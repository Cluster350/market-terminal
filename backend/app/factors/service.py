"""Faktor-Monitor (FCTR) und Faktorlast des Depots (RISK).

- Übersicht: Wie liefen Value, Wachstum, Momentum, Qualität, kleine Firmen, niedrige Schwankung …
  absolut und gegenüber dem Markt (Faktor-ETF ÷ Markt-ETF derselben Region)?
- Faktorlast: Regression der Wochenrenditen des Depots (heutige Stückzahlen rückwirkend) auf den Markt
  und die Faktor-Überrenditen (Faktor minus Markt). Ergebnis: wie stark das Depot einem Stil folgt.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Any, Optional

from ..errors import BadRequest, NotFound, TerminalError
from ..models import Model, Quote
from ..portfolio.analytics import analyze, fx_book
from ..portfolio.models import Portfolio
from ..rotation.calc import to_weekly
from ..services import metrics
from ..services.tickers import split
from ..crypto.calc import pairs as price_pairs
from . import calc
from .universe import FACTOR_HELP, REGIONS, FactorDef, Region

log = logging.getLogger("terminal")

CACHE_SECONDS = 300
EXPOSURE_YEARS = 3
MIN_WEEKS = 52
PREFERRED_EXCHANGES = ("XETRA", "F", "AS", "PA", "MI", "SW", "LSE")
WINDOWS = {"1d": None, "1w": (0, 7), "1m": (1, 0), "3m": (3, 0), "1y": (12, 0), "3y": (36, 0), "5y": (60, 0)}
BENCH_CCY = {"us": "USD", "eu": "EUR"}


class FactorRow(Model):
    key: str
    label: str
    ticker: str
    name: str
    isin: Optional[str] = None
    help: Optional[str] = None
    last: Optional[float] = None
    currency: Optional[str] = None
    abs: dict[str, Optional[float]] = {}
    rel: dict[str, Optional[float]] = {}
    vol_1y: Optional[float] = None
    beta_1y: Optional[float] = None
    rel_vs_avg: Optional[float] = None  # Verhältnislinie gegenüber ihrem 200-Tage-Durchschnitt (Prozent)
    first: Optional[str] = None


class FactorOverview(Model):
    region: str
    label: str
    bench: FactorRow
    rows: list[FactorRow]
    t: list[str]
    lines: dict[str, list[Optional[float]]]  # Kurse je Schlüssel auf dem gemeinsamen Raster (market = Maßstab)
    corr_keys: list[str] = []
    corr: list[list[Optional[float]]] = []
    notes: list[str] = []
    skipped: list[str] = []


class Loading(Model):
    key: str
    label: str
    ticker: str
    beta: Optional[float] = None
    t: Optional[float] = None


class FactorExposure(Model):
    region: str
    label: str
    auto: bool
    weeks: int
    start: Optional[str] = None
    end: Optional[str] = None
    r2: Optional[float] = None
    market: Optional[Loading] = None
    factors: list[Loading] = []
    us_share: Optional[float] = None
    notes: list[str] = []


def _with_quote(pts: list[tuple[str, float]], q: Optional[Quote]) -> list[tuple[str, float]]:
    if not q or q.last is None or q.last <= 0 or not pts:
        return pts
    day = (q.timestamp or "")[:10]
    if not day or day < pts[-1][0]:
        return pts
    return pts[:-1] + [(day, q.last)] if day == pts[-1][0] else pts + [(day, q.last)]


def _beta(a: list[tuple[str, float]], b: list[tuple[str, float]], days: int = 365) -> Optional[float]:
    if not a:
        return None
    from ..crypto.calc import log_returns, window

    ra, rb = log_returns(window(a, days)), log_returns(window(b, days))
    keys = sorted(set(ra) & set(rb))
    if len(keys) < 60:
        return None
    x = [rb[k] for k in keys]
    y = [ra[k] for k in keys]
    mx, my = sum(x) / len(x), sum(y) / len(y)
    var = sum((v - mx) ** 2 for v in x)
    return sum((u - mx) * (v - my) for u, v in zip(x, y)) / var if var else None


class FactorService:
    def __init__(self, terminal: Any, data_dir: Optional[str] = None, mode: str = "demo"):
        self.t = terminal
        self.mode = mode
        self._path = Path(data_dir) / f"faktor-kuerzel-{mode}.json" if data_dir else None
        self._resolved: dict[str, str] = self._load()
        self._cache: dict[str, tuple[float, FactorOverview]] = {}
        self._lock = asyncio.Lock()

    # --- Kürzel der europäischen ETFs (ISIN -> Börsenkürzel) ----------------------------

    def _load(self) -> dict[str, str]:
        try:
            if self._path and self._path.exists():
                data = json.loads(self._path.read_text(encoding="utf-8"))
                return {str(k): str(v) for k, v in data.items()} if isinstance(data, dict) else {}
        except (OSError, ValueError):
            pass
        return {}

    def _save(self) -> None:
        if not self._path:
            return
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(json.dumps(self._resolved, indent=1), encoding="utf-8")
        except OSError as exc:
            log.info("Faktor-Kürzel nicht gespeichert: %s", exc)

    async def _has_history(self, ticker: str) -> bool:
        try:
            h = await self.t.history(ticker)
        except TerminalError:
            return False
        return len(h.t) > 20

    async def ticker_of(self, f: FactorDef, want_ccy: str) -> Optional[str]:
        """Börsenkürzel eines Faktor-ETFs: gespeichert, sonst über die ISIN gesucht (bevorzugt Xetra,
        Handelswährung wie der Maßstab), sonst das vorgeschlagene Kürzel."""
        if not f.isin or self.mode == "demo":
            return f.ticker
        known = self._resolved.get(f.isin)
        if known:
            return known
        candidates: list[str] = []
        try:
            hits = await self.t.search(f.isin, 20)
        except TerminalError:
            hits = []
        same_ccy = [h for h in hits if (h.currency or "").upper() == want_ccy]
        rank = {ex: i for i, ex in enumerate(PREFERRED_EXCHANGES)}
        same_ccy.sort(key=lambda h: rank.get((h.exchange or "").upper(), 99))
        candidates = [h.ticker for h in same_ccy] + [f.ticker]
        for c in dict.fromkeys(candidates):
            if await self._has_history(c):
                self._resolved[f.isin] = c
                self._save()
                return c
        return None

    async def members(self, region: Region) -> tuple[list[tuple[FactorDef, str]], list[str]]:
        ccy = BENCH_CCY[region.key]
        defs = [region.bench, *region.factors]
        tickers = await asyncio.gather(*(self.ticker_of(f, ccy) for f in defs))
        found = [(f, t) for f, t in zip(defs, tickers) if t]
        missing = [f"{f.label} ({f.name}, ISIN {f.isin})" for f, t in zip(defs, tickers) if not t]
        return found, missing

    async def _series(self, tickers: list[str], live: bool = True) -> dict[str, list[tuple[str, float]]]:
        quotes: dict[str, Quote] = {}
        if live:
            try:
                quotes = {q.ticker: q for q in await self.t.quotes(tickers)}
            except TerminalError:
                quotes = {}
        sem = asyncio.Semaphore(6)

        async def one(t: str) -> tuple[str, list[tuple[str, float]]]:
            async with sem:
                try:
                    h = await self.t.history(t)
                except TerminalError:
                    return t, []
            return t, _with_quote(price_pairs(h.t, h.c), quotes.get(t))

        return {t: s for t, s in await asyncio.gather(*(one(t) for t in tickers)) if s}

    # --- Übersicht ---------------------------------------------------------------------

    async def overview(self, region: str = "us") -> FactorOverview:
        if region not in REGIONS:
            raise BadRequest(f"Unbekannte Region „{region}“.")
        hit = self._cache.get(region)
        if hit and time.time() - hit[0] < CACHE_SECONDS:
            return hit[1]
        async with self._lock:
            hit = self._cache.get(region)
            if hit and time.time() - hit[0] < CACHE_SECONDS:
                return hit[1]
            res = await self._overview(REGIONS[region])
            self._cache[region] = (time.time(), res)
            return res

    async def _overview(self, region: Region) -> FactorOverview:
        found, missing = await self.members(region)
        tick = {f.key: t for f, t in found}
        if "market" not in tick:
            raise NotFound(f"Für {region.label} fehlt der Markt-ETF ({region.bench.name}).")
        data = await self._series(list(tick.values()))
        bench_pts = data.get(tick["market"]) or []
        if len(bench_pts) < 30:
            raise NotFound(f"Keine Kurse für den Markt-ETF {region.bench.name}.")
        today = self.t.now().date()

        def row(f: FactorDef, t: str, pts: list[tuple[str, float]]) -> FactorRow:
            dates = [d for d, _ in pts]
            closes = [v for _, v in pts]
            rel = calc.ratio_line(pts, bench_pts)
            rd = [d for d, _ in rel]
            rv = [v for _, v in rel]

            def perf(ds: list[str], cs: list[float], key: str) -> Optional[float]:
                if key == "1d":
                    return (cs[-1] / cs[-2] - 1) * 100 if len(cs) > 1 else None
                if key == "ytd":
                    return metrics.perf_ytd(ds, cs, today=today)
                m, d = WINDOWS[key]  # type: ignore[misc]
                # Nur rechnen, wenn die Reihe den Zeitraum abdeckt (sonst „seit Auflage“ als 5 Jahre)
                if ds and metrics.shift_date(today, m, d).isoformat() < ds[0]:
                    return None
                return metrics.perf_since(ds, cs, months=m, days=d)

            keys = [*WINDOWS.keys(), "ytd"]
            is_bench = f.key == "market"
            return FactorRow(
                key=f.key, label=f.label, ticker=t, name=f.name, isin=f.isin, help=FACTOR_HELP.get(f.key),
                last=closes[-1], currency=BENCH_CCY[region.key],
                abs={k: perf(dates, closes, k) for k in keys},
                rel={} if is_bench else {k: perf(rd, rv, k) for k in keys},
                vol_1y=metrics.annual_vol_dated(dates, closes, 365),
                beta_1y=None if is_bench else _beta(pts, bench_pts),
                rel_vs_avg=None if is_bench else calc.pct_vs_avg(rel, 200),
                first=dates[0],
            )

        rows: list[FactorRow] = []
        skipped = list(missing)
        bench_row = row(region.bench, tick["market"], bench_pts)
        for f in region.factors:
            t = tick.get(f.key)
            pts = data.get(t) if t else None
            if not t or not pts or len(pts) < 30:
                if t:
                    skipped.append(f"{f.label} ({t}: keine Kurse)")
                continue
            rows.append(row(f, t, pts))

        # Gemeinsames Raster der Kurse (Börsentage des Markt-ETFs), höchstens 10 Jahre
        grid = [d for d, _ in bench_pts]
        lines: dict[str, list[Optional[float]]] = {"market": [round(v, 4) for _, v in bench_pts]}
        for r in rows:
            m = dict(data[r.ticker])
            lines[r.key] = [None if (x := m.get(d)) is None else round(x, 4) for d in grid]

        # Korrelation der wöchentlichen Überrenditen (Faktor minus Markt), drei Jahre
        start3 = metrics.shift_date(today, 36).isoformat()
        wb = to_weekly(*zip(*bench_pts)) if bench_pts else {}
        weeks = sorted(w for w in wb if w >= start3)
        rb = calc.returns([wb.get(w) for w in weeks])
        excess = []
        for r in rows:
            wf = to_weekly(*zip(*data[r.ticker]))
            rf = calc.returns([wf.get(w) for w in weeks])
            excess.append([None if a is None or b is None else a - b for a, b in zip(rf, rb)])
        corr = [[None if c is None else round(c, 2) for c in line] for line in calc.corr_matrix(excess)]

        notes = [
            "Gemessen mit Stil-ETFs: „gegenüber Markt“ = Entwicklung des Faktor-ETFs geteilt durch die des "
            f"Markt-ETFs ({region.bench.name}). Kurse in Handelswährung, ohne Ausschüttungen, wenn die Datenquelle "
            "keine bereinigten Kurse liefert. Keine Empfehlung.",
        ]
        if region.key == "eu" and self.mode != "demo":
            notes.append("Europa: Börsenkürzel der ETFs werden über die ISIN gesucht (Xetra bevorzugt).")
        return FactorOverview(
            region=region.key, label=region.label, bench=bench_row, rows=rows, t=grid, lines=lines,
            corr_keys=[r.key for r in rows], corr=corr, notes=notes, skipped=skipped,
        )

    # --- Faktorlast des Depots ---------------------------------------------------------

    async def exposure(self, p: Portfolio, region: str = "auto") -> FactorExposure:
        if not p.positions:
            raise NotFound("Das Depot ist leer – Faktorlast gibt es erst mit Positionen.")
        a = await analyze(self.t, p)
        held = [(pos, r) for pos, r in zip(p.positions, a.rows) if r.value is not None and r.currency]
        if not held:
            raise NotFound("Keine bewerteten Positionen im Depot.")
        total = sum(abs(r.value or 0.0) for _, r in held) or 1.0
        us_share = sum(abs(r.value or 0.0) for pos, r in held if split(pos.ticker)[1] == "US") / total
        auto = region == "auto"
        reg_key = ("us" if us_share >= 0.5 else "eu") if auto else region
        if reg_key not in REGIONS:
            raise BadRequest(f"Unbekannte Region „{region}“.")
        reg = REGIONS[reg_key]
        found, missing = await self.members(reg)
        model = [(f, t) for f, t in found if f.key == "market" or f.in_model]
        tick = {f.key: t for f, t in model}
        if "market" not in tick:
            raise NotFound(f"Für {reg.label} fehlt der Markt-ETF.")
        notes: list[str] = [f"Nicht verfügbar: {m}" for m in missing]

        today = self.t.now().date()
        start = metrics.shift_date(today, 12 * EXPOSURE_YEARS).isoformat()
        currencies = {r.currency for _, r in held if r.currency} | {BENCH_CCY[reg_key]}
        fx = await fx_book(self.t, p.base, currencies)

        # Wochenschlüsse je Position (in Basiswährung, heutige Stückzahlen)
        weekly_pos: list[tuple[float, dict[str, float]]] = []
        constant = p.cash
        for pos, r in held:
            try:
                h = await self.t.history(pos.ticker)
            except TerminalError:
                h = None
            w = to_weekly(h.t, h.c) if h else {}
            w = {k: v for k, v in w.items() if k >= start}
            if len(w) < MIN_WEEKS:
                constant += r.value or 0.0
                notes.append(f"{pos.ticker}: weniger als ein Jahr Kurse – als fester Betrag gerechnet.")
                continue
            weekly_pos.append((pos.quantity, {k: v * (fx.at(r.currency or "USD", k) or r.fx or 0.0) for k, v in w.items()}))
        if not weekly_pos:
            raise NotFound("Zu wenig Kursverlauf im Depot für eine Faktorlast.")

        data = await self._series(list(tick.values()), live=False)
        wk = {key: to_weekly(*zip(*data[t])) for key, t in tick.items() if data.get(t)}
        if "market" not in wk:
            raise NotFound(f"Keine Kurse für den Markt-ETF {reg.bench.name}.")
        first_common = max(min(w) for _, w in weekly_pos)
        weeks = sorted(w for w in wk["market"] if w >= max(start, first_common))
        # Wochen ohne vollständige Daten (Feiertagswochen) nach vorn auffüllen
        def filled(m: dict[str, float]) -> list[Optional[float]]:
            out, last = [], None
            for w in weeks:
                last = m.get(w, last)
                out.append(last)
            return out

        depot = [constant + sum(q * (v or 0.0) for q, v in zip([q for q, _ in weekly_pos], vals))
                 for vals in zip(*[filled(m) for _, m in weekly_pos])]
        bccy = BENCH_CCY[reg_key]
        market_base = [None if v is None else v * (fx.at(bccy, w) or 0.0) for v, w in zip(filled(wk["market"]), weeks)]
        r_dep = calc.returns(depot)
        r_mkt = calc.returns(market_base)
        r_mkt_local = calc.returns(filled(wk["market"]))
        fac_keys = [f.key for f, _ in model if f.key != "market" and f.key in wk]
        r_fac = {k: [None if a is None or b is None else a - b for a, b in zip(calc.returns(filled(wk[k])), r_mkt_local)] for k in fac_keys}
        idx = [i for i in range(len(r_dep)) if r_dep[i] is not None and r_mkt[i] is not None and all(r_fac[k][i] is not None for k in fac_keys)]
        if len(idx) < MIN_WEEKS:
            raise NotFound(f"Zu wenig gemeinsame Wochen ({len(idx)}) für eine verlässliche Faktorlast (mindestens {MIN_WEEKS}).")
        y = [r_dep[i] for i in idx]  # type: ignore[misc]
        xs = [[r_mkt[i] for i in idx]] + [[r_fac[k][i] for i in idx] for k in fac_keys]  # type: ignore[misc]
        res = calc.ols(y, xs)  # type: ignore[arg-type]
        if res is None:
            raise NotFound("Die Faktorlast ließ sich nicht berechnen (Faktoren zu ähnlich).")
        labels = {f.key: f for f, _ in model}
        notes.append(
            f"Regression der Wochenrenditen des Depots ({len(idx)} Wochen, heutige Stückzahlen rückwirkend) auf den Markt "
            f"und die Überrenditen der Faktor-ETFs ({reg.label}). Faktorlast 0,3 = das Depot verhält sich, als hielte es "
            "zusätzlich 30 % in diesem Stil (gegen den Markt). |t| ab 2 = deutlich, unter 1 = Zufall möglich."
        )
        return FactorExposure(
            region=reg_key, label=reg.label, auto=auto, weeks=len(idx), start=weeks[idx[0]] if idx else None,
            end=weeks[-1] if weeks else None, r2=res["r2"],
            market=Loading(key="market", label="Markt", ticker=tick["market"], beta=res["beta"][0], t=res["t"][0]),
            factors=[Loading(key=k, label=labels[k].label, ticker=tick[k], beta=b, t=tv) for k, b, tv in zip(fac_keys, res["beta"][1:], res["t"][1:])],
            us_share=us_share * 100, notes=notes,
        )
