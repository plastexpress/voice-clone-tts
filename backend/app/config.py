"""Configuração do serviço, lida integralmente de variáveis de ambiente."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ------------------------------------------------------------------ HTTP
    api_host: str = "0.0.0.0"
    api_port: int = 8096
    api_title: str = "Voice Clone TTS API"
    cors_origins: str = "*"
    # URL pública da API (sem barra no fim) — usada para montar o link de
    # download do áudio nos callbacks de /v1/tts/async. Vazio = manda um
    # caminho relativo (o cliente do callback precisa saber a base).
    public_api_url: str = ""

    # ------------------------------------------------------------ PocketBase
    pb_url: str = "http://pocketbase:8090"
    pb_admin_email: str = "admin@voiceclone.local"
    pb_admin_password: str = "changeme"
    pb_timeout_seconds: float = 30.0

    # ---------------------------------------------------------------- Pastas
    audio_dir: Path = Path("/data/audio")
    voices_dir: Path = Path("/data/voices")
    work_dir: Path = Path("/tmp/vct")

    # ---------------------------------------------------------------- Engine
    tts_engine: Literal["moss", "dummy"] = "moss"
    moss_model_id: str = "OpenMOSS-Team/MOSS-TTS-Local-Transformer-v1.5"
    # Fixa o commit do repositório no Hugging Face. Vazio = sempre o mais recente.
    # Como o modelo roda com trust_remote_code (executa .py do repo), fixar aqui
    # impede que uma atualização futura do repo execute código novo na sua máquina.
    moss_model_revision: str = ""
    moss_device: str = "cuda"
    # Onde roda o audio tokenizer (codifica a referência, decodifica a fala).
    # Ele sozinho ocupa ~4GB de VRAM, então em placas de 12GB ou menos vale
    # deixá-lo na CPU: custa alguns segundos por geração e libera a placa
    # inteira para o modelo. "auto" decide pelo tamanho da sua GPU.
    moss_tokenizer_device: Literal["auto", "cuda", "cpu"] = "auto"
    # Abaixo desta VRAM total (GB), o modo "auto" manda o tokenizer para a CPU.
    moss_tokenizer_cpu_below_gb: float = 16.0
    moss_dtype: str = "bfloat16"
    moss_attn_implementation: str = "auto"
    moss_preload: bool = True
    moss_max_new_tokens: int = 4096

    # --------------------------------------------- parâmetros padrão de fala
    tts_temperature: float = 1.7
    tts_top_p: float = 0.8
    tts_top_k: int = 25
    tts_repetition_penalty: float = 1.0
    tts_default_language: str = "Portuguese"
    tts_max_text_length: int = 5000

    # ------------------------------------------------------------------ Opus
    opus_bitrate: str = "64k"
    opus_channels: int = 1
    opus_sample_rate: int = 48000
    opus_application: Literal["audio", "voip", "lowdelay"] = "audio"

    # ----------------------------------------------------------------- Cache
    cache_enabled: bool = True
    cache_max_gb: float = 20.0

    # ------------------------------------------------------------------ Fila
    queue_max_size: int = 64
    sync_timeout_seconds: float = 300.0
    job_retention_hours: int = 48
    # teto do ?wait= em GET /v1/jobs/{id}. Fica abaixo dos 100s que o
    # Cloudflare tolera na frente da API — passar disso vira 524 no cliente.
    job_wait_max_seconds: float = 90.0
    job_wait_poll_interval: float = 0.5

    # -------------------------------------------------------- Observabilidade
    request_log_enabled: bool = True
    log_level: str = "INFO"

    # ------------------------------------------------------------------ misc
    # Chave simétrica (Fernet, 32 bytes urlsafe-base64) usada para guardar o
    # token da API de forma reversível, além do hash — permite "revelar" o
    # valor depois pela interface. Gere com:
    #   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    # Sem essa chave, o token continua funcionando normalmente (a autenticação
    # usa só o hash); só a funcionalidade de "revelar" fica indisponível.
    token_encryption_key: str = ""
    token_cache_ttl_seconds: float = 20.0
    ffmpeg_bin: str = "ffmpeg"
    ffprobe_bin: str = "ffprobe"

    max_reference_audio_mb: float = 25.0

    version: str = Field(default="1.0.0")

    @field_validator("audio_dir", "voices_dir", "work_dir", mode="before")
    @classmethod
    def _expand(cls, value: object) -> object:
        if isinstance(value, str):
            return Path(value).expanduser()
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        raw = (self.cors_origins or "").strip()
        if not raw or raw == "*":
            return ["*"]
        return [item.strip() for item in raw.split(",") if item.strip()]

    def ensure_dirs(self) -> None:
        for path in (self.audio_dir, self.voices_dir, self.work_dir):
            path.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
