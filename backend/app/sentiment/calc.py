"""Rechenkern des Stimmungsterminals (STIM): Marktbreite aus Einzelaktien, gleitende Kennzahlen, Rang im
Vergleich zur eigenen Geschichte (nur Vergangenheit), Gesamtwert und ehrlicher Rückblick nach Episoden.

Alles in reinem Python, Listen gleicher Länge auf einem gemeinsamen Datumsraster (None = kein Wert).
"""

from __future__ import annotations

import bisect
import math
from collections import deque
from dataclasses import dataclass, field
from typing import Optional, Sequence

Series = list[Optional[float]]

MIN_HISTORY = 250  # so viele frühere Werte braucht ein Rang (gut ein Börsenjahr)
FFILL_DAYS = 5  # Lücken (Feiertage einer Börse) höchstens so viele Tage mit dem letzten Kurs füllen


def align(dates: Sequence[str], values: dict[str, float], ffill: int = FFILL_DAYS) -> Series:
    """Werte (Datum -> Wert) auf das Raster bringen; kurze Lücken mit dem letzten Wert füllen, nie mit späteren."""
    out: Series = []
    last: Optional[float] = None
    age = 0
    for d in dates:
        v = values.get(d)
        if v is not None:
            last, age = v, 0
        elif last is not None:
            age += 1
            if age > ffill:
                last = None
        out.append(last if v is None else v)
    return out


def sma(xs: Series, n: int, min_count: Optional[int] = None) -> Series:
    """Gleitender Durchschnitt über n Tage; braucht mindestens min_count Werte im Fenster (Standard: n)."""
    need = n if min_count is None else min_count
    out: Series = []
    win: deque = deque()
    s, k = 0.0, 0
    for x in xs:
        win.append(x)
        if x is not None:
            s += x
            k += 1
        if len(win) > n:
            y = win.popleft()
            if y is not None:
                s -= y
                k -= 1
        out.append(s / k if k >= need and k else None)
    return out


def change(xs: Series, n: int) -> Series:
    """Veränderung in % gegenüber n Tagen vorher."""
    return [(x / xs[i - n] - 1) * 100 if i >= n and x is not None and xs[i - n] else None for i, x in enumerate(xs)]


@dataclass
class Breadth:
    """Tägliche Marktbreite einer Region (Zählungen über die Firmen)."""

    adv: list[int]
    dec: list[int]
    upvol: list[float]
    downvol: list[float]
    above200: list[int]
    n200: list[int]
    highs: list[int]
    lows: list[int]
    n252: list[int]
    vol_sum: list[float]  # Summe der 20-Tage-Schwankungen (Tagesrenditen in %)
    n_vol: list[int]
    sectors: dict[str, tuple[list[int], list[int]]] = field(default_factory=dict)  # Sektor -> (über 200T, mit 200T)


