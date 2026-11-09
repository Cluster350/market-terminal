"""Kennzahlen aus Kurszeitreihen (Performance, Volatilität, RSI, 52W)."""

from __future__ import annotations

import datetime as dt
import math
from typing import Optional, Sequence

from .util import pct, round_price

TRADING_DAYS = {"1w": 5, "1m": 21, "3m": 63, "6m": 126, "12m": 252}


def _clean(values: Sequence[Optional[float]]) -> list[float]:
    return [v for v in values if v is not None]


def perf(closes: Sequence[Optional[float]], days: int) -> Optional[float]:
    vals = _clean(closes)
    if len(vals) <= days:
        return None
    return pct(vals[-1], vals[-1 - days])


def perf_ytd(dates: Sequence[str], closes: Sequence[Optional[float]], today: Optional[dt.date] = None) -> Optional[float]:
    """Veränderung seit dem letzten Schlusskurs des Vorjahres.

    Mit `today` zählt das laufende Kalenderjahr: Liegt der letzte Kurs noch im Vorjahr
    (1. Januar, Feiertag), ist YTD 0 statt der kompletten Vorjahresperformance.
    """
    if not dates:
        return None
    last_year = int(dates[-1][:4])
    year = max(today.year, last_year) if today else last_year
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
    return [round_price(v) for v in _clean(values)[-n:]]  # Kleinstkurse mit gültigen Stellen


# --- Kalenderbasierte Fenster ------------------------------------------------------
# Börsen haben je nach Land unterschiedlich viele Handelstage (Feiertage). Perioden wie
# 1M, 12M oder 52 Wochen werden deshalb über das Datum bestimmt, nicht über eine feste
# Anzahl von Balken – so stimmen Chart, Beschreibung und Screener überein.


def shift_date(d: dt.date, months: int = 0, days: int = 0) -> dt.date:
    """Datum um Monate (auf Monatsende begrenzt) und Tage zurückverschieben."""
    if months:
        y, m = divmod(d.year * 12 + (d.month - 1) - months, 12)
        m += 1
        last = (dt.date(y + (m == 12), m % 12 + 1, 1) - dt.timedelta(days=1)).day
        d = dt.date(y, m, min(d.day, last))
    return d - dt.timedelta(days=days)


def _pairs(dates: Sequence[str], values: Sequence[Optional[float]]) -> list[tuple[str, float]]:
    return [(d[:10], v) for d, v in zip(dates, values) if v is not None]


def perf_since(
    dates: Sequence[str], closes: Sequence[Optional[float]], *, months: int = 0, days: int = 0
) -> Optional[float]:
    """Veränderung gegenüber dem letzten Schlusskurs am oder vor (letzter Tag − Zeitraum)."""
    pairs = _pairs(dates, closes)
    if len(pairs) < 2:
        return None
    cutoff = shift_date(dt.date.fromisoformat(pairs[-1][0]), months, days).isoformat()
    base: Optional[float] = None
    for d, c in pairs:
        if d > cutoff:
            break
        base = c
    return pct(pairs[-1][1], base)


def window_high_low(
    dates: Sequence[str], highs: Sequence[Optional[float]], lows: Sequence[Optional[float]], days: int = 365
) -> tuple[Optional[float], Optional[float]]:
    """Hoch und Tief der letzten `days` Kalendertage (52 Wochen ≈ 365 Tage)."""
    if not dates:
        return None, None
    start = (dt.date.fromisoformat(dates[-1][:10]) - dt.timedelta(days=days)).isoformat()
    hs = [h for d, h in zip(dates, highs) if h is not None and d[:10] > start]
    ls = [l for d, l in zip(dates, lows) if l is not None and d[:10] > start]
    return (max(hs) if hs else None, min(ls) if ls else None)


def dist_from_high_dated(
    dates: Sequence[str], closes: Sequence[Optional[float]], highs: Sequence[Optional[float]]
) -> Optional[float]:
    vals = _clean(closes)
    hi, _ = window_high_low(dates, highs, highs)
    if not vals or hi is None:
        return None
    return pct(vals[-1], max(hi, vals[-1]))


def annual_vol_dated(dates: Sequence[str], closes: Sequence[Optional[float]], days: int = 365) -> Optional[float]:
    """Annualisierte Volatilität der Tagesrenditen im Kalenderfenster."""
    if not dates:
        return None
    start = (dt.date.fromisoformat(dates[-1][:10]) - dt.timedelta(days=days)).isoformat()
    window = [c for d, c in zip(dates, closes) if c is not None and d[:10] >= start]
    return annual_vol(window, window=len(window))
