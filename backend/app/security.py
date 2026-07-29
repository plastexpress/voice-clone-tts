"""Geração e verificação dos tokens da API.

O hash (sha256) é o que autentica os requests — isso não muda. Opcionalmente
o token também é guardado criptografado (`token_encrypted`, ver migração
1750000002) para poder ser "revelado" depois pela interface; só o backend, com
TOKEN_ENCRYPTION_KEY, consegue decifrar. A geração/hash em claro espelha o
frontend (Web Crypto) em src/lib/token.ts.
"""

from __future__ import annotations

import base64
import hashlib
import secrets

from .config import settings

TOKEN_PREFIX = "vct_"
TOKEN_BYTES = 32
DISPLAY_PREFIX_LENGTH = 12


class TokenEncryptionUnavailable(RuntimeError):
    pass


def _fernet():
    if not settings.token_encryption_key:
        raise TokenEncryptionUnavailable(
            "TOKEN_ENCRYPTION_KEY não configurada — a criptografia reversível "
            "de tokens está desligada. Gere uma chave com: "
            'python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
        )
    from cryptography.fernet import Fernet

    return Fernet(settings.token_encryption_key.encode("utf-8"))


def encrypt_token(raw_token: str) -> str:
    """Cifra o token em claro para guardar de forma reversível."""
    return _fernet().encrypt(raw_token.strip().encode("utf-8")).decode("ascii")


def decrypt_token(ciphertext: str) -> str:
    """Devolve o token original a partir do valor cifrado."""
    from cryptography.fernet import InvalidToken

    try:
        return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("não foi possível decifrar este token") from exc


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
