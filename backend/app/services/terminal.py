"""Fachlogik des Terminals: Caching, Kennzahlen, Makro-Aggregation, Screener."""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
import math
from contextvars import ContextVar
from typing import Any, Awaitable, Callable, Optional

from ..cache import TTLCache
from ..errors import BadRequest, NotFound, PlanNotIncluded, TerminalError
from ..models import (
    Company,
    EarningsEvent,
    PeerResult,
    CountryRow,
    CountryTable,
    CountryValue,
    Curve,
    CurvePoint,
    Dividends,
    Earnings,
    EconEvent,
    Financials,
    History,
    Indicator,
    Intraday,
    MarketRow,
    Movers,
    NewsItem,
    NewsPage,
    Quote,
    ScreenField,
    ScreenResult,
    ScreenRow,
    SearchHit,
    Series,
)
from ..providers.base import MACRO_INDICATORS, Instrument, Provider, ScreenFilter
from . import metrics
from .util import pct

log = logging.getLogger("terminal")

# Wird pro Anfrage von der Middleware gesetzt; True, wenn veraltete Daten ausgeliefert wurden
request_flags: ContextVar[Optional[dict]] = ContextVar("request_flags", default=None)

SECTORS = [
    "Basic Materials", "Communication Services", "Consumer Cyclical", "Consumer Defensive",
    "Energy", "Financial Services", "Healthcare", "Industrials", "Real Estate", "Technology", "Utilities",
]

SCREEN_FIELDS: list[ScreenField] = [
    ScreenField(key="exchange", label="Börse", group="descriptive", kind="choice"),
    ScreenField(key="sector", label="Sektor", group="descriptive", kind="choice", choices=SECTORS),
    ScreenField(key="industry", label="Branche", group="descriptive", kind="text"),
    ScreenField(key="name", label="Name", group="descriptive", kind="text"),
    ScreenField(key="market_cap", label="Marktkap. (USD)", group="descriptive", kind="money"),
    ScreenField(key="price", label="Kurs", group="descriptive", kind="number"),
    ScreenField(key="avg_vol", label="Ø Volumen", group="descriptive", kind="number"),
    ScreenField(key="pe", label="KGV", group="fundamental", kind="number"),
    ScreenField(key="eps", label="EPS", group="fundamental", kind="number"),
    ScreenField(key="div_yield", label="Div.-Rendite %", group="fundamental", kind="percent"),
    ScreenField(key="chg_1d", label="Veränd. 1T %", group="technical", kind="percent"),
    ScreenField(key="chg_5d", label="Veränd. 5T %", group="technical", kind="percent"),
    ScreenField(key="perf_1m", label="Perf. 1M %", group="technical", kind="percent", enriched=True),
    ScreenField(key="perf_3m", label="Perf. 3M %", group="technical", kind="percent", enriched=True),
    ScreenField(key="perf_12m", label="Perf. 12M %", group="technical", kind="percent", enriched=True),
    ScreenField(key="rsi14", label="RSI 14", group="technical", kind="number", enriched=True),
    ScreenField(key="vol_1y", label="Volatilität 1J %", group="technical", kind="percent", enriched=True),
    ScreenField(key="dist_52w_high", label="Abst. 52W-Hoch %", group="technical", kind="percent", enriched=True),
]
_FIELD = {f.key: f for f in SCREEN_FIELDS}
_ENRICHED = {f.key for f in SCREEN_FIELDS if f.enriched}
_OPS = {"gt", "gte", "lt", "lte", "eq", "neq", "in", "contains"}


CURRENCY_SYMBOLS = {"$": "USD", "US$": "USD", "€": "EUR", "£": "GBP", "GBp": "GBX", "p": "GBX", "¥": "JPY", "Fr.": "CHF", "SFr": "CHF"}


def currency_code(raw: Optional[str]) -> Optional[str]:
    """EODHD liefert teils Symbole ($, €, £) statt ISO-Codes."""
    if not raw:
        return None
    s = raw.strip()
    if s in CURRENCY_SYMBOLS:
        return CURRENCY_SYMBOLS[s]
    s = s.upper()
    return s if len(s) == 3 and s.isalpha() else None


