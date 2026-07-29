"""Geração e verificação dos tokens da API.

O token em claro só existe no momento da criação (na interface). O banco guarda
apenas o sha256 — por isso um token perdido não pode ser recuperado, só rotacionado.
A mesma lógica está implementada no frontend (Web Crypto) em src/lib/token.ts.
"""

from __future__ import annotations

import base64
import hashlib
import secrets

TOKEN_PREFIX = "vct_"
TOKEN_BYTES = 32
DISPLAY_PREFIX_LENGTH = 12


def generate_token() -> str:
    """Gera um token novo: `vct_` + 32 bytes aleatórios em base64url."""
    raw = base64.urlsafe_b64encode(secrets.token_bytes(TOKEN_BYTES)).decode().rstrip("=")
    return f"{TOKEN_PREFIX}{raw}"


def hash_token(raw_token: str) -> str:
    """sha256 hexadecimal do token — é isso que fica no PocketBase."""
    return hashlib.sha256(raw_token.strip().encode("utf-8")).hexdigest()


def display_prefix(raw_token: str) -> str:
    """Trecho inicial mostrado na interface para identificar o token."""
    return raw_token[:DISPLAY_PREFIX_LENGTH]


def extract_bearer(authorization: str | None) -> str | None:
    """Aceita `Authorization: Bearer <token>` ou o token cru no header."""
    if not authorization:
        return None
    value = authorization.strip()
    if value.lower().startswith("bearer "):
        value = value[7:].strip()
    return value or None
