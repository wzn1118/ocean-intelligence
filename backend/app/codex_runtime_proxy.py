import hashlib
import hmac
import os
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from app.auth import require_user
from app.models import UserPublic


router = APIRouter(tags=["Codex runtime"])

_FORWARDED_REQUEST_HEADERS = {"accept", "content-type", "last-event-id"}
_FORWARDED_RESPONSE_HEADERS = {"cache-control", "content-disposition", "content-encoding", "content-type"}
_MAX_REQUEST_BODY_BYTES = 25 * 1024 * 1024
_TENANT_USER_HEADER = "X-Ocean-Codex-User"
_TENANT_TIMESTAMP_HEADER = "X-Ocean-Codex-Timestamp"
_TENANT_SIGNATURE_HEADER = "X-Ocean-Codex-Signature"
_proxy_client: httpx.AsyncClient | None = None


def _get_proxy_client() -> httpx.AsyncClient:
    global _proxy_client
    if _proxy_client is None or _proxy_client.is_closed:
        _proxy_client = httpx.AsyncClient(
            timeout=None,
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=20, keepalive_expiry=30),
        )
    return _proxy_client


async def _close_proxy(response: httpx.Response) -> None:
    await response.aclose()


async def close_codex_proxy_client() -> None:
    global _proxy_client
    if _proxy_client is not None and not _proxy_client.is_closed:
        await _proxy_client.aclose()
    _proxy_client = None


@router.api_route(
    "/api/codex-runtime/{runtime_path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
)
async def codex_runtime_proxy(
    runtime_path: str,
    request: Request,
    user: UserPublic = Depends(require_user),
) -> StreamingResponse:
    runtime_url = os.getenv("CODEX_RUNTIME_URL", "").strip().rstrip("/")
    if not runtime_url:
        raise HTTPException(status_code=503, detail="Codex runtime is not configured")

    query = request.url.query
    target = f"{runtime_url}/api/codex-runtime/{runtime_path}"
    if query:
        target = f"{target}?{query}"
    headers = {
        name: value
        for name, value in request.headers.items()
        if name.lower() in _FORWARDED_REQUEST_HEADERS
    }
    headers.update(_tenant_headers(user.id, request.method, runtime_path))
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > _MAX_REQUEST_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Codex upload exceeds the 25 MB limit")
    body = b"" if request.method in {"GET", "HEAD"} else await request.body()
    if len(body) > _MAX_REQUEST_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Codex upload exceeds the 25 MB limit")
    client = _get_proxy_client()
    try:
        upstream_request = client.build_request(
            request.method,
            target,
            headers=headers,
            content=body,
        )
        upstream = await client.send(upstream_request, stream=True)
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail=f"Codex runtime unavailable: {error}") from error

    response_headers = {
        name: value
        for name, value in upstream.headers.items()
        if name.lower() in _FORWARDED_RESPONSE_HEADERS
    }
    return StreamingResponse(
        upstream.aiter_raw(),
        status_code=upstream.status_code,
        headers=response_headers,
        background=BackgroundTask(_close_proxy, upstream),
    )


def _tenant_headers(user_id: str, method: str, runtime_path: str) -> dict[str, str]:
    secret = os.getenv("OCEAN_CODEX_TENANT_SECRET", "").strip()
    if not secret:
        raise HTTPException(status_code=503, detail="Codex tenant isolation is not configured")
    timestamp = str(int(time.time()))
    payload = f"{user_id}\n{method.upper()}\n{runtime_path}\n{timestamp}".encode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    return {
        _TENANT_USER_HEADER: user_id,
        _TENANT_TIMESTAMP_HEADER: timestamp,
        _TENANT_SIGNATURE_HEADER: signature,
    }
