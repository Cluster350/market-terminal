"""Datenquelle EODHD (echte Marktdaten)."""

from __future__ import annotations

import asyncio
import datetime as dt
import json
from typing import Any, Optional
from urllib.parse import quote as urlquote

from ..config import Settings
from ..eodhd import mapping
from ..eodhd.client import EODHDClient
from ..errors import NotFound, TerminalError
from ..models import (
    Company,
    CountryValue,
    Dividends,
    Earnings,
    EconEvent,
    Financials,
    History,
    Intraday,
    NewsItem,
    Quote,
    ScreenRow,
    SearchHit,
)
from .base import (
    COUNTRIES,
    FX,
    INDICES,
    Catalog,
    Instrument,
    ScreenFilter,
    curve_catalog,
)

CATALOG = Catalog(
    indices=INDICES,
    fx=FX,
    commodities=[
        Instrument("GLD.US", "Gold (SPDR Gold ETF)"),
        Instrument("SLV.US", "Silber (iShares Silver ETF)"),
        Instrument("USO.US", "WTI-Öl (US Oil Fund)"),
        Instrument("BNO.US", "Brent-Öl (US Brent Fund)"),
        Instrument("UNG.US", "Erdgas (US Natural Gas Fund)"),
        Instrument("CPER.US", "Kupfer (US Copper Index Fund)"),
        Instrument("DBA.US", "Agrarrohstoffe (Invesco DB Agriculture)"),
    ],
    curves=curve_catalog(),
    default_watchlist=[
        "AAPL.US", "MSFT.US", "NVDA.US", "AMZN.US", "GOOGL.US", "META.US", "TSLA.US",
        "SAP.XETRA", "SIE.XETRA", "ALV.XETRA", "ASML.AS", "MC.PA", "NESN.SW",
    ],
    default_news=["AAPL.US", "MSFT.US", "NVDA.US", "AMZN.US", "SAP.XETRA", "GSPC.INDX"],
    screener_exchanges=["US", "XETRA", "LSE", "PA", "AS", "SW", "MI", "MC"],
    heatmap_exchange="US",
    countries=COUNTRIES,
)

# Terminal-Feld -> EODHD-Screener-Feld (nur diese lassen sich serverseitig filtern)
SCREEN_FIELD_MAP = {
    "ticker": "code",
    "name": "name",
    "exchange": "exchange",
    "sector": "sector",
    "industry": "industry",
    "market_cap": "market_capitalization",
    "price": "adjusted_close",
    "chg_1d": "refund_1d_p",
    "chg_5d": "refund_5d_p",
    "eps": "earnings_share",
    "div_yield": "dividend_yield",
    "avg_vol": "avgvol_200d",
}
SCREEN_OPS = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<=", "eq": "=", "neq": "!=", "contains": "match"}
SCREEN_SORT_MAP = {
    "market_cap": "market_capitalization",
    "price": "adjusted_close",
    "chg_1d": "refund_1d_p",
    "chg_5d": "refund_5d_p",
    "eps": "earnings_share",
    "div_yield": "dividend_yield",
    "avg_vol": "avgvol_200d",
    "name": "name",
    "ticker": "code",
}


def _path_ticker(ticker: str) -> str:
    return urlquote(ticker, safe=".-_^=&")


