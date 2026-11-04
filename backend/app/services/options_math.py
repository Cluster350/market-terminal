"""Black-Scholes-Formeln (europäisch, mit Dividendenrendite) und Barone-Adesi/Whaley (amerikanisch) für Demo-Ketten und Kennzahlen."""

from __future__ import annotations

import math
from typing import Optional


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


# --- Amerikanische Optionen (US-Aktienoptionen) -----------------------------------------
# Näherung nach Barone-Adesi/Whaley (1987): europäischer Preis plus Prämie für vorzeitige
# Ausübung. Puts (bei positivem Zins) und Calls (bei Dividende) sind damit nie weniger wert
# als ihr innerer Wert, und ihr Theta ist nicht positiv wie bei tief im Geld liegenden
# europäischen Puts.


def _critical(kind: str, k: float, t: float, r: float, q: float, iv: float) -> Optional[tuple[float, float, float]]:
    """Kritischer Kurs S*, Exponent und Faktor A; None, wenn vorzeitige Ausübung nie lohnt."""
    if t <= 0 or iv <= 0:
        return None
    if kind == "call" and q <= 0:
        return None
    if kind == "put" and r <= 0:
        return None
    b = r - q
    v2 = iv * iv
    big_m, big_n = 2 * r / v2, 2 * b / v2
    kk = -math.expm1(-r * t)  # 1 − e^(−rT), stabil auch für kleine rT
    if kk <= 0:
        return None
    root = math.sqrt((big_n - 1) ** 2 + 4 * big_m / kk)
    dq, vt = math.exp(-q * t), iv * math.sqrt(t)
    if kind == "call":
        qe = (-(big_n - 1) + root) / 2
        q_inf = (-(big_n - 1) + math.sqrt((big_n - 1) ** 2 + 4 * big_m)) / 2
        s_inf = k / (1 - 1 / q_inf)
        si = k + (s_inf - k) * (1 - math.exp(-(b * t + 2 * vt) * k / (s_inf - k)))
    else:
        qe = (-(big_n - 1) - root) / 2
        q_inf = (-(big_n - 1) - math.sqrt((big_n - 1) ** 2 + 4 * big_m)) / 2
        s_inf = k / (1 - 1 / q_inf)
        si = s_inf + (k - s_inf) * math.exp((b * t - 2 * vt) * k / (k - s_inf))
    for _ in range(60):
        si = max(si, 1e-8)
        d1 = d1_d2(si, k, t, r, q, iv)[0]
        if kind == "call":
            rhs = price("call", si, k, t, r, q, iv) + (1 - dq * norm_cdf(d1)) * si / qe
            lhs = si - k
            slope = dq * norm_cdf(d1) * (1 - 1 / qe) + (1 - dq * norm_pdf(d1) / vt) / qe
            nxt = (k + rhs - slope * si) / (1 - slope)
        else:
            rhs = price("put", si, k, t, r, q, iv) - (1 - dq * norm_cdf(-d1)) * si / qe
            lhs = k - si
            slope = -dq * norm_cdf(-d1) * (1 - 1 / qe) - (1 + dq * norm_pdf(-d1) / vt) / qe
            nxt = (k - rhs + slope * si) / (1 + slope)
        if abs(lhs - rhs) / k < 1e-9 or not math.isfinite(nxt) or nxt <= 0:
            break
        si = nxt
    d1 = d1_d2(si, k, t, r, q, iv)[0]
    a = (si / qe) * (1 - dq * norm_cdf(d1)) if kind == "call" else -(si / qe) * (1 - dq * norm_cdf(-d1))
    return si, qe, a


def _american_with(crit: Optional[tuple[float, float, float]], kind: str, s: float, k: float, t: float, r: float, q: float, iv: float) -> float:
    euro = price(kind, s, k, t, r, q, iv)
    intrinsic = max(0.0, s - k) if kind == "call" else max(0.0, k - s)
    if crit is None:
        return max(euro, intrinsic) if t <= 0 or iv <= 0 else euro
    s_star, qe, a = crit
    if kind == "call":
        val = euro + a * (s / s_star) ** qe if s < s_star else s - k
    else:
        val = euro + a * (s / s_star) ** qe if s > s_star else k - s
    return max(val, intrinsic, euro)


def american_price(kind: str, s: float, k: float, t: float, r: float, q: float, iv: float) -> float:
    """Preis einer amerikanischen Option (Barone-Adesi/Whaley)."""
    return _american_with(_critical(kind, k, t, r, q, iv), kind, s, k, t, r, q, iv)


def american_greeks(kind: str, s: float, k: float, t: float, r: float, q: float, iv: float) -> dict[str, float]:
    """Greeks der amerikanischen Option über Differenzen; gleiche Einheiten wie greeks()."""
    if t <= 0 or iv <= 0:
        return greeks(kind, s, k, t, r, q, iv)
    crit = _critical(kind, k, t, r, q, iv)
    h = max(s * 1e-3, 1e-4)
    p0 = _american_with(crit, kind, s, k, t, r, q, iv)
    up, dn = _american_with(crit, kind, s + h, k, t, r, q, iv), _american_with(crit, kind, s - h, k, t, r, q, iv)
    day = 1 / 365
    p_tomorrow = american_price(kind, s, k, max(t - day, 0.0), r, q, iv)
    dv = min(0.01, iv / 2)
    vega = (american_price(kind, s, k, t, r, q, iv + dv) - american_price(kind, s, k, t, r, q, iv - dv)) / (2 * dv) / 100
    dr = 1e-4
    rho = (american_price(kind, s, k, t, r + dr, q, iv) - american_price(kind, s, k, t, r - dr, q, iv)) / (2 * dr) / 100
    return {
        "delta": (up - dn) / (2 * h),
        "gamma": max(0.0, (up - 2 * p0 + dn) / (h * h)),
        "theta": min(0.0, p_tomorrow - p0),  # je Kalendertag; amerikanische Optionen verlieren mit der Zeit nur an Wert
        "vega": vega,
        "rho": rho,
    }
