"""Rechenkern der Faktoren: relative Entwicklung gegenüber dem Markt und Regression der Depot-Faktorlast."""

from __future__ import annotations

import math
from typing import Optional, Sequence


def ratio_line(a: Sequence[tuple[str, float]], b: Sequence[tuple[str, float]]) -> list[tuple[str, float]]:
    """Verhältnis a ÷ b an gemeinsamen Tagen (steigt, wenn a besser läuft als b)."""
    mb = dict(b)
    return [(d, v / mb[d]) for d, v in a if d in mb and mb[d]]


def pct_vs_avg(pts: Sequence[tuple[str, float]], n: int = 200) -> Optional[float]:
    """Abstand des letzten Werts zu seinem gleitenden Durchschnitt über n Punkte (Prozent)."""
    if len(pts) < n:
        return None
    avg = sum(v for _, v in pts[-n:]) / n
    return (pts[-1][1] / avg - 1) * 100 if avg else None


def returns(values: Sequence[Optional[float]]) -> list[Optional[float]]:
    """Einfache Renditen; None, wenn ein Wert fehlt."""
    out: list[Optional[float]] = []
    for i in range(1, len(values)):
        a, b = values[i - 1], values[i]
        out.append(b / a - 1 if a and b else None)
    return out


def solve(a: list[list[float]], b: list[float]) -> Optional[list[float]]:
    """Lineares Gleichungssystem (Gauß mit Pivotsuche); None bei (nahezu) singulärer Matrix."""
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(m[r][col]))
        if abs(m[piv][col]) < 1e-12:
            return None
        m[col], m[piv] = m[piv], m[col]
        for r in range(n):
            if r != col and m[r][col]:
                f = m[r][col] / m[col][col]
                for c in range(col, n + 1):
                    m[r][c] -= f * m[col][c]
    return [m[i][n] / m[i][i] for i in range(n)]


def inverse(a: list[list[float]]) -> Optional[list[list[float]]]:
    n = len(a)
    cols = []
    for j in range(n):
        e = [1.0 if i == j else 0.0 for i in range(n)]
        x = solve(a, e)
        if x is None:
            return None
        cols.append(x)
    return [[cols[j][i] for j in range(n)] for i in range(n)]


def ols(y: Sequence[float], xs: Sequence[Sequence[float]]) -> Optional[dict]:
    """Kleinste Quadrate mit Achsenabschnitt: y = a + Σ b_k·x_k.

    Gibt Koeffizienten (ohne Achsenabschnitt), t-Werte, R² und den Achsenabschnitt zurück.
    """
    n, k = len(y), len(xs)
    if n < k + 10:
        return None
    rows = [[1.0] + [x[i] for x in xs] for i in range(n)]
    p = k + 1
    xtx = [[sum(r[i] * r[j] for r in rows) for j in range(p)] for i in range(p)]
    xty = [sum(r[i] * yy for r, yy in zip(rows, y)) for i in range(p)]
    beta = solve(xtx, xty)
    inv = inverse(xtx)
    if beta is None or inv is None:
        return None
    fitted = [sum(b * v for b, v in zip(beta, r)) for r in rows]
    resid = [yy - f for yy, f in zip(y, fitted)]
    sse = sum(e * e for e in resid)
    my = sum(y) / n
    sst = sum((yy - my) ** 2 for yy in y)
    s2 = sse / (n - p)
    se = [math.sqrt(max(inv[i][i] * s2, 0.0)) for i in range(p)]
    tval = [beta[i] / se[i] if se[i] > 0 else None for i in range(p)]
    return {
        "intercept": beta[0],
        "beta": beta[1:],
        "t": tval[1:],
        "r2": 1 - sse / sst if sst > 0 else None,
        "n": n,
        "resid_vol": math.sqrt(s2),
    }


def corr_matrix(series: Sequence[Sequence[Optional[float]]]) -> list[list[Optional[float]]]:
    """Korrelationen paarweise über die Zeitpunkte, an denen beide Werte vorliegen."""
    def c(a: Sequence[Optional[float]], b: Sequence[Optional[float]]) -> Optional[float]:
        pts = [(x, y) for x, y in zip(a, b) if x is not None and y is not None]
        if len(pts) < 20:
            return None
        mx = sum(x for x, _ in pts) / len(pts)
        my = sum(y for _, y in pts) / len(pts)
        sxy = sum((x - mx) * (y - my) for x, y in pts)
        sxx = sum((x - mx) ** 2 for x, _ in pts)
        syy = sum((y - my) ** 2 for _, y in pts)
        return sxy / math.sqrt(sxx * syy) if sxx > 0 and syy > 0 else None

    return [[1.0 if i == j else c(series[i], series[j]) for j in range(len(series))] for i in range(len(series))]
