"""Rechenkern des Bewertungstrends.

Grundsätze
- KGV einer Gruppe (Sektor, Land) wie bei Indexanbietern: Börsenwert aller Firmen geteilt durch ihren
  Gesamtgewinn. Verluste mindern den Gewinn, statt herauszufallen; ist der Gesamtgewinn ≤ 0, gibt es
  kein KGV („negativ“).
- Kalenderjahre: Geschäftsjahre (z. B. NVIDIA bis Ende Januar) werden anteilig nach Monaten auf
  Kalenderjahre verteilt, damit alle Firmen vergleichbar sind.
- Frühere Jahre: Kurs am Jahresende geteilt durch den tatsächlichen Gewinn des Jahres. Laufendes und
  nächstes Jahr: heutiger Kurs geteilt durch den Analystenkonsens.
- Kurse: Die Datenquelle bereinigt Kurse um Dividenden; für das KGV braucht es die gehandelten Kurse,
  daher wird die Dividendenbereinigung rückgängig gemacht (Splits bleiben bereinigt).
- Gewichte: heutige Aktienzahl (Börsenwert heute ÷ Kurs heute) – Rückkäufe und Kapitalerhöhungen der
  Vergangenheit sind nicht berücksichtigt, ebenso wenig Wechselkursänderungen zwischen Ländern.
"""

from __future__ import annotations

import bisect
import datetime as dt
import math
import re
from dataclasses import dataclass, field
from typing import Optional, Sequence

from .inputs import Estimate, ValInputs

REPORT_LAG = 60  # Tage, bis ein Quartals- oder Jahresgewinn veröffentlicht ist
LAGS = (7, 30, 60, 90)


# --- Kalenderjahre ------------------------------------------------------------------------------


def _mi(d: dt.date) -> int:
    """Monatsindex (Jahr · 12 + Monat − 1)."""
    return d.year * 12 + d.month - 1


def months_in_year(fy_end: dt.date, year: int) -> int:
    """Wie viele der zwölf Monate des Geschäftsjahres (endet im Monat von ``fy_end``) im Kalenderjahr liegen."""
    end = _mi(fy_end)
    start = end - 11
    return max(0, min(end, year * 12 + 11) - max(start, year * 12) + 1)


