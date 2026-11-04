"""Kennzahlen aus einer Optionskette: implizite Volatilität, erwartete Bewegung, Put/Call,
Max Pain, Skew, Laufzeitstruktur, Open Interest je Strike und auffällige Umsätze."""

from __future__ import annotations

import datetime as dt
import math
from collections import defaultdict
from typing import Optional, Sequence

from ..errors import NotFound
from ..models import Model, OptionContract


class OptionQuote(Model):
    contract: str
    bid: Optional[float] = None
    ask: Optional[float] = None
    last: Optional[float] = None
    volume: Optional[float] = None
    open_interest: Optional[float] = None
    iv: Optional[float] = None
    delta: Optional[float] = None
    gamma: Optional[float] = None
    theta: Optional[float] = None
    vega: Optional[float] = None


class ChainRow(Model):
    strike: float
    call: Optional[OptionQuote] = None
    put: Optional[OptionQuote] = None


class OptionChain(Model):
    ticker: str
    spot: Optional[float] = None
    exp: str
    dte: int
    expirations: list[str]
    atm_strike: Optional[float] = None
    rows: list[ChainRow]


class ExpirySummary(Model):
    exp: str
    dte: int
    monthly: bool
    atm_iv: Optional[float] = None
    straddle: Optional[float] = None
    move_pct: Optional[float] = None
    call_volume: float = 0
    put_volume: float = 0
    call_oi: float = 0
    put_oi: float = 0
    pc_volume: Optional[float] = None
    pc_oi: Optional[float] = None
    max_pain: Optional[float] = None
    iv_put25: Optional[float] = None
    iv_call25: Optional[float] = None
    skew25: Optional[float] = None  # Volatilitätspunkte: Put 25Δ − Call 25Δ
    earnings: bool = False  # erster Verfall nach den nächsten Quartalszahlen


class StrikeOI(Model):
    strike: float
    call_oi: float = 0
    put_oi: float = 0
    call_volume: float = 0
    put_volume: float = 0


class SmilePoint(Model):
    strike: float
    moneyness: float  # Prozent über/unter dem Kurs
    call_iv: Optional[float] = None
    put_iv: Optional[float] = None
    iv: Optional[float] = None  # aus der Option außerhalb des Geldes


class ActiveContract(Model):
    contract: str
    type: str
    exp: str
    strike: float
    volume: float
    open_interest: Optional[float] = None
    vol_oi: Optional[float] = None
    last: Optional[float] = None
    iv: Optional[float] = None
    delta: Optional[float] = None


class OptionsOverview(Model):
    ticker: str
    spot: Optional[float] = None
    earnings_date: Optional[str] = None  # nächste Quartalszahlen
    earnings_timing: Optional[str] = None  # BeforeMarket / AfterMarket
    iv30: Optional[float] = None
    hv30: Optional[float] = None
    hv1y: Optional[float] = None
    iv_hv: Optional[float] = None
    pc_volume: Optional[float] = None
    pc_oi: Optional[float] = None
    total_volume: float = 0
    total_oi: float = 0
    expirations: list[ExpirySummary] = []
    focus: Optional[ExpirySummary] = None
    oi_by_strike: list[StrikeOI] = []
    smile: list[SmilePoint] = []
    call_walls: list[StrikeOI] = []  # Strikes mit dem größten Call-OI (Widerstand)
    put_walls: list[StrikeOI] = []  # Strikes mit dem größten Put-OI (Unterstützung)
    most_active: list[ActiveContract] = []
    unusual: list[ActiveContract] = []
    contracts: int = 0


# --- Bausteine --------------------------------------------------------------------------


def is_monthly(exp: str) -> bool:
    """Monatsverfall = dritter Freitag (Tag 15–21); an einem Börsenfeiertag der Donnerstag davor."""
    d = dt.date.fromisoformat(exp)
    if d.weekday() == 3:
        d += dt.timedelta(days=1)
    return d.weekday() == 4 and 15 <= d.day <= 21


def mid(c: OptionContract) -> Optional[float]:
    if c.bid and c.ask and c.ask >= c.bid:
        return (c.bid + c.ask) / 2
    return c.last if c.last else None


def max_pain(contracts: Sequence[OptionContract]) -> Optional[float]:
    """Strike, bei dem die Käufer aller Optionen beim Verfall den geringsten Wert erhielten."""
    strikes = sorted({c.strike for c in contracts})
    if not strikes:
        return None

    def payout(k: float) -> float:
        total = 0.0
        for c in contracts:
            oi = c.open_interest or 0
            total += oi * (max(0.0, k - c.strike) if c.type == "call" else max(0.0, c.strike - k))
        return total

    return min(strikes, key=payout)


def otm_iv_by_strike(contracts: Sequence[OptionContract], spot: float) -> list[tuple[float, float]]:
    """IV je Strike aus der Option außerhalb des Geldes (Puts unter, Calls über dem Kurs)."""
    by: dict[float, dict[str, float]] = defaultdict(dict)
    for c in contracts:
        if c.iv:
            by[c.strike][c.type] = c.iv
    out = []
    for k in sorted(by):
        v = by[k].get("put" if k < spot else "call") or by[k].get("call") or by[k].get("put")
        if v:
            out.append((k, v))
    return out


