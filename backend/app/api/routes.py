"""REST-Endpunkte für das Frontend."""

from __future__ import annotations

import datetime as dt
from typing import Any, Optional

from fastapi import APIRouter, Body, Query, Request

from ..errors import BadRequest
from ..models import (
    Company,
    EarningsEvent,
    PeerResult,
    CountryTable,
    Curve,
    Dividends,
    Earnings,
    EconEvent,
    Financials,
    History,
    Intraday,
    MarketRow,
    Movers,
    NewsPage,
    Quote,
    ScreenField,
    ScreenResult,
    SearchHit,
    Series,
    WorldMap,
)
from ..services.terminal import Terminal
from ..services.tickers import normalize, normalize_list

router = APIRouter(prefix="/api")


def T(request: Request) -> Terminal:
    return request.app.state.terminal


@router.get("/status")
async def status(request: Request) -> dict[str, Any]:
    return await T(request).status()


@router.get("/search", response_model=list[SearchHit])
async def search(request: Request, q: str = Query("", max_length=40), limit: int = Query(12, ge=1, le=50)):
    return await T(request).search(q, limit)


@router.get("/quotes", response_model=list[Quote])
async def quotes(request: Request, tickers: str = Query(..., description="Kommagetrennt")):
    return await T(request).quotes(normalize_list(tickers))


@router.get("/history/{ticker}", response_model=History)
async def history(
    request: Request,
    ticker: str,
    start: Optional[str] = Query(None, alias="from"),
    end: Optional[str] = Query(None, alias="to"),
):
    h = await T(request).history(normalize(ticker))
    if start is None and end is None:
        return h
    # Zeitraum einschränken (vorher wurden from/to stillschweigend ignoriert)
    lo = _date(start, dt.date(1900, 1, 1)).isoformat()
    hi = _date(end, dt.date(2200, 1, 1)).isoformat()
    if lo > hi:
        raise BadRequest("„from“ liegt nach „to“.")
    keep = [i for i, d in enumerate(h.t) if lo <= d <= hi]
    return h.model_copy(update={k: [getattr(h, k)[i] for i in keep] for k in ("t", "o", "h", "l", "c", "v")})


@router.get("/intraday/{ticker}", response_model=Intraday)
async def intraday(request: Request, ticker: str, days: int = Query(1, ge=1, le=10)):
    return await T(request).intraday(normalize(ticker), days)


@router.get("/company/{ticker}", response_model=Company)
async def company(request: Request, ticker: str):
    return await T(request).company(normalize(ticker))


@router.get("/financials/{ticker}", response_model=Financials)
async def financials(request: Request, ticker: str, period: str = Query("annual")):
    return await T(request).financials(normalize(ticker), period)


@router.get("/earnings/{ticker}", response_model=Earnings)
async def earnings(request: Request, ticker: str):
    return await T(request).earnings(normalize(ticker))


@router.get("/dividends/{ticker}", response_model=Dividends)
async def dividends(request: Request, ticker: str):
    return await T(request).dividends(normalize(ticker))


@router.get("/news", response_model=NewsPage)
async def news(
    request: Request,
    tickers: Optional[str] = Query(None),
    topic: Optional[str] = Query(None, pattern="^(all|company|earnings|analyst|mna|macro|markets)$"),
    q: Optional[str] = Query(None, max_length=60),
    limit: int = Query(100, ge=1, le=300),
    offset: int = Query(0, ge=0, le=5000),
    since: Optional[str] = Query(None, max_length=40),
):
    tlist = normalize_list(tickers, limit=30) if tickers else None
    return await T(request).news(tlist, topic, q, limit, offset, since)


@router.get("/macro/indices", response_model=list[MarketRow])
async def macro_indices(request: Request):
    return await T(request).indices()


@router.get("/macro/fx", response_model=list[MarketRow])
async def macro_fx(request: Request):
    return await T(request).fx()


@router.get("/macro/commodities", response_model=list[MarketRow])
async def macro_commodities(request: Request):
    return await T(request).commodities()


@router.get("/macro/curves", response_model=list[Curve])
async def macro_curves(request: Request, countries: str = Query("US,DE")):
    wanted = [c.strip().upper() for c in countries.split(",") if c.strip()][:6]
    return await T(request).curves(wanted)


