"""Endpoints informativos para quem consome a API com um token."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import TokenContext, require_token
from ..params import token_defaults
from ..pocketbase import pb
from ..schemas import TokenInfo, VoiceOut
from ..voices import voice_summary

router = APIRouter(prefix="/v1", tags=["meta"])


@router.get("/me", response_model=TokenInfo, summary="O que este token já traz configurado")
async def me(token: TokenContext = Depends(require_token)) -> TokenInfo:
    summary = voice_summary(token.voice)
    return TokenInfo(
        name=token.name,
        prefix=token.prefix,
        active=bool(token.record.get("active")),
        expires_at=token.record.get("expires_at") or None,
        allow_overrides=token.allow_overrides,
        voice=VoiceOut(**summary) if summary else None,
        defaults=token_defaults(token),
        request_count=int(token.record.get("request_count") or 0),
        cached_count=int(token.record.get("cached_count") or 0),
        rate_limit_per_min=token.rate_limit_per_min,
    )


@router.get(
    "/voices",
    response_model=list[VoiceOut],
    summary="Clones de voz disponíveis",
)
async def list_voices(token: TokenContext = Depends(require_token)) -> list[VoiceOut]:
    # sem allow_overrides o token só enxerga a própria voz
    if not token.allow_overrides:
        summary = voice_summary(token.voice)
        return [VoiceOut(**summary)] if summary else []

    data = await pb.list_records("voices", filter="active = true", sort="name", per_page=200)
    result = []
    for item in data.get("items") or []:
        summary = voice_summary(item)
        if summary:
            result.append(VoiceOut(**summary))
    return result
