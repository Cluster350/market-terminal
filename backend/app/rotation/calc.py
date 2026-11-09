"""Rechenkern der relativen Rotation (offene Näherung an Relative Rotation Graphs).

Die Originalformeln (JdK RS-Ratio und RS-Momentum, geschützte Marken von RRG Research) sind nicht
öffentlich. Hier eine nachvollziehbare Näherung auf Wochenbasis:

- relative Stärke  RS = 100 · Kurs ÷ Maßstab, leicht geglättet (EMA über 3 Wochen)
- Trend            100 + z-Wert von RS gegenüber ihren letzten 20 Wochen
  (über 100: die relative Stärke liegt über ihrem eigenen jüngsten Niveau – Trend aufwärts)
- Schwung          100 + z-Wert des Trends gegenüber seinen letzten 10 Wochen
  (über 100: der Trend nimmt gerade zu)

z-Werte machen Werte mit unterschiedlicher Schwankung vergleichbar; begrenzt auf ±4.
Alle Fenster schauen nur zurück – der Rückblick-Test hat keinen Blick in die Zukunft.
"""

from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass, field
from typing import Optional, Sequence

SMOOTH = 3
TREND_WEEKS = 20
MOM_WEEKS = 10
Z_CAP = 4.0
HISTORY_WEEKS = 104  # Wochen für Anzeige und Abspielen
QUADRANTS = ("fuehrend", "schwaecher", "nachzuegler", "erholend")
CLOCKWISE = {("erholend", "fuehrend"), ("fuehrend", "schwaecher"), ("schwaecher", "nachzuegler"), ("nachzuegler", "erholend")}
COUNTER = {(b, a) for a, b in CLOCKWISE}


_WEEK_KEYS: dict[str, str] = {}


def week_key(day: str) -> str:
    """Freitag der Kalenderwoche als Schlüssel (JJJJ-MM-TT). Gemerkt: dieselben Handelstage kommen in jeder
    Kursreihe wieder (Depot, Faktoren, Rotation – zusammen mehrere Hunderttausend Aufrufe je Berechnung)."""
    key = day[:10]
    hit = _WEEK_KEYS.get(key)
    if hit is None:
        d = dt.date.fromisoformat(key)
        hit = (d + dt.timedelta(days=4 - d.weekday())).isoformat()
        if len(_WEEK_KEYS) > 100_000:
            _WEEK_KEYS.clear()
        _WEEK_KEYS[key] = hit
    return hit


def to_weekly(dates: Sequence[str], closes: Sequence[Optional[float]]) -> dict[str, float]:
    """Letzter Schlusskurs je Woche."""
    out: dict[str, float] = {}
    for d, c in zip(dates, closes):
        if c is not None and c > 0 and math.isfinite(c):
            out[week_key(d)] = c
    return out


def ema(xs: Sequence[Optional[float]], n: int) -> list[Optional[float]]:
    a = 2 / (n + 1)
    out: list[Optional[float]] = []
    prev: Optional[float] = None
    for x in xs:
        if x is None:
            out.append(prev)
            continue
        prev = x if prev is None else prev + a * (x - prev)
        out.append(prev)
    return out


def zscore(xs: Sequence[Optional[float]], n: int) -> list[Optional[float]]:
    """100 + z-Wert gegenüber den letzten ``n`` Werten (einschließlich des aktuellen)."""
    out: list[Optional[float]] = []
    last_none = -1  # Index des letzten fehlenden Werts
    for i, x in enumerate(xs):
        if x is None:
            last_none = i
        # erst mit n vorhandenen Werten im Fenster (kürzeres Fenster oder Lücke darin: kein Wert)
        if x is None or i - last_none < n:
            out.append(None)
            continue
        w = xs[i - n + 1: i + 1]
        m = sum(w) / n
        sd = math.sqrt(sum((v - m) ** 2 for v in w) / (n - 1))
        if sd <= 1e-12:
            out.append(100.0)
            continue
        out.append(100 + max(-Z_CAP, min(Z_CAP, (x - m) / sd)))
    return out


