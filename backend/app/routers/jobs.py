"""Consulta de jobs assíncronos."""

from __future__ import annotations

import asyncio
import base64
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import cache
from ..audio import MIME_BY_FORMAT, OPUS_MIME
from ..auth import TokenContext, require_token
from ..config import settings
from ..pocketbase import pb
from ..schemas import JobStatusResponse

router = APIRouter(prefix="/v1", tags=["jobs"])

TERMINAL = {"completed", "failed", "canceled"}


def _build(record: dict[str, Any], cache_record: dict[str, Any] | None) -> JobStatusResponse:
    status = str(record.get("status") or "queued")
    audio_id = None
    audio_url = None
    duration_ms = None

    if cache_record:
        audio_id = str(cache_record.get("id"))
        audio_url = f"/v1/audio/{audio_id}"
        duration_ms = int(cache_record.get("duration_ms") or 0)

    return JobStatusResponse(
        job_id=str(record.get("id")),
        status=status,  # type: ignore[arg-type]
        cached=bool(record.get("duration_ms") == 0 and status == "completed"),
        audio_url=audio_url,
        audio_id=audio_id,
        duration_ms=duration_ms,
        queue_ms=int(record.get("queue_ms") or 0),
        generation_ms=int(record.get("duration_ms") or 0),
        error=(record.get("error") or None),
        created=record.get("created"),
        finished_at=record.get("finished_at") or None,
    )


async def _fetch(job_id: str, token: TokenContext) -> tuple[dict[str, Any], dict[str, Any] | None]:
    record = await pb.get_record("tts_jobs", job_id, expand="cache")
    if record is None:
        raise HTTPException(status_code=404, detail="job não encontrado")

    if record.get("token") and str(record["token"]) != token.id:
        raise HTTPException(status_code=403, detail="este job pertence a outro token")

    cache_record = (record.get("expand") or {}).get("cache")
    if isinstance(cache_record, list):
        cache_record = cache_record[0] if cache_record else None
    return record, cache_record


def _attach_audio(body: JobStatusResponse, cache_record: dict[str, Any] | None) -> None:
    """Embute o áudio em base64 na resposta (para clientes que não baixam binário)."""
    if not cache_record:
        raise HTTPException(status_code=404, detail="o job terminou sem áudio associado")

    path = cache.absolute_path(str(cache_record.get("file_path") or ""))
    if not path.exists():
        raise HTTPException(status_code=410, detail="o arquivo foi removido do cache")

    audio_bytes = path.read_bytes()
    fmt = str(cache_record.get("format") or "opus")
    body.audio_base64 = base64.b64encode(audio_bytes).decode("ascii")
    body.mime_type = MIME_BY_FORMAT.get(fmt, OPUS_MIME)
    body.size_bytes = len(audio_bytes)


@router.get(
    "/jobs/{job_id}",
    response_model=JobStatusResponse,
    response_model_exclude_none=False,
    summary="Estado de um job assíncrono",
    responses={
        200: {"description": "estado atual do job"},
        403: {"description": "o job pertence a outro token"},
        404: {"description": "job não encontrado"},
        425: {"description": "ainda gerando — o ?wait= expirou; repita a chamada"},
    },
)
async def get_job(
    job_id: str,
    token: TokenContext = Depends(require_token),
    wait: float = Query(
        default=0,
        ge=0,
        description=(
            "segundos para segurar a resposta até o job terminar (long-poll). "
            f"0 = responde na hora. Teto: {settings.job_wait_max_seconds:.0f}s. "
            "Se estourar sem terminar, devolve 425 — basta repetir a chamada."
        ),
    ),
    response_format: str | None = Query(
        default=None,
        alias="format",
        description="'json' embute o áudio em base64 no campo audio_base64",
    ),
):
    want_json = (response_format or "").lower() in {"json", "base64"}
    budget = min(float(wait), settings.job_wait_max_seconds)
    deadline = time.monotonic() + budget

    record, cache_record = await _fetch(job_id, token)
    interval = settings.job_wait_poll_interval
    while str(record.get("status") or "queued") not in TERMINAL:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        await asyncio.sleep(min(interval, remaining))
        interval = min(interval * 1.5, 3.0)  # backoff: alivia o PocketBase em espera longa
        record, cache_record = await _fetch(job_id, token)

    body = _build(record, cache_record)

    if body.status not in TERMINAL and budget > 0:
        # 425 em vez de 200 para que o cliente (n8n, curl --retry, etc.) trate
        # como falha retentável em vez de seguir em frente sem áudio.
        raise HTTPException(
            status_code=425,
            detail=f"job ainda em '{body.status}' após {budget:.0f}s — repita a chamada",
            headers={"Retry-After": "5"},
        )

    if want_json and body.status == "completed":
        _attach_audio(body, cache_record)

    return body
