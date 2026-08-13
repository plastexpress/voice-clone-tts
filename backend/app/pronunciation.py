"""Dicionário de pronúncia: find/replace (texto ou regex) aplicado ao texto
antes da síntese. As regras vêm da coleção `pronunciation_rules` do PocketBase
e são cacheadas por alguns segundos para não bater no banco a cada request.
"""

from __future__ import annotations

import re
import time
from typing import Any

from .logging_setup import get_logger
from .pocketbase import PocketBaseError, pb

log = get_logger("vct.pronunciation")

_CACHE_TTL_SECONDS = 20.0  # mesma ordem de grandeza do cache de tokens

_cache: list[dict[str, Any]] | None = None
_cache_at: float = 0.0


def invalidate_cache() -> None:
    global _cache, _cache_at
    _cache = None
    _cache_at = 0.0


async def _load_rules() -> list[dict[str, Any]]:
    global _cache, _cache_at
    now = time.monotonic()
    if _cache is not None and (now - _cache_at) < _CACHE_TTL_SECONDS:
        return _cache

    try:
        data = await pb.list_records(
            "pronunciation_rules",
            filter="enabled = true",
            sort="order,created",
            per_page=200,
        )
    except PocketBaseError as exc:
        log.warning("não consegui carregar as regras de pronúncia: %s", exc)
        return _cache or []

    _cache = data.get("items") or []
    _cache_at = now
    return _cache


def _compile(rule: dict[str, Any]) -> re.Pattern[str] | None:
    pattern = str(rule.get("pattern") or "")
    if not pattern:
        return None
    flags = 0 if rule.get("case_sensitive") else re.IGNORECASE
    try:
        if rule.get("is_regex"):
            return re.compile(pattern, flags)
        return re.compile(re.escape(pattern), flags)
    except re.error as exc:
        log.warning("regra de pronúncia com regex inválida (%r): %s", pattern, exc)
        return None


async def apply_rules(text: str) -> str:
    """Aplica, em ordem, as regras de pronúncia habilitadas sobre o texto."""
    if not text:
        return text

    for rule in await _load_rules():
        compiled = _compile(rule)
        if compiled is None:
            continue
        replacement = str(rule.get("replacement") or "")
        try:
            if rule.get("is_regex"):
                # regex de verdade: permite backreferences (\1, \g<name>...)
                text = compiled.sub(replacement, text)
            else:
                # texto literal: troca sem interpretar \1 etc. na substituição
                text = compiled.sub(lambda _match: replacement, text)
        except re.error as exc:
            log.warning("falha ao aplicar regra de pronúncia %r: %s", rule.get("pattern"), exc)

    return text
