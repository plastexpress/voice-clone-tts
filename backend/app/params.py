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


# ~12,5 tokens de áudio por segundo de fala (ver docs).
#
# O prompt do MOSS tem um campo explícito "Tokens: {n}" que diz ao modelo
# quanto ele deve falar. Sem ele (duration_tokens=None, o padrão até aqui) o
# modelo não tem nenhuma pista de duração e o mecanismo de parada (sortear o
# token de fim de áudio) fica pouco confiável — sobretudo com temperature
# alta: a frase real termina em poucos segundos e o resto vira silêncio,
# ruído ou uma palavra solta até bater o teto de max_new_tokens.
#
# Testado empiricamente: texto de 49 caracteres, SEM hint -> 24,5s de áudio
# (a frase real tinha uns 3s). Mesmo texto, COM duration_tokens=45 -> 3,6s,
# batendo quase exato no alvo. Por isso agora sempre mandamos um hint —
# estimado a partir do texto quando o cliente/token não pede uma duração
# específica — e o teto de segurança vira só uma rede de proteção enxuta em
# cima desse alvo, não mais o controle principal de duração.
_TOKENS_PER_SECOND = 12.5
_CHARS_PER_SECOND_NATURAL = 13.5  # calibrado no teste acima (49 chars / 3,6s)
_MIN_DURATION_TOKENS = 25  # ~2s — piso pra textos bem curtos
_SAFETY_MULTIPLIER = 1.6
_SAFETY_BUFFER_TOKENS = 80  # ~6,4s de folga acima do alvo


def _estimate_duration_tokens(text: str, speech_rate: float = 1.0) -> int:
    """Tokens de duração para o texto rodar no ritmo pedido.

    speech_rate > 1 = fala mais rápida (menos tokens pro mesmo texto);
    speech_rate < 1 = mais devagar (mais tokens). É controle de prosódia de
    verdade (o modelo fala diferente), não acelerar o áudio depois.
    """
    chars = len((text or "").strip()) or 1
    estimated_seconds = chars / _CHARS_PER_SECOND_NATURAL / max(speech_rate, 0.1)
    return max(_MIN_DURATION_TOKENS, round(estimated_seconds * _TOKENS_PER_SECOND))


def _safety_max_new_tokens(duration_tokens: int, requested: int) -> int:
    cap = int(duration_tokens * _SAFETY_MULTIPLIER) + _SAFETY_BUFFER_TOKENS
    return min(requested, cap) if requested else cap


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
        "speech_rate": _as_float(cfg.get("speech_rate"), 1.0),
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

    # duration_tokens: se ninguém pediu um valor específico, estima a partir
    # do texto (ajustado por speech_rate) e manda como hint pro modelo (ver
    # comentário acima da função) — sem isso o modelo não sabe quanto falar
    # e tende a "esticar" a geração. duration_tokens explícito tem prioridade
    # sobre speech_rate (é um controle mais fino, em tokens).
    speech_rate = _as_float(pick("speech_rate", request.speech_rate), 1.0)
    duration_tokens = pick("duration_tokens", request.duration_tokens) or _estimate_duration_tokens(
        text, speech_rate
    )
    max_new_tokens = _as_int(
        pick("max_new_tokens", request.max_new_tokens), settings.moss_max_new_tokens
    )
    max_new_tokens = _safety_max_new_tokens(duration_tokens, max_new_tokens)

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
