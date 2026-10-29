"""Einstiegspunkt: uvicorn app.main:app"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from .api.routes import router
from .cache import TTLCache
from .config import Settings, settings
from .errors import TerminalError
from .providers.base import Provider
from .services.terminal import Terminal, request_flags

log = logging.getLogger("terminal")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def make_provider(cfg: Settings) -> Provider:
    if cfg.mode == "eodhd":
        from .providers.eodhd import EODHDProvider

        return EODHDProvider(cfg)
    from .providers.demo import DemoProvider

    return DemoProvider()


def create_app(provider: Provider | None = None, cfg: Settings = settings) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        prov = provider or make_provider(cfg)
        app.state.terminal = Terminal(prov, TTLCache())
        log.info("Market Terminal gestartet, Datenquelle: %s", prov.mode)
        yield
        await prov.close()

    app = FastAPI(title="Market Terminal API", version="1.0.0", lifespan=lifespan)
    app.add_middleware(GZipMiddleware, minimum_size=2048)

    @app.middleware("http")
    async def flags(request: Request, call_next):
        holder: dict = {}
        request_flags.set(holder)
        response = await call_next(request)
        if holder.get("stale"):
            response.headers["X-Data-Stale"] = "1"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(TerminalError)
    async def terminal_error(_: Request, exc: TerminalError):
        return JSONResponse(status_code=exc.status, content={"error": {"code": exc.code, "message": exc.message}})

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException):
        message = "Unbekannter Endpunkt." if exc.status_code == 404 else str(exc.detail)
        return JSONResponse(status_code=exc.status_code, content={"error": {"code": "http", "message": message}})

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(x) for x in first.get("loc", []) if x not in ("query", "body", "path"))
        msg = f"Ungültiger Parameter {where}: {first.get('msg', '')}".strip()
        return JSONResponse(status_code=422, content={"error": {"code": "validation", "message": msg}})

    @app.exception_handler(Exception)
    async def unexpected(_: Request, exc: Exception):
        log.exception("Unerwarteter Fehler: %s", exc)
        return JSONResponse(
            status_code=500,
            content={"error": {"code": "internal", "message": "Interner Fehler. Details stehen im Server-Log."}},
        )

    app.include_router(router)

    static = Path(cfg.static_dir)
    if static.is_dir() and (static / "index.html").is_file():
        assets = static / "assets"
        if assets.is_dir():
            app.mount("/assets", StaticFiles(directory=assets), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            if path.startswith("api/"):
                return JSONResponse(status_code=404, content={"error": {"code": "not_found", "message": "Unbekannter Endpunkt."}})
            candidate = (static / path).resolve()
            if path and candidate.is_file() and static.resolve() in candidate.parents:
                return FileResponse(candidate)
            return FileResponse(static / "index.html")

    return app


app = create_app()
