"""Kryptoübersicht (CRYP): Kurse, Entwicklung, Schwankung, Marktanteile und der Vergleich mit
Aktien und Gold."""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import time
from typing import Any, Optional

from ..errors import NotFound, PlanNotIncluded, TerminalError
from ..models import Model
from ..services import metrics
from . import calc
from .universe import COINS

log = logging.getLogger("terminal")

CACHE_SECONDS = 60
INFO_SECONDS = 24 * 3600
INFO_RETRY_SECONDS = 900  # Stammdaten nach einem vorübergehenden Fehler (Netz, Limit) nach 15 Minuten neu abrufen
INTRA_SECONDS = 1800  # 5-Minuten-Balken für die 24-Stunden-Veränderung (ältere Balken ändern sich nicht)
CROSS_YEARS = 5


class CryptoRow(Model):
    ticker: str
    name: str
    symbol: str
    last: Optional[float] = None
    chg_1d: Optional[float] = None  # seit 0 Uhr UTC (Tagesschluss)
    chg_24h: Optional[float] = None  # rollierend über 24 Stunden (Intraday)
    high_24h: Optional[float] = None
    low_24h: Optional[float] = None
    chg_7d: Optional[float] = None
    chg_30d: Optional[float] = None
    chg_ytd: Optional[float] = None
    chg_1y: Optional[float] = None
    vol_30d: Optional[float] = None
    from_high: Optional[float] = None
    high_date: Optional[str] = None
    corr_btc: Optional[float] = None
    above_200d: Optional[bool] = None
    market_cap: Optional[float] = None
    share: Optional[float] = None
    supply: Optional[float] = None
    max_supply: Optional[float] = None
    first: Optional[str] = None
    spark: list[float] = []
    as_of: Optional[str] = None


class Line(Model):
    key: str
    label: str
    t: list[str]
    v: list[float]


class CryptoOverview(Model):
    ccy: str
    rows: list[CryptoRow]
    total_cap: Optional[float] = None
    btc_share: Optional[float] = None
    eth_share: Optional[float] = None
    share_basis: str = "shown"  # "market": Anteil am gesamten Kryptomarkt (laut Datenquelle), "shown": an den gezeigten Coins
    breadth_up: int = 0
    breadth_n: int = 0
    cross: list[Line] = []
    corr: list[Line] = []
    notes: list[str] = []
    skipped: list[str] = []


