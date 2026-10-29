"""Kennzahlen aus Kurszeitreihen (Performance, Volatilität, RSI, 52W)."""

from __future__ import annotations

import datetime as dt
import math
from typing import Optional, Sequence

from .util import pct

TRADING_DAYS = {"1w": 5, "1m": 21, "3m": 63, "6m": 126, "12m": 252}


def _clean(values: Sequence[Optional[float]]) -> list[float]:
    return [v for v in values if v is not None]


def perf(closes: Sequence[Optional[float]], days: int) -> Optional[float]:
    vals = _clean(closes)
    if len(vals) <= days:
        return None
    return pct(vals[-1], vals[-1 - days])


def perf_ytd(dates: Sequence[str], closes: Sequence[Optional[float]], today: Optional[dt.date] = None) -> Optional[float]:
    """Veränderung seit dem letzten Schlusskurs des Vorjahres."""
    if not dates:
        return None
    year = (today or dt.date.fromisoformat(dates[-1][:10])).year
    base: Optional[float] = None
    last: Optional[float] = None
    for d, c in zip(dates, closes):
        if c is None:
            continue
        if int(d[:4]) < year:
            base = c
        last = c
    return pct(last, base)


def annual_vol(closes: Sequence[Optional[float]], window: int = 252) -> Optional[float]:
    vals = _clean(closes)[-(window + 1):]
    if len(vals) < 21:
        return None
    rets = [math.log(b / a) for a, b in zip(vals, vals[1:]) if a > 0 and b > 0]
    if len(rets) < 20:
        return None
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    return math.sqrt(var) * math.sqrt(252) * 100.0


def rsi(closes: Sequence[Optional[float]], period: int = 14) -> Optional[float]:
    """RSI nach Wilder."""
    vals = _clean(closes)
    if len(vals) <= period:
        return None
    gains = losses = 0.0
    for a, b in zip(vals[:period], vals[1 : period + 1]):
        d = b - a
        gains += max(d, 0.0)
        losses += max(-d, 0.0)
    avg_g, avg_l = gains / period, losses / period
    for a, b in zip(vals[period:], vals[period + 1 :]):
        d = b - a
        avg_g = (avg_g * (period - 1) + max(d, 0.0)) / period
        avg_l = (avg_l * (period - 1) + max(-d, 0.0)) / period
    if avg_l == 0:
        return 100.0 if avg_g > 0 else 50.0
    rs = avg_g / avg_l
    return 100.0 - 100.0 / (1.0 + rs)


def sma(closes: Sequence[Optional[float]], n: int) -> Optional[float]:
    vals = _clean(closes)
    if len(vals) < n:
        return None
    return sum(vals[-n:]) / n


def high_low_52w(highs: Sequence[Optional[float]], lows: Sequence[Optional[float]]) -> tuple[Optional[float], Optional[float]]:
    h = _clean(highs[-252:])
    l = _clean(lows[-252:])
    return (max(h) if h else None, min(l) if l else None)


def dist_from_high(closes: Sequence[Optional[float]], highs: Sequence[Optional[float]]) -> Optional[float]:
    vals = _clean(closes)
    hi, _ = high_low_52w(highs, highs)
    if not vals or hi is None:
        return None
    return pct(vals[-1], hi)


def last_n(values: Sequence[Optional[float]], n: int) -> list[float]:
    return [round(v, 6) for v in _clean(values)[-n:]]