def calendarize(fy_values: dict[int, float], year: int) -> Optional[float]:
    """Wert für ein Kalenderjahr aus Geschäftsjahreswerten (Schlüssel: Monatsindex des Geschäftsjahresendes).
    Nur wenn alle zwölf Monate abgedeckt sind, sonst None."""
    acc, months = 0.0, 0
    for end_mi, v in fy_values.items():
        end = dt.date(end_mi // 12, end_mi % 12 + 1, 1)
        m = months_in_year(end, year)
        if m:
            acc += v * m / 12
            months += m
    return acc if months == 12 else None


def fy_from_quarters(quarters: Sequence[tuple[dt.date, float]], fy_month: int) -> dict[int, float]:
    """Geschäftsjahreswerte aus Quartalen (vier Quartale mit Ende in den zwölf Monaten bis ``fy_month``)."""
    out: dict[int, float] = {}
    by_fy: dict[int, list[float]] = {}
    for d, v in quarters:
        # Geschäftsjahr, in dem das Quartal liegt: nächstes Ende im Monat fy_month ab d
        y = d.year if d.month <= fy_month else d.year + 1
        by_fy.setdefault(y * 12 + fy_month - 1, []).append(v)
    for end_mi, vals in by_fy.items():
        if len(vals) == 4:
            out[end_mi] = sum(vals)
    return out


def fy_month(inp: ValInputs) -> int:
    for e in inp.estimates:
        return e.end.month
    if inp.annual:
        return inp.annual[-1][0].month
    return 12


def fy_values(inp: ValInputs, lag: int = 0, with_estimates: bool = True) -> dict[int, float]:
    """Geschäftsjahres-EPS: berichtete Werte, ergänzt um Schätzungen für noch nicht berichtete Jahre.
    ``lag`` > 0 nimmt den Konsens von vor ``lag`` Tagen."""
    vals = fy_from_quarters(inp.quarters, fy_month(inp))
    vals.update({_mi(d): v for d, v in inp.annual})  # gemeldete Jahreswerte gehen vor
    if with_estimates:
        for e in inp.estimates:
            key = _mi(e.end)
            if key in vals:
                continue  # schon berichtet
            v = e.eps if lag == 0 else e.ago.get(lag)
            if v is not None:
                vals[key] = v
    return vals


# --- Bereinigungen ------------------------------------------------------------------------------


def split_ratio(text: str) -> Optional[float]:
    """„10/1“, „10.000000/1.000000“ oder „10:1“ -> 10 (neue Aktien je alte)."""
    m = re.match(r"\s*([\d.]+)\s*[/:]\s*([\d.]+)", text or "")
    if not m:
        return None
    a, b = float(m.group(1)), float(m.group(2))
    return a / b if a > 0 and b > 0 else None


def split_fix(series: list[tuple[dt.date, float]], splits: Sequence[tuple[dt.date, float]]) -> list[tuple[dt.date, float]]:
    """Gewinne vor einem Aktiensplit auf die heutige Aktienzahl umrechnen – nur wenn die Reihe es
    erkennbar braucht (Gewinn springt am Split um etwa den Split-Faktor)."""
    out = list(series)
    for when, r in splits:
        if not r or abs(math.log(r)) < math.log(1.5):
            continue
        before = [abs(v) for d, v in out if d < when][-4:]
        after = [abs(v) for d, v in out if d >= when][:4]
        if not before or not after:
            continue
        mb, ma = sorted(before)[len(before) // 2], sorted(after)[len(after) // 2]
        if ma <= 0 or mb <= 0:
            continue
        jump = mb / ma
        if r / 2.5 <= jump <= r * 2.5:
            out = [(d, v / r if d < when else v) for d, v in out]
    return out


def undo_dividend_adjustment(dates: Sequence[str], closes: Sequence[float], dividends: Sequence[tuple[str, float]]) -> list[float]:
    """Dividendenbereinigte Schlusskurse zurück in gehandelte Kurse (Splits bleiben bereinigt).
    Die Datenquelle multipliziert alle Kurse vor einem Ex-Tag mit (1 − Dividende ÷ Vortageskurs)."""
    divs = sorted(((d[:10], v) for d, v in dividends if v and v > 0), reverse=True)
    out = list(closes)
    factor, k = 1.0, 0
    for i in range(len(dates) - 1, -1, -1):
        while k < len(divs) and dates[i] < divs[k][0]:
            # Kurs am Vortag nur um diese Dividende bereinigt: x = gehandelt − Dividende
            x = closes[i] / factor
            if x > 0:
                factor *= x / (x + divs[k][1])
            k += 1
        out[i] = closes[i] / factor
    return out


def unit_factor(price: Optional[float], eps_ttm: Optional[float], pe_ref: Optional[float],
                eps_fwd: Optional[float] = None, fpe_ref: Optional[float] = None) -> float:
    """Faktor für den Gewinn je Aktie, falls Kurs und Gewinn in verschiedenen Einheiten oder Währungen
    stehen (Pence statt Pfund, Bericht in USD bei Notiz in EUR …). Bezug ist das KGV der Datenquelle."""
    for e, ref in ((eps_ttm, pe_ref), (eps_fwd, fpe_ref)):
        if price and e and ref and e > 0 and ref > 0:
            k = (price / e) / ref
            return k if abs(math.log(k)) > math.log(1.3) else 1.0
    return 1.0


# --- Firma --------------------------------------------------------------------------------------


@dataclass
class CompanyVal:
    ticker: str
    name: str
    sector: Optional[str]
    exchange: Optional[str]
    mcap: float  # Börsenwert heute in USD
    s: float  # Gewicht: Börsenwert heute ÷ Kurs heute
    k: float  # Einheiten-/Währungsfaktor für den Gewinn je Aktie
    price_now: float
    dates: list[str]  # Handelstage (gehandelte Kurse in closes)
    closes: list[float]
    eps_cy: dict[int, float]  # Kalenderjahr -> Gewinn je Aktie (berichtet bzw. Konsens)
    est_cy: dict[int, dict[int, float]]  # Schätzjahr -> {0, 7, 30, 60, 90 Tage zurück -> Konsens}
    quarters: list[tuple[dt.date, float]]
    annual: list[tuple[dt.date, float]]
    up30: int = 0
    down30: int = 0
    analysts: int = 0
    notes: list[str] = field(default_factory=list)

    def price_at(self, day: str) -> Optional[float]:
        """Letzter Kurs bis einschließlich ``day``."""
        i = bisect.bisect_right(self.dates, day) - 1
        return self.closes[i] if i >= 0 else None

    def year_end(self, year: int) -> Optional[float]:
        i = bisect.bisect_right(self.dates, f"{year}-12-31") - 1
        if i < 0 or self.dates[i] < f"{year}-12-01":
            return None
        return self.closes[i]

    def ttm(self, when: dt.date) -> Optional[float]:
        """Gewinn je Aktie der letzten zwölf Monate, wie er an ``when`` bekannt war."""
        cache = self.__dict__.setdefault("_ttm_cache", {})
        if when not in cache:
            cache[when] = self._ttm(when)
        return cache[when]

    def _ttm(self, when: dt.date) -> Optional[float]:
        known = [(d, v) for d, v in self.quarters if d + dt.timedelta(days=REPORT_LAG) <= when]
        if len(known) >= 4:
            last4 = known[-4:]
            if (when - last4[-1][0]).days <= 200 and (last4[-1][0] - last4[0][0]).days <= 300:
                return sum(v for _, v in last4)
        known_a = [(d, v) for d, v in self.annual if d + dt.timedelta(days=REPORT_LAG) <= when]
        if known_a and (when - known_a[-1][0]).days <= 450:
            return known_a[-1][1]
        return None


def company_val(inp: ValInputs, mcap_usd: float, dates: Sequence[str], closes: Sequence[float],
                today: dt.date, dividends: Sequence[tuple[str, float]] = (), splits: Sequence[tuple[str, str]] = (),
                prices_adjusted: bool = True, years_back: int = 6) -> Optional[CompanyVal]:
    pairs = [(d, c) for d, c in zip(dates, closes) if c]
    if not pairs or not mcap_usd or mcap_usd <= 0:
        return None
    ds = [d[:10] for d, _ in pairs]
    cs = [c for _, c in pairs]
    if prices_adjusted and dividends:
        cs = undo_dividend_adjustment(ds, cs, dividends)
    split_list = [(dt.date.fromisoformat(d[:10]), r) for d, txt in splits if (r := split_ratio(txt))]
    quarters = split_fix(inp.quarters, split_list)
    annual = split_fix(inp.annual, split_list)
    inp2 = ValInputs(**{**inp.__dict__, "quarters": quarters, "annual": annual})
    price_now = cs[-1]

    y0 = today.year
    actual = fy_values(inp2, with_estimates=False)
    eps_cy: dict[int, float] = {}
    for y in range(y0 - years_back, y0):
        v = calendarize(actual, y)
        if v is not None:
            eps_cy[y] = v
    est_cy: dict[int, dict[int, float]] = {}
    for y in (y0, y0 + 1):
        lags: dict[int, float] = {}
        for lag in (0, *LAGS):
            v = calendarize(fy_values(inp2, lag), y)
            if v is not None:
                lags[lag] = v
        if 0 in lags:
            est_cy[y] = lags
            eps_cy[y] = lags[0]

    tmp = CompanyVal(inp.ticker, inp.name, inp.sector, inp.exchange, mcap_usd, mcap_usd / price_now, 1.0, price_now,
                     ds, cs, eps_cy, est_cy, quarters, annual)
    eps_ttm = tmp.ttm(today)
    eps_fwd = est_cy.get(y0 + 1, {}).get(0)
    tmp.k = unit_factor(price_now, eps_ttm, inp.pe_ref, eps_fwd, inp.forward_pe_ref)
    if tmp.k != 1.0:
        tmp.notes.append(f"Einheit/Währung des Gewinns angeglichen (Faktor {tmp.k:.3g})")
    nxt = next((e for e in inp.estimates if e.period == "+1y"), None) or next(iter(inp.estimates), None)
    if isinstance(nxt, Estimate):
        tmp.up30, tmp.down30, tmp.analysts = nxt.up30, nxt.down30, nxt.analysts or 0
    return tmp


# --- Gruppe -------------------------------------------------------------------------------------


def _ratio(num: float, den: float) -> Optional[float]:
    return num / den if den > 0 else None


def month_ends(today: dt.date, years: int = 10) -> list[dt.date]:
    out = []
    y, m = today.year - years, today.month
    while (y, m) < (today.year, today.month):
        nxt = dt.date(y + (m // 12), m % 12 + 1, 1)
        out.append(nxt - dt.timedelta(days=1))
        y, m = nxt.year, nxt.month
    out.append(today)
    return out


@dataclass
class GroupVal:
    n: int
    pe_years: dict[int, Optional[float]]  # frühere Jahre (tatsächlich) und Schätzjahre
    negative_years: list[int]
    coverage: dict[int, int]
    pe_ttm: Optional[float]
    monthly: list[tuple[str, Optional[float]]]  # Monatsende -> KGV (letzte zwölf Monate)
    avg: Optional[float]
    low: Optional[float]
    high: Optional[float]
    position: Optional[float]  # 0 = so günstig wie nie im Zeitraum, 1 = so teuer wie nie
    chg12m: Optional[float]  # Veränderung des KGV in zwölf Monaten (Punkte)
    growth_next: Optional[float]  # Gewinnwachstum nächstes Jahr ggü. laufendem (Anteil)
    revisions: dict[int, Optional[float]]  # Tage zurück -> Veränderung des Konsenses fürs nächste Jahr (Anteil)
    forward_path: list[tuple[str, Optional[float]]]  # KGV aufs nächste Jahr vor 90/60/30/7/0 Tagen
    up30: int
    down30: int
    dist52: Optional[float]  # Abstand zum 52-Wochen-Hoch (Anteil, ≤ 0)
    decomposition: dict[str, dict[str, Optional[float]]]  # 1J/3J/5J: Kurs, Gewinn, KGV (Anteile)


def aggregate(cs: Sequence[CompanyVal], today: dt.date, years_back: int = 5) -> GroupVal:
    y0 = today.year
    years = list(range(y0 - years_back, y0 + 2))
    pe_years: dict[int, Optional[float]] = {}
    coverage: dict[int, int] = {}
    negative: list[int] = []
    for y in years:
        num = den = 0.0
        n = 0
        for c in cs:
            e = c.eps_cy.get(y)
            p = c.year_end(y) if y < y0 else c.price_now
            if e is None or p is None:
                continue
            num += c.s * p
            den += c.s * c.k * e
            n += 1
        coverage[y] = n
        pe_years[y] = _ratio(num, den) if n else None
        if n and den <= 0:
            negative.append(y)

    def pe_at(when: dt.date) -> Optional[float]:
        num = den = 0.0
        day = when.isoformat()
        for c in cs:
            e, p = c.ttm(when), c.price_at(day)
            if e is None or p is None:
                continue
            num += c.s * p
            den += c.s * c.k * e
        return _ratio(num, den) if den else None

    monthly = [(d.isoformat(), pe_at(d)) for d in month_ends(today)]
    vals = [v for _, v in monthly if v is not None and v > 0]
    pe_ttm = monthly[-1][1]
    avg = sum(vals) / len(vals) if vals else None
    low, high = (min(vals), max(vals)) if vals else (None, None)
    position = None
    if pe_ttm is not None and vals and len(vals) >= 12:
        position = sum(1 for v in vals if v <= pe_ttm) / len(vals)
    year_ago = next((v for d, v in reversed(monthly) if d <= (today - dt.timedelta(days=365)).isoformat()), None)
    chg12m = pe_ttm - year_ago if pe_ttm is not None and year_ago is not None else None

    # Konsens fürs nächste Jahr: Veränderung und Verlauf des KGV darauf (nur Firmen mit allen Werten)
    y1 = y0 + 1
    with_all = [c for c in cs if all(l in c.est_cy.get(y1, {}) for l in (0, *LAGS))]
    revisions: dict[int, Optional[float]] = {}
    forward_path: list[tuple[str, Optional[float]]] = []
    e_now = sum(c.s * c.k * c.est_cy[y1][0] for c in with_all)
    for lag in LAGS:
        e_then = sum(c.s * c.k * c.est_cy[y1][lag] for c in with_all)
        revisions[lag] = e_now / e_then - 1 if with_all and e_then > 0 and e_now > 0 else None
    for lag in (90, 60, 30, 7, 0):
        day = (today - dt.timedelta(days=lag)).isoformat()
        num = den = 0.0
        for c in with_all:
            p = c.price_at(day)
            if p is None:
                continue
            num += c.s * p
            den += c.s * c.k * c.est_cy[y1][lag]
        forward_path.append((day, _ratio(num, den) if with_all else None))

    both = [c for c in cs if y0 in c.eps_cy and y1 in c.eps_cy]
    e0 = sum(c.s * c.k * c.eps_cy[y0] for c in both)
    e1 = sum(c.s * c.k * c.eps_cy[y1] for c in both)
    growth = e1 / e0 - 1 if both and e0 > 0 else None

    # Abstand zum 52-Wochen-Hoch des Gruppenindex (Börsenwert aller Firmen)
    start = (today - dt.timedelta(days=365)).isoformat()
    days = sorted({d for c in cs for d in c.dates if d >= start})
    full = [c for c in cs if c.dates and c.dates[0] <= start]
    index = [sum(c.s * (c.price_at(d) or 0) for c in full) for d in days] if full else []
    dist52 = index[-1] / max(index) - 1 if index and max(index) > 0 else None

    decomposition: dict[str, dict[str, Optional[float]]] = {}
    for label, yrs in (("1J", 1), ("3J", 3), ("5J", 5)):
        then = today - dt.timedelta(days=round(365.25 * yrs))
        p_now = p_then = e_n = e_t = 0.0
        for c in cs:
            a, b = c.price_at(today.isoformat()), c.price_at(then.isoformat())
            ea, eb = c.ttm(today), c.ttm(then)
            if None in (a, b, ea, eb):
                continue
            p_now += c.s * a
            p_then += c.s * b
            e_n += c.s * c.k * ea
            e_t += c.s * c.k * eb
        if p_then > 0 and e_t > 0 and e_n > 0:
            pc, ec = p_now / p_then - 1, e_n / e_t - 1
            decomposition[label] = {"price": pc, "earnings": ec, "pe": (1 + pc) / (1 + ec) - 1}
        else:
            decomposition[label] = {"price": None, "earnings": None, "pe": None}

    return GroupVal(
        n=len(cs), pe_years=pe_years, negative_years=negative, coverage=coverage, pe_ttm=pe_ttm, monthly=monthly,
        avg=avg, low=low, high=high, position=position, chg12m=chg12m, growth_next=growth, revisions=revisions,
        forward_path=forward_path, up30=sum(c.up30 for c in cs), down30=sum(c.down30 for c in cs), dist52=dist52,
        decomposition=decomposition,
    )
