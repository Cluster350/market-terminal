"""Kennzahlen des Depots: Wert, Ergebnis, Aufteilung und Risiko (historische Simulation).

Alle Beträge in der Basiswährung des Depots. Für Verlauf und Risiko gelten die heutigen
Stückzahlen rückwirkend über ein Jahr (ohne Käufe und Verkäufe im Zeitraum) – so zeigen die
Kennzahlen das Risiko des Depots, wie es jetzt ist.
"""

from __future__ import annotations

import asyncio
import bisect
import datetime as dt
import math
from typing import Optional, Sequence

from ..errors import TerminalError
from ..models import History, Quote
from ..providers.base import INDICES
from ..services.terminal import Terminal, currency_code
from ..services.tickers import display, split
from .models import Analytics, Correlation, Portfolio, Position, PositionRow, Risk, Slice, Summary, ValueSeries

YEAR_DAYS = 365
MIN_OBS = 60  # weniger Kurstage: Position fehlt in den Risikokennzahlen
TRADING_DAYS = 252

EXCHANGE_CCY = {
    "US": "USD", "XETRA": "EUR", "F": "EUR", "PA": "EUR", "AS": "EUR", "BR": "EUR", "MI": "EUR", "MC": "EUR", "HE": "EUR",
    "LSE": "GBX", "SW": "CHF", "TSE": "JPY", "HK": "HKD", "TO": "CAD", "AU": "AUD", "ST": "SEK", "CO": "DKK", "OL": "NOK",
    "CC": "USD", "COMM": "USD",
}
EXCHANGE_COUNTRY = {
    "US": "USA", "XETRA": "Deutschland", "F": "Deutschland", "PA": "Frankreich", "AS": "Niederlande", "BR": "Belgien",
    "MI": "Italien", "MC": "Spanien", "HE": "Finnland", "LSE": "Großbritannien", "SW": "Schweiz", "TSE": "Japan",
    "HK": "Hongkong", "TO": "Kanada", "AU": "Australien", "ST": "Schweden", "CO": "Dänemark", "OL": "Norwegen",
    "CC": "Krypto", "COMM": "Rohstoffe",
}
INDEX_CCY = {
    "GSPC": "USD", "NDX": "USD", "DJI": "USD", "RUT": "USD", "IXIC": "USD", "GSPTSE": "CAD", "GDAXI": "EUR", "MDAXI": "EUR",
    "STOXX50E": "EUR", "FCHI": "EUR", "FTSE": "GBP", "SSMI": "CHF", "N225": "JPY", "HSI": "HKD", "AXJO": "AUD",
}
BENCH_FOR_EXCHANGE = {
    "US": "GSPC.INDX", "XETRA": "GDAXI.INDX", "F": "GDAXI.INDX", "LSE": "FTSE.INDX", "SW": "SSMI.INDX", "TSE": "N225.INDX",
    "HK": "HSI.INDX", "TO": "GSPTSE.INDX", "AU": "AXJO.INDX", "CC": "GSPC.INDX", "COMM": "GSPC.INDX",
}
# Währung -> (Devisenpaar, Kehrwert?) für die Umrechnung über USD (wie Terminal.fx_to_usd)
USD_PAIRS = {
    "EUR": ("EURUSD.FOREX", False), "GBP": ("GBPUSD.FOREX", False), "AUD": ("AUDUSD.FOREX", False), "NZD": ("NZDUSD.FOREX", False),
    "CHF": ("USDCHF.FOREX", True), "JPY": ("USDJPY.FOREX", True), "CAD": ("USDCAD.FOREX", True), "CNY": ("USDCNH.FOREX", True),
    "SEK": ("USDSEK.FOREX", True), "NOK": ("USDNOK.FOREX", True), "DKK": ("USDDKK.FOREX", True), "HKD": ("USDHKD.FOREX", True),
}
NON_EQUITY_SECTOR = {"CC": "Krypto", "COMM": "Rohstoffe"}
INDEX_NAMES = {i.ticker: i.name for i in INDICES}


# --- Statistik ------------------------------------------------------------------------


def _mean(x: Sequence[float]) -> float:
    return sum(x) / len(x)


