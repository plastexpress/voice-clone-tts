"""Endpoints de geração de áudio."""

from __future__ import annotations

import base64
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse

from .. import cache, service
from ..audio import MIME_BY_FORMAT, OPUS_MIME
from ..auth import TokenContext, require_token, token_or_user
from ..config import settings
from ..logging_setup import get_logger
from ..pocketbase import pb
from ..schemas import JobCreatedResponse, TTSJsonResponse, TTSRequest
from ..service import TTSOutcome

log = get_logger("vct.api.tts")

router = APIRouter(prefix="/v1", tags=["tts"])


def _filename(outcome: TTSOutcome) -> str:
    base = outcome.params.voice_slug or "tts"
    return f"{base}-{outcome.entry.id or 'audio'}.{outcome.params.format}"


def _headers(outcome: TTSOutcome) -> dict[str, str]:
    return {
        "X-Cache": "hit" if outcome.cached else "miss",
        "X-Audio-Id": outcome.entry.id,
        "X-Audio-Duration-Ms": str(outcome.entry.duration_ms),
        "X-Queue-Ms": str(outcome.queue_ms),
        "X-Generation-Ms": str(outcome.generation_ms),
        "X-Total-Ms": str(outcome.total_ms),
        "X-Voice": outcome.params.voice_slug or "",
        "X-Model": outcome.params.model_id,
        "X-Sample-Rate": str(outcome.entry.sample_rate),
        "Content-Disposition": f'inline; filename="{_filename(outcome)}"',
        "Access-Control-Expose-Headers": (
            "X-Cache, X-Audio-Id, X-Audio-Duration-Ms, X-Queue-Ms, "
            "X-Generation-Ms, X-Total-Ms, X-Voice, X-Model, X-Sample-Rate"
        ),
    }


def _binary_response(outcome: TTSOutcome) -> FileResponse:
    media_type = MIME_BY_FORMAT.get(outcome.params.format, OPUS_MIME)
    return FileResponse(
        path=outcome.entry.path,
        media_type=media_type,
        headers=_headers(outcome),
        filename=None,
    )


def _json_response(outcome: TTSOutcome) -> JSONResponse:
    audio_bytes = outcome.entry.path.read_bytes()
    payload = TTSJsonResponse(
        id=outcome.entry.id,
        audio_base64=base64.b64encode(audio_bytes).decode("ascii"),
        format=outcome.params.format,
        mime_type=MIME_BY_FORMAT.get(outcome.params.format, OPUS_MIME),
        duration_ms=outcome.entry.duration_ms,
        size_bytes=len(audio_bytes),
        sample_rate=outcome.entry.sample_rate,
        channels=outcome.entry.channels,
        cached=outcome.cached,
        voice=outcome.params.voice_slug,
        model=outcome.params.model_id,
        queue_ms=outcome.queue_ms,
        generation_ms=outcome.generation_ms,
        total_ms=outcome.total_ms,
    )
    return JSONResponse(content=payload.model_dump(), headers=_headers(outcome))


@router.post(
    "/tts",
    summary="Gera o áudio e devolve o arquivo (.opus)",
    response_description="Arquivo de áudio Opus (audio/ogg)",
    responses={
        200: {"content": {"audio/ogg": {}, "application/json": {}}},
        401: {"description": "token ausente ou inválido"},
        429: {"description": "limite de requisições do token"},
        504: {"description": "geração excedeu o tempo limite (continua no cache depois)"},
    },
)
async def create_speech(
    payload: TTSRequest,
    request: Request,
    token: TokenContext = Depends(require_token),
    response_format: str | None = Query(
        default=None,
        alias="format",
        description="'json' devolve o áudio em base64 em vez do binário",
    ),
    response_alias: str | None = Query(default=None, alias="response", include_in_schema=False),
):
    want_json = (response_format or response_alias or "").lower() in {"json", "base64"}

    error: str | None = None
    outcome: TTSOutcome | None = None
    status_code = 200
    try:
        outcome = await service.synthesize(token, payload)
    except HTTPException as exc:
        status_code, error = exc.status_code, str(exc.detail)
        raise
    except Exception as exc:  # noqa: BLE001 - só para registrar antes de propagar
        status_code, error = 500, f"{type(exc).__name__}: {exc}"
        raise
    finally:
        await service.log_request(
            token=token,
            endpoint="POST /v1/tts",
            status_code=status_code,
            cached=bool(outcome and outcome.cached),
            text=payload.text,
            queue_ms=outcome.queue_ms if outcome else 0,
            duration_ms=outcome.total_ms if outcome else 0,
            audio_ms=outcome.entry.duration_ms if outcome else 0,
            voice_name=(outcome.params.voice_slug if outcome else None),
            ip=request.client.host if request.client else None,
            error=error,
        )

    assert outcome is not None
    return _json_response(outcome) if want_json else _binary_response(outcome)


@router.post(
    "/tts/async",
    response_model=JobCreatedResponse,
    status_code=202,
    summary="Enfileira a geração e devolve um job_id",
)
async def create_speech_async(
    payload: TTSRequest,
    request: Request,
    token: TokenContext = Depends(require_token),
):
    result = await service.submit_async(token, payload)
    await service.log_request(
        token=token,
        endpoint="POST /v1/tts/async",
        status_code=202,
        cached=bool(result.get("cached")),
        text=payload.text,
        ip=request.client.host if request.client else None,
    )
    return JobCreatedResponse(
        job_id=result["job_id"],
        status=result["status"],
        status_url=f"/v1/jobs/{result['job_id']}",
        queue_position=int(result.get("queue_position") or 0),
    )


@router.get(
    "/audio/{audio_id}",
    summary="Baixa um áudio já gerado pelo id",
    responses={200: {"content": {"audio/ogg": {}}}, 404: {"description": "não encontrado"}},
)
async def get_audio(audio_id: str, principal: dict[str, Any] = Depends(token_or_user)):
    record = await pb.get_record("tts_cache", audio_id)
    if record is None:
        raise HTTPException(status_code=404, detail="áudio não encontrado")

    path = cache.absolute_path(str(record.get("file_path") or ""))
    if not path.exists():
        raise HTTPException(status_code=410, detail="o arquivo foi removido do cache")

    fmt = str(record.get("format") or "opus")
    return FileResponse(
        path=path,
        media_type=MIME_BY_FORMAT.get(fmt, OPUS_MIME),
        headers={
            "X-Audio-Duration-Ms": str(record.get("duration_ms") or 0),
            "Content-Disposition": f'inline; filename="{audio_id}.{fmt}"',
            "Cache-Control": "private, max-age=86400",
        },
    )


@router.get("/limits", summary="Limites do serviço", include_in_schema=False)
async def limits(_: TokenContext = Depends(require_token)) -> dict[str, Any]:
    return {
        "max_text_length": settings.tts_max_text_length,
        "sync_timeout_seconds": settings.sync_timeout_seconds,
        "queue_max_size": settings.queue_max_size,
        "formats": ["opus", "wav"],
    }
