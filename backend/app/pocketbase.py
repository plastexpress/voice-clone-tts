"""Cliente assíncrono do PocketBase (o backend age como superusuário).

O PocketBase é a única fonte de verdade para usuários, tokens, clones de voz,
índice de cache, jobs e logs. Aqui ficam só as chamadas HTTP.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import httpx

from .config import settings
from .logging_setup import get_logger

log = get_logger("vct.pocketbase")


class PocketBaseError(RuntimeError):
    """Erro vindo do PocketBase (status >= 400)."""

    def __init__(self, status_code: int, payload: Any) -> None:
        self.status_code = status_code
        self.payload = payload
        super().__init__(f"PocketBase respondeu {status_code}: {payload}")


def quote(value: str) -> str:
    """Escapa um valor para uso dentro de um filtro do PocketBase."""
    escaped = str(value).replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


class PocketBaseClient:
    def __init__(
        self,
        base_url: str | None = None,
        email: str | None = None,
        password: str | None = None,
    ) -> None:
        self.base_url = (base_url or settings.pb_url).rstrip("/")
        self.email = email or settings.pb_admin_email
        self.password = password or settings.pb_admin_password
        self._client: httpx.AsyncClient | None = None
        self._token: str | None = None
        self._auth_lock = asyncio.Lock()

    # ------------------------------------------------------------- ciclo de vida
    async def start(self) -> None:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=settings.pb_timeout_seconds,
            )

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
        self._token = None

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            raise RuntimeError("PocketBaseClient.start() não foi chamado")
        return self._client

    async def wait_until_ready(self, attempts: int = 30, delay: float = 2.0) -> None:
        """Espera o PocketBase responder — útil no boot do container."""
        await self.start()
        last: Exception | None = None
        for attempt in range(1, attempts + 1):
            try:
                response = await self.client.get("/api/health")
                if response.status_code < 500:
                    log.info("PocketBase disponível em %s", self.base_url)
                    return
                last = PocketBaseError(response.status_code, response.text)
            except Exception as exc:  # noqa: BLE001 - queremos tentar de novo
                last = exc
            log.info("aguardando o PocketBase (%s/%s)...", attempt, attempts)
            await asyncio.sleep(delay)
        raise RuntimeError(f"PocketBase não respondeu em {self.base_url}: {last}")

    # -------------------------------------------------------------- autenticação
    async def authenticate(self, force: bool = False) -> str:
        async with self._auth_lock:
            if self._token and not force:
                return self._token
            response = await self.client.post(
                "/api/collections/_superusers/auth-with-password",
                json={"identity": self.email, "password": self.password},
            )
            if response.status_code >= 400:
                raise PocketBaseError(response.status_code, _safe_json(response))
            self._token = response.json()["token"]
            log.info("autenticado no PocketBase como %s", self.email)
            return self._token

    async def _request(
        self,
        method: str,
        path: str,
        *,
        retry_auth: bool = True,
        **kwargs: Any,
    ) -> httpx.Response:
        token = self._token or await self.authenticate()
        headers = dict(kwargs.pop("headers", {}) or {})
        headers["Authorization"] = token
        response = await self.client.request(method, path, headers=headers, **kwargs)

        if response.status_code in (401, 403) and retry_auth:
            await self.authenticate(force=True)
            return await self._request(method, path, retry_auth=False, headers=headers, **kwargs)

        if response.status_code >= 400:
            raise PocketBaseError(response.status_code, _safe_json(response))
        return response

    # ------------------------------------------------------------------ registros
    async def list_records(
        self,
        collection: str,
        *,
        filter: str | None = None,
        sort: str | None = None,
        expand: str | None = None,
        fields: str | None = None,
        page: int = 1,
        per_page: int = 50,
        skip_total: bool = True,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "perPage": per_page}
        if filter:
            params["filter"] = filter
        if sort:
            params["sort"] = sort
        if expand:
            params["expand"] = expand
        if fields:
            params["fields"] = fields
        if skip_total:
            params["skipTotal"] = "true"
        response = await self._request(
            "GET", f"/api/collections/{collection}/records", params=params
        )
        return response.json()

    async def first_record(
        self,
        collection: str,
        filter: str,
        *,
        expand: str | None = None,
        sort: str | None = None,
    ) -> dict[str, Any] | None:
        data = await self.list_records(
            collection, filter=filter, expand=expand, sort=sort, per_page=1
        )
        items = data.get("items") or []
        return items[0] if items else None

    async def get_record(
        self, collection: str, record_id: str, *, expand: str | None = None
    ) -> dict[str, Any] | None:
        params = {"expand": expand} if expand else None
        try:
            response = await self._request(
                "GET", f"/api/collections/{collection}/records/{record_id}", params=params
            )
        except PocketBaseError as exc:
            if exc.status_code == 404:
                return None
            raise
        return response.json()

    async def create_record(self, collection: str, data: dict[str, Any]) -> dict[str, Any]:
        response = await self._request("POST", f"/api/collections/{collection}/records", json=data)
        return response.json()

    async def update_record(
        self, collection: str, record_id: str, data: dict[str, Any]
    ) -> dict[str, Any]:
        response = await self._request(
            "PATCH", f"/api/collections/{collection}/records/{record_id}", json=data
        )
        return response.json()

    async def delete_record(self, collection: str, record_id: str) -> None:
        try:
            await self._request("DELETE", f"/api/collections/{collection}/records/{record_id}")
        except PocketBaseError as exc:
            if exc.status_code != 404:
                raise

    # --------------------------------------------------------------------- arquivos
    def file_url(self, collection: str, record_id: str, filename: str) -> str:
        return f"{self.base_url}/api/files/{collection}/{record_id}/{filename}"

    async def download_file(
        self, collection: str, record_id: str, filename: str, dest: Path
    ) -> Path:
        """Baixa um arquivo do PocketBase para o disco local do backend."""
        dest.parent.mkdir(parents=True, exist_ok=True)
        url = f"/api/files/{collection}/{record_id}/{filename}"
        token = self._token or await self.authenticate()
        tmp = dest.with_suffix(dest.suffix + ".part")
        async with self.client.stream(
            "GET", url, headers={"Authorization": token}
        ) as response:
            if response.status_code >= 400:
                await response.aread()
                raise PocketBaseError(response.status_code, response.text)
            with tmp.open("wb") as handle:
                async for chunk in response.aiter_bytes(64 * 1024):
                    handle.write(chunk)
        tmp.replace(dest)
        return dest

    # ------------------------------------------- validação de usuário da interface
    async def verify_user_token(self, jwt: str) -> dict[str, Any] | None:
        """Valida o JWT de um usuário logado na interface. Retorna o record."""
        try:
            response = await self.client.post(
                "/api/collections/users/auth-refresh",
                headers={"Authorization": jwt},
            )
        except httpx.HTTPError as exc:
            log.warning("falha ao validar token de usuário: %s", exc)
            return None
        if response.status_code >= 400:
            return None
        return response.json().get("record")


def _safe_json(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return response.text


# instância única usada pela aplicação
pb = PocketBaseClient()