def _cov(a: Sequence[float], b: Sequence[float]) -> Optional[float]:
    n = len(a)
    if n < 3:
        return None
    ma, mb = _mean(a), _mean(b)
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / (n - 1)


def _vol_pa(r: Sequence[float]) -> Optional[float]:
    v = _cov(r, r)
    return None if v is None else math.sqrt(v * TRADING_DAYS) * 100


def _beta(r: Sequence[float], rb: Sequence[float]) -> Optional[float]:
    vb = _cov(rb, rb)
    c = _cov(r, rb)
    return None if not vb or c is None else c / vb


def _corr(a: Sequence[float], b: Sequence[float]) -> Optional[float]:
    va, vb, c = _cov(a, a), _cov(b, b), _cov(a, b)
    if not va or not vb or c is None:
        return None
    return max(-1.0, min(1.0, c / math.sqrt(va * vb)))


def _quantile(sorted_x: Sequence[float], q: float) -> float:
    """Quantil mit linearer Interpolation (wie numpy.quantile, Standardverfahren)."""
    pos = (len(sorted_x) - 1) * q
    lo = math.floor(pos)
    hi = min(lo + 1, len(sorted_x) - 1)
    return sorted_x[lo] + (sorted_x[hi] - sorted_x[lo]) * (pos - lo)


def _returns(values: Sequence[float]) -> list[float]:
    return [b / a - 1.0 if a else 0.0 for a, b in zip(values, values[1:])]


def _drawdown(t: Sequence[str], v: Sequence[float]) -> tuple[Optional[float], Optional[str], Optional[str]]:
    peak, peak_i, worst, worst_peak, worst_trough = -math.inf, 0, 0.0, None, None
    for i, x in enumerate(v):
        if x > peak:
            peak, peak_i = x, i
        dd = x / peak - 1.0 if peak > 0 else 0.0
        if dd < worst:
            worst, worst_peak, worst_trough = dd, t[peak_i], t[i]
    return (worst * 100 if worst_peak else 0.0), worst_peak, worst_trough


def ffill(grid: Sequence[str], dates: Sequence[str], values: Sequence[Optional[float]]) -> list[Optional[float]]:
    """Werte auf ein Datumsraster legen; fehlende Tage (Feiertage) mit dem letzten Wert füllen."""
    pairs = [(d[:10], x) for d, x in zip(dates, values) if x is not None]
    keys = [d for d, _ in pairs]
    out: list[Optional[float]] = []
    for g in grid:
        i = bisect.bisect_right(keys, g) - 1
        out.append(pairs[i][1] if i >= 0 else None)
    return out


# --- Devisen --------------------------------------------------------------------------


class FxBook:
    """Umrechnung Handelswährung -> Basiswährung, heute und an einem Datum."""

    def __init__(self, base: str, now_usd: dict[str, float], hist_usd: dict[str, tuple[list[str], list[float]]],
                 prev_usd: Optional[dict[str, float]] = None):
        self.base = base
        self.now_usd = now_usd
        self.hist_usd = hist_usd
        self.prev_usd = prev_usd or {}

    def prev(self, ccy: str) -> Optional[float]:
        """Kurs zum Vortagesschluss (für das Tagesergebnis inkl. Währungsbewegung)."""
        c, f = self._norm(ccy)
        a = 1.0 if c == "USD" else self.prev_usd.get(c, self.now_usd.get(c))
        b = 1.0 if self.base == "USD" else self.prev_usd.get(self.base, self.now_usd.get(self.base))
        return None if a is None or not b else a / b * f

    @staticmethod
    def _norm(ccy: str) -> tuple[str, float]:
        return ("GBP", 0.01) if ccy == "GBX" else (ccy, 1.0)

    def now(self, ccy: str) -> Optional[float]:
        c, f = self._norm(ccy)
        a, b = self.now_usd.get(c), self.now_usd.get(self.base)
        return None if a is None or not b else a / b * f

    def _usd_at(self, ccy: str, day: str) -> Optional[float]:
        if ccy == "USD":
            return 1.0
        h = self.hist_usd.get(ccy)
        if not h:
            return self.now_usd.get(ccy)
        i = bisect.bisect_right(h[0], day) - 1
        return h[1][i] if i >= 0 else h[1][0] if h[1] else None

    def at(self, ccy: str, day: str) -> Optional[float]:
        c, f = self._norm(ccy)
        a, b = self._usd_at(c, day), self._usd_at(self.base, day)
        return None if a is None or not b else a / b * f

    def series(self, ccy: str, grid: Sequence[str]) -> list[Optional[float]]:
        return [self.at(ccy, g) for g in grid]


