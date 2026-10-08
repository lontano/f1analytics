from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.config import ROOT, settings
from app.routers import auth, health, me, timing

WEB_DIST = ROOT / "web" / "dist"
_HOP = {"host", "content-length", "connection", "transfer-encoding"}


class CoopMiddleware:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_coop(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers") or [])
                headers.append((b"cross-origin-opener-policy", b"same-origin-allow-popups"))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_coop)


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    application.state.upstream = httpx.AsyncClient(timeout=None)
    try:
        yield
    finally:
        await application.state.upstream.aclose()


app = FastAPI(title="F1 Analytics", lifespan=lifespan)
app.add_middleware(CoopMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(me.router)
app.include_router(timing.router)


async def _forward(request: Request, upstream: str, path: str) -> StreamingResponse:
    client: httpx.AsyncClient = request.app.state.upstream
    url = f"{upstream}/{path}"
    if request.url.query:
        url = f"{url}?{request.url.query}"
    headers = {key: value for key, value in request.headers.items() if key.lower() not in _HOP}
    upstream_request = client.build_request(request.method, url, headers=headers, content=await request.body())
    response = await client.send(upstream_request, stream=True)

    async def chunks() -> AsyncIterator[bytes]:
        try:
            async for chunk in response.aiter_raw():
                yield chunk
        finally:
            await response.aclose()

    passthrough = {
        key: value
        for key, value in response.headers.items()
        if key.lower() not in {"content-encoding", "content-length", "transfer-encoding", "connection"}
    }
    return StreamingResponse(chunks(), status_code=response.status_code, headers=passthrough)


@app.api_route("/timing-live/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], include_in_schema=False)
async def timing_live(path: str, request: Request) -> StreamingResponse:
    return await _forward(request, settings.timing_live_upstream.rstrip("/"), path)


@app.api_route("/timing-api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], include_in_schema=False)
async def timing_schedule(path: str, request: Request) -> StreamingResponse:
    return await _forward(request, settings.timing_schedule_upstream.rstrip("/"), path)


def _mount_web(application: FastAPI, dist: Path) -> None:
    assets = dist / "assets"
    if assets.is_dir():
        application.mount("/assets", StaticFiles(directory=assets), name="assets")

    @application.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str) -> FileResponse:
        candidate = dist / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(dist / "index.html")


if WEB_DIST.is_dir() and (WEB_DIST / "index.html").is_file():
    _mount_web(app, WEB_DIST)
