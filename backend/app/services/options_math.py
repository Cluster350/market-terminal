"""Black-Scholes-Formeln (europäisch, mit Dividendenrendite) für Demo-Ketten und Kennzahlen."""

from __future__ import annotations

import math


def norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def norm_pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def d1_d2(s: float, k: float, t: float, r: float, q: float, iv: float) -> tuple[float, float]:
    v = iv * math.sqrt(t)
    d1 = (math.log(s / k) + (r - q + 0.5 * iv * iv) * t) / v
    return d1, d1 - v


def price(kind: str, s: float, k: float, t: float, r: float, q: float, iv: float) -> float:
    """Optionspreis; kind = "call" oder "put". Zinsen und Volatilität als Dezimalzahl (0.04)."""
    if t <= 0 or iv <= 0:
        return max(0.0, s - k) if kind == "call" else max(0.0, k - s)
    d1, d2 = d1_d2(s, k, t, r, q, iv)
    if kind == "call":
        return s * math.exp(-q * t) * norm_cdf(d1) - k * math.exp(-r * t) * norm_cdf(d2)
    return k * math.exp(-r * t) * norm_cdf(-d2) - s * math.exp(-q * t) * norm_cdf(-d1)


def greeks(kind: str, s: float, k: float, t: float, r: float, q: float, iv: float) -> dict[str, float]:
    """Delta, Gamma, Theta (je Kalendertag), Vega (je Volatilitätspunkt), Rho (je Prozentpunkt)."""
    if t <= 0 or iv <= 0:
        itm = (s > k) if kind == "call" else (s < k)
        return {"delta": (1.0 if itm else 0.0) * (1 if kind == "call" else -1), "gamma": 0.0, "theta": 0.0, "vega": 0.0, "rho": 0.0}
    d1, d2 = d1_d2(s, k, t, r, q, iv)
    dq, dr = math.exp(-q * t), math.exp(-r * t)
    gamma = dq * norm_pdf(d1) / (s * iv * math.sqrt(t))
    vega = s * dq * norm_pdf(d1) * math.sqrt(t) / 100
    common = -s * dq * norm_pdf(d1) * iv / (2 * math.sqrt(t))
    if kind == "call":
        delta = dq * norm_cdf(d1)
        theta = common - r * k * dr * norm_cdf(d2) + q * s * dq * norm_cdf(d1)
        rho = k * t * dr * norm_cdf(d2) / 100
    else:
        delta = -dq * norm_cdf(-d1)
        theta = common + r * k * dr * norm_cdf(-d2) - q * s * dq * norm_cdf(-d1)
        rho = -k * t * dr * norm_cdf(-d2) / 100
    return {"delta": delta, "gamma": gamma, "theta": theta / 365, "vega": vega, "rho": rho}