async def fx_book(t: Terminal, base: str, currencies: set[str]) -> FxBook:
    needed = {("GBP" if c == "GBX" else c) for c in currencies | {base}} - {"USD"}
    pairs = {c: USD_PAIRS[c] for c in needed if c in USD_PAIRS}
    now_usd: dict[str, float] = {"USD": 1.0}
    prev_usd: dict[str, float] = {"USD": 1.0}
    hist_usd: dict[str, tuple[list[str], list[float]]] = {}
    if pairs:
        try:
            raw = await t.quotes(sorted({p for p, _ in pairs.values()}))
            quotes = {q.ticker: q.last for q in raw}
            prevs = {q.ticker: q.prev_close for q in raw}
        except TerminalError:
            quotes, prevs = {}, {}

        async def hist(c: str, ticker: str, invert: bool) -> None:
            try:
                h = await t.history(ticker)
            except TerminalError:
                return
            dates, vals = [], []
            for d, x in zip(h.t, h.c):
                if x:
                    dates.append(d[:10])
                    vals.append(1.0 / x if invert else x)
            if dates:
                hist_usd[c] = (dates, vals)

        await asyncio.gather(*(hist(c, tk, inv) for c, (tk, inv) in pairs.items()))
        for c, (ticker, invert) in pairs.items():
            px = quotes.get(ticker)
            if px:
                now_usd[c] = 1.0 / px if invert else px
            elif c in hist_usd:
                now_usd[c] = hist_usd[c][1][-1]
            pv = prevs.get(ticker)
            if pv:
                prev_usd[c] = 1.0 / pv if invert else pv
    return FxBook(base, now_usd, hist_usd, prev_usd)


# --- Stammdaten je Position -------------------------------------------------------------


async def _info(t: Terminal, ticker: str, sem: asyncio.Semaphore) -> dict:
    """Name, Währung, Sektor (nur Aktien, aus dem Firmenprofil)."""
    exch = split(ticker)[1]
    out: dict = {"name": None, "currency": None, "sector": NON_EQUITY_SECTOR.get(exch)}
    async with sem:
        try:
            hit = await t.resolve(ticker)
            out["name"], out["currency"] = hit.name, currency_code(hit.currency)
        except TerminalError:
            pass
        if exch not in NON_EQUITY_SECTOR:
            try:
                c = await t.company(ticker)
                out["sector"] = c.sector or None
                out["name"] = out["name"] or c.name
                out["currency"] = out["currency"] or currency_code(c.currency)
            except TerminalError:
                pass
    return out


async def _history(t: Terminal, ticker: str, sem: asyncio.Semaphore) -> Optional[History]:
    async with sem:
        try:
            return await t.history(ticker)
        except TerminalError:
            return None


def choose_benchmark(p: Portfolio, values: dict[str, float]) -> str:
    if p.benchmark:
        return p.benchmark
    by_exch: dict[str, float] = {}
    for ticker, v in values.items():
        exch = split(ticker)[1]
        key = BENCH_FOR_EXCHANGE.get(exch, "STOXX50E.INDX" if EXCHANGE_CCY.get(exch) == "EUR" else "GSPC.INDX")
        by_exch[key] = by_exch.get(key, 0.0) + abs(v)
    return max(by_exch, key=by_exch.get) if by_exch else ("GDAXI.INDX" if p.base == "EUR" else "GSPC.INDX")


# --- Berechnung ---------------------------------------------------------------------


