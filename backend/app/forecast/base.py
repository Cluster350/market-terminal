"""Gemeinsame Bausteine der Prognose: Quantil-Stufen, Quantilfunktion und die Motor-Schnittstelle."""

from __future__ import annotations

import math
from typing import Protocol, Sequence

# Quantile, die jede Prognose liefert: 80 %-Band (0.1–0.9), 50 %-Band (0.25–0.75) und Median
LEVELS: tuple[float, ...] = (0.1, 0.25, 0.5, 0.75, 0.9)


def quantile(xs: Sequence[float], q: float) -> float:
    """Quantil mit linearer Interpolation (wie numpy, Methode „linear“)."""
    s = sorted(xs)
    if not s:
        return math.nan
    pos = (len(s) - 1) * q
    lo = math.floor(pos)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


class Engine(Protocol):
    """Ein Prognosemotor: bekommt Reihen (älteste zuerst) und liefert je Reihe eine Tabelle
    (Zeilen: Schritte 1…h, Spalten: LEVELS)."""

    name: str
    label: str

    def ready(self) -> bool: ...

    def predict(self, series: list[list[float]], h: int) -> list[list[list[float]]]: ...
