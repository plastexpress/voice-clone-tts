"""Geração de teste no Playground, autenticada pela sessão do usuário.

Diferente da API pública (/v1/tts*), aqui não existe um `api_tokens` de
verdade por trás: o Playground é uma ferramenta do próprio operador logado na
interface, então ele sempre pode trocar de voz e ajustar parâmetros — não faz
sentido aplicar a trava `allow_overrides`, que existe para controlar o que
*clientes externos* podem sobrescrever.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from .. import service
from ..auth import TokenContext, require_user
from ..pocketbase import pb
from ..schemas import JobCreatedResponse, JobStatusResponse, TTSRequest
from .jobs import build_status

router = APIRouter(prefix="/internal/playground", tags=["playground"], include_in_schema=False)


def _session_token(user: dict[str, Any]) -> TokenContext:
    label = str(user.get("email") or user.get("name") or user.get("id") or "sessão")
    return TokenContext(
        record={
            "id": "",
            "name": f"Playground ({label})",
            "active": True,
            "allow_overrides": True,
            "settings": {},
        },
        voice=None,
    )


@router.post(
    "/tts/async",
    response_model=JobCreatedResponse,
    status_code=202,
    summary="Enfileira uma geração de teste usando a sessão logada",
)
async def playground_generate(payload: TTSRequest, user: dict = Depends(require_user)):
    token = _session_token(user)
    result = await service.submit_async(token, payload)
    return JobCreatedResponse(
        job_id=result["job_id"],
        status=result["status"],
        status_url=f"/internal/playground/jobs/{result['job_id']}",
        queue_position=int(result.get("queue_position") or 0),
    )


@router.get(
    "/jobs/{job_id}",
    response_model=JobStatusResponse,
    summary="Estado de um job criado pelo Playground",
)
async def playground_job(job_id: str, _: dict = Depends(require_user)) -> JobStatusResponse:
    record = await pb.get_record("tts_jobs", job_id, expand="cache")
    if record is None:
        raise HTTPException(status_code=404, detail="job não encontrado")

    cache_record = (record.get("expand") or {}).get("cache")
    if isinstance(cache_record, list):
        cache_record = cache_record[0] if cache_record else None

    return build_status(record, cache_record)
