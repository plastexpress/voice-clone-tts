"""Orquestração de uma geração: parâmetros -> cache -> fila -> resposta."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status

from . import cache, params as params_module, webhooks
from .auth import TokenContext
from .config import settings
from .logging_setup import get_logger
from .params import RenderParams
from .pocketbase import PocketBaseError, pb
from .queue import GenerationJob, QueueFull, queue
from .schemas import TTSRequest
from .tts import EngineOutOfMemory, EngineError, get_engine
from .voices import VoiceNotFound, resolve_voice

log = get_logger("vct.service")


@dataclass(slots=True)
class TTSOutcome:
    entry: cache.CacheEntry
    cached: bool
    queue_ms: int
    generation_ms: int
    total_ms: int
    params: RenderParams
    voice: dict[str, Any] | None


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%fZ")


async def resolve_request(
    token: TokenContext, request: TTSRequest
) -> tuple[RenderParams, dict[str, Any] | None, str]:
    """Valida o texto, resolve o clone de voz e calcula a chave de cache."""
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="o campo 'text' está vazio")
    if len(text) > settings.tts_max_text_length:
        raise HTTPException(
            status_code=413,
            detail=(
                f"texto com {len(text)} caracteres excede o limite de "
                f"{settings.tts_max_text_length}. Divida em partes menores."
            ),
        )

    voice = token.voice
    if request.voice:
        if not token.allow_overrides:
            raise HTTPException(
                status_code=403,
                detail="este token não permite escolher a voz no request (allow_overrides desligado)",
            )
        try:
            voice = await resolve_voice(request.voice)
        except VoiceNotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    engine = get_engine()
    resolved = params_module.resolve(
        token, request, voice, engine_name=engine.name, model_id=engine.model_id
    )
    return resolved, voice, resolved.cache_key()


async def synthesize(token: TokenContext, request: TTSRequest) -> TTSOutcome:
    """Caminho síncrono: devolve o áudio pronto (do cache ou recém-gerado)."""
    started = time.monotonic()
    resolved, voice, key = await resolve_request(token, request)

    use_cache = settings.cache_enabled and (request.cache is not False)

    if use_cache:
        entry = await cache.lookup(key)
        if entry is not None:
            await cache.register_hit(entry)
            await touch_token(token, cached=True)
            total_ms = int((time.monotonic() - started) * 1000)
            log.info(
                "cache hit para o token '%s' (%s)", token.name, resolved.voice_slug or "sem clone"
            )
            return TTSOutcome(
                entry=entry,
                cached=True,
                queue_ms=0,
                generation_ms=0,
                total_ms=total_ms,
                params=resolved,
                voice=voice,
            )

    job = GenerationJob(
        params=resolved,
        cache_key=key,
        voice=voice,
        token_id=token.id,
        token_name=token.name,
    )

    try:
        await queue.submit(job)
    except QueueFull as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
            headers={"Retry-After": "10"},
        ) from exc

    try:
        outcome = await queue.wait(job)
    except asyncio.TimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=(
                f"a geração passou de {settings.sync_timeout_seconds:.0f}s. Ela continua "
                "rodando: repita o request daqui a pouco (virá do cache) ou use /v1/tts/async."
            ),
        ) from exc
    except EngineOutOfMemory as exc:
        raise HTTPException(status_code=507, detail=str(exc)) from exc
    except EngineError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    await touch_token(token, cached=outcome.cached)
    total_ms = int((time.monotonic() - started) * 1000)
    return TTSOutcome(
        entry=outcome.entry,
        cached=outcome.cached,
        queue_ms=outcome.queue_ms,
        generation_ms=outcome.generation_ms,
        total_ms=total_ms,
        params=resolved,
        voice=voice,
    )


async def submit_async(token: TokenContext, request: TTSRequest) -> dict[str, Any]:
    """Caminho assíncrono: cria o job no PocketBase e devolve o id."""
    resolved, voice, key = await resolve_request(token, request)

    if settings.cache_enabled and request.cache is not False:
        entry = await cache.lookup(key)
        if entry is not None:
            await cache.register_hit(entry)
            await touch_token(token, cached=True)
            record = await pb.create_record(
                "tts_jobs",
                {
                    "token": token.id,
                    "status": "completed",
                    "text": resolved.text[:20000],
                    "params": resolved.public_dict(),
                    "cache": entry.id,
                    "queue_ms": 0,
                    "duration_ms": 0,
                    "started_at": _now_iso(),
                    "finished_at": _now_iso(),
                },
            )
            if request.callback_url:
                base = settings.public_api_url.rstrip("/") if settings.public_api_url else ""
                webhooks.fire(
                    request.callback_url,
                    request.merged_callback_headers(),
                    {
                        "job_id": str(record["id"]),
                        "status": "completed",
                        "cached": True,
                        "audio_url": f"{base}/v1/audio/{entry.id}" if base else f"/v1/audio/{entry.id}",
                        "audio_id": entry.id,
                        "duration_ms": entry.duration_ms,
                        "queue_ms": 0,
                        "generation_ms": 0,
                        "error": None,
                        "finished_at": _now_iso(),
                    },
                )
            return {
                "job_id": str(record["id"]),
                "status": "completed",
                "queue_position": 0,
                "cached": True,
            }

    record = await pb.create_record(
        "tts_jobs",
        {
            "token": token.id,
            "status": "queued",
            "text": resolved.text[:20000],
            "params": resolved.public_dict(),
        },
    )

    job = GenerationJob(
        params=resolved,
        cache_key=key,
        voice=voice,
        token_id=token.id,
        token_name=token.name,
        pb_job_id=str(record["id"]),
        callback_url=request.callback_url,
        callback_headers=request.merged_callback_headers(),
    )

    try:
        await queue.submit(job)
    except QueueFull as exc:
        await pb.update_record(
            "tts_jobs", str(record["id"]), {"status": "failed", "error": str(exc)}
        )
        raise HTTPException(status_code=503, detail=str(exc), headers={"Retry-After": "10"}) from exc

    # consome a exceção se ninguém aguardar o future (evita "never retrieved")
    job.future.add_done_callback(lambda fut: fut.exception() if not fut.cancelled() else None)

    await touch_token(token, cached=False)
    return {
        "job_id": str(record["id"]),
        "status": "queued",
        "queue_position": queue.depth,
        "cached": False,
    }


async def touch_token(token: TokenContext, *, cached: bool) -> None:
    """Atualiza contadores de uso do token (sem bloquear a resposta)."""
    if not token.id:
        # token "virtual" (ex.: geração via sessão no Playground) — não existe
        # registro em api_tokens para atualizar.
        return

    async def _update() -> None:
        try:
            data: dict[str, Any] = {
                "last_used_at": _now_iso(),
                "request_count": int(token.record.get("request_count") or 0) + 1,
            }
            if cached:
                data["cached_count"] = int(token.record.get("cached_count") or 0) + 1
            await pb.update_record("api_tokens", token.id, data)
            token.record.update(data)
        except PocketBaseError as exc:
            log.debug("não consegui atualizar o uso do token: %s", exc)

    asyncio.create_task(_update())


async def log_request(
    *,
    token: TokenContext | None,
    endpoint: str,
    status_code: int,
    cached: bool = False,
    text: str = "",
    queue_ms: int = 0,
    duration_ms: int = 0,
    audio_ms: int = 0,
    voice_name: str | None = None,
    ip: str | None = None,
    error: str | None = None,
) -> None:
    """Grava uma linha em request_logs (best effort)."""
    if not settings.request_log_enabled:
        return

    data = {
        "token": token.id if token else "",
        "token_name": token.name if token else "",
        "endpoint": endpoint,
        "status_code": status_code,
        "cached": cached,
        "text_preview": text[:300],
        "text_length": len(text),
        "queue_ms": queue_ms,
        "duration_ms": duration_ms,
        "audio_ms": audio_ms,
        "voice_name": voice_name or "",
        "ip": ip or "",
        "error": (error or "")[:500],
    }

    async def _write() -> None:
        try:
            await pb.create_record("request_logs", data)
        except PocketBaseError as exc:
            log.debug("não consegui gravar o log da requisição: %s", exc)

    asyncio.create_task(_write())
