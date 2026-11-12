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


MIN_X_POINTS = 12  # kürzere Reihen: Einflussgrößen bleiben unberücksichtigt
RIDGE = 0.25  # Stärke der Dämpfung je Beobachtung (schützt bei wenigen Werten vor Zufallstreffern)


def _solve(a: list[list[float]], b: list[float]) -> list[float]:
    """Lineares Gleichungssystem (klein, symmetrisch positiv definit) per Gauß mit Pivotsuche."""
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for i in range(n):
        p = max(range(i, n), key=lambda r: abs(m[r][i]))
        if abs(m[p][i]) < 1e-12:
            return [0.0] * n
        m[i], m[p] = m[p], m[i]
        for r in range(i + 1, n):
            f = m[r][i] / m[i][i]
            for c in range(i, n + 1):
                m[r][c] -= f * m[i][c]
    out = [0.0] * n
    for i in range(n - 1, -1, -1):
        out[i] = (m[i][n] - sum(m[i][c] * out[c] for c in range(i + 1, n))) / m[i][i]
    return out


def _feats(xs: Sequence[Sequence[float]], o: int) -> list[float]:
    """Merkmale am Startpunkt ``o`` (bekannt ist alles bis o−1): je Einflussgröße Niveau und letzte Veränderung."""
    out: list[float] = []
    for x in xs:
        out.append(x[o - 1])
        out.append(x[o - 1] - x[o - 2])
    return out


def predict_one_x(y: Sequence[float], xs: Sequence[Sequence[float]], h: int) -> list[list[float]]:
    """Wie predict_one, dazu Einflussgrößen: Der Fehler des gedämpften Trends in der Vergangenheit wird durch
    die Einflussgrößen erklärt (gedämpfte Regression je Vorlaufzeit) und die Prognose um den erklärten Teil
    verschoben. Die Bänder bleiben die der Grundmethode; der Rückblick-Test kalibriert sie neu."""
    y = [float(v) for v in y]
    rows = predict_one(y, h)
    n = len(y)
    if n < MIN_X_POINTS or not xs:
        return rows
    params = fit(y)
    start = max(3, n // 3)
    origins = list(range(start, n))
    raw = [_feats(xs, o) for o in origins]
    p = len(raw[0])
    mean = [sum(r[j] for r in raw) / len(raw) for j in range(p)]
    sd = [math.sqrt(sum((r[j] - mean[j]) ** 2 for r in raw) / len(raw)) or 1.0 for j in range(p)]
    z = [[(r[j] - mean[j]) / sd[j] for j in range(p)] for r in raw]
    now = [(v - mean[j]) / sd[j] for j, v in enumerate(_feats(xs, n))]
    now = [min(3.0, max(-3.0, v)) for v in now]  # Ausreißer der Einflussgröße nicht blind fortschreiben
    points = [point(y[:o], min(h, n - o), params) for o in origins]
    for k in range(h):
        zs, res = [], []
        for i, o in enumerate(origins):
            if o + k < n:
                zs.append(z[i])
                res.append(y[o + k] - points[i][k])
        m = len(res)
        if m < 2 * p + 4:
            continue
        rmean = sum(res) / m
        lam = RIDGE * m
        a = [[sum(r[i] * r[j] for r in zs) + (lam if i == j else 0.0) for j in range(p)] for i in range(p)]
        b = [sum(r[i] * (e - rmean) for r, e in zip(zs, res)) for i in range(p)]
        w = _solve(a, b)
        adj = sum(wi * v for wi, v in zip(w, now))
        spread = math.sqrt(sum((e - rmean) ** 2 for e in res) / m)
        adj = min(2 * spread, max(-2 * spread, adj))
        rows[k] = [q + adj for q in rows[k]]
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

    def predict_x(self, series: list[list[float]], covs: list[list[list[float]]], h: int) -> list[list[list[float]]]:
        return [predict_one_x(s, cs, h) for s, cs in zip(series, covs)]