@router.get("/macro/spreads", response_model=list[Series])
async def macro_spreads(request: Request, years: int = Query(2, ge=1, le=10)):
    return await T(request).spreads(years)


def _date(raw: Optional[str], default: dt.date) -> dt.date:
    if not raw:
        return default
    try:
        d = dt.date.fromisoformat(raw)
    except ValueError as exc:
        raise BadRequest(f"Datum „{raw}“ ungültig (Format JJJJ-MM-TT).") from exc
    # Randdaten (9999-12-31 + 6 Tage als Standard-Ende) ließen die Datumsarithmetik überlaufen
    if not 1900 <= d.year <= 2200:
        raise BadRequest("Datum außerhalb des unterstützten Bereichs (1900–2200).")
    return d


@router.get("/macro/calendar", response_model=list[EconEvent])
async def macro_calendar(
    request: Request,
    start: Optional[str] = Query(None, alias="from"),
    end: Optional[str] = Query(None, alias="to"),
    country: Optional[str] = Query(None, pattern="^[A-Za-z]{2}$"),
    importance: int = Query(1, ge=1, le=3),
):
    today = dt.date.today()
    s = _date(start, today - dt.timedelta(days=3))
    e = _date(end, today + dt.timedelta(days=7))
    return await T(request).calendar(s, e, country.upper() if country else None, importance)


@router.get("/macro/worldmap", response_model=WorldMap)
async def world_map(request: Request, group: str = Query("equity", pattern="^(equity|rates|macro)$")):
    """Länderdaten für die Weltkarte (WMAP): Aktienindizes, zehnjährige Anleihen oder Konjunktur."""
    return await T(request).world_map(group)


@router.get("/macro/countries", response_model=CountryTable)
async def macro_countries(request: Request, indicators: Optional[str] = Query(None)):
    keys = [k.strip() for k in indicators.split(",")] if indicators else None
    return await T(request).countries(keys)


@router.get("/screener/fields", response_model=list[ScreenField])
async def screener_fields(request: Request):
    return T(request).screen_fields()


@router.post("/screener", response_model=ScreenResult)
async def screener(request: Request, body: dict = Body(...)):
    term = T(request)
    filters = term.parse_filters(body.get("filters") or [])
    sort = str(body.get("sort") or "market_cap")
    desc = bool(body.get("desc", True))
    try:
        limit = int(body.get("limit", 100))
    except (TypeError, ValueError, OverflowError) as exc:  # OverflowError: limit = Infinity
        raise BadRequest("limit muss eine Zahl sein.") from exc
    return await term.screen(filters, sort, desc, limit, bool(body.get("enrich", False)))


@router.get("/market/movers", response_model=Movers)
async def market_movers(request: Request, exchange: Optional[str] = Query(None, max_length=10)):
    term = T(request)
    return await term.movers(exchange or term.p.catalog.heatmap_exchange)


@router.get("/market/heatmap", response_model=ScreenResult)
async def market_heatmap(request: Request, exchange: Optional[str] = Query(None, max_length=10), limit: int = Query(100, ge=10, le=300)):
    term = T(request)
    return await term.heatmap(exchange or term.p.catalog.heatmap_exchange, limit)


@router.get("/resolve", response_model=SearchHit)
async def resolve(request: Request, q: str = Query(..., min_length=1, max_length=40)):
    return await T(request).resolve(normalize(q))


@router.get("/calendar/earnings", response_model=list[EarningsEvent])
async def calendar_earnings(
    request: Request,
    start: Optional[str] = Query(None, alias="from"),
    end: Optional[str] = Query(None, alias="to"),
):
    today = dt.date.today()
    s = _date(start, today - dt.timedelta(days=today.weekday()))
    e = _date(end, s + dt.timedelta(days=6))
    return await T(request).earnings_calendar(s, e)


@router.get("/peers/{ticker}", response_model=PeerResult)
async def peers(request: Request, ticker: str, limit: int = Query(12, ge=3, le=30)):
    return await T(request).peers(normalize(ticker), limit)
