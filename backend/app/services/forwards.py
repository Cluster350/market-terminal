"""Terminkurse aus Kassakursen und Zinsen (gedeckte Zinsparität) und implizite Forward-Zinsen.

EODHD liefert keine Börsen-Futures und keine Devisen-Terminkurse. Beides lässt sich aber aus
Daten berechnen, die vorhanden sind: Devisen-Terminkurse aus dem Kassakurs und den Geldmarkt-
zinsen beider Währungen (so rechnen auch Banken; am Markt weicht der Kurs nur um den kleinen
„Cross-Currency-Basis“ ab), Forward-Zinsen aus der Zinskurve. Als Zinsen dienen Renditen
kurzlaufender Staatsanleihen – eine Näherung an die Geldmarktsätze.
"""

from __future__ import annotations

import asyncio
import datetime as dt
from typing import Optional

from ..errors import BadRequest, TerminalError
from ..models import Model
from . import metrics

# Währung -> Land der Staatsanleihen, deren kurze Renditen als Zins dienen
CCY_COUNTRY = {
    "USD": "US", "EUR": "DE", "GBP": "UK", "JPY": "JP", "CHF": "CH", "CAD": "CA", "AUD": "AU", "NZD": "NZ",
    "SEK": "SE", "NOK": "NO", "DKK": "DK", "PLN": "PL", "CNH": "CN", "CNY": "CN", "MXN": "MX", "BRL": "BR",
    "INR": "IN", "KRW": "KR", "ZAR": "ZA", "TRY": "TR", "ILS": "IL", "IDR": "ID",
}
MONEY_TENORS = [("3M", 0.25), ("6M", 0.5), ("1Y", 1.0), ("2Y", 2.0)]
FX_TENORS = [("1W", 7 / 365), ("1M", 1 / 12), ("2M", 2 / 12), ("3M", 0.25), ("6M", 0.5), ("9M", 0.75), ("1Y", 1.0), ("18M", 1.5), ("2Y", 2.0)]
HEDGE_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "SEK", "NOK", "DKK", "CNH"]
RATE_FORWARD_STARTS = [0, 1, 2, 3, 4, 5, 7, 10, 15]
RATE_FORWARD_KEYS = [("1Y1Y", 1, 1), ("2Y1Y", 2, 1), ("2Y3Y", 2, 3), ("5Y5Y", 5, 5), ("10Y10Y", 10, 10)]


class RatePoint(Model):
    years: float
    rate: float  # Prozent


class FxForwardRow(Model):
    tenor: str
    years: float
    base_rate: Optional[float] = None
    quote_rate: Optional[float] = None
    outright: Optional[float] = None
    points: Optional[float] = None  # Swap-Punkte in Pips
    premium_pa: Optional[float] = None  # Auf-/Abschlag der Basiswährung in % p. a.


class FxForwards(Model):
    pair: str
    base: str
    quote: str
    spot: Optional[float] = None
    pip: float
    as_of: Optional[str] = None
    rows: list[FxForwardRow] = []
    base_curve: list[RatePoint] = []
    quote_curve: list[RatePoint] = []
    missing: list[str] = []


class HedgeRow(Model):
    currency: str
    rate_3m: Optional[float] = None  # Zins der Fremdwährung
    hedge_3m_pa: Optional[float] = None  # Ertrag (+) bzw. Kosten (−) der Absicherung in % p. a.
    hedge_1y_pa: Optional[float] = None


class HedgeTable(Model):
    home: str
    home_rate_3m: Optional[float] = None
    rows: list[HedgeRow] = []
    missing: list[str] = []


class RateForwardPoint(Model):
    start: float
    rate: Optional[float] = None
    rate_1m: Optional[float] = None


class RateForwardKey(Model):
    label: str
    start: float
    length: float
    rate: Optional[float] = None
    change_1m_bp: Optional[float] = None


class RateForwards(Model):
    country: str
    name: str
    as_of: Optional[str] = None
    spot: list[RatePoint] = []
    spot_1m: list[RatePoint] = []
    forwards: list[RateForwardPoint] = []
    keys: list[RateForwardKey] = []