class Terminal:
    def __init__(self, provider: Provider, cache: Optional[TTLCache] = None):
        self.p = provider
        self.cache = cache or TTLCache()
        live = provider.mode == "eodhd"
        # TTL in Sekunden; im Demo-Modus kurz, damit der "Live"-Tag weiterläuft
        self.ttl = {
            "quote": 30 if live else 20,
            "history": 6 * 3600 if live else 60,
            "intraday": 300 if live else 60,
            "fund": 24 * 3600 if live else 3600,
            "news": 600 if live else 60,
            "calendar": 3600 if live else 60,
            "macro": 7 * 24 * 3600,
            "screen": 900 if live else 60,
            "search": 24 * 3600,
        }
        self.enrich_limit = 150 if live else 1000
        self._sem = asyncio.Semaphore(8)

    # --- Infrastruktur ----------------------------------------------------------

    async def _cached(self, key: str, ttl: str, loader: Callable[[], Awaitable[Any]]) -> Any:
        value, stale = await self.cache.get_or_load(key, self.ttl[ttl], loader)
        if stale:
            flags = request_flags.get()
            if flags is not None:
                flags["stale"] = True
        return value

    async def status(self) -> dict[str, Any]:
        extra = await self.p.status()
        return {
            "mode": self.p.mode,
            "serverTime": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
            "cache": self.cache.stats(),
            "defaults": {
                "watchlist": self.p.catalog.default_watchlist,
                "news": self.p.catalog.default_news[:10],
                "screenerExchanges": self.p.catalog.screener_exchanges,
                "heatmapExchange": self.p.catalog.heatmap_exchange,
                "curveCountries": list(self.p.catalog.curves.keys()),
            },
            **extra,
        }

    # --- Kurse --------------------------------------------------------------------

    async def search(self, query: str, limit: int = 12) -> list[SearchHit]:
        q = query.strip()
        if len(q) < 1:
            return []
        if len(q) > 40:
            raise BadRequest("Suchbegriff zu lang.")
        return await self._cached(f"search:{q.lower()}:{limit}", "search", lambda: self.p.search(q, limit))

    async def quotes(self, tickers: list[str]) -> list[Quote]:
        if not tickers:
            return []
        key = "quotes:" + ",".join(sorted(tickers))
        result: list[Quote] = await self._cached(key, "quote", lambda: self.p.quotes(tickers))
        by = {q.ticker: q for q in result}
        return [by.get(t, Quote(ticker=t)) for t in tickers]

    async def history(self, ticker: str) -> History:
        return await self._cached(f"hist:{ticker}", "history", lambda: self.p.history(ticker))

    async def intraday(self, ticker: str, days: int) -> Intraday:
        days = max(1, min(days, 10))
        return await self._cached(f"intra:{ticker}:{days}", "intraday", lambda: self.p.intraday(ticker, days))

    # --- Unternehmen ----------------------------------------------------------------

    async def company(self, ticker: str) -> Company:
        return await self._cached(f"company:{ticker}", "fund", lambda: self.p.company(ticker))

    async def financials(self, ticker: str, period: str) -> Financials:
        if period not in ("annual", "quarterly"):
            raise BadRequest("period muss annual oder quarterly sein.")
        return await self._cached(f"fin:{ticker}:{period}", "fund", lambda: self.p.financials(ticker, period))

    async def earnings(self, ticker: str) -> Earnings:
        return await self._cached(f"earn:{ticker}", "fund", lambda: self.p.earnings(ticker))

    async def dividends(self, ticker: str) -> Dividends:
        return await self._cached(f"div:{ticker}", "fund", lambda: self.p.dividends(ticker))

    # --- News ------------------------------------------------------------------------

    async def news(
        self,
        tickers: Optional[list[str]],
        topic: Optional[str] = None,
        query: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
        since: Optional[str] = None,
    ) -> NewsPage:
        key = "news:" + (",".join(sorted(tickers)) if tickers else "*")
        items: list[NewsItem] = await self._cached(key, "news", lambda: self.p.news(tickers, 100))
        if topic and topic != "all":
            items = [n for n in items if n.topic == topic]
        if query:
            q = query.lower()
            items = [n for n in items if q in n.title.lower() or q in n.content.lower() or any(q in s.lower() for s in n.symbols)]
        if since:
            cutoff = self._since(since)
            items = [n for n in items if n.date > cutoff]
        limit = max(1, min(limit, 300))
        note = None
        if self.p.mode == "eodhd" and not tickers:
            note = "Allgemeiner Feed aus den Standard-Tickern (EODHD liefert News je Ticker)."
        return NewsPage(items=items[offset : offset + limit], sources_note=note)

    @staticmethod
    def _since(raw: str) -> str:
        """since in das Format der Meldungen bringen (UTC, 'Z'), sonst vergleicht der
        Textvergleich Offsets wie +02:00 oder ein Leerzeichen statt 'T' falsch."""
        try:
            d = dt.datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
        except ValueError as exc:
            raise BadRequest(f"since „{raw}“ ist kein ISO-Zeitpunkt.") from exc
        if d.tzinfo is None:
            d = d.replace(tzinfo=dt.timezone.utc)
        return d.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # --- Makro ------------------------------------------------------------------------

    def _today(self) -> dt.date:
        """Heutiges Datum (UTC); die Demo-Quelle hat eine eigene Uhr."""
        now = getattr(self.p, "now", None)
        return (now() if callable(now) else dt.datetime.now(dt.timezone.utc)).date()

    async def _market_rows(self, instruments: list[Instrument]) -> list[MarketRow]:
        tickers = [i.ticker for i in instruments]
        today = self._today()
        try:
            quotes = {q.ticker: q for q in await self.quotes(tickers)}
        except TerminalError as exc:
            log.warning("Quotes für Marktübersicht fehlgeschlagen: %s", exc.message)
            quotes = {}

        async def one(inst: Instrument) -> MarketRow:
            async with self._sem:
                try:
                    h = await self.history(inst.ticker)
                except TerminalError as exc:
                    log.info("Historie %s nicht verfügbar: %s", inst.ticker, exc.message)
                    h = None
            q = quotes.get(inst.ticker)
            closes = list(h.c) if h else []
            dates = list(h.t) if h else []
            # Live-Kurs in die Reihe übernehmen, damit 1W/1M/YTD zum angezeigten Kurs passen
            if q and q.last is not None and dates:
                qd = (q.timestamp or "")[:10]
                if qd and qd > dates[-1]:
                    closes.append(q.last)
                    dates.append(qd)
                elif qd == dates[-1]:
                    closes[-1] = q.last
            last = q.last if q and q.last is not None else (closes[-1] if closes else None)
            prev = q.prev_close if q and q.prev_close is not None else (closes[-2] if len(closes) > 1 else None)
            return MarketRow(
                ticker=inst.ticker,
                name=inst.name,
                region=inst.region or None,
                last=last,
                change=None if last is None or prev is None else last - prev,
                change_pct=(q.change_pct if q and q.change_pct is not None else pct(last, prev)),
                chg_1w=metrics.perf_since(dates, closes, days=7),
                chg_1m=metrics.perf_since(dates, closes, months=1),
                # YTD ab dem heutigen Kalenderjahr, nicht ab dem Jahr des letzten Kurses: sonst zeigt
                # ein Index ohne Handel am 1. Januar noch die Vorjahresperformance als YTD
                chg_ytd=metrics.perf_ytd(dates, closes, today=today) if dates else None,
                spark=metrics.last_n(closes, 30),
                as_of=(q.timestamp if q and q.timestamp else (dates[-1] if dates else None)),
            )

        return list(await asyncio.gather(*(one(i) for i in instruments)))

    async def indices(self) -> list[MarketRow]:
        return await self._market_rows(self.p.catalog.indices)

    async def fx(self) -> list[MarketRow]:
        return await self._market_rows(self.p.catalog.fx)

    async def commodities(self) -> list[MarketRow]:
        return await self._market_rows(self.p.catalog.commodities)

    async def curves(self, countries: list[str]) -> list[Curve]:
        catalog = self.p.catalog.curves
        wanted = [c for c in countries if c in catalog] or list(catalog)[:2]
        plan_errors = 0

        async def point(tenor: str, years: float, ticker: str) -> CurvePoint:
            nonlocal plan_errors
            try:
                h = await self.history(ticker)
            except PlanNotIncluded:
                plan_errors += 1
                return CurvePoint(tenor=tenor, years=years)
            except TerminalError:
                return CurvePoint(tenor=tenor, years=years)
            c = [x for x in h.c if x is not None]
            return CurvePoint(
                tenor=tenor,
                years=years,
                y=c[-1] if c else None,
                y_1m=c[-22] if len(c) > 22 else None,
                y_1y=c[-253] if len(c) > 253 else None,
            )

        async def curve(cc: str) -> Curve:
            name, pts = catalog[cc]
            points = await asyncio.gather(*(point(*p) for p in pts))
            as_of = None
            for _, _, t in pts:
                try:
                    as_of = (await self.history(t)).t[-1]
                    break
                except TerminalError:
                    continue
            return Curve(country=cc, name=name, as_of=as_of, points=[p for p in points])

        result = list(await asyncio.gather(*(curve(c) for c in wanted)))
        if plan_errors and all(p.y is None for c in result for p in c.points):
            raise PlanNotIncluded("Der EODHD-Plan enthält keine Staatsanleihen (GBOND).")
        return result

    async def spreads(self, years: int = 2) -> list[Series]:
        specs = [
            ("us2s10s", "USA 2J/10J", "US10Y.GBOND", "US2Y.GBOND"),
            ("de2s10s", "Deutschland 2J/10J", "DE10Y.GBOND", "DE2Y.GBOND"),
            ("us_de10", "USA − Deutschland 10J", "US10Y.GBOND", "DE10Y.GBOND"),
            ("it_de10", "Italien − Deutschland 10J", "IT10Y.GBOND", "DE10Y.GBOND"),
        ]
        cutoff = (self._today() - dt.timedelta(days=365 * years)).isoformat()

        async def spread(key: str, label: str, a: str, b: str) -> Optional[Series]:
            try:
                ha, hb = await asyncio.gather(self.history(a), self.history(b))
            except TerminalError:
                return None
            mb = {d: v for d, v in zip(hb.t, hb.c) if v is not None}
            t: list[str] = []
            v: list[Optional[float]] = []
            for d, x in zip(ha.t, ha.c):
                if d < cutoff or x is None or d not in mb:
                    continue
                t.append(d)
                v.append(round((x - mb[d]) * 100, 1))
            return Series(key=key, label=label, unit="bp", t=t, v=v) if t else None

        res = await asyncio.gather(*(spread(*s) for s in specs))
        return [s for s in res if s is not None]

    async def calendar(
        self, start: dt.date, end: dt.date, country: Optional[str], min_importance: int = 1
    ) -> list[EconEvent]:
        if start.year < 1900 or end.year > 2200:
            # Randdaten wie 0001-01-01 oder 9999-12-31 ließen die Datumsarithmetik überlaufen
            raise BadRequest("Datum außerhalb des unterstützten Bereichs (1900–2200).")
        if end < start:
            raise BadRequest("Enddatum liegt vor Startdatum.")
        if (end - start).days > 62:
            raise BadRequest("Maximal 62 Tage pro Abfrage.")
        key = f"cal:{start}:{end}:{country or '*'}"
        events: list[EconEvent] = await self._cached(key, "calendar", lambda: self.p.calendar(start, end, country))
        return [e for e in events if e.importance >= min_importance]

    async def countries(self, indicators: Optional[list[str]] = None) -> CountryTable:
        known = {k: (label, unit) for k, label, unit in MACRO_INDICATORS}
        keys = [k for k in (indicators or []) if k in known] or [k for k, _, _ in MACRO_INDICATORS[:5]]
        countries = self.p.catalog.countries

        async def series(cc: str, ind: str) -> tuple[str, str, list[CountryValue]]:
            async with self._sem:
                try:
                    data = await self._cached(
                        f"macro:{cc}:{ind}", "macro", lambda: self.p.macro_indicator(cc, ind)
                    )
                except TerminalError as exc:
                    if isinstance(exc, PlanNotIncluded):
                        raise
                    data = []
            return cc, ind, data

        results = await asyncio.gather(*(series(cc, ind) for cc in countries for ind in keys))
        rows: dict[str, CountryRow] = {
            cc: CountryRow(country=cc, name=name, values={}, history={}) for cc, name in countries.items()
        }
        for cc, ind, data in results:
            valid = [d for d in data if d.value is not None]
            rows[cc].values[ind] = valid[-1] if valid else CountryValue()
            rows[cc].history[ind] = valid[-20:]
        return CountryTable(
            indicators=[Indicator(key=k, label=known[k][0], unit=known[k][1]) for k in keys],
            rows=list(rows.values()),
            note="Jahreswerte (Weltbank-Basis). Das letzte verfügbare Jahr kann je Land abweichen.",
        )

    # --- Screener ---------------------------------------------------------------------

    def screen_fields(self) -> list[ScreenField]:
        fields = []
        for f in SCREEN_FIELDS:
            if f.key == "exchange":
                fields.append(f.model_copy(update={"choices": self.p.catalog.screener_exchanges}))
            else:
                fields.append(f)
        return fields

    @staticmethod
    def parse_filters(raw: Any) -> list[ScreenFilter]:
        def scalar(x: Any) -> bool:
            return isinstance(x, (str, int, float)) and not isinstance(x, bool)

        # Eingaben kommen ungeprüft aus dem JSON-Body: falsche Typen sind 400, nicht 500
        if not isinstance(raw, list):
            raise BadRequest("filters muss eine Liste sein.")
        out: list[ScreenFilter] = []
        if len(raw) > 30:
            raise BadRequest("Maximal 30 Filter.")
        for item in raw:
            if not isinstance(item, dict):
                raise BadRequest("Jeder Filter braucht die Felder field, op und value.")
            field, op, value = item.get("field"), item.get("op"), item.get("value")
            if not isinstance(field, str) or field not in _FIELD:
                raise BadRequest(f"Unbekanntes Filterfeld: {field}")
            if not isinstance(op, str) or op not in _OPS:
                raise BadRequest(f"Unbekannter Operator: {op}")
            kind = _FIELD[field].kind
            if kind in ("number", "percent", "money") and op not in ("in", "contains"):
                if not scalar(value) or isinstance(value, str) or (isinstance(value, float) and not math.isfinite(value)):
                    raise BadRequest(f"Filter {field}: Zahl erwartet.")
            if op == "in":
                if not isinstance(value, list) or not all(scalar(x) for x in value):
                    raise BadRequest(f"Filter {field}: Liste erwartet.")
            elif not scalar(value):
                raise BadRequest(f"Filter {field}: einzelner Wert erwartet.")
            out.append(ScreenFilter(field=field, op=op, value=value))
        return out

    @staticmethod
    def _match(row: ScreenRow, f: ScreenFilter) -> bool:
        v = getattr(row, f.field, None)
        if v is None:
            return False
        target = f.value
        if f.op == "in":
            return str(v).upper() in {str(x).upper() for x in target}
        if f.op == "contains":
            return str(target).lower() in str(v).lower()
        if isinstance(v, str):
            a, b = v.upper(), str(target).upper()
            return a == b if f.op == "eq" else a != b if f.op == "neq" else False
        try:
            b = float(target)
        except (TypeError, ValueError):
            return False
        return {
            "gt": v > b, "gte": v >= b, "lt": v < b, "lte": v <= b, "eq": v == b, "neq": v != b,
        }[f.op]

    async def fx_to_usd(self) -> dict[str, float]:
        """Umrechnungsfaktoren Landeswährung -> USD aus den Devisenkursen."""
        pairs = {
            "EUR": ("EURUSD.FOREX", False), "GBP": ("GBPUSD.FOREX", False), "AUD": ("AUDUSD.FOREX", False),
            "NZD": ("NZDUSD.FOREX", False), "CHF": ("USDCHF.FOREX", True), "JPY": ("USDJPY.FOREX", True),
            "CAD": ("USDCAD.FOREX", True), "CNH": ("USDCNH.FOREX", True), "CNY": ("USDCNH.FOREX", True),
            "SEK": ("USDSEK.FOREX", True), "NOK": ("USDNOK.FOREX", True), "DKK": ("USDDKK.FOREX", True),
            "HKD": ("USDHKD.FOREX", True),
        }
        try:
            quotes = {q.ticker: q.last for q in await self.quotes(sorted({t for t, _ in pairs.values()}))}
        except TerminalError:
            quotes = {}
        rates = {"USD": 1.0}
        for ccy, (ticker, invert) in pairs.items():
            px = quotes.get(ticker)
            if px:
                rates[ccy] = 1.0 / px if invert else px
        if "GBP" in rates:
            rates["GBX"] = rates["GBP"] / 100.0  # Londoner Kurse in Pence
        return rates

    async def _to_usd(self, rows: list[ScreenRow]) -> list[ScreenRow]:
        """Marktkapitalisierung einheitlich in USD, damit Filter, Sortierung und Heatmap
        Werte verschiedener Börsen vergleichen können. Der Originalwert bleibt erhalten."""
        if not any(r.market_cap is not None and r.currency not in (None, "USD") for r in rows):
            return [r.model_copy(update={"market_cap_local": r.market_cap}) for r in rows]
        rates = await self.fx_to_usd()
        out = []
        for r in rows:
            ccy = currency_code(r.currency)
            rate = rates.get(ccy) if ccy else None
            usd = r.market_cap * rate if r.market_cap is not None and rate is not None else None
            out.append(r.model_copy(update={"market_cap_local": r.market_cap, "market_cap": usd, "currency": ccy or r.currency}))
        return out

    async def _enrich(self, rows: list[ScreenRow]) -> list[ScreenRow]:
        async def one(row: ScreenRow) -> ScreenRow:
            async with self._sem:
                try:
                    h = await self.history(row.ticker)
                except TerminalError:
                    return row
            c, t = h.c, h.t
            # Kalenderfenster statt Balkenzahl: identisch mit GP-Zeiträumen und 52W in DES
            return row.model_copy(
                update={
                    "perf_1m": metrics.perf_since(t, c, months=1),
                    "perf_3m": metrics.perf_since(t, c, months=3),
                    "perf_12m": metrics.perf_since(t, c, months=12),
                    "rsi14": metrics.rsi(c, 14),
                    "vol_1y": metrics.annual_vol_dated(t, c),
                    "dist_52w_high": metrics.dist_from_high_dated(t, c, h.h),
                }
            )

        return list(await asyncio.gather(*(one(r) for r in rows)))

    async def screen(
        self,
        filters: list[ScreenFilter],
        sort: str = "market_cap",
        desc: bool = True,
        limit: int = 100,
        enrich: bool = False,
    ) -> ScreenResult:
        if sort not in _FIELD and sort != "ticker":
            raise BadRequest(f"Unbekanntes Sortierfeld: {sort}")
        limit = max(1, min(limit, 500))
        base_filters = [f for f in filters if f.field not in _ENRICHED]
        late_filters = [f for f in filters if f.field in _ENRICHED]
        needs_enrich = enrich or bool(late_filters) or sort in _ENRICHED
        server_sort = sort if sort not in _ENRICHED else "market_cap"
        # Kennzahlen gibt es nur für die ersten enrich_limit Treffer: dafür die größten Werte
        # laden – auch bei aufsteigender Sortierung (sonst nur die kleinsten Nebenwerte)
        server_desc = desc if sort not in _ENRICHED else True
        max_rows = 300 if self.p.mode == "eodhd" else 1000
        key = "screen:" + json.dumps(
            [[f.field, f.op, f.value] for f in base_filters] + [server_sort, server_desc, max_rows], sort_keys=True, default=str
        )
        rows, local, notes = await self._cached(
            key, "screen", lambda: self.p.screener(base_filters, server_sort, server_desc, max_rows)
        )
        notes = list(notes)
        rows = await self._to_usd(rows)
        rows = [r for r in rows if all(self._match(r, f) for f in local)]
        if needs_enrich:
            head, tail = rows[: self.enrich_limit], rows[self.enrich_limit :]
            if tail:
                notes.append(
                    f"Technische Kennzahlen nur für die ersten {self.enrich_limit} Treffer berechnet."
                )
            rows = await self._enrich(head) + (tail if not late_filters else [])
            rows = [r for r in rows if all(self._match(r, f) for f in late_filters)]
        present = [r for r in rows if getattr(r, sort, None) is not None]
        missing = [r for r in rows if getattr(r, sort, None) is None]

        def sort_key(r: ScreenRow) -> Any:
            v = getattr(r, sort)
            return v.lower() if isinstance(v, str) else v

        present.sort(key=sort_key, reverse=desc)
        rows = present + missing
        total = len(rows)
        return ScreenResult(rows=rows[:limit], total=total, truncated=total > limit, notes=notes)

    async def movers(self, exchange: Optional[str]) -> Movers:
        flt = [ScreenFilter("market_cap", "gt", 1e9)]
        if exchange and exchange.upper() != "ALL":
            flt.append(ScreenFilter("exchange", "eq", exchange.upper()))
        gain, lose, active = await asyncio.gather(
            self.screen(flt, "chg_1d", True, 10),
            self.screen(flt, "chg_1d", False, 10),
            self.screen(flt, "avg_vol", True, 10),
        )
        return Movers(
            gainers=gain.rows,
            losers=lose.rows,
            active=active.rows,
            as_of=dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        )

    async def heatmap(self, exchange: Optional[str], limit: int = 100) -> ScreenResult:
        flt: list[ScreenFilter] = []
        if exchange and exchange.upper() != "ALL":
            flt.append(ScreenFilter("exchange", "eq", exchange.upper()))
        return await self.screen(flt, "market_cap", True, limit)

    # --- Ticker-Prüfung, Earnings-Kalender, Peers ---------------------------------------

    async def resolve(self, ticker: str) -> SearchHit:
        """Prüft, ob es den Ticker bei der Datenquelle gibt; sonst 404 mit Vorschlägen."""
        hit = await self._cached(f"resolve:{ticker}", "search", lambda: self.p.resolve(ticker))
        if hit is not None:
            return hit
        code = ticker.rpartition(".")[0]
        try:
            suggestions = [h.ticker for h in await self.search(code, 4) if h.ticker != ticker][:3]
        except TerminalError:
            suggestions = []
        hint = f" Meinten Sie: {', '.join(suggestions)}?" if suggestions else ""
        raise NotFound(f"Unbekannter Ticker {ticker}.{hint}")

    async def earnings_calendar(self, start: dt.date, end: dt.date) -> list[EarningsEvent]:
        if end < start:
            raise BadRequest("Enddatum liegt vor Startdatum.")
        if (end - start).days > 31:
            raise BadRequest("Maximal 31 Tage pro Abfrage.")
        return await self._cached(f"evts:{start}:{end}", "calendar", lambda: self.p.earnings_calendar(start, end))

    async def peers(self, ticker: str, limit: int = 12) -> PeerResult:
        """Vergleichsgruppe: gleiche Branche, bei zu wenigen Treffern gleicher Sektor."""
        company = await self.company(ticker)
        basis, group = "industry", company.industry
        rows: list[ScreenRow] = []
        if company.industry:
            res = await self.screen([ScreenFilter("industry", "eq", company.industry)], "market_cap", True, 60, enrich=True)
            rows = res.rows
        if len([r for r in rows if r.ticker != ticker]) < 4 and company.sector:
            basis, group = "sector", company.sector
            res = await self.screen([ScreenFilter("sector", "eq", company.sector)], "market_cap", True, 60, enrich=True)
            rows = res.rows
        own = next((r for r in rows if r.ticker == ticker), None)
        others = [r for r in rows if r.ticker != ticker][: max(1, limit - 1)]
        if own is None:
            q = (await self.quotes([ticker]))[0]
            own = (await self._enrich([ScreenRow(
                ticker=ticker, name=company.name, exchange=company.exchange, sector=company.sector,
                industry=company.industry, currency=company.currency, price=q.last, chg_1d=q.change_pct,
                eps=company.per_share.eps, pe=company.valuation.pe,
                div_yield=None if company.per_share.dividend_yield is None else company.per_share.dividend_yield * 100,
            )]))[0]
            own = (await self._to_usd([own.model_copy(update={"market_cap": company.market_cap})]))[0]
        table = [own] + others

        def median(field: str) -> Optional[float]:
            vals = sorted(v for v in (getattr(r, field) for r in table) if isinstance(v, (int, float)))
            if not vals:
                return None
            mid = len(vals) // 2
            return vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2

        med = ScreenRow(
            ticker="MEDIAN",
            name="Median der Gruppe",
            **{f: median(f) for f in ("price", "chg_1d", "chg_5d", "market_cap", "pe", "div_yield", "perf_1m",
                                      "perf_3m", "perf_12m", "rsi14", "vol_1y", "dist_52w_high")},
        )
        return PeerResult(ticker=ticker, basis=basis, group=group, rows=table, median=med)
