"""Cache local dos áudios gerados.

Mesmo texto + mesma voz + mesmos parâmetros = mesmo arquivo. O binário fica em
/data/audio (volume do host) e o índice no PocketBase, na coleção `tts_cache`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .audio import AudioInfo
from .config import settings
from .logging_setup import get_logger
from .params import RenderParams
from .pocketbase import PocketBaseError, pb, quote

log = get_logger("vct.cache")

EXTENSIONS = {"opus": ".opus", "wav": ".wav"}


@dataclass(slots=True)
class CacheEntry:
    record: dict[str, Any]
    path: Path

    @property
    def id(self) -> str:
        return str(self.record.get("id", ""))

    @property
    def duration_ms(self) -> int:
        return int(self.record.get("duration_ms") or 0)

    @property
    def size_bytes(self) -> int:
        return int(self.record.get("size_bytes") or 0)

    @property
    def format(self) -> str:
        return str(self.record.get("format") or "opus")

    @property
    def sample_rate(self) -> int:
        return int(self.record.get("sample_rate") or 0)

    @property
    def channels(self) -> int:
        return int(self.record.get("channels") or 0)

    @property
    def generation_ms(self) -> int:
        return int(self.record.get("generation_ms") or 0)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%fZ")


def relative_path(key: str, fmt: str) -> str:
    """Caminho fragmentado para não criar um diretório gigante."""
    return f"{key[:2]}/{key[2:4]}/{key}{EXTENSIONS.get(fmt, '.bin')}"


def absolute_path(relative: str) -> Path:
    return settings.audio_dir / relative


def path_for(key: str, fmt: str) -> Path:
    return absolute_path(relative_path(key, fmt))


async def lookup(key: str) -> CacheEntry | None:
    """Procura no índice e confirma que o arquivo ainda existe em disco."""
    if not settings.cache_enabled:
        return None
    try:
        record = await pb.first_record("tts_cache", filter=f"cache_key = {quote(key)}")
    except PocketBaseError as exc:
        log.warning("falha ao consultar o cache: %s", exc)
        return None
    if record is None:
        return None

    path = absolute_path(str(record.get("file_path") or ""))
    if not path.exists() or path.stat().st_size == 0:
        log.warning("arquivo do cache sumiu (%s) — removendo o índice", path)
        await pb.delete_record("tts_cache", str(record["id"]))
        return None

    return CacheEntry(record=record, path=path)


async def register_hit(entry: CacheEntry) -> None:
    try:
        await pb.update_record(
            "tts_cache",
            entry.id,
            {"hits": int(entry.record.get("hits") or 0) + 1, "last_hit_at": _now_iso()},
        )
    except PocketBaseError as exc:
        log.debug("não consegui registrar o hit de cache: %s", exc)


async def store(
    key: str,
    params: RenderParams,
    info: AudioInfo,
    *,
    token_id: str | None,
    generation_ms: int,
) -> CacheEntry:
    """Registra no índice um arquivo que já está em disco."""
    relative = relative_path(key, params.format)
    data = {
        "cache_key": key,
        "text": params.text[:20000],
        "text_length": len(params.text),
        "voice": params.voice_id or "",
        "token": token_id or "",
        "file_path": relative,
        "format": params.format,
        "bitrate": params.bitrate,
        "sample_rate": info.sample_rate,
        "channels": info.channels,
        "size_bytes": info.size_bytes,
        "duration_ms": info.duration_ms,
        "generation_ms": generation_ms,
        "params": params.public_dict(),
        "model_id": params.model_id,
        "hits": 0,
        "last_hit_at": _now_iso(),
    }

    try:
        record = await pb.create_record("tts_cache", data)
    except PocketBaseError as exc:
        # corrida entre dois requests idênticos: aproveita o registro existente
        existing = await pb.first_record("tts_cache", filter=f"cache_key = {quote(key)}")
        if existing is None:
            raise
        log.debug("registro de cache já existia para %s (%s)", key[:12], exc.status_code)
        record = existing

    return CacheEntry(record=record, path=absolute_path(relative))


async def delete(entry_id: str) -> bool:
    """Remove o registro e o arquivo correspondente."""
    record = await pb.get_record("tts_cache", entry_id)
    if record is None:
        return False
    path = absolute_path(str(record.get("file_path") or ""))
    await pb.delete_record("tts_cache", entry_id)
    try:
        path.unlink(missing_ok=True)
    except OSError as exc:
        log.warning("não consegui apagar %s: %s", path, exc)
    return True


async def stats(max_pages: int = 20, per_page: int = 500) -> dict[str, Any]:
    """Contagem e tamanho total do cache (varredura limitada)."""
    total_items = 0
    total_bytes = 0
    total_duration = 0
    total_hits = 0
    truncated = False

    for page in range(1, max_pages + 1):
        try:
            data = await pb.list_records(
                "tts_cache",
                page=page,
                per_page=per_page,
                fields="id,size_bytes,duration_ms,hits",
                skip_total=False,
            )
        except PocketBaseError as exc:
            log.warning("falha ao calcular estatísticas do cache: %s", exc)
            break

        items = data.get("items") or []
        for item in items:
            total_items += 1
            total_bytes += int(item.get("size_bytes") or 0)
            total_duration += int(item.get("duration_ms") or 0)
            total_hits += int(item.get("hits") or 0)

        if len(items) < per_page:
            break
        if page == max_pages:
            truncated = True

    return {
        "entries": total_items,
        "size_bytes": total_bytes,
        "size_mb": round(total_bytes / (1024 * 1024), 2),
        "audio_hours": round(total_duration / 3_600_000, 3),
        "hits": total_hits,
        "truncated": truncated,
        "limit_gb": settings.cache_max_gb,
        "enabled": settings.cache_enabled,
    }


async def enforce_limit() -> int:
    """Remove os itens menos usados quando o cache passa de CACHE_MAX_GB."""
    if settings.cache_max_gb <= 0:
        return 0

    current = await stats()
    limit_bytes = int(settings.cache_max_gb * 1024**3)
    if current["size_bytes"] <= limit_bytes:
        return 0

    to_free = current["size_bytes"] - limit_bytes
    freed = 0
    removed = 0
    page = 1

    while freed < to_free and page <= 20:
        data = await pb.list_records(
            "tts_cache",
            page=page,
            per_page=100,
            sort="last_hit_at,created",
            fields="id,size_bytes,file_path",
        )
        items = data.get("items") or []
        if not items:
            break
        for item in items:
            if freed >= to_free:
                break
            size = int(item.get("size_bytes") or 0)
            if await delete(str(item["id"])):
                freed += size
                removed += 1
        if len(items) < 100:
            break

    if removed:
        log.info("limpeza do cache: %d arquivos removidos (%.1f MB)", removed, freed / 1024**2)
    return removed