def breadth(n_days: int, firms: Sequence[tuple[str, Series, Series]]) -> Breadth:
    """Marktbreite aus Einzelaktien. firms: (Sektor, Schlusskurse, Volumen) je Firma auf dem Raster."""
    z = lambda: [0] * n_days  # noqa: E731
    b = Breadth(z(), z(), [0.0] * n_days, [0.0] * n_days, z(), z(), z(), z(), z(), [0.0] * n_days, z())
    for sector, c, v in firms:
        sec = b.sectors.setdefault(sector, (z(), z()))
        win200: deque = deque()
        s200 = 0.0
        run = 0  # Tage am Stück mit Kurs
        hi: deque = deque()  # (Index, Kurs) absteigend – gleitendes Maximum der letzten 252 Tage
        lo: deque = deque()
        rets: deque = deque()
        rs = rs2 = 0.0
        prev: Optional[float] = None
        for i in range(n_days):
            x = c[i]
            if x is None or x <= 0:
                win200.clear()
                s200 = 0.0
                run = 0
                hi.clear()
                lo.clear()
                rets.clear()
                rs = rs2 = 0.0
                prev = None
                continue
            if prev is not None:
                if x > prev:
                    b.adv[i] += 1
                    b.upvol[i] += v[i] or 0.0
                elif x < prev:
                    b.dec[i] += 1
                    b.downvol[i] += v[i] or 0.0
                r = math.log(x / prev)
                rets.append(r)
                rs += r
                rs2 += r * r
                if len(rets) > 20:
                    y = rets.popleft()
                    rs -= y
                    rs2 -= y * y
                if len(rets) == 20:
                    var = max(0.0, (rs2 - rs * rs / 20) / 19)
                    b.vol_sum[i] += math.sqrt(var) * 100
                    b.n_vol[i] += 1
            # 52-Wochen-Hoch/-Tief gegen die 252 Tage davor
            while hi and hi[0][0] < i - 252:
                hi.popleft()
            while lo and lo[0][0] < i - 252:
                lo.popleft()
            if run >= 252:
                b.n252[i] += 1
                if x > hi[0][1]:
                    b.highs[i] += 1
                if x < lo[0][1]:
                    b.lows[i] += 1
            while hi and hi[-1][1] <= x:
                hi.pop()
            hi.append((i, x))
            while lo and lo[-1][1] >= x:
                lo.pop()
            lo.append((i, x))
            run += 1
            win200.append(x)
            s200 += x
            if len(win200) > 200:
                s200 -= win200.popleft()
            if len(win200) == 200:
                b.n200[i] += 1
                sec[1][i] += 1
                if x > s200 / 200:
                    b.above200[i] += 1
                    sec[0][i] += 1
            prev = x
    return b


def ratio(num: Sequence[float], den: Sequence[float], scale: float = 100.0, min_den: float = 1) -> Series:
    return [n / d * scale if d >= min_den else None for n, d in zip(num, den)]


def trin(b: Breadth) -> Series:
    """Arms-Index: (steigende / fallende Aktien) / (Volumen steigender / Volumen fallender)."""
    out: Series = []
    for a, d, uv, dv in zip(b.adv, b.dec, b.upvol, b.downvol):
        out.append((a / d) / (uv / dv) if a and d and uv > 0 and dv > 0 else None)
    return out


def expanding_rank(xs: Series, invert: bool = False, min_history: int = MIN_HISTORY) -> Series:
    """Rang 0–100 jedes Werts gegen alle FRÜHEREN Werte (kein Blick in die Zukunft): Anteil kleinerer Werte,
    Gleichstände halb. invert=True dreht die Richtung (hoher Wert = Angst, z. B. VIX)."""
    seen: list[float] = []
    out: Series = []
    for x in xs:
        if x is None or not math.isfinite(x):
            out.append(None)
            continue
        if len(seen) >= min_history:
            lo = bisect.bisect_left(seen, x)
            hi = bisect.bisect_right(seen, x)
            r = (lo + (hi - lo) / 2) / len(seen) * 100
            out.append(100 - r if invert else r)
        else:
            out.append(None)
        bisect.insort(seen, x)
    return out


def combine(ranks: dict[str, Series], keys: Sequence[str], min_share: float = 0.5) -> tuple[Series, list[int]]:
    """Gesamtwert je Tag: Mittel der verfügbaren Ränge (gleich gewichtet). Fehlt mehr als die Hälfte, kein Wert."""
    n = len(next(iter(ranks.values()))) if ranks else 0
    total: Series = []
    count: list[int] = []
    for i in range(n):
        vals = [ranks[k][i] for k in keys if k in ranks and ranks[k][i] is not None]
        count.append(len(vals))
        total.append(sum(vals) / len(vals) if vals and len(vals) >= max(1, math.ceil(len(keys) * min_share)) else None)
    return total, count


WORDS = [(5, "extrem selten so ängstlich"), (20, "ängstlich"), (40, "eher vorsichtig"), (60, "gewöhnlich"),
         (80, "eher zuversichtlich"), (95, "sorglos"), (101, "extrem selten so sorglos")]


