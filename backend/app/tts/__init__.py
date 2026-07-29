"""Seleção do motor de síntese conforme TTS_ENGINE."""

from __future__ import annotations

from ..config import settings
from ..logging_setup import get_logger
from .base import (
    EngineError,
    EngineOutOfMemory,
    SynthesisRequest,
    SynthesisResult,
    TTSEngine,
)

log = get_logger("vct.engine")

_engine: TTSEngine | None = None


def build_engine(name: str | None = None) -> TTSEngine:
    name = (name or settings.tts_engine).lower()
    if name == "dummy":
        from .dummy import DummyEngine

        return DummyEngine()
    if name == "moss":
        from .moss import MossTTSEngine

        return MossTTSEngine()
    raise ValueError(f"TTS_ENGINE desconhecido: {name!r} (use 'moss' ou 'dummy')")


def get_engine() -> TTSEngine:
    global _engine
    if _engine is None:
        _engine = build_engine()
        log.info("motor de síntese: %s (%s)", _engine.name, _engine.model_id)
    return _engine


def reset_engine() -> None:
    global _engine
    if _engine is not None:
        _engine.unload()
    _engine = None


__all__ = [
    "EngineError",
    "EngineOutOfMemory",
    "SynthesisRequest",
    "SynthesisResult",
    "TTSEngine",
    "build_engine",
    "get_engine",
    "reset_engine",
]