# --- Rechenbausteine --------------------------------------------------------------------


def interp(curve: list[tuple[float, float]], t: float) -> Optional[float]:
    """Zins zur Laufzeit t: linear zwischen Stützstellen, außerhalb flach."""
    if not curve:
        return None
    pts = sorted(curve)
    if t <= pts[0][0]:
        return pts[0][1]
    if t >= pts[-1][0]:
        return pts[-1][1]
    for (t0, r0), (t1, r1) in zip(pts, pts[1:]):
        if t0 <= t <= t1:
            return r0 + (r1 - r0) * (t - t0) / (t1 - t0)
    return pts[-1][1]


def growth(rate_pct: float, t: float) -> float:
    """Aufzinsungsfaktor: einfach bis ein Jahr (Geldmarkt), darüber mit Zinseszins."""
    r = rate_pct / 100
    return 1 + r * t if t <= 1 else (1 + r) ** t


def fx_forward(spot: float, base_rate: float, quote_rate: float, t: float) -> float:
    """Terminkurs (Notierungswährung je Einheit Basiswährung) per gedeckter Zinsparität."""
    return spot * growth(quote_rate, t) / growth(base_rate, t)


def annualized(ratio: float, t: float) -> float:
    return (ratio ** (1 / t) - 1) * 100


def hedge_pa(home_rate: float, foreign_rate: float, t: float) -> float:
    """Ertrag (+) oder Kosten (−) pro Jahr, wenn Fremdwährung per Termin in die Heimatwährung getauscht wird."""
    return annualized(growth(home_rate, t) / growth(foreign_rate, t), t)


def forward_rate(curve: list[tuple[float, float]], start: float, length: float) -> Optional[float]:
    """Implizierter Zins für `length` Jahre ab `start` (Renditen als jährlich verzinste Nullkuponsätze)."""
    end = start + length
    if not curve or end > max(t for t, _ in curve) + 1e-9:
        return None
    y2 = interp(curve, end)
    if start == 0:
        return y2
    y1 = interp(curve, start)
    if y1 is None or y2 is None:
        return None
    return (((1 + y2 / 100) ** end / (1 + y1 / 100) ** start) ** (1 / length) - 1) * 100


def pip_size(quote: str) -> float:
    return 0.01 if quote == "JPY" else 0.0001


# --- Dienst ------------------------------------------------------------------------------


