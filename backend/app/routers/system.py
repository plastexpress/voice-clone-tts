"""Saúde do serviço, status da GPU e endpoints internos usados pela interface."""

from __future__ import annotations

import asyncio
import time
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import cache
from ..auth import TokenContext, require_token, require_user
from ..config import settings
from ..logging_setup import get_logger
from ..pocketbase import pb
from ..queue import queue
from ..schemas import HealthResponse, SystemStatus
from ..tts import get_engine

log = get_logger("vct.api.system")

router = APIRouter(tags=["system"])
STARTED_AT = time.monotonic()


def gpu_info() -> dict[str, Any] | None:
    """Memória da GPU via torch (quando disponível)."""
    try:
        import torch
    except ImportError:
        return None
    if not torch.cuda.is_available():
        return None
    try:
        index = torch.cuda.current_device()
        free, total = torch.cuda.mem_get_info(index)
        return {
            "name": torch.cuda.get_device_name(index),
            "total_mb": round(total / 1024**2),
            "free_mb": round(free / 1024**2),
            "used_mb": round((total - free) / 1024**2),
            "allocated_mb": round(torch.cuda.memory_allocated(index) / 1024**2),
            "reserved_mb": round(torch.cuda.memory_reserved(index) / 1024**2),
            "capability": ".".join(str(x) for x in torch.cuda.get_device_capability(index)),
        }
    except Exception as exc:  # noqa: BLE001
        log.debug("não consegui ler o estado da GPU: %s", exc)
        return None


async def _pocketbase_ok() -> bool:
    try:
        response = await pb.client.get("/api/health", timeout=5.0)
        return response.status_code < 500
    except Exception:  # noqa: BLE001
        return False


@router.get("/health", response_model=HealthResponse, summary="Health check (sem autenticação)")
async def health() -> HealthResponse:
    engine = get_engine()
    return HealthResponse(
        status="ok",
        version=settings.version,
        engine=engine.name,
        model=engine.model_id,
        model_loaded=engine.is_loaded,
        device=engine.device,
        pocketbase=await _pocketbase_ok(),
    )


async def _status_payload() -> SystemStatus:
    engine = get_engine()
    info = engine.info()
    queue_stats = queue.stats()
    return SystemStatus(
        engine=engine.name,
        model=engine.model_id,
        model_loaded=engine.is_loaded,
        device=engine.device,
        dtype=info.get("dtype"),
        queue_depth=queue_stats["depth"],
        queue_max=queue_stats["max"],
        processing=queue_stats["processing"],
        current_job=queue_stats["current_job"],
        gpu=gpu_info(),
        cache=await cache.stats(),
        uptime_seconds=round(time.monotonic() - STARTED_AT, 1),
    )


@router.get("/v1/status", response_model=SystemStatus, summary="Estado do serviço (token)")
async def status_with_token(_: TokenContext = Depends(require_token)) -> SystemStatus:
    return await _status_payload()


# -----------------------------------------------------------------------------
# Endpoints internos — autenticados com a sessão da interface (JWT do PocketBase)
# -----------------------------------------------------------------------------
internal = APIRouter(prefix="/internal", tags=["internal"], include_in_schema=False)


@internal.get("/status", response_model=SystemStatus)
async def internal_status(_: dict = Depends(require_user)) -> SystemStatus:
    return await _status_payload()


@internal.post("/model/load")
async def load_model(_: dict = Depends(require_user)) -> dict[str, Any]:
    engine = get_engine()
    if engine.is_loaded:
        return {"status": "already_loaded", **engine.info()}
    started = time.monotonic()
    await asyncio.to_thread(engine.load)
    return {
        "status": "loaded",
        "elapsed_seconds": round(time.monotonic() - started, 1),
        **engine.info(),
    }


@internal.post("/model/unload")
async def unload_model(_: dict = Depends(require_user)) -> dict[str, Any]:
    engine = get_engine()
    await asyncio.to_thread(engine.unload)
    return {"status": "unloaded", **engine.info()}


@internal.delete("/cache/{entry_id}")
async def delete_cache_entry(entry_id: str, _: dict = Depends(require_user)) -> dict[str, Any]:
    removed = await cache.delete(entry_id)
    if not removed:
        raise HTTPException(status_code=404, detail="registro de cache não encontrado")
    return {"status": "deleted", "id": entry_id}


@internal.post("/cache/purge")
async def purge_cache(
    _: dict = Depends(require_user),
    confirm: bool = Body(default=False, embed=True),
) -> dict[str, Any]:
    """Apaga TODO o cache (índice + arquivos). Exige {"confirm": true}."""
    if not confirm:
        raise HTTPException(status_code=400, detail='envie {"confirm": true} para limpar o cache')

    removed = 0
    while True:
        data = await pb.list_records("tts_cache", per_page=100, fields="id")
        items = data.get("items") or []
        if not items:
            break
        for item in items:
            if await cache.delete(str(item["id"])):
                removed += 1
        if len(items) < 100:
            break

    log.info("cache limpo pela interface: %d itens", removed)
    return {"status": "purged", "removed": removed}


@internal.get("/cache/stats")
async def cache_stats(_: dict = Depends(require_user)) -> dict[str, Any]:
    return await cache.stats()