def to_daily(dates: Sequence[str], closes: Sequence[Optional[float]]) -> dict[str, float]:
    """Schlusskurs je Tag (JJJJ-MM-TT)."""
    return {d[:10]: c for d, c in zip(dates, closes) if c is not None and c > 0 and math.isfinite(c)}


def rrg_lines(values: Sequence[Optional[float]], bench: Sequence[Optional[float]], smooth_n: int = SMOOTH,
              trend_n: int = TREND_WEEKS, mom_n: int = MOM_WEEKS) -> tuple[list[Optional[float]], list[Optional[float]], list[Optional[float]]]:
    """(relative Stärke, Trend, Schwung) je Zeitpunkt (Woche oder Tag – die Fenster zählen Zeitpunkte)."""
    rs: list[Optional[float]] = [100 * v / b if v and b else None for v, b in zip(values, bench)]
    smooth = ema(rs, smooth_n)
    trend = zscore(smooth, trend_n)
    mom = zscore(trend, mom_n)
    return rs, trend, mom


def quadrant(trend: Optional[float], mom: Optional[float]) -> Optional[str]:
    if trend is None or mom is None:
        return None
    if trend >= 100:
        return "fuehrend" if mom >= 100 else "schwaecher"
    return "erholend" if mom >= 100 else "nachzuegler"


def heading(trend: Sequence[Optional[float]], mom: Sequence[Optional[float]], i: int) -> tuple[Optional[float], Optional[float]]:
    """Richtung (Grad, 0 = nach rechts, 90 = nach oben) und Schrittweite der letzten Woche."""
    if i < 1 or None in (trend[i], mom[i], trend[i - 1], mom[i - 1]):
        return None, None
    dx, dy = trend[i] - trend[i - 1], mom[i] - mom[i - 1]  # type: ignore[operator]
    return (math.degrees(math.atan2(dy, dx)) % 360, math.hypot(dx, dy))


@dataclass
class Series:
    key: str
    label: str
    values: list[Optional[float]]  # wöchentlich, gleiche Wochen wie der Maßstab
    ticker: Optional[str] = None
    extra: dict = field(default_factory=dict)


def backtest(members: Sequence[tuple[list[Optional[float]], list[Optional[float]], list[Optional[float]]]],
             horizons: Sequence[int] = (4, 13)) -> dict:
    """Wie entwickelte sich die relative Stärke nach einem Stand in jedem Feld? Und wie oft lief die
    Rotation im Uhrzeigersinn? Gepoolt über alle Werte; überlappende Zeiträume."""
    stats: dict[str, dict[int, list[float]]] = {q: {h: [] for h in horizons} for q in QUADRANTS}
    cw = ccw = 0
    for rs, trend, mom in members:
        prev_q = None
        for i in range(len(rs)):
            q = quadrant(trend[i], mom[i])
            if q is None or rs[i] is None:
                prev_q = q
                continue
            for h in horizons:
                if i + h < len(rs) and rs[i + h] is not None:
                    stats[q][h].append(rs[i + h] / rs[i] - 1)  # type: ignore[operator]
            if prev_q and q != prev_q:
                cw += (prev_q, q) in CLOCKWISE
                ccw += (prev_q, q) in COUNTER
            prev_q = q
    out: dict = {"quadrants": {}, "clockwise": cw, "counter": ccw,
                 "clockwise_share": cw / (cw + ccw) if cw + ccw else None}
    for q in QUADRANTS:
        out["quadrants"][q] = {
            f"h{h}": {
                "n": len(r), "avg": sum(r) / len(r) if r else None, "up": sum(1 for x in r if x > 0) / len(r) if r else None,
            }
            for h, r in stats[q].items()
        }
    return out
