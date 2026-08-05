"""Contratos de entrada e saída da API."""

from __future__ import annotations

import ipaddress
from typing import Any, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .config import settings

# hosts que um callback_url não pode apontar — evita que um token da API vire
# um jeito de fazer o backend chamar serviços internos da rede docker (SSRF).
# Não resolve DNS (não protege contra DNS rebinding), só barra o caso óbvio
# de alguém apontar direto pra um IP/hostname interno.
_BLOCKED_CALLBACK_HOSTS = {"localhost", "0.0.0.0", "pocketbase", "backend", "frontend"}

# headers que o cliente não pode sobrescrever na chamada de callback — mexem
# no transporte HTTP em si, não são "dados" que façam sentido customizar.
_BLOCKED_CALLBACK_HEADER_NAMES = {"host", "content-length", "transfer-encoding", "connection"}
_MAX_CALLBACK_HEADERS = 20


def _validate_callback_url(value: str | None) -> str | None:
    if not value:
        return None
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("callback_url precisa começar com http:// ou https://")
    host = (parsed.hostname or "").lower()
    if not host:
        raise ValueError("callback_url sem host válido")
    if host in _BLOCKED_CALLBACK_HOSTS:
        raise ValueError(f"callback_url não pode apontar para '{host}'")
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        pass  # é um hostname, não um IP literal — segue
    else:
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise ValueError("callback_url não pode apontar para um IP privado/interno")
    return value


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
        description="Controle de duração em tokens: 1s de fala ≈ 12.5 tokens. Se enviado, tem prioridade sobre speech_rate.",
    )
    speech_rate: float | None = Field(
        default=None,
        gt=0.4,
        le=2.5,
        description=(
            "Velocidade da fala (não é acelerar o áudio depois — é o próprio modelo falando "
            "mais rápido/devagar, via duration_tokens). 1.0 = normal, 1.3 = ~30% mais rápido, "
            "0.7 = ~30% mais devagar."
        ),
    )
    seed: int | None = Field(default=None, ge=0)
    instruction: str | None = Field(
        default=None,
        max_length=500,
        description=(
            "Instrução livre em texto pro modelo, ex.: 'fale com sotaque americano'. "
            "Não é um campo documentado oficialmente pelo MOSS — funciona por tentativa e erro."
        ),
    )

    cache: bool | None = Field(
        default=None, description="false força regeneração mesmo com cache disponível"
    )

    # --- callback (só usado por /v1/tts/async) --------------------------------
    callback_url: str | None = Field(
        default=None,
        description="POST /v1/tts/async: URL chamada quando o job terminar (sucesso ou falha).",
    )
    callback_token: str | None = Field(
        default=None,
        max_length=2000,
        description='Atalho: enviado como "Authorization: Bearer <valor>" na chamada de callback.',
    )
    callback_headers: dict[str, str] | None = Field(
        default=None,
        description=(
            "Headers extras na chamada de callback, ex.: {\"X-Api-Key\": \"...\"}. "
            "Se colidir com callback_token (ex.: Authorization), callback_headers vence."
        ),
    )

    @field_validator("callback_url")
    @classmethod
    def _check_callback_url(cls, value: str | None) -> str | None:
        return _validate_callback_url(value)

    @field_validator("callback_headers")
    @classmethod
    def _check_callback_headers(cls, value: dict[str, str] | None) -> dict[str, str] | None:
        if not value:
            return value
        if len(value) > _MAX_CALLBACK_HEADERS:
            raise ValueError(f"callback_headers aceita no máximo {_MAX_CALLBACK_HEADERS} headers")
        for key, val in value.items():
            if not isinstance(key, str) or not isinstance(val, str):
                raise ValueError("callback_headers precisa mapear string para string")
            if key.lower() in _BLOCKED_CALLBACK_HEADER_NAMES:
                raise ValueError(f"callback_headers não pode definir '{key}'")
            if len(key) > 200 or len(val) > 4000:
                raise ValueError("chave/valor de callback_headers muito grande")
        return value

    def merged_callback_headers(self) -> dict[str, str]:
        """Combina callback_token (atalho) com callback_headers (headers explícitos)."""
        headers: dict[str, str] = {}
        if self.callback_token:
            headers["Authorization"] = f"Bearer {self.callback_token}"
        if self.callback_headers:
            headers.update(self.callback_headers)
        return headers

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
    # preenchidos só quando o job terminou e o cliente pediu ?format=json
    audio_base64: str | None = None
    mime_type: str | None = None
    size_bytes: int | None = None


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
