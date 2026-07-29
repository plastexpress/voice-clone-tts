"""Autenticação por token no header + rate limit por token."""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from fastapi import Depends, Header, HTTPException, Request, status

from .config import settings
from .logging_setup import get_logger
from .pocketbase import PocketBaseError, pb, quote
from .security import extract_bearer, hash_token

log = get_logger("vct.auth")


@dataclass(slots=True)
class TokenContext:
    """Token válido + tudo que ele carrega de configuração."""

    record: dict[str, Any]
    voice: dict[str, Any] | None = None

    @property
    def id(self) -> str:
        return str(self.record.get("id", ""))

    @property
    def name(self) -> str:
        return str(self.record.get("name") or "sem nome")

    @property
    def prefix(self) -> str:
        return str(self.record.get("token_prefix") or "")

    @property
    def allow_overrides(self) -> bool:
        return bool(self.record.get("allow_overrides"))

    @property
    def rate_limit_per_min(self) -> int:
        try:
            return int(self.record.get("rate_limit_per_min") or 0)
        except (TypeError, ValueError):
            return 0

    @property
    def settings_json(self) -> dict[str, Any]:
        raw = self.record.get("settings")
        return raw if isinstance(raw, dict) else {}


@dataclass
class _CacheEntry:
    context: TokenContext
    expires_at: float


class _TokenCache:
    """Evita bater no PocketBase a cada request (TTL curto)."""

    def __init__(self, ttl: float) -> None:
        self._ttl = ttl
        self._entries: dict[str, _CacheEntry] = {}

    def get(self, key: str) -> TokenContext | None:
        entry = self._entries.get(key)
        if entry is None:
            return None
        if entry.expires_at < time.monotonic():
            self._entries.pop(key, None)
            return None
        return entry.context

    def put(self, key: str, context: TokenContext) -> None:
        self._entries[key] = _CacheEntry(context, time.monotonic() + self._ttl)

    def invalidate(self, key: str | None = None) -> None:
        if key is None:
            self._entries.clear()
        else:
            self._entries.pop(key, None)


_token_cache = _TokenCache(settings.token_cache_ttl_seconds)


@dataclass
class _RateLimiter:
    """Janela deslizante de 60s por token."""

    windows: dict[str, deque[float]] = field(default_factory=dict)

    def check(self, token_id: str, limit: int) -> bool:
        if limit <= 0:
            return True
        now = time.monotonic()
        window = self.windows.setdefault(token_id, deque())
        while window and now - window[0] > 60.0:
            window.popleft()
        if len(window) >= limit:
            return False
        window.append(now)
        return True


_rate_limiter = _RateLimiter()


def _parse_pb_datetime(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    text = value.strip().replace(" ", "T")
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


async def _load_token_context(raw_token: str) -> TokenContext:
    token_hash = hash_token(raw_token)
    cached = _token_cache.get(token_hash)
    if cached is not None:
        return cached

    try:
        record = await pb.first_record(
            "api_tokens",
            filter=f"token_hash = {quote(token_hash)}",
            expand="voice",
        )
    except PocketBaseError as exc:
        log.error("erro ao consultar tokens no PocketBase: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="banco de dados indisponível",
        ) from exc

    if record is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="token inválido")

    if not record.get("active", False):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="token desativado")

    expires_at = _parse_pb_datetime(record.get("expires_at"))
    if expires_at is not None and expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="token expirado")

    voice = (record.get("expand") or {}).get("voice")
    if isinstance(voice, list):
        voice = voice[0] if voice else None

    context = TokenContext(record=record, voice=voice)
    _token_cache.put(token_hash, context)
    return context


async def require_token(
    request: Request,
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> TokenContext:
    """Dependency principal da API pública."""
    raw = extract_bearer(authorization) or (x_api_key.strip() if x_api_key else None)
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="informe o token em 'Authorization: Bearer <token>'",
            headers={"WWW-Authenticate": "Bearer"},
        )

    context = await _load_token_context(raw)

    if not _rate_limiter.check(context.id, context.rate_limit_per_min):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"limite de {context.rate_limit_per_min} requisições/minuto excedido",
            headers={"Retry-After": "60"},
        )

    request.state.token_context = context
    return context


async def require_user(
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Dependency dos endpoints internos usados pela interface (JWT do PocketBase)."""
    raw = extract_bearer(authorization)
    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="não autenticado")
    user = await pb.verify_user_token(raw)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="sessão inválida")
    return user


async def token_or_user(
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> dict[str, Any]:
    """Aceita token de API **ou** sessão da interface (usado no download de áudio)."""
    raw = extract_bearer(authorization) or (x_api_key.strip() if x_api_key else None)
    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="não autenticado")

    if raw.startswith("vct_"):
        context = await _load_token_context(raw)
        return {"kind": "token", "token": context}

    user = await pb.verify_user_token(raw)
    if user is not None:
        return {"kind": "user", "user": user}

    # último recurso: pode ser um token de API sem o prefixo esperado
    context = await _load_token_context(raw)
    return {"kind": "token", "token": context}


def invalidate_token_cache(token_hash: str | None = None) -> None:
    _token_cache.invalidate(token_hash)


__all__ = [
    "TokenContext",
    "require_token",
    "require_user",
    "token_or_user",
    "invalidate_token_cache",
    "Depends",
]
