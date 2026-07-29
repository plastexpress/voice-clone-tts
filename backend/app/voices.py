"""Resolução dos clones de voz e cache local dos áudios de referência.

O áudio de referência é enviado pela interface e fica no PocketBase. Aqui ele é
baixado uma vez para /data/voices e normalizado para WAV mono; enquanto o
registro não mudar (campo `updated`), o arquivo local é reaproveitado.
"""

from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any

from .audio import normalize_reference
from .config import settings
from .logging_setup import get_logger
from .pocketbase import pb, quote

log = get_logger("vct.voices")

_SAFE = re.compile(r"[^a-zA-Z0-9._-]+")
_locks: dict[str, asyncio.Lock] = {}


class VoiceNotFound(LookupError):
    pass


def _safe(value: str) -> str:
    return _SAFE.sub("_", value)[:80]


async def resolve_voice(identifier: str) -> dict[str, Any]:
    """Aceita id do PocketBase ou slug; devolve o registro do clone."""
    identifier = identifier.strip()
    if not identifier:
        raise VoiceNotFound("clone de voz não informado")

    record = await pb.first_record("voices", filter=f"slug = {quote(identifier)}")
    if record is None:
        record = await pb.get_record("voices", identifier)
    if record is None:
        raise VoiceNotFound(f"clone de voz '{identifier}' não encontrado")
    if not record.get("active", True):
        raise VoiceNotFound(f"clone de voz '{identifier}' está desativado")
    return record


async def reference_audio_path(voice: dict[str, Any] | None) -> Path | None:
    """Garante o áudio de referência em disco e devolve o caminho local."""
    if not voice:
        return None
    filename = voice.get("reference_audio")
    if not filename:
        return None

    voice_id = str(voice.get("id"))
    stamp = _safe(str(voice.get("updated") or "0"))
    target = settings.voices_dir / voice_id / f"{stamp}.wav"

    if target.exists() and target.stat().st_size > 0:
        return target

    lock = _locks.setdefault(voice_id, asyncio.Lock())
    async with lock:
        if target.exists() and target.stat().st_size > 0:
            return target

        raw = settings.voices_dir / voice_id / f"raw_{_safe(str(filename))}"
        log.info("baixando áudio de referência do clone '%s'", voice.get("slug") or voice_id)
        await pb.download_file("voices", voice_id, str(filename), raw)

        size_mb = raw.stat().st_size / (1024 * 1024)
        if size_mb > settings.max_reference_audio_mb:
            raw.unlink(missing_ok=True)
            raise ValueError(
                f"áudio de referência tem {size_mb:.1f}MB "
                f"(máximo {settings.max_reference_audio_mb:.0f}MB)"
            )

        await asyncio.to_thread(normalize_reference, raw, target)
        raw.unlink(missing_ok=True)

        # limpa versões antigas do mesmo clone
        for old in target.parent.glob("*.wav"):
            if old != target:
                old.unlink(missing_ok=True)

    return target


def voice_summary(voice: dict[str, Any] | None) -> dict[str, Any] | None:
    if not voice:
        return None
    return {
        "id": voice.get("id"),
        "slug": voice.get("slug"),
        "name": voice.get("name"),
        "description": voice.get("description") or None,
        "language": voice.get("language") or None,
        "has_reference_audio": bool(voice.get("reference_audio")),
    }