def interp_iv(points: list[tuple[float, float]], x: float) -> Optional[float]:
    if not points:
        return None
    if x <= points[0][0]:
        return points[0][1]
    if x >= points[-1][0]:
        return points[-1][1]
    for (k0, v0), (k1, v1) in zip(points, points[1:]):
        if k0 <= x <= k1:
            return v0 + (v1 - v0) * (x - k0) / (k1 - k0) if k1 > k0 else v0
    return None


def iv_at_delta(contracts: Sequence[OptionContract], kind: str, target: float) -> Optional[float]:
    """IV bei einem Ziel-Delta (z. B. −0,25 für den 25-Delta-Put), linear zwischen den beiden
    benachbarten Strikes interpoliert. Früher galt der nächstgelegene Strike, wodurch der Skew
    bei kleinen Kursbewegungen sprang."""
    pts = sorted({(c.delta, c.iv) for c in contracts if c.type == kind and c.delta is not None and c.iv})
    if not pts:
        return None
    for (d0, v0), (d1, v1) in zip(pts, pts[1:]):
        if d0 <= target <= d1:
            return v0 if d1 == d0 else v0 + (v1 - v0) * (target - d0) / (d1 - d0)
    # Ziel außerhalb der Kette: nur sehr nahe Randwerte gelten lassen
    edge = min(pts, key=lambda p: abs(p[0] - target))
    return edge[1] if abs(edge[0] - target) <= 0.05 else None


def summarize_expiry(exp: str, contracts: Sequence[OptionContract], spot: Optional[float], today: dt.date) -> ExpirySummary:
    s = ExpirySummary(exp=exp, dte=(dt.date.fromisoformat(exp) - today).days, monthly=is_monthly(exp))
    for c in contracts:
        if c.type == "call":
            s.call_volume += c.volume or 0
            s.call_oi += c.open_interest or 0
        else:
            s.put_volume += c.volume or 0
            s.put_oi += c.open_interest or 0
    s.pc_volume = s.put_volume / s.call_volume if s.call_volume else None
    s.pc_oi = s.put_oi / s.call_oi if s.call_oi else None
    s.max_pain = max_pain(contracts)
    if spot:
        s.atm_iv = interp_iv(otm_iv_by_strike(contracts, spot), spot)
        strikes = sorted({c.strike for c in contracts}, key=lambda k: abs(k - spot))
        for k in strikes[:3]:
            call = next((c for c in contracts if c.type == "call" and c.strike == k), None)
            put = next((c for c in contracts if c.type == "put" and c.strike == k), None)
            if call and put and mid(call) is not None and mid(put) is not None:
                s.straddle = mid(call) + mid(put)  # type: ignore[operator]
                s.move_pct = s.straddle / spot * 100
                break
    s.iv_put25 = iv_at_delta(contracts, "put", -0.25)
    s.iv_call25 = iv_at_delta(contracts, "call", 0.25)
    if s.iv_put25 is not None and s.iv_call25 is not None:
        s.skew25 = (s.iv_put25 - s.iv_call25) * 100
    return s


def constant_maturity_iv(expiries: Sequence[ExpirySummary], days: int = 30) -> Optional[float]:
    """IV für genau `days` Tage, interpoliert in der Varianz zwischen den umliegenden Verfällen."""
    pts = [(e.dte, e.atm_iv) for e in expiries if e.atm_iv and e.dte > 0]
    if not pts:
        return None
    below = [p for p in pts if p[0] <= days]
    above = [p for p in pts if p[0] >= days]
    if not below:
        return above[0][1]
    if not above:
        return below[-1][1]
    (t1, v1), (t2, v2) = below[-1], above[0]
    if t2 == t1:
        return v1
    w = (t2 - days) / (t2 - t1)
    var = (w * v1 * v1 * t1 + (1 - w) * v2 * v2 * t2) / days
    return math.sqrt(max(var, 0.0))


