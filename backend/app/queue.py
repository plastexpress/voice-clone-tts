"""Fila de inferência com um único worker.

A RTX 3060 processa uma geração por vez: todos os requests entram nesta fila e
são atendidos em ordem. A parte pesada (modelo + ffmpeg) roda num executor de
uma thread, então o event loop continua respondendo enquanto a GPU trabalha.

Detalhe útil: se o cliente síncrono desistir por timeout, o job continua até o
fim e o resultado fica no cache — a próxima chamada com o mesmo texto é instantânea.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import cache, webhooks
from .audio import copy_as_wav, encode_opus
from .config import settings
from .logging_setup import get_logger
from .params import RenderParams
from .pocketbase import PocketBaseError, pb
from .tts import EngineError, SynthesisRequest, TTSEngine, get_engine
from .voices import reference_audio_path

log = get_logger("vct.queue")


class QueueFull(RuntimeError):
    pass


@dataclass
class GenerationJob:
    params: RenderParams
    cache_key: str
    voice: dict[str, Any] | None = None
    token_id: str | None = None
    token_name: str | None = None
    pb_job_id: str | None = None
    callback_url: str | None = None
    callback_headers: dict[str, str] = field(default_factory=dict)
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    enqueued_at: float = field(default_factory=time.monotonic)
    started_at: float | None = None
    future: asyncio.Future = field(default_factory=asyncio.Future)


@dataclass(slots=True)
class GenerationOutcome:
    entry: cache.CacheEntry
    cached: bool
    queue_ms: int
    generation_ms: int


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%fZ")


def _audio_url(entry: cache.CacheEntry) -> str:
    path = f"/v1/audio/{entry.id}"
    base = settings.public_api_url.rstrip("/") if settings.public_api_url else ""
    return f"{base}{path}" if base else path


def _callback_payload(
    job: GenerationJob,
    *,
    status: str,
    entry: cache.CacheEntry | None = None,
    cached: bool = False,
    queue_ms: int = 0,
    generation_ms: int = 0,
    error: str | None = None,
) -> dict[str, Any]:
    return {
        "job_id": job.pb_job_id or job.id,
        "status": status,
        "cached": cached,
        "audio_url": _audio_url(entry) if entry else None,
        "audio_id": entry.id if entry else None,
        "duration_ms": entry.duration_ms if entry else None,
        "queue_ms": queue_ms,
        "generation_ms": generation_ms,
        "error": error,
        "finished_at": _now_iso(),
    }


class InferenceQueue:
    def __init__(self, engine: TTSEngine | None = None) -> None:
        self._engine = engine
        self._queue: asyncio.Queue[GenerationJob | None] = asyncio.Queue(
            maxsize=max(1, settings.queue_max_size)
        )
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="tts-gpu")
        self._worker: asyncio.Task | None = None
        self._current: GenerationJob | None = None
        self._processed = 0
        self._failed = 0

    # ------------------------------------------------------------------ estado
    @property
    def engine(self) -> TTSEngine:
        if self._engine is None:
            self._engine = get_engine()
        return self._engine

    @property
    def depth(self) -> int:
        return self._queue.qsize()

    @property
    def processing(self) -> bool:
        return self._current is not None

    @property
    def current_job_id(self) -> str | None:
        return self._current.id if self._current else None

    def stats(self) -> dict[str, Any]:
        return {
            "depth": self.depth,
            "max": settings.queue_max_size,
            "processing": self.processing,
            "current_job": self.current_job_id,
            "processed": self._processed,
            "failed": self._failed,
        }

    # ------------------------------------------------------------ ciclo de vida
    async def start(self) -> None:
        if self._worker is None or self._worker.done():
            self._worker = asyncio.create_task(self._run(), name="tts-queue-worker")
            log.info("fila de inferência iniciada (capacidade %d)", settings.queue_max_size)

    async def stop(self) -> None:
        if self._worker is None:
            return
        await self._queue.put(None)
        try:
            await asyncio.wait_for(self._worker, timeout=30)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            self._worker.cancel()
        self._executor.shutdown(wait=False, cancel_futures=True)
        self._worker = None
        log.info("fila de inferência encerrada")

    # ------------------------------------------------------------------ envio
    async def submit(self, job: GenerationJob) -> GenerationJob:
        await self.start()
        try:
            self._queue.put_nowait(job)
        except asyncio.QueueFull as exc:
            raise QueueFull(
                f"fila cheia ({settings.queue_max_size} itens). Tente novamente em instantes."
            ) from exc
        log.debug("job %s enfileirado (posição %d)", job.id[:8], self.depth)
        return job

    async def wait(self, job: GenerationJob, timeout: float | None = None) -> GenerationOutcome:
        timeout = timeout if timeout is not None else settings.sync_timeout_seconds
        return await asyncio.wait_for(asyncio.shield(job.future), timeout=timeout)

    # ------------------------------------------------------------------ worker
    async def _run(self) -> None:
        while True:
            job = await self._queue.get()
            if job is None:
                self._queue.task_done()
                break

            self._current = job
            job.started_at = time.monotonic()
            try:
                outcome = await self._process(job)
                self._processed += 1
                if not job.future.done():
                    job.future.set_result(outcome)
            except Exception as exc:  # noqa: BLE001 - o erro vai para quem pediu
                self._failed += 1
                log.exception("job %s falhou", job.id[:8])
                await self._mark_job_failed(job, exc)
                webhooks.fire(
                    job.callback_url,
                    job.callback_headers,
                    _callback_payload(job, status="failed", error=str(exc)),
                )
                if not job.future.done():
                    job.future.set_exception(exc)
            finally:
                self._current = None
                self._queue.task_done()

    async def _process(self, job: GenerationJob) -> GenerationOutcome:
        loop = asyncio.get_running_loop()
        queue_ms = int((time.monotonic() - job.enqueued_at) * 1000)
        params = job.params

        # alguém idêntico pode ter terminado enquanto este job esperava
        entry = await cache.lookup(job.cache_key)
        if entry is not None:
            await cache.register_hit(entry)
            await self._mark_job_done(job, entry, queue_ms, 0)
            webhooks.fire(
                job.callback_url,
                job.callback_headers,
                _callback_payload(job, status="completed", entry=entry, cached=True, queue_ms=queue_ms),
            )
            return GenerationOutcome(entry=entry, cached=True, queue_ms=queue_ms, generation_ms=0)

        await self._mark_job_processing(job)

        reference = await reference_audio_path(job.voice)
        settings.work_dir.mkdir(parents=True, exist_ok=True)
        raw_wav = settings.work_dir / f"{job.id}.wav"

        request = SynthesisRequest(
            text=params.text,
            output_path=raw_wav,
            reference_audio=reference,
            reference_text=(job.voice or {}).get("reference_text") or None,
            language=params.language,
            temperature=params.temperature,
            top_p=params.top_p,
            top_k=params.top_k,
            repetition_penalty=params.repetition_penalty,
            max_new_tokens=params.max_new_tokens,
            duration_tokens=params.duration_tokens,
            seed=params.seed,
            instruction=params.instruction,
        )

        started = time.monotonic()
        try:
            await loop.run_in_executor(self._executor, self.engine.synthesize, request)

            final_path = cache.path_for(job.cache_key, params.format)
            if params.format == "wav":
                info = await loop.run_in_executor(
                    self._executor,
                    lambda: copy_as_wav(raw_wav, final_path, channels=params.channels),
                )
            else:
                info = await loop.run_in_executor(
                    self._executor,
                    lambda: encode_opus(
                        raw_wav,
                        final_path,
                        bitrate=params.bitrate,
                        channels=params.channels,
                        sample_rate=params.sample_rate,
                    ),
                )
        finally:
            _unlink(raw_wav)

        generation_ms = int((time.monotonic() - started) * 1000)

        entry = await cache.store(
            job.cache_key,
            params,
            info,
            token_id=job.token_id,
            generation_ms=generation_ms,
        )

        await self._mark_job_done(job, entry, queue_ms, generation_ms)
        webhooks.fire(
            job.callback_url,
            job.callback_headers,
            _callback_payload(
                job, status="completed", entry=entry, queue_ms=queue_ms, generation_ms=generation_ms
            ),
        )

        if settings.cache_enabled:
            asyncio.create_task(_safe_enforce_limit())

        log.info(
            "job %s concluído em %dms (%s, %.1fs de áudio, %.1f KB)",
            job.id[:8],
            generation_ms,
            params.voice_slug or "sem clone",
            info.duration_ms / 1000,
            info.size_bytes / 1024,
        )
        return GenerationOutcome(
            entry=entry, cached=False, queue_ms=queue_ms, generation_ms=generation_ms
        )

    # ------------------------------------------- espelha o estado no PocketBase
    async def _mark_job_processing(self, job: GenerationJob) -> None:
        if not job.pb_job_id:
            return
        await _safe_update(
            job.pb_job_id,
            {
                "status": "processing",
                "started_at": _now_iso(),
                "queue_ms": int((time.monotonic() - job.enqueued_at) * 1000),
            },
        )

    async def _mark_job_done(
        self,
        job: GenerationJob,
        entry: cache.CacheEntry,
        queue_ms: int,
        generation_ms: int,
    ) -> None:
        if not job.pb_job_id:
            return
        await _safe_update(
            job.pb_job_id,
            {
                "status": "completed",
                "cache": entry.id,
                "queue_ms": queue_ms,
                "duration_ms": generation_ms,
                "finished_at": _now_iso(),
            },
        )

    async def _mark_job_failed(self, job: GenerationJob, exc: Exception) -> None:
        if not job.pb_job_id:
            return
        message = str(exc) if isinstance(exc, EngineError) else f"{type(exc).__name__}: {exc}"
        await _safe_update(
            job.pb_job_id,
            {"status": "failed", "error": message[:2000], "finished_at": _now_iso()},
        )


def _unlink(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:  # pragma: no cover
        log.debug("não consegui apagar o temporário %s", path)


async def _safe_update(job_id: str, data: dict[str, Any]) -> None:
    try:
        await pb.update_record("tts_jobs", job_id, data)
    except PocketBaseError as exc:
        log.warning("não consegui atualizar o job %s: %s", job_id, exc)


async def _safe_enforce_limit() -> None:
    try:
        await cache.enforce_limit()
    except Exception as exc:  # noqa: BLE001
        log.warning("limpeza de cache falhou: %s", exc)


queue = InferenceQueue()
