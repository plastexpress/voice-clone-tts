"""Interface comum dos motores de síntese."""

from __future__ import annotations

import abc
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class EngineError(RuntimeError):
    """Falha durante a síntese (mensagem chega ao cliente)."""


class EngineOutOfMemory(EngineError):
    """VRAM insuficiente para o texto/parâmetros pedidos."""


@dataclass(slots=True)
class SynthesisRequest:
    text: str
    output_path: Path
    reference_audio: Path | None = None
    reference_text: str | None = None
    language: str | None = None
    temperature: float = 1.7
    top_p: float = 0.8
    top_k: int = 25
    repetition_penalty: float = 1.0
    max_new_tokens: int = 4096
    duration_tokens: int | None = None
    seed: int | None = None


@dataclass(slots=True)
class SynthesisResult:
    path: Path
    sample_rate: int
    channels: int
    duration_ms: int
    model_id: str
    engine: str


class TTSEngine(abc.ABC):
    """Motor de síntese. `synthesize` roda numa thread dedicada (1 por vez)."""

    name: str = "base"

    @property
    @abc.abstractmethod
    def model_id(self) -> str: ...

    @property
    @abc.abstractmethod
    def device(self) -> str: ...

    @property
    @abc.abstractmethod
    def is_loaded(self) -> bool: ...

    @abc.abstractmethod
    def load(self) -> None:
        """Carrega pesos na memória/GPU. Idempotente."""

    @abc.abstractmethod
    def synthesize(self, request: SynthesisRequest) -> SynthesisResult:
        """Gera o áudio em `request.output_path` (WAV) e devolve os metadados."""

    def unload(self) -> None:  # pragma: no cover - opcional
        """Libera a memória do modelo."""

    def info(self) -> dict[str, Any]:
        return {
            "engine": self.name,
            "model": self.model_id,
            "device": self.device,
            "loaded": self.is_loaded,
        }
