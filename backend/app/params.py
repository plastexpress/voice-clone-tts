"""Resolução dos parâmetros efetivos de cada geração.

Precedência:  padrão do serviço  ->  configuração do token  ->  corpo do request
(o último nível só é aplicado se o token tiver `allow_overrides`).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from typing import Any

from .auth import TokenContext
from .config import settings
from .schemas import TTSRequest

VALID_FORMATS = {"opus", "wav"}


@dataclass(slots=True)
class RenderParams:
    """Tudo que determina o áudio final — é a base da chave de cache."""

    text: str
    voice_id: str | None
    voice_slug: str | None
    voice_version: str | None
    language: str | None
    temperature: float
    top_p: float
    top_k: int
    repetition_penalty: float
    max_new_tokens: int
    duration_tokens: int | None
    seed: int | None
    format: str
    bitrate: str
    channels: int
    sample_rate: int
    engine: str
    model_id: str

    def cache_key(self) -> str:
        payload = {
            "text": self.text,
            "voice": self.voice_id,
            "voice_version": self.voice_version,
            "language": self.language,
            "temperature": round(self.temperature, 4),
            "top_p": round(self.top_p, 4),
            "top_k": self.top_k,
            "repetition_penalty": round(self.repetition_penalty, 4),
            "max_new_tokens": self.max_new_tokens,
            "duration_tokens": self.duration_tokens,
            "seed": self.seed,
            "format": self.format,
            "bitrate": self.bitrate,
            "channels": self.channels,
            "sample_rate": self.sample_rate,
            "engine": self.engine,
            "model": self.model_id,
        }
        canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    def public_dict(self) -> dict[str, Any]:
        data = self.as_dict()
        data.pop("text", None)
        return data


def _as_float(value: Any, fallback: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _as_int(value: Any, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


# ~12,5 tokens de áudio por segundo de fala (ver docs). O MOSS às vezes não
# sorteia o token de fim de áudio (mais provável com temperature alta) e roda
# até o teto de max_new_tokens — sem isso, uma frase de 10s pode virar 5+
# minutos de geração (e estourar timeouts de proxy/túnel). O teto abaixo
# escala com o texto, com folga generosa pra pausas/entonação.
_TOKENS_PER_SECOND = 12.5
_CHARS_PER_SECOND_SLOW = 6.0
_SAFETY_MULTIPLIER = 3
_MIN_SAFETY_TOKENS = 150  # ~12s de áudio


def _safety_max_new_tokens(text: str, duration_tokens: int | None, requested: int) -> int:
    if duration_tokens:
        # duration_tokens já é um pedido explícito de duração; só damos uma
        # margem pra o modelo fechar a frase, não o texto inteiro de novo.
        cap = int(duration_tokens * 1.5) + _MIN_SAFETY_TOKENS
    else:
        chars = len((text or "").strip()) or 1
        estimated_seconds = chars / _CHARS_PER_SECOND_SLOW
        cap = int(estimated_seconds * _TOKENS_PER_SECOND * _SAFETY_MULTIPLIER)
    cap = max(cap, _MIN_SAFETY_TOKENS)
    return min(requested, cap)


def token_defaults(token: TokenContext) -> dict[str, Any]:
    """Padrões do serviço mesclados com o que o token define."""
    cfg = token.settings_json
    return {
        "language": (cfg.get("language") or settings.tts_default_language) or None,
        "temperature": _as_float(cfg.get("temperature"), settings.tts_temperature),
        "top_p": _as_float(cfg.get("top_p"), settings.tts_top_p),
        "top_k": _as_int(cfg.get("top_k"), settings.tts_top_k),
        "repetition_penalty": _as_float(
            cfg.get("repetition_penalty"), settings.tts_repetition_penalty
        ),
        "max_new_tokens": _as_int(cfg.get("max_new_tokens"), settings.moss_max_new_tokens),
        "duration_tokens": (
            _as_int(cfg.get("duration_tokens"), 0) or None
            if cfg.get("duration_tokens")
            else None
        ),
        "seed": _as_int(cfg.get("seed"), 0) if cfg.get("seed") not in (None, "") else None,
        "format": (cfg.get("format") or "opus").lower(),
        "bitrate": str(cfg.get("bitrate") or settings.opus_bitrate),
        "channels": _as_int(cfg.get("channels"), settings.opus_channels),
    }


def resolve(
    token: TokenContext,
    request: TTSRequest,
    voice: dict[str, Any] | None,
    *,
    engine_name: str,
    model_id: str,
) -> RenderParams:
    defaults = token_defaults(token)
    allow = token.allow_overrides

    def pick(field: str, value: Any) -> Any:
        if value is None or not allow:
            return defaults[field]
        return value

    fmt = str(pick("format", request.format)).lower()
    if fmt not in VALID_FORMATS:
        fmt = "opus"

    channels = _as_int(pick("channels", request.channels), settings.opus_channels)
    channels = 2 if channels >= 2 else 1

    text = request.text.strip()[: settings.tts_max_text_length]

    duration_tokens = pick("duration_tokens", request.duration_tokens)
    max_new_tokens = _as_int(
        pick("max_new_tokens", request.max_new_tokens), settings.moss_max_new_tokens
    )
    max_new_tokens = _safety_max_new_tokens(text, duration_tokens, max_new_tokens)

    return RenderParams(
        text=text,
        voice_id=(voice or {}).get("id"),
        voice_slug=(voice or {}).get("slug"),
        voice_version=(voice or {}).get("updated"),
        language=pick("language", request.language) or None,
        temperature=_as_float(pick("temperature", request.temperature), settings.tts_temperature),
        top_p=_as_float(pick("top_p", request.top_p), settings.tts_top_p),
        top_k=_as_int(pick("top_k", request.top_k), settings.tts_top_k),
        repetition_penalty=_as_float(
            pick("repetition_penalty", request.repetition_penalty),
            settings.tts_repetition_penalty,
        ),
        max_new_tokens=max_new_tokens,
        duration_tokens=duration_tokens,
        seed=pick("seed", request.seed),
        format=fmt,
        bitrate=str(pick("bitrate", request.bitrate) or settings.opus_bitrate),
        channels=channels,
        sample_rate=settings.opus_sample_rate,
        engine=engine_name,
        model_id=model_id,
    )
