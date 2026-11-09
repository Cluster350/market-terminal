"""Rechenkern der Kryptoübersicht: Renditen, Schwankung, Korrelation, Abstand zum Hoch.

Kryptowährungen handeln täglich rund um die Uhr; Schwankungen werden deshalb mit 365 Tagen
hochgerechnet (Aktien: 252 Handelstage). Alle Fenster schauen auf Kalendertage.
"""

from __future__ import annotations

import datetime as dt
import math
from typing import Optional, Sequence

DAYS_PER_YEAR = 365


def pairs(dates: Sequence[str], values: Sequence[Optional[float]]) -> list[tuple[str, float]]:
    return [(d[:10], float(v)) for d, v in zip(dates, values) if v is not None and v > 0]


def window(pts: Sequence[tuple[str, float]], days: int) -> list[tuple[str, float]]:
    """Punkte der letzten ``days`` Kalendertage (ab dem letzten Datum gerechnet, inklusive Ausgangspunkt)."""
    if not pts:
        return []
    start = (dt.date.fromisoformat(pts[-1][0]) - dt.timedelta(days=days)).isoformat()
    return [p for p in pts if p[0] >= start]


def log_returns(pts: Sequence[tuple[str, float]]) -> dict[str, float]:
    """Tagesrendite (log) je Datum."""
    return {pts[i][0]: math.log(pts[i][1] / pts[i - 1][1]) for i in range(1, len(pts))}


def vol(pts: Sequence[tuple[str, float]], days: int = 30, per_year: int = DAYS_PER_YEAR) -> Optional[float]:
    """Annualisierte Schwankung der Tagesrenditen der letzten ``days`` Tage, in Prozent."""
    r = list(log_returns(window(pts, days)).values())
    if len(r) < max(5, days // 3):
        return None
    m = sum(r) / len(r)
    var = sum((x - m) ** 2 for x in r) / (len(r) - 1)
    return math.sqrt(var * per_year) * 100


def corr(a: dict[str, float], b: dict[str, float], min_obs: int = 20) -> Optional[float]:
    keys = sorted(set(a) & set(b))
    if len(keys) < min_obs:
        return None
    x = [a[k] for k in keys]
    y = [b[k] for k in keys]
    mx, my = sum(x) / len(x), sum(y) / len(y)
    sxy = sum((p - mx) * (q - my) for p, q in zip(x, y))
    sxx = sum((p - mx) ** 2 for p in x)
    syy = sum((q - my) ** 2 for q in y)
    # praktisch keine Streuung (z. B. gleichbleibende Rendite): keine sinnvolle Korrelation
    return sxy / math.sqrt(sxx * syy) if sxx > 1e-14 and syy > 1e-14 else None


def from_high(pts: Sequence[tuple[str, float]]) -> tuple[Optional[float], Optional[str]]:
    """Abstand des letzten Kurses zum höchsten Schlusskurs der Reihe (Prozent, ≤ 0) und dessen Datum."""
    if not pts:
        return None, None
    d, hi = max(pts, key=lambda p: p[1])
    return (pts[-1][1] / hi - 1) * 100, d


def sma(pts: Sequence[tuple[str, float]], n: int) -> Optional[float]:
    if len(pts) < n:
        return None
    return sum(v for _, v in pts[-n:]) / n


def ffill(grid: Sequence[str], pts: Sequence[tuple[str, float]]) -> list[Optional[float]]:
    """Werte auf ein Datumsraster legen (letzter bekannter Wert; vor dem ersten Wert None)."""
    out: list[Optional[float]] = []
    j, last = 0, None
    for d in grid:
        while j < len(pts) and pts[j][0] <= d:
            last = pts[j][1]
            j += 1
        out.append(last)
    return out


def rolling_corr(a: Sequence[tuple[str, float]], b: Sequence[tuple[str, float]], n: int = 90) -> list[tuple[str, float]]:
    """Gleitende Korrelation der Tagesrenditen an gemeinsamen Tagen (z. B. Bitcoin gegen Nasdaq an
    Börsentagen), Fenster ``n`` gemeinsame Tage."""
    ma = dict(a)
    common = [(d, ma[d], v) for d, v in b if d in ma]
    ra = [math.log(common[i][1] / common[i - 1][1]) for i in range(1, len(common))]
    rb = [math.log(common[i][2] / common[i - 1][2]) for i in range(1, len(common))]
    days = [common[i][0] for i in range(1, len(common))]
    out: list[tuple[str, float]] = []
    for i in range(n - 1, len(ra)):
        x, y = ra[i - n + 1 : i + 1], rb[i - n + 1 : i + 1]
        mx, my = sum(x) / n, sum(y) / n
        sxy = sum((p - mx) * (q - my) for p, q in zip(x, y))
        sxx = sum((p - mx) ** 2 for p in x)
        syy = sum((q - my) ** 2 for q in y)
        if sxx > 0 and syy > 0:
            out.append((days[i], sxy / math.sqrt(sxx * syy)))
    return out
