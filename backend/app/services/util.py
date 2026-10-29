"""Kleine, defensive Helfer für unsaubere API-Daten."""

from __future__ import annotations

import math
from typing import Any, Optional


def num(value: Any) -> Optional[float]:
    """Wandelt Zahlen und Zahl-Strings in float um; alles andere wird None.

    EODHD liefert Bilanzwerte oft als String ("394328000000.00"), fehlende Werte
    als None, "NA", "" oder "0" (letzteres bleibt 0.0).
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        try:
            f = float(value)
        except OverflowError:  # Ganzzahl jenseits des float-Bereichs (z. B. 10**400)
            return None
    elif isinstance(value, str):
        s = value.strip().replace(",", "")
        if not s or s.upper() in {"NA", "N/A", "NONE", "NULL", "-", "NAN"}:
            return None
        try:
            f = float(s)
        except ValueError:
            return None
    else:
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def integer(value: Any) -> Optional[int]:
    f = num(value)
    return int(f) if f is not None else None


def text(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    if not s or s.upper() in {"NA", "N/A", "NONE", "NULL"}:
        return None
    return s


def round_or_none(value: Optional[float], digits: int = 4) -> Optional[float]:
    return None if value is None else round(value, digits)


def pct(a: Optional[float], b: Optional[float]) -> Optional[float]:
    """Prozentuale Veränderung von b nach a."""
    if a is None or b is None or b == 0:
        return None
    return (a / b - 1.0) * 100.0


def safe_div(a: Optional[float], b: Optional[float]) -> Optional[float]:
    if a is None or b is None or b == 0:
        return None
    return a / b
