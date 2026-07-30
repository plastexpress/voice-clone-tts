"""MOSS-TTS Local rodando localmente na GPU (RTX 3060 12GB).

Baseado no uso oficial do repositório OpenMOSS/MOSS-TTS: o `AutoProcessor` monta
a conversa (texto + áudio de referência para clonagem), o `AutoModel` gera os
tokens de áudio e o próprio processor decodifica para forma de onda.

Tudo aqui é síncrono e roda numa única thread — a serialização da GPU é feita
pela fila em app/queue.py.
"""

from __future__ import annotations

import inspect
import threading
import time
from pathlib import Path
from typing import Any

from ..config import settings
from ..logging_setup import get_logger
from .base import EngineError, EngineOutOfMemory, SynthesisRequest, SynthesisResult, TTSEngine

log = get_logger("vct.engine.moss")


_audio_io_patched = False


def _ensure_audio_io() -> None:
    """Faz o torchaudio funcionar sem o torchcodec.

    O torchaudio 2.9 delega `load`/`save` para o pacote `torchcodec`, que
    precisa de um build de FFmpeg compatível e falha nesta imagem
    (`Could not load libtorchcodec`). Isso quebraria dois pontos:

      * o nosso salvamento do WAV gerado;
      * o `torchaudio.load()` que o processor do MOSS usa para ler o áudio de
        referência do clone (processing_moss_tts.py).

    Aqui trocamos as duas funções por `soundfile` (libsndfile), que lê e
    escreve WAV sem depender de FFmpeg. Só é aplicado se o torchcodec estiver
    mesmo indisponível — se um dia funcionar, o torchaudio original é mantido.
    """
    global _audio_io_patched
    if _audio_io_patched:
        return

    import torch
    import torchaudio

    try:
        from torchcodec.encoders import AudioEncoder  # noqa: F401

        _audio_io_patched = True
        log.debug("torchcodec disponível — usando o torchaudio original")
        return
    except Exception as exc:  # noqa: BLE001
        log.info("torchcodec indisponível (%s); usando soundfile para I/O de áudio", type(exc).__name__)

    import soundfile as sf

    def _load(uri, *args, **kwargs):  # noqa: ANN001
        data, sample_rate = sf.read(str(uri), dtype="float32", always_2d=True)
        return torch.from_numpy(data.T.copy()), int(sample_rate)

    def _save(uri, src, sample_rate, *args, **kwargs):  # noqa: ANN001
        array = src.detach().cpu().to(torch.float32).numpy()
        if array.ndim == 1:
            array = array[None, :]
        sf.write(str(uri), array.T, int(sample_rate), subtype="FLOAT")

    torchaudio.load = _load
    torchaudio.save = _save
    _audio_io_patched = True


def _write_wav(path: Any, waveform: Any, sample_rate: int) -> None:
    """Grava a forma de onda [canais, amostras] em WAV, sem torchcodec."""
    import numpy as np
    import soundfile as sf
    import torch

    array = waveform.detach().cpu().to(torch.float32).numpy()
    if array.ndim == 1:
        array = array[None, :]
    array = np.clip(array, -1.0, 1.0)
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), array.T, int(sample_rate), subtype="FLOAT")


def _filter_kwargs(func: Any, kwargs: dict[str, Any]) -> dict[str, Any]:
    """Remove kwargs que a versão instalada do MOSS não aceita."""
    try:
        signature = inspect.signature(func)
    except (TypeError, ValueError):
        return kwargs
    params = signature.parameters
    if any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values()):
        return kwargs
    accepted = {name: value for name, value in kwargs.items() if name in params}
    dropped = set(kwargs) - set(accepted)
    if dropped:
        log.debug("parâmetros ignorados por %s: %s", getattr(func, "__name__", func), dropped)
    return accepted