async def analyze(t: Terminal, p: Portfolio) -> Analytics:
    notes: list[str] = []
    sem = asyncio.Semaphore(6)
    positions = p.positions
    tickers = [x.ticker for x in positions]
    quotes: dict[str, Quote] = {}
    for i in range(0, len(tickers), 40):
        try:
            for q in await t.quotes(tickers[i : i + 40]):
                quotes[q.ticker] = q
        except TerminalError as exc:
            notes.append(f"Kurse teilweise nicht abrufbar: {exc.message}")
    infos = await asyncio.gather(*(_info(t, x, sem) for x in tickers))
    info = dict(zip(tickers, infos))

    def ccy_of(pos: Position) -> str:
        return pos.currency or info[pos.ticker]["currency"] or quotes.get(pos.ticker, Quote(ticker=pos.ticker)).currency or EXCHANGE_CCY.get(split(pos.ticker)[1], "USD")

    currencies = {ccy_of(x) for x in positions}
    fx = await fx_book(t, p.base, currencies)

    # Werte heute
    rows: list[PositionRow] = []
    now_values: dict[str, float] = {}
    for pos in positions:
        q = quotes.get(pos.ticker) or Quote(ticker=pos.ticker)
        ccy = ccy_of(pos)
        rate = fx.now(ccy)
        row = PositionRow(
            id=pos.id, ticker=pos.ticker, name=q.name or info[pos.ticker]["name"], quantity=pos.quantity, cost=pos.cost,
            opened=pos.opened, note=pos.note, currency=ccy, price=q.last, change_pct=q.change_pct, fx=rate,
            sector=info[pos.ticker]["sector"], country=EXCHANGE_COUNTRY.get(split(pos.ticker)[1], split(pos.ticker)[1]),
        )
        if q.last is None:
            row.issue = "Kein Kurs – Ticker prüfen."
        elif rate is None:
            row.issue = f"Kein Devisenkurs für {ccy}."
        else:
            row.value = pos.quantity * q.last * rate
            now_values[pos.ticker] = row.value
            if q.prev_close:
                # Tagesergebnis in Basiswährung: heutiger Wert minus Wert zum Vortagesschluss,
                # beide mit ihrem Devisenkurs (früher fehlte die Währungsbewegung des Tages)
                prev_rate = fx.prev(ccy) or rate
                row.day_pnl = pos.quantity * (q.last * rate - q.prev_close * prev_rate)
            if pos.cost:
                cost_rate = (fx.at(ccy, pos.opened) if pos.opened else None) or rate
                basis = pos.quantity * pos.cost * cost_rate
                row.pnl = row.value - basis
                row.pnl_pct = (q.last / pos.cost - 1.0) * 100 * (1 if pos.quantity > 0 else -1)
                row.pnl_pct_base = row.pnl / abs(basis) * 100 if basis else None
        rows.append(row)

    positions_value = sum(now_values.values())
    total = positions_value + p.cash
    for r in rows:
        if r.value is not None and total:
            r.weight = r.value / total * 100
    day = [r.day_pnl for r in rows if r.day_pnl is not None]
    day_pnl = sum(day) if day else None
    with_cost = [(r.pnl, r.value - r.pnl) for r in rows if r.pnl is not None and r.value is not None]
    invested = sum(abs(b) for _, b in with_cost) if with_cost else None
    pnl = sum(x for x, _ in with_cost) if with_cost else None
    summary = Summary(
        value=total, positions_value=positions_value, cash=p.cash, invested=invested,
        day_pnl=day_pnl, day_pnl_pct=day_pnl / (total - day_pnl) * 100 if day_pnl is not None and total - day_pnl else None,
        pnl=pnl, pnl_pct=pnl / invested * 100 if pnl is not None and invested else None, count=len(positions),
    )
    for r in rows:
        if r.issue:
            notes.append(f"{display(r.ticker)}: {r.issue}")

    # Aufteilung
    allocation: dict[str, list[Slice]] = {}
    for dim, key in (("sector", lambda r: r.sector or "Unbekannt"), ("country", lambda r: r.country or "Unbekannt"),
                     ("currency", lambda r: "GBP" if r.currency == "GBX" else r.currency or "?")):
        acc: dict[str, float] = {}
        for r in rows:
            if r.value is not None:
                acc[key(r)] = acc.get(key(r), 0.0) + r.value
        if p.cash:
            k = p.base if dim == "currency" else "Kasse"
            acc[k] = acc.get(k, 0.0) + p.cash
        allocation[dim] = sorted((Slice(key=k, value=v, weight=v / total * 100 if total else 0.0) for k, v in acc.items()), key=lambda s: -s.value)

    bench = choose_benchmark(p, now_values)
    result = Analytics(
        base=p.base, benchmark=bench, benchmark_name=INDEX_NAMES.get(bench, display(bench)), summary=summary, rows=rows,
        allocation=allocation, notes=notes,
        as_of=max((q.timestamp for q in quotes.values() if q.timestamp), default=None),
    )
    if not now_values:
        return result
    await _risk(t, p, rows, fx, ccy_of, bench, result, sem)
    return result


