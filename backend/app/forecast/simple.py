"""Eingebaute Statistik-Prognose ohne Zusatzpakete: gedämpfter Trend (Holt) mit Bändern aus den
eigenen Fehlern der Vergangenheit.

Gedacht als verlässliche Grundlage, die immer verfügbar ist, und als Vergleich für Chronos-2.
Die Bänder sind empirisch: Für jede Vorlaufzeit (1, 2, … Schritte) wird gemessen, wie weit die
Methode in der Vergangenheit danebenlag; deren Quantile ergeben die Bänder.
"""

from __future__ import annotations

import math
from typing import Sequence

from .base import LEVELS, quantile

ALPHAS = (0.1, 0.2, 0.3, 0.5, 0.7, 0.9, 1.0)
BETAS = (0.0, 0.05, 0.15, 0.3)
PHIS = (0.8, 0.9, 0.98)
MIN_ERRORS = 8  # weniger beobachtete Fehler je Vorlaufzeit: Normalverteilung statt empirischer Quantile


def _run(y: Sequence[float], a: float, b: float, phi: float) -> tuple[float, float, float]:
    """Glättung über die ganze Reihe; liefert (Niveau, Trend, Summe der quadrierten 1-Schritt-Fehler)."""
    level = y[0]
    trend = (y[1] - y[0]) if b and len(y) > 1 else 0.0  # ohne beta: einfache Glättung ohne Trend
    sse = 0.0
    for x in y[1:]:
        pred = level + phi * trend
        err = x - pred
        sse += err * err
        new_level = pred + a * err
        if b:
            trend = phi * trend + b * (new_level - level - phi * trend)
        level = new_level
    return level, trend, sse


def fit(y: Sequence[float]) -> tuple[float, float, float]:
    """Parameter (alpha, beta, phi) mit dem kleinsten 1-Schritt-Fehler auf der Reihe."""
    best = (0.5, 0.0, 0.9)
    best_sse = math.inf
    for a in ALPHAS:
        for b in BETAS:
            for phi in PHIS if b else (0.9,):
                _, _, sse = _run(y, a, b, phi)
                if sse < best_sse - 1e-12:
                    best, best_sse = (a, b, phi), sse
    return best


def point(y: Sequence[float], h: int, params: tuple[float, float, float]) -> list[float]:
    a, b, phi = params
    level, trend, _ = _run(y, a, b, phi)
    out, damp = [], 0.0
    for k in range(1, h + 1):
        damp += phi**k
        out.append(level + damp * trend)
    return out


def predict_one(y: Sequence[float], h: int) -> list[list[float]]:
    """Quantile (Zeilen: Schritte 1…h, Spalten: LEVELS) für eine Reihe."""
    y = [float(x) for x in y]
    if not y:
        raise ValueError("leere Reihe")
    if len(y) < 3:
        last = y[-1]
        spread = abs(last) * 0.1 or 1.0
        return [[last + spread * math.sqrt(k) * z for z in _Z] for k in range(1, h + 1)]
    params = fit(y)
    center = point(y, h, params)
    # Fehler der Methode in der Vergangenheit (feste Parameter, rollierender Startpunkt)
    errors: list[list[float]] = [[] for _ in range(h)]
    start = max(3, len(y) // 3)
    for o in range(start, len(y)):
        fc = point(y[:o], min(h, len(y) - o), params)
        for k, f in enumerate(fc):
            errors[k].append(y[o + k] - f)
    one_step = errors[0] if errors and errors[0] else [0.0]
    sigma1 = math.sqrt(sum(e * e for e in one_step) / max(len(one_step), 1)) or (abs(y[-1]) * 0.05 or 1.0)
    rows: list[list[float]] = []
    prev_lo, prev_hi = 0.0, 0.0
    for k in range(h):
        e = errors[k]
        if len(e) >= MIN_ERRORS:
            # Fehler um ihren Median zentrieren: der Mittelpunkt bleibt die Punktprognose
            med = quantile(e, 0.5)
            offs = [quantile(e, lv) - med for lv in LEVELS]
        else:
            offs = [sigma1 * math.sqrt(k + 1) * z for z in _Z]
        # Bänder werden mit der Vorlaufzeit nicht schmaler
        lo = min(offs[0], prev_lo)
        hi = max(offs[-1], prev_hi)
        scale_lo = lo / offs[0] if offs[0] < 0 else 1.0
        scale_hi = hi / offs[-1] if offs[-1] > 0 else 1.0
        offs = [o * (scale_lo if o < 0 else scale_hi) for o in offs]
        prev_lo, prev_hi = lo, hi
        rows.append([center[k] + o for o in offs])
    return rows


# Standardnormal-Quantile zu LEVELS (0.1, 0.25, 0.5, 0.75, 0.9)
_Z = (-1.2815515655446004, -0.6744897501960817, 0.0, 0.6744897501960817, 1.2815515655446004)


class SimpleEngine:
    name = "simple"
    label = "Statistik (gedämpfter Trend)"

    def ready(self) -> bool:
        return True

    def predict(self, series: list[list[float]], h: int) -> list[list[list[float]]]:
        return [predict_one(s, h) for s in series]
