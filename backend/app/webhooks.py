"""Callback HTTP disparado quando um job assíncrono termina (sucesso ou falha).

Fire-and-forget: nunca deve derrubar ou atrasar o processamento do job. Se o
endpoint do cliente estiver fora do ar, tentamos algumas vezes e desistimos —
o resultado já está salvo no cache/PocketBase, então o cliente sempre pode
recuperar via GET /v1/jobs/{id} mesmo se o callback falhar de vez.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx

from .logging_setup import get_logger

log = get_logger("vct.webhooks")

_TIMEOUT_SECONDS = 10.0
_MAX_ATTEMPTS = 3
_BACKOFF_SECONDS = 2.0


async def _post_with_retry(url: str, payload: dict[str, Any], headers: dict[str, str]) -> None:
    async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
        for attempt in range(1, _MAX_ATTEMPTS + 1):
            try:
                response = await client.post(url, json=payload, headers=headers)
                if response.status_code < 400:
                    return
                log.warning(
                    "callback %s respondeu %d (tentativa %d/%d)",
                    url,
                    response.status_code,
                    attempt,
                    _MAX_ATTEMPTS,
                )
            except httpx.HTTPError as exc:
                log.warning(
                    "callback %s falhou: %s (tentativa %d/%d)",
                    url,
                    exc,
                    attempt,
                    _MAX_ATTEMPTS,
                )
            if attempt < _MAX_ATTEMPTS:
                await asyncio.sleep(_BACKOFF_SECONDS * attempt)
        log.warning("callback %s desistiu após %d tentativas", url, _MAX_ATTEMPTS)


def fire(url: str | None, headers: dict[str, str] | None, payload: dict[str, Any]) -> None:
    """Dispara o callback em segundo plano; não bloqueia quem chamou."""
    if not url:
        return
    final_headers = {"Content-Type": "application/json", **(headers or {})}
    task = asyncio.create_task(_post_with_retry(url, payload, final_headers))
    # evita "Task exception was never retrieved" se algo escapar do try/except interno
    task.add_done_callback(lambda t: t.exception() if not t.cancelled() else None)
