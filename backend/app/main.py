"""Aplicação FastAPI — API de geração de áudio (porta 8096)."""

from __future__ import annotations

import asyncio
import contextlib
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .audio import ffmpeg_available
from .config import settings
from .logging_setup import get_logger, setup_logging
from .pocketbase import pb
from .queue import queue
from .routers import jobs, meta, playground, system, tts
from .tts import EngineError, get_engine

setup_logging()
log = get_logger("vct.main")

DESCRIPTION = """
API local de Text-to-Speech com clonagem de voz (MOSS-TTS rodando na sua GPU).

**Autenticação** — envie o token no header:

    Authorization: Bearer vct_xxxxxxxxxxxxxxxx

O token já carrega o clone de voz e os parâmetros configurados na interface,
então o cliente normalmente só precisa mandar o texto:

    curl -X POST http://localhost:8096/v1/tts \\
      -H "Authorization: Bearer $TOKEN" \\
      -H "Content-Type: application/json" \\
      -d '{"text": "Olá, tudo bem?"}' \\
      --output fala.opus

Textos idênticos (mesma voz e mesmos parâmetros) são servidos do cache local,
sem passar pela GPU.
"""


async def _preload_model() -> None:
    engine = get_engine()
    try:
        await asyncio.to_thread(engine.load)
    except EngineError as exc:
        log.error("não foi possível carregar o modelo no boot: %s", exc)
    except Exception as exc:  # noqa: BLE001
        log.exception("erro inesperado ao pré-carregar o modelo: %s", exc)


async def _janitor() -> None:
    """Remove jobs antigos de tempos em tempos."""
    while True:
        try:
            await asyncio.sleep(3600)
            if settings.job_retention_hours <= 0:
                continue
            cutoff = datetime.now(timezone.utc) - timedelta(hours=settings.job_retention_hours)
            stamp = cutoff.strftime("%Y-%m-%d %H:%M:%S")
            data = await pb.list_records(
                "tts_jobs",
                filter=f'created < "{stamp}"',
                per_page=200,
                fields="id",
            )
            for item in data.get("items") or []:
                await pb.delete_record("tts_jobs", str(item["id"]))
            if data.get("items"):
                log.info("faxina: %d jobs antigos removidos", len(data["items"]))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.warning("faxina falhou: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.ensure_dirs()
    log.info("iniciando %s v%s", settings.api_title, settings.version)

    if not ffmpeg_available():
        log.error(
            "ffmpeg não encontrado no PATH — a conversão para Opus vai falhar. "
            "Instale o ffmpeg na imagem."
        )

    await pb.wait_until_ready()
    await pb.authenticate()
    await queue.start()

    background: list[asyncio.Task] = [asyncio.create_task(_janitor(), name="janitor")]
    if settings.moss_preload and settings.tts_engine != "dummy":
        log.info("pré-carregando o modelo em segundo plano...")
        background.append(asyncio.create_task(_preload_model(), name="preload"))

    try:
        yield
    finally:
        for task in background:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        await queue.stop()
        await pb.close()
        log.info("serviço encerrado")


app = FastAPI(
    title=settings.api_title,
    description=DESCRIPTION,
    version=settings.version,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "X-Cache",
        "X-Audio-Id",
        "X-Audio-Duration-Ms",
        "X-Queue-Ms",
        "X-Generation-Ms",
        "X-Total-Ms",
        "X-Voice",
        "X-Model",
        "X-Sample-Rate",
    ],
)

app.include_router(tts.router)
app.include_router(jobs.router)
app.include_router(meta.router)
app.include_router(system.router)
app.include_router(system.internal)
app.include_router(playground.router)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(part) for part in first.get("loc", []) if part != "body")
    detail = first.get("msg", "corpo do request inválido")
    return JSONResponse(
        status_code=422,
        content={"error": "invalid_request", "detail": f"{field}: {detail}" if field else detail},
    )


@app.get("/", include_in_schema=False)
async def root() -> dict:
    engine = get_engine()
    return {
        "service": settings.api_title,
        "version": settings.version,
        "engine": engine.name,
        "model": engine.model_id,
        "docs": "/docs",
        "endpoints": {
            "sync": "POST /v1/tts",
            "async": "POST /v1/tts/async",
            "job": "GET /v1/jobs/{job_id}",
            "audio": "GET /v1/audio/{audio_id}",
            "token_info": "GET /v1/me",
            "voices": "GET /v1/voices",
            "health": "GET /health",
        },
    }