async def _risk(t: Terminal, p: Portfolio, rows: list[PositionRow], fx: FxBook, ccy_of, bench: str, out: Analytics, sem) -> None:
    held = [(pos, r) for pos, r in zip(p.positions, rows) if r.value is not None]
    hists = await asyncio.gather(*(_history(t, pos.ticker, sem) for pos, _ in held), _history(t, bench, sem))
    bench_hist = hists[-1]
    today = t.now().date()
    start = (today - dt.timedelta(days=YEAR_DAYS)).isoformat()

    usable: list[tuple[Position, PositionRow, History]] = []
    for (pos, r), h in zip(held, hists[:-1]):
        n = sum(1 for d, c in zip(h.t, h.c) if c is not None and d[:10] >= start) if h else 0
        if n < MIN_OBS:
            out.notes.append(f"{display(pos.ticker)}: nur {n} Kurstage im letzten Jahr – fehlt in Verlauf und Risiko.")
            continue
        usable.append((pos, r, h))
    if not usable:
        return

    # Raster: alle Handelstage des letzten Jahres, ab dem Tag, an dem jede Position einen Kurs hat
    first = max(next(d[:10] for d, c in zip(h.t, h.c) if c is not None) for _, _, h in usable)
    grid = sorted({d[:10] for _, _, h in usable for d, c in zip(h.t, h.c) if c is not None and d[:10] >= max(start, first)})
    if len(grid) < MIN_OBS:
        out.notes.append("Zu wenig gemeinsame Kurshistorie für Risikokennzahlen.")
        return

    values_base: list[list[float]] = []
    for pos, r, h in usable:
        px = ffill(grid, h.t, h.c)
        rate = fx.series(ccy_of(pos), grid)
        values_base.append([pos.quantity * (a or 0.0) * (b or r.fx or 0.0) for a, b in zip(px, rate)])
    held_value = [sum(col) for col in zip(*values_base)]
    excluded = sum(r.value or 0.0 for r in rows) - sum(r.value or 0.0 for _, r, _ in usable)
    # Nicht berechenbare Positionen und Kasse als konstanten Betrag mitführen
    v = [x + p.cash + excluded for x in held_value]
    if min(v) <= 0:
        out.notes.append("Depotwert im Verlauf nicht durchgehend positiv (Leerverkäufe/Kredit) – Risikokennzahlen entfallen.")
        return
    rp = _returns(v)

    bench_base: Optional[list[float]] = None
    if bench_hist:
        bpx = ffill(grid, bench_hist.t, bench_hist.c)
        bccy = INDEX_CCY.get(split(bench)[0], "USD")
        brate = fx.series(bccy, grid)
        if all(x is not None for x in bpx) and all(x is not None for x in brate):
            bench_base = [a * b for a, b in zip(bpx, brate)]  # type: ignore[operator]
    rb = _returns(bench_base) if bench_base else None

    risk = Risk(days=len(rp))
    risk.vol = _vol_pa(rp)
    risk.return_1y = (v[-1] / v[0] - 1.0) * 100
    risk.max_drawdown, risk.drawdown_peak, risk.drawdown_trough = _drawdown(grid, v)
    srt = sorted(rp)
    q05 = _quantile(srt, 0.05)
    tail = [x for x in srt if x <= q05] or [srt[0]]
    now_total = out.summary.value
    risk.var95_pct = max(0.0, -q05 * 100)
    risk.var95 = max(0.0, -q05) * now_total
    risk.es95 = max(0.0, -_mean(tail)) * now_total
    if rb:
        risk.beta = _beta(rp, rb)
        risk.bench_vol = _vol_pa(rb)
        risk.bench_return_1y = (bench_base[-1] / bench_base[0] - 1.0) * 100  # type: ignore[index]

    # Gewichte, Konzentration, Risikobeitrag (aktuelle Gewichte, Kovarianz der Tagesrenditen)
    weights = [(r.weight or 0.0) / 100 for _, r, _ in usable]
    all_w = sorted((abs(r.weight or 0.0) for r in rows if r.weight is not None), reverse=True)
    risk.top5_weight = sum(all_w[:5])
    # Effektive Positionszahl 1/Σw² mit Gewichten innerhalb der Wertpapiere (ohne Kasse);
    # mit Kasse im Nenner kamen bei 3 Positionen 4,5 heraus
    tot = sum(all_w)
    sq = sum((w / tot) ** 2 for w in all_w) if tot else 0.0
    risk.effective_n = 1.0 / sq if sq else None
    big = max((r for r in rows if r.weight is not None), key=lambda r: abs(r.weight or 0.0), default=None)
    if big:
        risk.largest, risk.largest_weight = big.ticker, big.weight
    # Renditen je Position in Basiswährung (bei fester Stückzahl gleich der Rendite eines Stücks)
    rets = [_returns(col) for col in values_base]
    n = len(rets)
    cov = [[_cov(rets[i], rets[j]) or 0.0 for j in range(n)] for i in range(n)]
    cw = [sum(cov[i][j] * weights[j] for j in range(n)) for i in range(n)]
    var_p = sum(weights[i] * cw[i] for i in range(n))
    for i, (_, r, _) in enumerate(usable):
        r.vol = _vol_pa(rets[i])
        if rb:
            r.beta = _beta(rets[i], rb)
        if var_p > 0:
            r.risk_share = weights[i] * cw[i] / var_p * 100
    out.risk = risk

    out.series = ValueSeries(
        t=grid,
        portfolio=[round(x / v[0] * 100, 3) for x in v],
        benchmark=[round(x / bench_base[0] * 100, 3) for x in bench_base] if bench_base else [],
    )
    order = sorted(range(n), key=lambda i: -abs(weights[i]))[:12]
    out.correlation = Correlation(
        tickers=[usable[i][0].ticker for i in order],
        matrix=[[None if (c := _corr(rets[i], rets[j])) is None else round(c, 3) for j in order] for i in order],
    )
    out.notes.append("Verlauf und Risiko: heutige Stückzahlen rückwirkend über ein Jahr, ohne Käufe und Verkäufe im Zeitraum.")