class CryptoService:
    def __init__(self, terminal: Any):
        self.t = terminal
        self._cache: dict[str, tuple[float, CryptoOverview]] = {}
        self._info: dict[str, tuple[float, dict]] = {}  # Ticker -> (gültig bis, Stammdaten)
        self._intra: dict[str, tuple[float, list[tuple[int, float, float, float]]]] = {}
        self._corr_memo: dict[str, dict] = {}  # gleitende Korrelation je Vergleichswert (siehe calc.rolling_corr)
        self._lock = asyncio.Lock()

    def _gold(self) -> Optional[str]:
        for inst in self.t.p.catalog.commodities:
            if inst.name.lower().startswith("gold"):
                return inst.ticker
        return None

    async def _history(self, ticker: str) -> list[tuple[str, float]]:
        try:
            h = await self.t.history(ticker)
        except TerminalError as exc:
            log.info("Krypto: keine Historie für %s (%s)", ticker, exc.message)
            return []
        return calc.pairs(h.t, h.c)

    async def _crypto_info(self, ticker: str) -> dict:
        hit = self._info.get(ticker)
        if hit and time.time() < hit[0]:
            return hit[1]
        fn = getattr(self.t.p, "crypto_info", None)
        info: dict = {}
        ttl = INFO_SECONDS
        if fn is not None:
            try:
                info = await fn(ticker) or {}
            except (NotFound, PlanNotIncluded):
                info = {}  # gibt es nicht: einen Tag lang nicht erneut fragen
            except TerminalError as exc:
                # vorübergehend (Zeitüberschreitung, Limit): nicht einen ganzen Tag ohne Marktkapitalisierung
                log.info("Krypto-Stammdaten %s: %s", ticker, exc.message)
                info, ttl = {}, INFO_RETRY_SECONDS
            except Exception as exc:  # noqa: BLE001 – fehlende Stammdaten sollen die Übersicht nicht verhindern
                log.info("Krypto-Stammdaten %s: %s", ticker, exc)
                info, ttl = {}, INFO_RETRY_SECONDS
        self._info[ticker] = (time.time() + ttl, info)
        return info

    async def _bars(self, ticker: str) -> list[tuple[int, float, float, float]]:
        """5-Minuten-Balken der letzten zwei Tage (Zeitstempel, Hoch, Tief, Schluss), 30 Minuten gemerkt.

        Devisen: drei Handelstage – montags sind die letzten zwei Sonntagabend und Montag, „vor 24 Stunden“
        (Sonntag) läge sonst vor dem ersten Balken, und der Euro-Wert der 24 Stunden nähme den Kurs von jetzt
        statt des Freitagsschlusses."""
        hit = self._intra.get(ticker)
        if hit and time.time() - hit[0] < INTRA_SECONDS:
            return hit[1]
        try:
            d = await self.t.intraday(ticker, 3 if ticker.endswith(".FOREX") else 2, "5m")
            bars = [(int(ts), h or c, l or c, c) for ts, h, l, c in zip(d.t, d.h, d.l, d.c) if c]
        except TerminalError as exc:
            log.info("Krypto: keine Intraday-Kurse für %s (%s)", ticker, exc.message)
            bars = []
        self._intra[ticker] = (time.time(), bars)
        return bars

    async def overview(self, ccy: str = "usd") -> CryptoOverview:
        ccy = "eur" if ccy == "eur" else "usd"
        hit = self._cache.get(ccy)
        if hit and time.time() - hit[0] < CACHE_SECONDS:
            return hit[1]
        async with self._lock:
            hit = self._cache.get(ccy)
            if hit and time.time() - hit[0] < CACHE_SECONDS:
                return hit[1]
            res = await self._build(ccy)
            self._cache[ccy] = (time.time(), res)
            return res

    async def _build(self, ccy: str) -> CryptoOverview:
        tickers = [t for t, _ in COINS]
        gold = self._gold()
        cross_defs = [("NDX.INDX", "Nasdaq 100"), ("GSPC.INDX", "S&P 500")] + ([(gold, "Gold")] if gold else [])
        try:
            quotes = {q.ticker: q for q in await self.t.quotes(tickers + ["EURUSD.FOREX"])}
        except TerminalError as exc:
            log.warning("Krypto-Kurse nicht abrufbar: %s", exc.message)
            quotes = {}
        sem = asyncio.Semaphore(8)

        async def hist(t: str) -> list[tuple[str, float]]:
            async with sem:
                return await self._history(t)

        all_hist = await asyncio.gather(*(hist(t) for t in tickers + [c for c, _ in cross_defs] + ["EURUSD.FOREX"]))
        infos = await asyncio.gather(*(self._crypto_info(t) for t in tickers))

        async def bars(t: str) -> list[tuple[int, float, float, float]]:
            async with sem:
                return await self._bars(t)

        # 5-Minuten-Kurse von EUR/USD braucht nur die Euro-Ansicht (jeder Intraday-Abruf kostet bei EODHD 5 Calls)
        intra_tickers = tickers + (["EURUSD.FOREX"] if ccy == "eur" else [])
        intra = dict(zip(intra_tickers, await asyncio.gather(*(bars(t) for t in intra_tickers))))
        now_ts = self.t.now().timestamp()
        series = {t: calc.with_quote(h, quotes.get(t)) for t, h in zip(tickers, all_hist[: len(tickers)])}
        cross_hist = dict(zip([c for c, _ in cross_defs], all_hist[len(tickers) : -1]))
        eurusd = calc.with_quote(all_hist[-1], quotes.get("EURUSD.FOREX"))
        notes: list[str] = []
        skipped: list[str] = []

        def to_ccy(pts: list[tuple[str, float]]) -> list[tuple[str, float]]:
            if ccy == "usd" or not pts:
                return pts
            rate = calc.ffill([d for d, _ in pts], eurusd)
            return [(d, v / r) for (d, v), r in zip(pts, rate) if r]

        if ccy == "eur" and not eurusd:
            raise NotFound("Für die Umrechnung in Euro fehlt der Kurs EUR/USD.")
        btc_usd = series.get("BTC-USD.CC") or []
        btc_ret = calc.log_returns(calc.window(btc_usd, 90))
        today = self.t.now().date()
        eur_now = eurusd[-1][1] if eurusd else None

        rows: list[CryptoRow] = []
        for (t, name), info in zip(COINS, infos):
            usd = series.get(t) or []
            if len(usd) < 2:
                skipped.append(f"{name} (keine Kurse)")
                continue
            pts = to_ccy(usd)
            dates = [d for d, _ in pts]
            closes = [v for _, v in pts]
            q = quotes.get(t)
            last = closes[-1]
            chg_1d = q.change_pct if (ccy == "usd" and q and q.change_pct is not None) else (closes[-1] / closes[-2] - 1) * 100
            # Rollierende 24 Stunden aus 5-Minuten-Balken (in Euro mit dem Devisenkurs von damals und jetzt)
            c24, ref, h24, l24 = calc.change_24h(intra.get(t) or [], now_ts, usd[-1][1])
            if ccy == "eur" and c24 is not None:
                _, fx_ref, _, _ = calc.change_24h(intra.get("EURUSD.FOREX") or [], now_ts, eur_now, tolerance=4 * 86400)
                fx_ref = fx_ref or eur_now
                c24 = ((usd[-1][1] / eur_now) / (ref / fx_ref) - 1) * 100 if eur_now and fx_ref and ref else None
                h24 = h24 / eur_now if h24 and eur_now else None
                l24 = l24 / eur_now if l24 and eur_now else None
            hi, hi_date = calc.from_high(pts)
            s200 = calc.sma(pts, 200)
            supply = info.get("circulating_supply")
            cap_usd = supply * usd[-1][1] if supply else info.get("market_cap")
            cap = cap_usd / eur_now if (cap_usd and ccy == "eur" and eur_now) else cap_usd
            rows.append(CryptoRow(
                ticker=t, name=name, symbol=t.split("-")[0], last=last, chg_1d=chg_1d, chg_24h=c24, high_24h=h24, low_24h=l24,
                chg_7d=metrics.perf_since(dates, closes, days=7), chg_30d=metrics.perf_since(dates, closes, days=30),
                chg_ytd=metrics.perf_ytd(dates, closes, today=today), chg_1y=metrics.perf_since(dates, closes, months=12),
                vol_30d=calc.vol(pts, 30), from_high=hi, high_date=hi_date,
                corr_btc=None if t == "BTC-USD.CC" else calc.corr(calc.log_returns(calc.window(usd, 90)), btc_ret),
                above_200d=None if s200 is None else last > s200,
                market_cap=cap, supply=supply, max_supply=info.get("max_supply"),
                first=dates[0], spark=[round(v, 8) for v in closes[-30:]], as_of=(q.timestamp if q and q.timestamp else dates[-1]),
            ))

        # Marktanteile: laut Datenquelle (gesamter Kryptomarkt) oder unter den gezeigten Coins
        dom = {t: (i.get("dominance")) for (t, _), i in zip(COINS, infos)}
        caps = [r.market_cap for r in rows if r.market_cap]
        total = sum(caps) if caps else None
        basis = "market" if dom.get("BTC-USD.CC") else "shown"
        for r in rows:
            if basis == "market":
                r.share = dom.get(r.ticker)
            elif r.market_cap and total:
                r.share = r.market_cap / total * 100
        rows.sort(key=lambda r: -(r.market_cap or 0))
        by = {r.ticker: r for r in rows}
        flags = [r.above_200d for r in rows if r.above_200d is not None]
        if any(r.market_cap is None for r in rows):
            notes.append("Ohne Angabe der umlaufenden Menge fehlt bei einzelnen Coins die Marktkapitalisierung.")
        notes.append(
            "24 h = Veränderung über die letzten 24 Stunden (5-Minuten-Kurse). Abstand zum Hoch: höchster Tagesschluss "
            "seit Beginn der Kursdaten. Schwankung mit 365 Tagen hochgerechnet. Stablecoins (USDT, USDC) sind nicht enthalten."
        )

        # Vergleich mit Aktien und Gold: Kurse der letzten Jahre und gleitende Korrelation (90 Börsentage)
        start = (today - dt.timedelta(days=365 * CROSS_YEARS)).isoformat()
        cross: list[Line] = []
        for key, label, pts_usd in [("BTC-USD.CC", "Bitcoin", btc_usd), ("ETH-USD.CC", "Ethereum", series.get("ETH-USD.CC") or [])] + [
            (c, lab, cross_hist.get(c) or []) for c, lab in cross_defs
        ]:
            pts = [p for p in to_ccy(pts_usd) if p[0] >= start]
            if pts:
                cross.append(Line(key=key, label=label, t=[d for d, _ in pts], v=[round(v, 6) for _, v in pts]))
            else:
                skipped.append(f"{label} (Vergleich: keine Kurse)")
        corr_lines: list[Line] = []
        for c, lab in cross_defs:
            other = cross_hist.get(c) or []
            rc = calc.rolling_corr(btc_usd, other, 90, start, memo=self._corr_memo.setdefault(c, {}))
            if rc:
                corr_lines.append(Line(key=c, label=f"Bitcoin ↔ {lab}", t=[d for d, _ in rc], v=[round(v, 3) for _, v in rc]))
        return CryptoOverview(
            ccy=ccy, rows=rows, total_cap=total,
            btc_share=by["BTC-USD.CC"].share if "BTC-USD.CC" in by else None,
            eth_share=by["ETH-USD.CC"].share if "ETH-USD.CC" in by else None,
            share_basis=basis, breadth_up=sum(1 for f in flags if f), breadth_n=len(flags),
            cross=cross, corr=corr_lines, notes=notes, skipped=skipped,
        )
