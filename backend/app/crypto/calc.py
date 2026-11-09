"""Rechenkern der Kryptoübersicht: Renditen, Schwankung, Korrelation, Abstand zum Hoch.

Kryptowährungen handeln täglich rund um die Uhr; Schwankungen werden deshalb mit 365 Tagen
hochgerechnet (Aktien: 252 Handelstage). Alle Fenster schauen auf Kalendertage.
"""

from __future__ import annotations

import datetime as dt
import math
from typing import Optional, Sequence

from ..models import Quote

DAYS_PER_YEAR = 365


def pairs(dates: Sequence[str], values: Sequence[Optional[float]]) -> list[tuple[str, float]]:
    return [(d[:10], float(v)) for d, v in zip(dates, values) if v is not None and v > 0]


def with_quote(pts: list[tuple[str, float]], q: Optional[Quote]) -> list[tuple[str, float]]:
    """Laufenden Kurs an die Tagesreihe hängen (bzw. den heutigen Schluss ersetzen)."""
    if not q or q.last is None or q.last <= 0 or not pts:
        return pts
    day = (q.timestamp or "")[:10]
    if not day or day < pts[-1][0]:
        return pts
    if day == pts[-1][0]:
        return pts[:-1] + [(day, q.last)]
    return pts + [(day, q.last)]


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


def rolling_corr(a: Sequence[tuple[str, float]], b: Sequence[tuple[str, float]], n: int = 90,
                 start: Optional[str] = None, memo: Optional[dict] = None) -> list[tuple[str, float]]:
    """Gleitende Korrelation der Tagesrenditen an gemeinsamen Tagen (z. B. Bitcoin gegen Nasdaq an
    Börsentagen), Fenster ``n`` gemeinsame Tage. ``start``: nur Fenster, die an oder nach diesem Tag
    enden (frühere werden gar nicht erst gerechnet – die Fenster sind der teure Teil).

    ``memo``: Zwischenspeicher für wiederholte Aufrufe mit denselben Reihen (je Reihenpaar ein eigenes
    dict). Ändert sich seit dem letzten Aufruf nur der letzte gemeinsame Tag (laufender Kurs), wird nur das
    letzte Fenster neu gerechnet – alle früheren hängen nicht von ihm ab."""
    ma = dict(a)
    common = [(d, ma[d], v) for d, v in b if d in ma]
    ra = [math.log(common[i][1] / common[i - 1][1]) for i in range(1, len(common))]
    rb = [math.log(common[i][2] / common[i - 1][2]) for i in range(1, len(common))]
    days = [common[i][0] for i in range(1, len(common))]
    last = len(ra) - 1  # Index des letzten Fensters

    def one(i: int) -> Optional[tuple[str, float]]:
        if start is not None and days[i] < start:
            return None
        x, y = ra[i - n + 1 : i + 1], rb[i - n + 1 : i + 1]
        mx, my = sum(x) / n, sum(y) / n
        sxy = sum((p - mx) * (q - my) for p, q in zip(x, y))
        sxx = sum((p - mx) ** 2 for p in x)
        syy = sum((q - my) ** 2 for q in y)
        return (days[i], sxy / math.sqrt(sxx * syy)) if sxx > 0 and syy > 0 else None

    prev = memo.get("common") if memo is not None and memo.get("args") == (n, start) else None
    if prev is not None and len(prev) == len(common) and prev[:-1] == common[:-1]:
        head = memo["head"]  # type: ignore[index]
    else:
        head = [w for i in range(n - 1, last) if (w := one(i)) is not None]
    if memo is not None:
        memo.update(args=(n, start), common=common, head=head)
    tail = one(last) if last >= n - 1 else None
    return head + [tail] if tail is not None else list(head)


def change_24h(bars: Sequence[tuple[int, float, float, float]], now_ts: float, last: Optional[float] = None,
               tolerance: int = 3 * 3600) -> tuple[Optional[float], Optional[float], Optional[float], Optional[float]]:
    """Veränderung über die letzten 24 Stunden aus Intraday-Balken (Start-Zeitstempel, Hoch, Tief, Schluss):
    Bezug ist der Schluss des Balkens, in dem „jetzt minus 24 Stunden“ liegt. Gibt (Veränderung in Prozent,
    Bezugskurs, Hoch, Tief der 24 Stunden) zurück; None, wenn um diese Zeit kein Kurs vorliegt (z. B. Lücke)."""
    if not bars:
        return None, None, None, None
    target = now_ts - 86400
    before = [b for b in bars if b[0] <= target]
    if not before or target - before[-1][0] > tolerance:
        return None, None, None, None
    ref = before[-1][3]
    window = [b for b in bars if b[0] > target]
    cur = last if last is not None else (window[-1][3] if window else None)
    highs = [b[1] for b in window] + ([cur] if cur is not None else [])
    lows = [b[2] for b in window] + ([cur] if cur is not None else [])
    chg = (cur / ref - 1) * 100 if cur is not None and ref else None
    return chg, ref, (max(highs) if highs else None), (min(lows) if lows else None)