# --- Muster-Depot (Demo-Modus) -----------------------------------------------------------

SAMPLE = [  # Ticker, Zielwert beim Kauf in EUR, Monate seit Kauf
    ("NWND.US", 14000, 14), ("QBIT.US", 11000, 10), ("MDRN.US", 7000, 18), ("ORCX.US", 8000, 7), ("NRDW.XETRA", 12000, 16),
    ("ALPV.XETRA", 9000, 12), ("SPRK.XETRA", 6000, 9), ("LMRE.PA", 7000, 13), ("DLTA.AS", 6000, 6), ("GLTS.SW", 8000, 15),
    ("THMS.LSE", 5000, 11),
]


async def sample_portfolio(t: Terminal) -> Portfolio:
    """Beispieldepot mit Käufen vor 6–18 Monaten zu den damaligen Kursen (nur Demo-Daten)."""
    from ..services import metrics

    fx = await fx_book(t, "EUR", {"USD", "CHF", "GBP"})
    today = t.now().date()
    positions: list[Position] = []
    for i, (ticker, target, months) in enumerate(SAMPLE):
        try:
            h = await t.history(ticker)
            hit = await t.resolve(ticker)
        except TerminalError:
            continue
        day = metrics.shift_date(today, months=months).isoformat()
        px = ffill([day], h.t, h.c)[0]
        ccy = currency_code(hit.currency) or EXCHANGE_CCY.get(split(ticker)[1], "USD")
        rate = fx.at(ccy, day)
        if not px or not rate:
            continue
        qty = max(1, round(target / (px * rate)))
        opened = next((d[:10] for d in h.t if d[:10] >= day), day)
        positions.append(Position(id=f"muster{i}", ticker=ticker, quantity=qty, cost=round(px, 2), opened=opened))
    return Portfolio(version=0, base="EUR", cash=5000.0, positions=positions, sample=True)
