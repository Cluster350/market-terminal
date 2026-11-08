"""KGV-Bänder („Fair-Value-Bänder“): Welcher Kurs entspräche dem üblichen KGV?

Aus dem eigenen KGV-Verlauf (Monatswerte, Gewinn der letzten zwölf Monate) werden Median sowie die
Bereiche 25–75 % und 10–90 % bestimmt – robuster als Mittelwert ± Standardabweichung, weil einzelne
Extremjahre (Gewinneinbruch) die Bänder nicht verzerren. Die Bänder werden auf die Kursachse
umgerechnet: Kurslinie = Kurs × (Band-KGV ÷ KGV). Nach rechts laufen sie mit dem Analystenkonsens
weiter (Kurs, der beim Band-KGV und dem geschätzten Gewinn des Jahres gälte).

Ehrlichkeitsprüfung: Für jeden früheren Monat wird – nur mit dem bis dahin bekannten Verlauf – geprüft,
ob das KGV im unteren, mittleren oder oberen Bereich lag, und wie sich der Kurs in den folgenden
zwölf Monaten entwickelte. So sieht man, ob die Bänder bei diesem Wert früher etwas taugten.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional, Sequence

LEVELS = {"p10": 0.1, "p25": 0.25, "p50": 0.5, "p75": 0.75, "p90": 0.9}
MIN_POINTS = 24  # Monate mit positivem KGV für Bänder
TEST_MIN_HISTORY = 36  # Monate Vorgeschichte, bevor ein Monat in die Prüfung eingeht
HORIZON = 12  # Monate bis zur Messung der Kursentwicklung


def quantile(xs: Sequence[float], q: float) -> float:
    s = sorted(xs)
    pos = (len(s) - 1) * q
    lo = math.floor(pos)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def percentiles(pes: Sequence[Optional[float]]) -> Optional[dict[str, float]]:
    pos = [p for p in pes if p is not None and p > 0 and math.isfinite(p)]
    if len(pos) < MIN_POINTS:
        return None
    return {k: quantile(pos, q) for k, q in LEVELS.items()}


@dataclass
class Bands:
    t: list[str]
    pe: list[Optional[float]]
    level: list[Optional[float]]  # Kurs (bzw. Index) in der Skala des Charts
    lines: dict[str, list[Optional[float]]]  # p10 … p90 -> Kurslinie je Zeitpunkt
    future_t: list[str]  # heute, Ende laufendes Jahr, Ende nächstes Jahr
    future: dict[str, list[Optional[float]]]
    pct: dict[str, float]  # KGV der Bänder
    pe_now: Optional[float]
    position: Optional[float]  # Anteil der Monate mit KGV ≤ heute
    fair_now: Optional[float]  # Kurs beim Median-KGV auf den heutigen Gewinn
    fair_next: Optional[float]  # Kurs beim Median-KGV auf den Gewinn des letzten Schätzjahres
    fair_year: Optional[int]
    fair_gap: Optional[float]  # fair_next ÷ heutiger Kurs − 1 (> 0: Kurs unter dem fairen Wert)
    test: dict[str, dict[str, Optional[float]]] = field(default_factory=dict)


def band_test(pe: Sequence[Optional[float]], level: Sequence[Optional[float]], horizon: int = HORIZON,
              min_history: int = TEST_MIN_HISTORY) -> dict[str, dict[str, Optional[float]]]:
    """Kursentwicklung in den ``horizon`` Monaten nach einem Stand im unteren (≤ 25 %), mittleren oder
    oberen (≥ 75 %) Bereich – Bereiche jeweils nur aus der Vorgeschichte (kein Blick in die Zukunft).
    Die Zeiträume überlappen sich; die Zahl der Fälle ist daher kleiner als sie aussieht."""
    zones: dict[str, list[float]] = {"unten": [], "mitte": [], "oben": []}
    for m in range(len(pe)):
        if m + horizon >= len(pe):
            break
        p, a, b = pe[m], level[m], level[m + horizon]
        if p is None or p <= 0 or not a or not b:
            continue
        hist = [x for x in pe[: m + 1] if x is not None and x > 0]
        if len(hist) < min_history:
            continue
        lo, hi = quantile(hist, 0.25), quantile(hist, 0.75)
        zone = "oben" if p >= hi else "unten" if p <= lo else "mitte"
        zones[zone].append(b / a - 1)
    out: dict[str, dict[str, Optional[float]]] = {}
    for z, r in zones.items():
        out[z] = {
            "n": float(len(r)),
            "avg": sum(r) / len(r) if r else None,
            "up": sum(1 for x in r if x > 0) / len(r) if r else None,
        }
    return out


def pe_bands(t: Sequence[str], pe: Sequence[Optional[float]], level: Sequence[Optional[float]],
             future: Sequence[tuple[str, Optional[float]]] = ()) -> Optional[Bands]:
    """Bänder aus Monatswerten. ``t``/``pe``/``level``: Monatsenden, der letzte Eintrag ist heute.
    ``future``: (Datum, KGV auf den geschätzten Gewinn dieses Jahres zum heutigen Kurs)."""
    pct = percentiles(pe)
    if not pct or not t:
        return None
    lines = {
        k: [lv * v / p if lv and p is not None and p > 0 else None for lv, p in zip(level, pe)]
        for k, v in pct.items()
    }
    level_now, pe_now = level[-1], pe[-1]
    fut_t: list[str] = []
    fut: dict[str, list[Optional[float]]] = {k: [] for k in pct}
    if level_now and pe_now is not None and pe_now > 0:  # Anschluss am heutigen Stand
        fut_t.append(t[-1])
        for k, v in pct.items():
            fut[k].append(level_now * v / pe_now)
    fair_next = fair_year = None
    for d, pe_e in future:
        if not level_now or pe_e is None or pe_e <= 0 or d <= t[-1]:
            continue
        fut_t.append(d)
        for k, v in pct.items():
            fut[k].append(level_now * v / pe_e)
        fair_next, fair_year = level_now * pct["p50"] / pe_e, int(d[:4])
    pos = [x for x in pe if x is not None and x > 0]
    position = sum(1 for x in pos if x <= pe_now) / len(pos) if pe_now is not None and pe_now > 0 else None
    fair_now = level_now * pct["p50"] / pe_now if level_now and pe_now is not None and pe_now > 0 else None
    fair_gap = fair_next / level_now - 1 if fair_next and level_now else None
    if len(fut_t) < 2:
        fut_t, fut = [], {k: [] for k in pct}
    return Bands(
        t=list(t), pe=list(pe), level=list(level), lines=lines, future_t=fut_t, future=fut, pct=pct,
        pe_now=pe_now, position=position, fair_now=fair_now, fair_next=fair_next, fair_year=fair_year,
        fair_gap=fair_gap, test=band_test(pe, level),
    )