class Forwards:
    def __init__(self, terminal):
        self.t = terminal

    async def money_curve(self, ccy: str, months_ago: int = 0) -> tuple[list[tuple[float, float]], Optional[str]]:
        """Kurze Zinsen einer Währung aus den Renditen der Staatsanleihen (3M bis 2J)."""
        cc = CCY_COUNTRY.get(ccy)
        if not cc:
            return [], None

        async def one(tenor: str, years: float) -> Optional[tuple[float, float, str]]:
            try:
                h = await self.t.history(f"{cc}{tenor}.GBOND")
            except TerminalError:
                return None
            pairs = [(d[:10], x) for d, x in zip(h.t, h.c) if x is not None]
            if not pairs:
                return None
            if months_ago:
                cutoff = metrics.shift_date(dt.date.fromisoformat(pairs[-1][0]), months_ago).isoformat()
                pairs = [p for p in pairs if p[0] <= cutoff]
                if not pairs:
                    return None
            return years, pairs[-1][1], pairs[-1][0]

        got = [x for x in await asyncio.gather(*(one(t, y) for t, y in MONEY_TENORS)) if x]
        return [(y, r) for y, r, _ in got], max((d for _, _, d in got), default=None)

    async def _spot(self, base: str, quote: str) -> Optional[float]:
        try:
            q = (await self.t.quotes([f"{base}{quote}.FOREX"]))[0]
            if q.last:
                return q.last
        except TerminalError:
            pass
        usd = await self.t.fx_to_usd()  # Kreuzkurs über USD
        a, b = usd.get(base), usd.get(quote)
        return a / b if a and b else None

    async def fx(self, pair: str) -> FxForwards:
        pair = pair.upper().replace("/", "").replace(".FOREX", "")
        base, quote = pair[:3], pair[3:]
        if len(pair) != 6 or base not in CCY_COUNTRY or quote not in CCY_COUNTRY or base == quote:
            raise BadRequest(f"Devisenpaar „{pair}“ wird nicht unterstützt. Möglich: {', '.join(sorted(CCY_COUNTRY))}.")
        (bc, bd), (qc, qd), spot = await asyncio.gather(self.money_curve(base), self.money_curve(quote), self._spot(base, quote))
        out = FxForwards(pair=pair, base=base, quote=quote, spot=spot, pip=pip_size(quote), as_of=max(filter(None, [bd, qd]), default=None),
                         base_curve=[RatePoint(years=y, rate=r) for y, r in sorted(bc)],
                         quote_curve=[RatePoint(years=y, rate=r) for y, r in sorted(qc)],
                         missing=[c for c, cur in ((base, bc), (quote, qc)) if not cur])
        for label, t in FX_TENORS:
            rb, rq = interp(bc, t), interp(qc, t)
            row = FxForwardRow(tenor=label, years=round(t, 4), base_rate=rb, quote_rate=rq)
            if spot and rb is not None and rq is not None:
                f = fx_forward(spot, rb, rq, t)
                row.outright, row.points, row.premium_pa = f, (f - spot) / out.pip, annualized(f / spot, t)
            out.rows.append(row)
        return out

    async def hedge(self, home: str, currencies: Optional[list[str]] = None) -> HedgeTable:
        home = home.upper()
        if home not in CCY_COUNTRY:
            raise BadRequest(f"Heimatwährung „{home}“ wird nicht unterstützt.")
        wanted = [c.upper() for c in (currencies or HEDGE_CURRENCIES) if c.upper() != home]
        wanted = [c for c in dict.fromkeys(wanted) if c in CCY_COUNTRY][:20]
        curves = await asyncio.gather(*(self.money_curve(c) for c in [home, *wanted]))
        hc = curves[0][0]
        out = HedgeTable(home=home, home_rate_3m=interp(hc, 0.25))
        if not hc:
            out.missing.append(home)
            return out
        for c, (fc, _) in zip(wanted, curves[1:]):
            if not fc:
                out.missing.append(c)
                continue
            out.rows.append(HedgeRow(
                currency=c, rate_3m=interp(fc, 0.25),
                hedge_3m_pa=hedge_pa(interp(hc, 0.25), interp(fc, 0.25), 0.25),  # type: ignore[arg-type]
                hedge_1y_pa=hedge_pa(interp(hc, 1.0), interp(fc, 1.0), 1.0),  # type: ignore[arg-type]
            ))
        return out

    async def rates(self, country: str) -> RateForwards:
        catalog = self.t.p.catalog.curves
        cc = country.upper()
        if cc not in catalog:
            raise BadRequest(f"Für „{country}“ gibt es keine Zinskurve. Möglich: {', '.join(catalog)}.")
        curve = (await self.t.curves([cc]))[0]
        now = [(p.years, p.y) for p in curve.points if p.y is not None]
        ago = [(p.years, p.y_1m) for p in curve.points if p.y_1m is not None]
        out = RateForwards(country=cc, name=curve.name, as_of=curve.as_of,
                           spot=[RatePoint(years=y, rate=r) for y, r in now], spot_1m=[RatePoint(years=y, rate=r) for y, r in ago])
        for s in RATE_FORWARD_STARTS:
            f = forward_rate(now, s, 1)
            if f is None:
                continue
            out.forwards.append(RateForwardPoint(start=s, rate=f, rate_1m=forward_rate(ago, s, 1)))
        for label, s, n in RATE_FORWARD_KEYS:
            f, f1 = forward_rate(now, s, n), forward_rate(ago, s, n)
            if f is not None:
                out.keys.append(RateForwardKey(label=label, start=s, length=n, rate=f, change_1m_bp=None if f1 is None else round((f - f1) * 100, 1)))
        return out
