"""Consulta de jobs assíncronos."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ..auth import TokenContext, require_token
from ..pocketbase import pb
from ..schemas import JobStatusResponse

router = APIRouter(prefix="/v1", tags=["jobs"])


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


@router.get(
    "/jobs/{job_id}",
    response_model=JobStatusResponse,
    summary="Estado de um job assíncrono",
)
async def get_job(job_id: str, token: TokenContext = Depends(require_token)):
    record = await pb.get_record("tts_jobs", job_id, expand="cache")
    if record is None:
        raise HTTPException(status_code=404, detail="job não encontrado")

    if record.get("token") and str(record["token"]) != token.id:
        raise HTTPException(status_code=403, detail="este job pertence a outro token")

    cache_record = (record.get("expand") or {}).get("cache")
    if isinstance(cache_record, list):
        cache_record = cache_record[0] if cache_record else None

    return _build(record, cache_record)
