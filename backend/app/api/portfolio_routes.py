"""REST-Endpunkte des Depots: Positionen lesen und speichern, Kennzahlen berechnen."""

from __future__ import annotations

from fastapi import APIRouter, Request

from ..errors import BadRequest, TerminalError
from ..portfolio.analytics import analyze, fx_book, sample_portfolio
from ..portfolio.models import Analytics, Portfolio
from ..portfolio.store import PortfolioStore
from ..services.terminal import Terminal
from ..services.tickers import normalize

router = APIRouter(prefix="/api/portfolio")


def _store(request: Request) -> PortfolioStore:
    return request.app.state.portfolio


async def current_portfolio(app) -> Portfolio:
    """Gespeichertes Depot; im Demo-Modus ohne Datei ein Muster-Depot zum Ausprobieren."""
    saved = app.state.portfolio.load()
    if saved is not None:
        return saved
    t: Terminal = app.state.terminal
    if t.p.mode != "demo":
        return Portfolio()
    sample = getattr(app.state, "portfolio_sample", None)
    if sample is None:
        sample = await sample_portfolio(t)
        app.state.portfolio_sample = sample
    return sample


async def current(request: Request) -> Portfolio:
    return await current_portfolio(request.app)


@router.get("", response_model=Portfolio)
async def get_portfolio(request: Request):
    return await current(request)


@router.put("", response_model=Portfolio)
async def put_portfolio(request: Request, body: Portfolio):
    if body.benchmark:
        bench = normalize(body.benchmark)
        if not bench.endswith(".INDX"):
            raise BadRequest("Als Vergleichsindex bitte einen Index wählen (z. B. DAX Index).")
        body = body.model_copy(update={"benchmark": bench})
    # Neue Ticker prüfen (unbekannte ablehnen; bei Störungen der Datenquelle trotzdem speichern)
    store = _store(request)
    t: Terminal = request.app.state.terminal
    before = await current_portfolio(request.app)
    known = {x.ticker for x in before.positions}
    if body.base != before.base and body.cash and body.cash == before.cash:
        # Neue Basiswährung: Kasse umrechnen statt den Betrag nur umzubenennen
        rate = (await fx_book(t, body.base, {before.base})).now(before.base)
        if rate:
            body = body.model_copy(update={"cash": round(body.cash * rate, 2)})
    for pos in body.positions:
        ticker = normalize(pos.ticker)
        if ticker in known:
            continue
        try:
            await t.resolve(ticker)
        except TerminalError as exc:
            if exc.code == "not_found":
                raise
    # Ein noch nicht gespeichertes Muster-Depot hat Version 0 wie eine fehlende Datei
    return await store.save(body, body.version)


@router.get("/analytics", response_model=Analytics)
async def get_analytics(request: Request):
    return await analyze(request.app.state.terminal, await current(request))
