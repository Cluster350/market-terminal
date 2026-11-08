"""Einstiegspunkt: uvicorn app.main:app"""

from __future__ import annotations

import logging
import math
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

import httpx

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from .ai.service import AIService
from .alerts.service import AlertService
from .api.ai_routes import router as ai_router
from .api.alert_routes import router as alert_router
from .api.forecast_routes import router as forecast_router
from .api.forward_routes import router as forward_router
from .api.option_routes import router as option_router
from .api.portfolio_routes import current_portfolio, router as portfolio_router
from .api.routes import router
from .api.stream_routes import router as stream_router
from .api.rotation_routes import router as rotation_router
from .api.valuation_routes import router as valuation_router
from .cache import TTLCache
from .config import Settings, settings
from .errors import TerminalError
from .forecast.service import ForecastService
from .portfolio.store import PortfolioStore
from .providers.base import Provider
from .realtime.demo import DemoSource
from .realtime.eodhd_ws import EodhdSource
from .realtime.hub import RealtimeHub
from .services.terminal import Terminal, request_flags
from .rotation.service import RotationService
from .valuation.service import ValuationService

log = logging.getLogger("terminal")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def _finite(x: Any) -> Any:
    if isinstance(x, float) and not math.isfinite(x):
        return None
    if isinstance(x, dict):
        return {k: _finite(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_finite(v) for v in x]
    return x


class SafeJSONResponse(JSONResponse):
    """JSON ohne NaN/Infinity: Starlette lehnt sie ab (allow_nan=False), was die ganze Antwort
    zu einem 500er machte. Solche Werte werden zu null; der Normalfall kostet nichts extra."""

    def render(self, content: Any) -> bytes:
        try:
            return super().render(content)
        except ValueError:
            log.warning("Nicht-endliche Zahl in der Antwort durch null ersetzt.")
            return super().render(_finite(content))


def make_provider(cfg: Settings) -> Provider:
    if cfg.mode == "eodhd":
        from .providers.eodhd import EODHDProvider

        return EODHDProvider(cfg)
    from .providers.demo import DemoProvider

    return DemoProvider()


class _GZipExceptStream(GZipMiddleware):
    """GZip für alle Antworten außer dem Echtzeit-Strom: Komprimierung würde die Ereignisse puffern."""

    async def __call__(self, scope, receive, send):  # type: ignore[no-untyped-def]
        if scope.get("type") == "http" and str(scope.get("path", "")).startswith("/api/stream"):
            await self.app(scope, receive, send)
            return
        await super().__call__(scope, receive, send)


def make_realtime(app: FastAPI, prov: Provider, cfg: Settings, enabled: bool) -> RealtimeHub:
    """Echtzeit-Verteiler: Demo-Strom bzw. EODHD-WebSocket; verzögerte Kurse für alle übrigen Werte."""
    source = None
    if enabled and cfg.realtime != "off":
        if prov.mode == "demo" and hasattr(prov, "live_price"):
            source = DemoSource(prov)
        elif prov.mode == "eodhd" and cfg.eodhd_api_key:
            source = EodhdSource(cfg.eodhd_api_key)

    async def server_tickers() -> list[str]:
        tickers = [a.ticker for a in app.state.alerts.load().alerts if a.alarm and a.active]
        try:
            tickers += [p.ticker for p in (await current_portfolio(app)).positions]
        except Exception:  # noqa: BLE001 – ohne Depot nur die Alarme
            pass
        return list(dict.fromkeys(tickers))

    return RealtimeHub(
        source,
        delayed_quotes=(lambda ts: app.state.terminal.quotes(ts)) if enabled else None,
        server_tickers=server_tickers if enabled else None,
    )


def create_app(
    provider: Provider | None = None, cfg: Settings = settings, llm_transport: Optional[httpx.AsyncBaseTransport] = None,
    realtime: Optional[bool] = None, forecast: Optional[str] = None, valuation: Optional[bool] = None,
) -> FastAPI:
    # Bewertungstrend im Hintergrund vorberechnen (Tests mit eigenem Provider rechnen erst bei Abfrage)
    valuation_auto = valuation if valuation is not None else provider is None
    # Prognose: Tests (eigener Provider) rechnen ohne Chronos-2, damit nicht bei jedem Start das Modell lädt
    forecast_mode = forecast or (cfg.forecast_mode if provider is None else "simple")
    # Echtzeit läuft im Betrieb; Tests übergeben einen eigenen Provider mit fester Uhr und schalten
    # sie bei Bedarf ausdrücklich ein (sonst würden Hintergrund-Ticks erwartete Kurse verändern)
    live = realtime if realtime is not None else provider is None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        prov = provider or make_provider(cfg)
        app.state.terminal = Terminal(prov, TTLCache())
        app.state.ai = AIService(cfg, app.state.terminal, prov.mode, transport=llm_transport)
        app.state.portfolio = PortfolioStore(cfg.portfolio_dir, prov.mode)
        app.state.terminal.portfolio_source = lambda: current_portfolio(app)
        app.state.alerts = AlertService(app.state.terminal, cfg.portfolio_dir, prov.mode, cfg.alert_interval)
        app.state.terminal.alerts_source = app.state.alerts.view
        app.state.alerts.start()
        app.state.ai.start()
        app.state.realtime = make_realtime(app, prov, cfg, live)
        app.state.terminal.realtime = app.state.realtime if live else None
        app.state.realtime.start()
        app.state.forecast = ForecastService(forecast_mode, cfg.forecast_model, cfg.forecast_device)
        app.state.terminal.forecast = app.state.forecast
        app.state.forecast.start()
        app.state.valuation = ValuationService(app.state.terminal, cfg.portfolio_dir, prov.mode)
        app.state.terminal.valuation = app.state.valuation
        app.state.rotation = RotationService(app.state.terminal, app.state.valuation)
        if valuation_auto:
            app.state.valuation.start()
        log.info("Market Terminal gestartet, Datenquelle: %s, KI: LLM_MODE=%s (%s)", prov.mode, cfg.llm_mode, cfg.llm_base_url)
        yield
        await app.state.realtime.close()
        await app.state.forecast.close()
        await app.state.valuation.close()
        await app.state.alerts.close()
        await app.state.ai.close()
        await prov.close()

    app = FastAPI(title="Market Terminal API", version="1.0.0", lifespan=lifespan, default_response_class=SafeJSONResponse)
    app.add_middleware(_GZipExceptStream, minimum_size=2048)

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
    app.include_router(ai_router)
    app.include_router(portfolio_router)
    app.include_router(alert_router)
    app.include_router(forward_router)
    app.include_router(option_router)
    app.include_router(stream_router)
    app.include_router(forecast_router)
    app.include_router(valuation_router)
    app.include_router(rotation_router)

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