def word(rank: Optional[float]) -> str:
    if rank is None:
        return "keine Einordnung"
    return next(w for limit, w in WORDS if rank < limit)


def rank_sentence(rank: Optional[float], since: str) -> str:
    """„niedriger als an 62 von 100 Tagen seit 2015“ – Rang in Worten, ohne Fachbegriff."""
    if rank is None:
        return f"noch zu wenig Verlauf für eine Einordnung (mindestens {MIN_HISTORY} Tage)"
    r = round(rank)
    if r < 50:
        return f"niedriger als an {100 - r} von 100 Tagen seit {since}"
    return f"höher als an {r} von 100 Tagen seit {since}"


def quantile(xs: Sequence[float], q: float) -> float:
    s = sorted(xs)
    pos = (len(s) - 1) * q
    lo = math.floor(pos)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


HORIZONS = ((21, "1 Monat"), (63, "3 Monate"), (126, "6 Monate"))


def backtest(total: Series, prices: Series, today_rank: Optional[float], gap: int = 10) -> dict:
    """Was folgte früher? Episoden im selben Fünftel wie heute (zusammenhängende Phasen zählen einmal, Abstand
    über gap Tage = neue Episode), Kursveränderung danach nach 1/3/6 Monaten – neben „alle Tage“."""
    if today_rank is None:
        return {"state": "wenig", "text": "Noch keine Einordnung – zu wenig Verlauf.", "rows": []}
    band = min(4, int(today_rank // 20))
    lo_b, hi_b = band * 20, band * 20 + 20
    n = len(total)
    starts: list[int] = []
    last = -10_000
    for i, x in enumerate(total[:-1]):
        if x is not None and lo_b <= x < hi_b:
            if i - last > gap:
                starts.append(i)
            last = i

    def fwd(i: int, h: int) -> Optional[float]:
        a, b = prices[i] if i < n else None, prices[i + h] if i + h < n else None
        return (b / a - 1) * 100 if a and b else None

    rows = []
    stats: dict[int, dict] = {}
    for h, label in HORIZONS:
        ep = [r for r in (fwd(i, h) for i in starts) if r is not None]
        al = [r for r in (fwd(i, h) for i in range(n)) if r is not None]
        s = {"h": h, "label": label, "n": len(ep), "nAll": len(al),
             "median": quantile(ep, 0.5) if ep else None, "medianAll": quantile(al, 0.5) if al else None,
             "plus": sum(1 for r in ep if r > 0) / len(ep) * 100 if ep else None,
             "plusAll": sum(1 for r in al if r > 0) / len(al) * 100 if al else None,
             "p10": quantile(ep, 0.1) if len(ep) >= 5 else None, "p90": quantile(ep, 0.9) if len(ep) >= 5 else None,
             "p10All": quantile(al, 0.1) if al else None, "p90All": quantile(al, 0.9) if al else None}
        stats[h] = s
        rows.append(s)
    s3 = stats[63]
    if s3["n"] < 10 or s3["median"] is None or s3["medianAll"] is None:
        state, text = "wenig", f"Zu wenig frühere Episoden in diesem Bereich ({s3['n']}) für eine Aussage."
    else:
        spread = (s3["p90All"] - s3["p10All"]) if s3["p90All"] is not None else 0
        diff = s3["median"] - s3["medianAll"]
        if s3["n"] >= 20 and spread and abs(diff) >= spread / 4:
            state = "deutlich"
            text = "Früher lag der Index nach solchen Phasen deutlich anders als im Durchschnitt aller Tage."
        else:
            state = "schwach"
            text = "Der Unterschied zu allen Tagen ist kleiner als die Streuung – kein verlässliches Muster."
    return {"state": state, "text": text, "band": [lo_b, hi_b], "episodes": len(starts), "rows": rows}