class MossTTSEngine(TTSEngine):
    name = "moss"

    def __init__(
        self,
        model_id: str | None = None,
        device: str | None = None,
        dtype: str | None = None,
        attn_implementation: str | None = None,
        revision: str | None = None,
    ) -> None:
        self._model_id = model_id or settings.moss_model_id
        self._revision = (revision if revision is not None else settings.moss_model_revision) or None
        self._device = device or settings.moss_device
        self._dtype_name = (dtype or settings.moss_dtype).lower()
        self._attn = attn_implementation or settings.moss_attn_implementation
        self._model = None
        self._processor = None
        self._sampling_rate = 48000
        self._resolved_attn: str | None = None
        self._tokenizer_device: str | None = None
        self._load_lock = threading.Lock()
        # códigos de áudio já codificados por referência (path -> (mtime, tensor)).
        # evita reencodar a mesma referência de voz em toda geração — para um
        # clone com ~1min de áudio, o encode na CPU custa minutos, mas só
        # muda quando o arquivo de referência é substituído.
        self._reference_cache: dict[str, tuple[float, Any]] = {}
        self._reference_cache_lock = threading.Lock()

    # ------------------------------------------------------------------ VRAM
    @staticmethod
    def _free_cuda() -> None:
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:  # noqa: BLE001
            pass

    @staticmethod
    def _vram_summary() -> str:
        try:
            import torch

            if not torch.cuda.is_available():
                return ""
            free, total = torch.cuda.mem_get_info(0)
            return f"VRAM livre {free / 1024**3:.1f} GB de {total / 1024**3:.1f} GB."
        except Exception:  # noqa: BLE001
            return ""

    # ------------------------------------------------------------------ infos
    @property
    def model_id(self) -> str:
        return self._model_id

    @property
    def device(self) -> str:
        return self._device

    @property
    def is_loaded(self) -> bool:
        return self._model is not None and self._processor is not None

    @property
    def sampling_rate(self) -> int:
        return self._sampling_rate

    def info(self) -> dict[str, Any]:
        data = super().info()
        data.update(
            {
                "dtype": self._dtype_name,
                "attn_implementation": self._resolved_attn,
                "tokenizer_device": self._tokenizer_device,
                "revision": self._revision or "latest",
                "sampling_rate": self._sampling_rate if self.is_loaded else None,
            }
        )
        return data

    # ------------------------------------------------------------------- load
    def _resolve_dtype(self) -> Any:
        import torch

        mapping = {
            "bfloat16": torch.bfloat16,
            "bf16": torch.bfloat16,
            "float16": torch.float16,
            "fp16": torch.float16,
            "half": torch.float16,
            "float32": torch.float32,
            "fp32": torch.float32,
        }
        if self._device == "cpu":
            return torch.float32
        return mapping.get(self._dtype_name, torch.bfloat16)

    def _resolve_tokenizer_device(self) -> str:
        """Onde colocar o audio tokenizer.

        Ele sozinho ocupa cerca de 4GB de VRAM. Numa placa de 12GB isso não
        sobra depois do modelo de 5B (~8,5GB), então o padrão "auto" manda o
        tokenizer para a CPU em GPUs menores que `moss_tokenizer_cpu_below_gb`.
        O custo é alguns segundos por geração; o benefício é o serviço subir.
        """
        import torch

        choice = (settings.moss_tokenizer_device or "auto").lower()
        if choice in {"cpu", "cuda"}:
            return choice
        if not self._device.startswith("cuda") or not torch.cuda.is_available():
            return "cpu"

        total_gb = torch.cuda.get_device_properties(0).total_memory / 1024**3
        if total_gb < settings.moss_tokenizer_cpu_below_gb:
            log.info(
                "GPU com %.1f GB: mantendo o audio tokenizer na CPU para sobrar "
                "VRAM para o modelo (mude com MOSS_TOKENIZER_DEVICE)",
                total_gb,
            )
            return "cpu"
        return self._device

    def _resolve_attn_implementation(self, dtype: Any) -> str:
        import importlib.util

        import torch

        if self._attn and self._attn != "auto":
            return self._attn
        if self._device.startswith("cuda"):
            if (
                importlib.util.find_spec("flash_attn") is not None
                and dtype in {torch.float16, torch.bfloat16}
                and torch.cuda.is_available()
                and torch.cuda.get_device_capability()[0] >= 8
            ):
                return "flash_attention_2"
            return "sdpa"
        return "eager"

    def load(self) -> None:
        if self.is_loaded:
            return
        with self._load_lock:
            if self.is_loaded:
                return

            import torch
            from transformers import AutoModel, AutoProcessor

            # o processor do MOSS lê o áudio de referência com torchaudio.load
            _ensure_audio_io()

            # o backend cuDNN de SDPA quebra este modelo (ver README do MOSS-TTS)
            torch.backends.cuda.enable_cudnn_sdp(False)
            torch.backends.cuda.enable_flash_sdp(True)
            torch.backends.cuda.enable_mem_efficient_sdp(True)
            torch.backends.cuda.enable_math_sdp(True)

            if self._device.startswith("cuda") and not torch.cuda.is_available():
                raise EngineError(
                    "CUDA não está disponível no container. Confira se o Docker "
                    "está com acesso à GPU (--gpus all) ou use TTS_ENGINE=dummy."
                )

            dtype = self._resolve_dtype()
            self._resolved_attn = self._resolve_attn_implementation(dtype)

            started = time.perf_counter()
            log.info(
                "carregando %s (device=%s dtype=%s attn=%s revision=%s) — o 1º boot baixa os pesos",
                self._model_id,
                self._device,
                self._dtype_name,
                self._resolved_attn,
                self._revision or "latest",
            )
            if not self._revision:
                log.warning(
                    "MOSS_MODEL_REVISION não está definido: o modelo roda com "
                    "trust_remote_code e pode baixar código novo do Hugging Face a "
                    "cada atualização do repositório. Fixe um commit em produção."
                )

            # `revision` só é passado quando definido, para não quebrar em versões
            # antigas do transformers que tratam None de forma diferente.
            pin = {"revision": self._revision} if self._revision else {}

            processor = AutoProcessor.from_pretrained(
                self._model_id, trust_remote_code=True, **pin
            )

            self._tokenizer_device = self._resolve_tokenizer_device()
            if hasattr(processor, "audio_tokenizer") and processor.audio_tokenizer is not None:
                # NÃO converter para bf16: o forward do audio tokenizer
                # (modeling_moss_audio_tokenizer.py) tem `.float()` embutido em
                # pontos internos (ex.: antes do quantizer), então mistura
                # ativação float32 com pesos bf16 e quebra com
                # "Input type (float) and bias type (c10::BFloat16) should be
                # the same". Confirmado via teste real — reproduzir com cuidado
                # antes de tentar de novo.
                processor.audio_tokenizer = processor.audio_tokenizer.to(self._tokenizer_device)

            try:
                model = AutoModel.from_pretrained(
                    self._model_id,
                    trust_remote_code=True,
                    attn_implementation=self._resolved_attn,
                    dtype=dtype,
                    **pin,
                ).to(self._device)
            except RuntimeError as exc:
                message = str(exc).lower()
                if any(
                    hint in message
                    for hint in ("out of memory", "device not ready", "cuda error", "allocat")
                ):
                    self._free_cuda()
                    raise EngineOutOfMemory(
                        f"não coube na VRAM ao carregar {self._model_id}. "
                        f"{self._vram_summary()} Saídas, em ordem: "
                        "1) MOSS_TOKENIZER_DEVICE=cpu (libera ~4GB); "
                        "2) trocar para o modelo menor "
                        "MOSS_MODEL_ID=OpenMOSS-Team/MOSS-TTS-Local-Transformer; "
                        "3) fechar outros programas que usam a GPU."
                    ) from exc
                raise
            model.eval()

            self._processor = processor
            self._model = model
            self._sampling_rate = int(
                getattr(getattr(processor, "model_config", None), "sampling_rate", 48000) or 48000
            )

            log.info(
                "modelo pronto em %.1fs (sample rate %d Hz, tokenizer em %s). %s",
                time.perf_counter() - started,
                self._sampling_rate,
                self._tokenizer_device,
                self._vram_summary(),
            )

    def unload(self) -> None:
        with self._load_lock:
            self._model = None
            self._processor = None
            try:
                import torch

                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:  # noqa: BLE001
                pass
            log.info("modelo descarregado da memória")

    # ---------------------------------------------------- cache de referência
    def _encode_reference(self, path: Path) -> Any:
        """Codifica o áudio de referência em codes e guarda em cache por path+mtime.

        `build_user_message(reference=...)` aceita tanto um path (reencoda do
        zero) quanto um `torch.Tensor` de codes já prontos. Como o audio
        tokenizer roda na CPU (ver `_resolve_tokenizer_device`), reencodar a
        cada request é o gargalo que faz toda geração demorar o mesmo tanto,
        clone ou não — este cache faz isso acontecer só na 1ª vez por voz.
        """
        key = str(path)
        mtime = path.stat().st_mtime
        with self._reference_cache_lock:
            cached = self._reference_cache.get(key)
            if cached is not None and cached[0] == mtime:
                return cached[1]

        assert self._processor is not None
        started = time.perf_counter()
        codes = self._processor.encode_audios_from_path([key])[0]
        log.info(
            "referência %s codificada em %.1fs (cache miss — próximas gerações com esta voz pulam este passo)",
            path.name,
            time.perf_counter() - started,
        )
        with self._reference_cache_lock:
            self._reference_cache[key] = (mtime, codes)
        return codes

    # -------------------------------------------------------------- síntese
    def synthesize(self, request: SynthesisRequest) -> SynthesisResult:
        self.load()

        import torch

        assert self._processor is not None and self._model is not None

        if request.seed is not None:
            torch.manual_seed(request.seed)
            if torch.cuda.is_available():
                torch.cuda.manual_seed_all(request.seed)

        message_kwargs: dict[str, Any] = {"text": request.text}
        if request.reference_audio is not None:
            message_kwargs["reference"] = [self._encode_reference(request.reference_audio)]
            if request.reference_text:
                message_kwargs["reference_text"] = request.reference_text
        if request.language:
            message_kwargs["language"] = request.language
        if request.duration_tokens:
            message_kwargs["tokens"] = request.duration_tokens
        if request.instruction:
            message_kwargs["instruction"] = request.instruction

        build = self._processor.build_user_message
        message = build(**_filter_kwargs(build, message_kwargs))
        conversations = [[message]]

        generate_kwargs: dict[str, Any] = {
            "max_new_tokens": request.max_new_tokens,
            "audio_temperature": request.temperature,
            "audio_top_p": request.top_p,
            "audio_top_k": request.top_k,
            "audio_repetition_penalty": request.repetition_penalty,
        }

        started = time.perf_counter()
        try:
            with torch.no_grad():
                batch = self._processor(conversations, mode="generation")
                input_ids = batch["input_ids"].to(self._device)
                attention_mask = batch["attention_mask"].to(self._device)

                gen_started = time.perf_counter()
                try:
                    outputs = self._model.generate(
                        input_ids=input_ids,
                        attention_mask=attention_mask,
                        **generate_kwargs,
                    )
                except TypeError as exc:
                    # versão do modelo sem os parâmetros audio_*: repete só com o essencial
                    log.warning("generate() recusou os parâmetros de amostragem (%s)", exc)
                    outputs = self._model.generate(
                        input_ids=input_ids,
                        attention_mask=attention_mask,
                        max_new_tokens=request.max_new_tokens,
                    )
                generate_ms = int((time.perf_counter() - gen_started) * 1000)

                decode_started = time.perf_counter()
                audio = None
                for decoded in self._processor.decode(outputs):
                    codes = getattr(decoded, "audio_codes_list", None)
                    if codes:
                        audio = codes[0]
                        break
                decode_ms = int((time.perf_counter() - decode_started) * 1000)
                log.info(
                    "split: generate() %dms (LLM, %s) | decode() %dms (audio tokenizer, %s)",
                    generate_ms,
                    self._device,
                    decode_ms,
                    self._tokenizer_device,
                )
        except torch.cuda.OutOfMemoryError as exc:  # type: ignore[attr-defined]
            torch.cuda.empty_cache()
            raise EngineOutOfMemory(
                "VRAM insuficiente. Reduza o texto, baixe MOSS_MAX_NEW_TOKENS ou "
                "use o modelo menor (OpenMOSS-Team/MOSS-TTS-Local-Transformer)."
            ) from exc
        except RuntimeError as exc:
            if "out of memory" in str(exc).lower():
                torch.cuda.empty_cache()
                raise EngineOutOfMemory("VRAM insuficiente durante a geração.") from exc
            raise EngineError(f"falha na geração: {exc}") from exc

        if audio is None:
            raise EngineError("o modelo não devolveu áudio para este texto")

        waveform = audio.detach().cpu().to(torch.float32)
        if waveform.ndim == 1:
            waveform = waveform.unsqueeze(0)

        _write_wav(request.output_path, waveform, self._sampling_rate)

        channels, samples = waveform.shape[0], waveform.shape[-1]
        duration_ms = int(round(samples / self._sampling_rate * 1000))
        log.info(
            "gerados %.1fs de áudio em %.1fs (%d caracteres)",
            duration_ms / 1000,
            time.perf_counter() - started,
            len(request.text),
        )

        return SynthesisResult(
            path=request.output_path,
            sample_rate=self._sampling_rate,
            channels=channels,
            duration_ms=duration_ms,
            model_id=self._model_id,
            engine=self.name,
        )
