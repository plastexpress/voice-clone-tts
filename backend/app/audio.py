"""Conversão de áudio via ffmpeg (WAV do modelo -> Opus entregue na API)."""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .config import settings
from .logging_setup import get_logger

log = get_logger("vct.audio")

OPUS_MIME = "audio/ogg"
WAV_MIME = "audio/wav"

MIME_BY_FORMAT = {"opus": OPUS_MIME, "wav": WAV_MIME}


class AudioError(RuntimeError):
    pass


@dataclass(slots=True)
class AudioInfo:
    path: Path
    size_bytes: int
    duration_ms: int
    sample_rate: int
    channels: int
    format: str


def ffmpeg_available() -> bool:
    return shutil.which(settings.ffmpeg_bin) is not None


def _run(cmd: list[str]) -> str:
    log.debug("exec: %s", " ".join(cmd))
    try:
        completed = subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except FileNotFoundError as exc:
        raise AudioError(f"binário não encontrado: {cmd[0]} (instale o ffmpeg)") from exc
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or "").strip().splitlines()
        tail = " | ".join(stderr[-4:]) if stderr else "sem detalhes"
        raise AudioError(f"{cmd[0]} falhou: {tail}") from exc
    return completed.stdout


def probe(path: Path) -> dict:
    """Metadados do arquivo via ffprobe."""
    output = _run(
        [
            settings.ffprobe_bin,
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(path),
        ]
    )
    try:
        return json.loads(output)
    except json.JSONDecodeError as exc:
        raise AudioError(f"ffprobe devolveu algo inesperado para {path.name}") from exc


def _audio_stream(data: dict) -> dict:
    for stream in data.get("streams", []):
        if stream.get("codec_type") == "audio":
            return stream
    return {}


def inspect(path: Path, fmt: str = "opus") -> AudioInfo:
    data = probe(path)
    stream = _audio_stream(data)
    duration_s = 0.0
    for candidate in (stream.get("duration"), (data.get("format") or {}).get("duration")):
        try:
            duration_s = float(candidate)
            break
        except (TypeError, ValueError):
            continue
    return AudioInfo(
        path=path,
        size_bytes=path.stat().st_size,
        duration_ms=int(round(duration_s * 1000)),
        sample_rate=int(stream.get("sample_rate") or 0),
        channels=int(stream.get("channels") or 0),
        format=fmt,
    )


def encode_opus(
    source: Path,
    dest: Path,
    *,
    bitrate: str | None = None,
    channels: int | None = None,
    sample_rate: int | None = None,
    application: str | None = None,
) -> AudioInfo:
    """Converte o WAV gerado pelo modelo em .opus (container Ogg)."""
    bitrate = bitrate or settings.opus_bitrate
    channels = channels or settings.opus_channels
    sample_rate = sample_rate or settings.opus_sample_rate
    application = application or settings.opus_application

    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")

    _run(
        [
            settings.ffmpeg_bin,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(source),
            "-c:a",
            "libopus",
            "-b:a",
            str(bitrate),
            "-vbr",
            "on",
            "-application",
            application,
            "-ac",
            str(channels),
            "-ar",
            str(sample_rate),
            "-map_metadata",
            "-1",
            # o arquivo temporário termina em .tmp: o formato precisa ser explícito
            "-f",
            "opus",
            str(tmp),
        ]
    )

    tmp.replace(dest)
    return inspect(dest, "opus")


def copy_as_wav(source: Path, dest: Path, *, channels: int | None = None) -> AudioInfo:
    """Saída em WAV 16 bits (para `format: "wav"` na API)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    cmd = [
        settings.ffmpeg_bin,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(source),
        "-c:a",
        "pcm_s16le",
    ]
    if channels:
        cmd += ["-ac", str(channels)]
    cmd += ["-f", "wav", str(tmp)]
    _run(cmd)
    tmp.replace(dest)
    return inspect(dest, "wav")


def normalize_reference(source: Path, dest: Path) -> Path:
    """Converte o áudio de referência do clone para WAV mono.

    O MOSS aceita vários formatos, mas normalizar aqui evita depender do
    backend de decodificação do torchaudio dentro do container.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    _run(
        [
            settings.ffmpeg_bin,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(source),
            "-c:a",
            "pcm_s16le",
            "-ac",
            "1",
            "-f",
            "wav",
            str(tmp),
        ]
    )
    tmp.replace(dest)
    return dest
