"""Contratos de entrada e saída da API."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .config import settings


class TTSRequest(BaseModel):
    """Corpo de POST /v1/tts.

    Só `text` é obrigatório: voz, idioma e parâmetros vêm da configuração do
    token. Os campos opcionais só são aceitos se o token tiver `allow_overrides`.
    """

    model_config = ConfigDict(extra="forbid")

    text: str = Field(..., min_length=1, description="Texto a ser falado")

    # --- overrides opcionais -------------------------------------------------
    voice: str | None = Field(
        default=None, description="slug ou id do clone de voz (sobrescreve o do token)"
    )
    language: str | None = Field(
        default=None, description='Idioma, ex.: "Portuguese", "English", "Spanish"'
    )
    format: Literal["opus", "wav"] | None = Field(
        default=None, description="Formato de saída (padrão: opus)"
    )
    bitrate: str | None = Field(default=None, description='Bitrate do Opus, ex.: "64k"')
    channels: int | None = Field(default=None, ge=1, le=2)

    temperature: float | None = Field(default=None, gt=0, le=3)
    top_p: float | None = Field(default=None, gt=0, le=1)
    top_k: int | None = Field(default=None, ge=0, le=500)
    repetition_penalty: float | None = Field(default=None, ge=0.5, le=3)
    max_new_tokens: int | None = Field(default=None, ge=32, le=32768)
    duration_tokens: int | None = Field(
        default=None,
        ge=1,
        description="Controle de duração: 1s de fala ≈ 12.5 tokens",
    )
    seed: int | None = Field(default=None, ge=0)

    cache: bool | None = Field(
        default=None, description="false força regeneração mesmo com cache disponível"
    )

    def truncated_text(self) -> str:
        return self.text[: settings.tts_max_text_length]


class TTSJsonResponse(BaseModel):
    """Resposta de POST /v1/tts?format=json."""

    id: str
    audio_base64: str
    format: str
    mime_type: str
    duration_ms: int
    size_bytes: int
    sample_rate: int
    channels: int
    cached: bool
    voice: str | None = None
    model: str
    queue_ms: int
    generation_ms: int
    total_ms: int


class JobCreatedResponse(BaseModel):
    job_id: str
    status: str
    status_url: str
    queue_position: int


class JobStatusResponse(BaseModel):
    job_id: str
    status: Literal["queued", "processing", "completed", "failed", "canceled"]
    cached: bool = False
    audio_url: str | None = None
    audio_id: str | None = None
    duration_ms: int | None = None
    queue_ms: int | None = None
    generation_ms: int | None = None
    error: str | None = None
    created: str | None = None
    finished_at: str | None = None


class VoiceOut(BaseModel):
    id: str
    slug: str
    name: str
    description: str | None = None
    language: str | None = None
    has_reference_audio: bool = False


class TokenInfo(BaseModel):
    """GET /v1/me — o cliente descobre o que o token já traz configurado."""

    name: str
    prefix: str
    active: bool
    expires_at: str | None = None
    allow_overrides: bool
    voice: VoiceOut | None = None
    defaults: dict[str, Any]
    request_count: int
    cached_count: int
    rate_limit_per_min: int


class HealthResponse(BaseModel):
    status: str
    version: str
    engine: str
    model: str
    model_loaded: bool
    device: str
    pocketbase: bool


class SystemStatus(BaseModel):
    engine: str
    model: str
    model_loaded: bool
    device: str
    dtype: str | None = None
    queue_depth: int
    queue_max: int
    processing: bool
    current_job: str | None = None
    gpu: dict[str, Any] | None = None
    cache: dict[str, Any]
    uptime_seconds: float


class ErrorResponse(BaseModel):
    error: str
    detail: str | None = None