class EODHDProvider:
    mode = "eodhd"
    catalog = CATALOG

    def __init__(self, settings: Settings, client: Optional[EODHDClient] = None):
        self.settings = settings
        self.client = client or EODHDClient(
            settings.eodhd_api_key,
            settings.eodhd_base_url,
            daily_budget=settings.daily_call_budget,
            max_concurrency=settings.max_concurrency,
            timeout=settings.request_timeout,
        )

    async def close(self) -> None:
        await self.client.close()

    async def status(self) -> dict[str, Any]:
        info: dict[str, Any] = {"budget": self.client.budget.snapshot()}
        try:
            user = await self.client.get("user")
            if isinstance(user, dict):
                info["account"] = {
                    "plan": user.get("subscriptionType"),
                    "apiRequests": user.get("apiRequests"),
                    "dailyRateLimit": user.get("dailyRateLimit"),
                    "requestsDate": user.get("apiRequestsDate"),
                }
        except TerminalError as exc:
            info["accountError"] = exc.message
        return info

    async def search(self, query: str, limit: int) -> list[SearchHit]:
        data = await self.client.get(f"search/{urlquote(query, safe='')}", {"limit": limit})
        return mapping.search_hits(data)[:limit]

    async def quotes(self, tickers: list[str]) -> list[Quote]:
        if not tickers:
            return []
        out: list[Quote] = []
        # EODHD erlaubt einen Haupt-Ticker plus weitere über s= (Kosten je Ticker)
        for i in range(0, len(tickers), 20):
            chunk = tickers[i : i + 20]
            params = {"s": ",".join(chunk[1:])} if len(chunk) > 1 else {}
            data = await self.client.get(
                f"real-time/{_path_ticker(chunk[0])}", params, cost=len(chunk)
            )
            out.extend(mapping.quotes(data, chunk))
        return out

    async def history(self, ticker: str) -> History:
        start = dt.date.today() - dt.timedelta(days=365 * self.settings.history_years + 10)
        data = await self.client.get(
            f"eod/{_path_ticker(ticker)}", {"from": start.isoformat(), "period": "d", "order": "a"}
        )
        hist = mapping.history(data, ticker)
        if not hist.t:
            raise NotFound(f"Keine Kursdaten für {ticker}.")
        return hist

    async def intraday(self, ticker: str, days: int) -> Intraday:
        interval = "5m" if days <= 5 else "1h"
        now = dt.datetime.now(dt.timezone.utc)
        start = now - dt.timedelta(days=days + 3)  # Wochenenden überbrücken
        data = await self.client.get(
            f"intraday/{_path_ticker(ticker)}",
            {"interval": interval, "from": int(start.timestamp()), "to": int(now.timestamp())},
        )
        return mapping.last_sessions(mapping.intraday(data, ticker, interval), days)

    async def _fundamentals(self, ticker: str) -> dict:
        data = await self.client.get(f"fundamentals/{_path_ticker(ticker)}")
        if not isinstance(data, dict) or not data:
            raise NotFound(f"Keine Fundamentaldaten für {ticker}.")
        return data

    async def company(self, ticker: str) -> Company:
        return mapping.company(await self._fundamentals(ticker), ticker)

    async def financials(self, ticker: str, period: str) -> Financials:
        return mapping.financials(await self._fundamentals(ticker), ticker, period)

    async def earnings(self, ticker: str) -> Earnings:
        return mapping.earnings(await self._fundamentals(ticker), ticker)

    async def dividends(self, ticker: str) -> Dividends:
        start = (dt.date.today() - dt.timedelta(days=365 * 15)).isoformat()
        divs, splits = await asyncio.gather(
            self.client.get(f"div/{_path_ticker(ticker)}", {"from": start}),
            self.client.get(f"splits/{_path_ticker(ticker)}", {"from": "1990-01-01"}),
            return_exceptions=True,
        )
        if isinstance(divs, Exception) and not isinstance(divs, NotFound):
            raise divs
        return mapping.dividends(
            [] if isinstance(divs, Exception) else divs,
            [] if isinstance(splits, Exception) else splits,
            ticker,
        )

    async def news(self, tickers: Optional[list[str]], limit: int) -> list[NewsItem]:
        targets = tickers or self.catalog.default_news
        frm = (dt.date.today() - dt.timedelta(days=14)).isoformat()

        async def one(t: str) -> list[NewsItem]:
            data = await self.client.get("news", {"s": t, "limit": min(limit, 50), "from": frm})
            return mapping.news(data)

        results = await asyncio.gather(*(one(t) for t in targets[:10]), return_exceptions=True)
        items: dict[str, NewsItem] = {}
        errors: list[Exception] = []
        for res in results:
            if isinstance(res, Exception):
                errors.append(res)
                continue
            for item in res:
                items.setdefault(item.id, item)
        if not items and errors:
            raise errors[0]
        return sorted(items.values(), key=lambda n: n.date, reverse=True)

    async def calendar(self, start: dt.date, end: dt.date, country: Optional[str]) -> list[EconEvent]:
        params: dict[str, Any] = {"from": start.isoformat(), "to": end.isoformat(), "limit": 1000}
        if country:
            params["country"] = country
        return mapping.econ_events(await self.client.get("economic-events", params))

    async def macro_indicator(self, country: str, indicator: str) -> list[CountryValue]:
        data = await self.client.get(f"macro-indicator/{urlquote(country, safe='')}", {"indicator": indicator})
        return mapping.macro_series(data)

    async def screener(
        self, filters: list[ScreenFilter], sort: str, desc: bool, max_rows: int
    ) -> tuple[list[ScreenRow], list[ScreenFilter], list[str]]:
        server: list[list[Any]] = []
        local: list[ScreenFilter] = []
        for f in filters:
            field = SCREEN_FIELD_MAP.get(f.field)
            op = SCREEN_OPS.get(f.op)
            if field and op and not isinstance(f.value, (list, tuple)):
                value: Any = f.value
                if f.field == "exchange" and isinstance(value, str):
                    value = "us" if value.upper() == "US" else value.upper()
                if f.field == "div_yield" and isinstance(value, (int, float)):
                    value = value / 100.0  # Terminal: Prozent, EODHD: Anteil
                server.append([field, op, value])
            else:
                local.append(f)

        sort_field = SCREEN_SORT_MAP.get(sort)
        if sort_field is None:
            # Feld nur lokal sortierbar (KGV, Sektor …): die größten Werte laden, nicht die
            # kleinsten Nebenwerte, wenn lokal aufsteigend sortiert wird
            sort_field, desc = "market_capitalization", True
        rows: list[ScreenRow] = []
        seen: set[str] = set()
        cap = max(1, min(max_rows, 1000))
        offset = 0
        while offset < cap and offset <= 999:
            page = min(100, cap - offset)
            params = {
                "sort": f"{sort_field}.{'desc' if desc else 'asc'}",
                "limit": page,
                "offset": offset,
            }
            if server:
                params["filters"] = json.dumps(server)
            data = await self.client.get("screener", params)
            chunk = mapping.screen_rows(data)
            # Zwischen zwei Seitenabrufen kann sich die Reihenfolge ändern: Doppelte verwerfen
            for row in chunk:
                if row.ticker not in seen:
                    seen.add(row.ticker)
                    rows.append(row)
            if len(chunk) < page:
                break
            offset += page
        notes = [
            "Quelle: EODHD-Screener (max. 1.000 Treffer pro Abfrage).",
        ]
        if local:
            notes.append(
                "Folgende Filter werden lokal auf die geladenen Treffer angewandt: "
                + ", ".join(sorted({f.field for f in local}))
                + "."
            )
        return rows, local, notes