def realized_vol(closes: Sequence[float], days: int) -> Optional[float]:
    vals = [c for c in closes if c][-(days + 1):]
    rets = [math.log(b / a) for a, b in zip(vals, vals[1:]) if a > 0 and b > 0]
    if len(rets) < max(5, days // 2):
        return None
    m = sum(rets) / len(rets)
    return math.sqrt(sum((x - m) ** 2 for x in rets) / (len(rets) - 1) * 252)


def _active(c: OptionContract) -> ActiveContract:
    return ActiveContract(
        contract=c.contract, type=c.type, exp=c.exp, strike=c.strike, volume=c.volume or 0, open_interest=c.open_interest,
        vol_oi=(c.volume or 0) / c.open_interest if c.open_interest else None, last=c.last, iv=c.iv, delta=c.delta,
    )


def overview(ticker: str, contracts: Sequence[OptionContract], spot: Optional[float], closes: Sequence[float], today: dt.date, focus_exp: Optional[str] = None,
             earnings: Optional[tuple[str, Optional[str]]] = None) -> OptionsOverview:
    by_exp: dict[str, list[OptionContract]] = defaultdict(list)
    for c in contracts:
        if c.exp >= today.isoformat():
            by_exp[c.exp].append(c)
    exps = sorted(by_exp)
    summaries = [summarize_expiry(e, by_exp[e], spot, today) for e in exps]
    out = OptionsOverview(ticker=ticker, spot=spot, expirations=summaries, contracts=sum(len(v) for v in by_exp.values()))
    if earnings and earnings[0]:
        day, timing = earnings[0][:10], earnings[1]
        out.earnings_date, out.earnings_timing = day, timing
        # nachbörslich am Verfallstag zählt erst der nächste Verfall
        first = next((s for s in summaries if s.exp > day or (s.exp == day and timing == "BeforeMarket")), None)
        if first:
            first.earnings = True
    out.iv30 = constant_maturity_iv(summaries)
    out.hv30, out.hv1y = realized_vol(closes, 21), realized_vol(closes, 252)
    out.iv_hv = out.iv30 / out.hv30 if out.iv30 and out.hv30 else None
    cv = sum(s.call_volume for s in summaries)
    pv = sum(s.put_volume for s in summaries)
    co = sum(s.call_oi for s in summaries)
    po = sum(s.put_oi for s in summaries)
    out.total_volume, out.total_oi = cv + pv, co + po
    out.pc_volume, out.pc_oi = (pv / cv if cv else None), (po / co if co else None)
    if not summaries:
        return out
    focus = next((s for s in summaries if s.exp == focus_exp), None) or next((s for s in summaries if s.monthly and s.dte >= 7), None) or summaries[0]
    out.focus = focus
    fc = by_exp[focus.exp]
    strikes: dict[float, StrikeOI] = {}
    for c in fc:
        row = strikes.setdefault(c.strike, StrikeOI(strike=c.strike))
        if c.type == "call":
            row.call_oi += c.open_interest or 0
            row.call_volume += c.volume or 0
        else:
            row.put_oi += c.open_interest or 0
            row.put_volume += c.volume or 0
    out.oi_by_strike = [strikes[k] for k in sorted(strikes)]
    out.call_walls = sorted((r for r in out.oi_by_strike if spot is None or r.strike >= spot), key=lambda r: -r.call_oi)[:3]
    out.put_walls = sorted((r for r in out.oi_by_strike if spot is None or r.strike <= spot), key=lambda r: -r.put_oi)[:3]
    if spot:
        by_k: dict[float, SmilePoint] = {}
        for c in fc:
            p = by_k.setdefault(c.strike, SmilePoint(strike=c.strike, moneyness=(c.strike / spot - 1) * 100))
            if c.type == "call":
                p.call_iv = c.iv
            else:
                p.put_iv = c.iv
        for k, p in by_k.items():
            p.iv = (p.put_iv if k < spot else p.call_iv) or p.call_iv or p.put_iv
        out.smile = [by_k[k] for k in sorted(by_k)]
    traded = [c for c in contracts if (c.volume or 0) > 0 and c.exp >= today.isoformat()]
    out.most_active = [_active(c) for c in sorted(traded, key=lambda c: -(c.volume or 0))[:12]]
    top = max((c.volume or 0 for c in traded), default=0)
    unusual = [c for c in traded if c.open_interest and (c.volume or 0) >= max(100, 0.05 * top) and (c.volume or 0) / c.open_interest >= 1.2]
    out.unusual = [_active(c) for c in sorted(unusual, key=lambda c: -((c.volume or 0) / (c.open_interest or 1)))[:10]]
    return out


def chain(ticker: str, contracts: Sequence[OptionContract], spot: Optional[float], today: dt.date, exp: Optional[str]) -> OptionChain:
    exps = sorted({c.exp for c in contracts if c.exp >= today.isoformat()})
    if not exps:
        return OptionChain(ticker=ticker, spot=spot, exp="", dte=0, expirations=[], rows=[])
    if exp and exp not in exps:
        raise NotFound(f"Kein Verfall am {exp}. Verfügbar: {', '.join(exps[:8])}{' …' if len(exps) > 8 else ''}")
    chosen = exp or next((e for e in exps if is_monthly(e) and (dt.date.fromisoformat(e) - today).days >= 7), exps[0])
    rows: dict[float, ChainRow] = {}
    for c in contracts:
        if c.exp != chosen:
            continue
        q = OptionQuote(contract=c.contract, bid=c.bid, ask=c.ask, last=c.last, volume=c.volume, open_interest=c.open_interest,
                        iv=c.iv, delta=c.delta, gamma=c.gamma, theta=c.theta, vega=c.vega)
        row = rows.setdefault(c.strike, ChainRow(strike=c.strike))
        if c.type == "call":
            row.call = q
        else:
            row.put = q
    ordered = [rows[k] for k in sorted(rows)]
    atm = min(rows, key=lambda k: abs(k - spot)) if spot and rows else None
    return OptionChain(ticker=ticker, spot=spot, exp=chosen, dte=(dt.date.fromisoformat(chosen) - today).days, expirations=exps, atm_strike=atm, rows=ordered)
