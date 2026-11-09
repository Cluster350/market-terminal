"""Rechenkern für den inneren Wert nach Aswath Damodarans veröffentlichter Methode (reine Funktionen, ohne Daten).

- F&E aktivieren (Forschungsvermögen, Abschreibung, bereinigtes EBIT)
- Kapitalkosten aufbauen (risikoloser Zins, Beta ohne Verschuldung → mit Verschuldung, Aktien-Risikoprämie,
  Länderrisiko, synthetisches Rating aus der Zinsdeckung)
- FCFF-DCF mit „Story-Hebeln“ wie in Damodarans Ginzu-Tabelle: Umsatzwachstum, Zielmarge und Jahr der Annäherung,
  Umsatz je eingesetztem Kapital (Reinvestition), Kapitalkosten, Endwachstum ≤ risikoloser Zins, Kapitalrendite im
  Endwert (Annäherung an die Kapitalkosten), optional Ausfallwahrscheinlichkeit
- Rückwärts-DCF („was muss man glauben?“), Simulation (Bandbreite statt Punktwert), Lebenszyklus

Alle Sätze als Anteile (0.05 = 5 %), alle Beträge in der Berichtswährung.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field, replace
from typing import Optional

YEARS = 10


# ---------------------------------------------------------------------------------------------------------------
# F&E aktivieren
# ---------------------------------------------------------------------------------------------------------------


@dataclass
class RDCapital:
    life: int  # Abschreibungsdauer in Jahren
    current: float  # F&E des laufenden Jahres
    asset: float  # nicht abgeschriebener Teil = Forschungsvermögen
    amortization: float  # Abschreibung des laufenden Jahres
    adjustment: float  # Zuschlag zum EBIT: F&E zurück, Abschreibung ab
    history: list[float]  # verwendete Reihe, neueste zuerst (aktuelles Jahr + life frühere)
    estimated: int  # davon fortgeschriebene (geschätzte) Jahre


def capitalize_rd(history: list[float], life: int) -> Optional[RDCapital]:
    """F&E als Investition behandeln (Damodaran): Das laufende Jahr zählt voll zum Forschungsvermögen, ein Jahr altes
    F&E zu (life−1)/life usw.; abgeschrieben werden die früheren Jahrgänge mit je 1/life. Fehlende frühere Jahre werden
    mit der beobachteten Wachstumsrate zurückgerechnet (gekennzeichnet)."""
    vals = [max(0.0, float(v)) for v in history if v is not None]
    if not vals or vals[0] <= 0 or life < 1:
        return None
    need = life + 1
    estimated = 0
    if len(vals) < need:
        # Wachstum der vorhandenen Reihe (älteste → neueste), begrenzt
        n = len(vals) - 1
        g = (vals[0] / vals[-1]) ** (1 / n) - 1 if n > 0 and vals[-1] > 0 else 0.05
        g = min(max(g, -0.10), 0.30)
        while len(vals) < need:
            vals.append(vals[-1] / (1 + g))
            estimated += 1
    vals = vals[:need]
    asset = sum(vals[k] * (1 - k / life) for k in range(life))
    amort = sum(vals[k] / life for k in range(1, life + 1))
    return RDCapital(life, vals[0], asset, amort, vals[0] - amort, vals, estimated)


# ---------------------------------------------------------------------------------------------------------------
# Kapitalkosten
# ---------------------------------------------------------------------------------------------------------------


@dataclass
class CostOfCapital:
    riskfree: float
    erp: float
    crp: float
    beta_u: float
    debt_to_equity: float
    beta_l: float
    cost_equity: float
    coverage: Optional[float]
    rating: str
    spread: float
    cost_debt_pre: float
    tax_marginal: float
    cost_debt_after: float
    weight_debt: float
    wacc: float
    wacc_terminal: float


def relever(beta_u: float, debt_to_equity: float, tax: float) -> float:
    """Hamada: Beta mit Verschuldung = Beta ohne × (1 + (1 − t) × D/E)."""
    return beta_u * (1 + (1 - tax) * max(debt_to_equity, 0.0))


def cost_of_capital(
    *,
    riskfree: float,
    erp: float,
    crp: float,
    beta_u: float,
    market_cap: float,
    debt: float,
    ebit: Optional[float],
    interest: Optional[float],
    tax_marginal: float,
    rating_for,
) -> CostOfCapital:
    de = debt / market_cap if market_cap > 0 else 0.0
    beta_l = relever(beta_u, de, tax_marginal)
    ke = riskfree + beta_l * erp + crp
    if interest is not None and interest > 0 and ebit is not None:
        coverage: Optional[float] = ebit / interest
    elif interest is not None and interest <= 0 and debt <= 0:
        coverage = None  # schuldenfrei: Fremdkapital spielt keine Rolle
    else:
        coverage = None
    step = rating_for(coverage if coverage is not None else (100.0 if debt <= 0 else None))
    kd = riskfree + step.spread
    kd_after = kd * (1 - tax_marginal)
    wd = debt / (debt + market_cap) if debt + market_cap > 0 else 0.0
    wacc = (1 - wd) * ke + wd * kd_after
    # Reife Firma ab Jahr 11: Beta 1 (risikoloser Zins + Risikoprämie + Länderrisiko), wie Damodarans Standard
    wacc_terminal = riskfree + erp + crp
    return CostOfCapital(riskfree, erp, crp, beta_u, de, beta_l, ke, coverage, step.rating, step.spread, kd, tax_marginal,
                         kd_after, wd, wacc, wacc_terminal)


# ---------------------------------------------------------------------------------------------------------------
# DCF
# ---------------------------------------------------------------------------------------------------------------


@dataclass
class Levers:
    growth_next: float  # Umsatzwachstum im nächsten Jahr
    growth_2_5: float  # jährliches Umsatzwachstum Jahre 2–5 (danach linear zum Endwachstum)
    target_margin: float  # operative Marge vor Steuern (bereinigt) ab dem Zieljahr
    margin_year: int  # Jahr, in dem die Zielmarge erreicht ist (1–10)
    sales_to_capital: float  # zusätzlicher Umsatz je zusätzlich eingesetztem Kapital (bestimmt die Reinvestition)
    wacc: float  # Kapitalkosten Jahre 1–5 (danach linear zum Endwert)
    wacc_terminal: float  # Kapitalkosten ab Jahr 11
    growth_terminal: float  # ewiges Wachstum ab Jahr 11 (höchstens risikoloser Zins)
    roic_terminal: float  # Kapitalrendite auf neue Investitionen im Endwert
    failure_prob: float = 0.0  # Wahrscheinlichkeit, dass die Firma scheitert
    failure_proceeds: float = 0.5  # Erlös im Fall des Scheiterns, Anteil am eingesetzten Kapital (Buchwert)


@dataclass
class Base:
    revenue: float
    margin: float  # aktuelle operative Marge vor Steuern (bereinigt)
    tax_effective: float
    tax_marginal: float
    invested_capital: float  # Buchwert eingesetztes Kapital (bereinigt, inkl. Forschungsvermögen)
    cash: float
    debt: float
    shares: float
    riskfree: float
    nol: float = 0.0  # Verlustvorträge (mindern künftige Steuern)


@dataclass
class YearRow:
    year: int
    growth: float
    revenue: float
    margin: float
    ebit: float
    tax_rate: float
    ebit_after_tax: float
    reinvestment: float
    fcff: float
    wacc: float
    discount: float
    pv: float
    invested_capital: float
    roic: Optional[float]


@dataclass
class DcfResult:
    rows: list[YearRow]
    terminal_revenue: float
    terminal_ebit_after_tax: float
    terminal_reinvestment_rate: float
    terminal_fcff: float
    terminal_value: float
    pv_terminal: float
    pv_years: float
    operating_value: float  # vor Ausfall-Anpassung
    operating_value_adj: float
    equity_value: float
    value_per_share: float
    terminal_share: float  # Anteil des Endwerts am operativen Wert
    warnings: list[str] = field(default_factory=list)


class DcfError(ValueError):
    pass


def check_levers(lev: Levers, base: Base) -> tuple[Levers, list[str]]:
    """Damodarans harte Regeln durchsetzen; jede Korrektur wird gemeldet."""
    warn: list[str] = []
    lev = replace(lev)
    if lev.growth_terminal > base.riskfree + 1e-12:
        warn.append(
            f"Endwachstum auf den risikolosen Zins ({base.riskfree * 100:.2f} %) begrenzt – sonst würde die Firma auf Dauer "
            "schneller wachsen als die Wirtschaft."
        )
        lev.growth_terminal = base.riskfree
    if lev.wacc_terminal <= lev.growth_terminal + 0.005:
        raise DcfError("Die Kapitalkosten im Endwert müssen deutlich über dem Endwachstum liegen.")
    if lev.roic_terminal <= 0:
        raise DcfError("Die Kapitalrendite im Endwert muss positiv sein.")
    if lev.sales_to_capital <= 0:
        raise DcfError("Umsatz je eingesetztem Kapital muss positiv sein.")
    lev.margin_year = int(min(max(lev.margin_year, 1), YEARS))
    lev.failure_prob = min(max(lev.failure_prob, 0.0), 1.0)
    lev.failure_proceeds = min(max(lev.failure_proceeds, 0.0), 1.0)
    if lev.growth_terminal > 0 and lev.roic_terminal < lev.wacc_terminal:
        warn.append("Kapitalrendite im Endwert liegt unter den Kapitalkosten: Wachstum vernichtet dort Wert.")
    return lev, warn


def growth_path(lev: Levers) -> list[float]:
    """Umsatzwachstum Jahr 1–10: Jahr 1, dann Jahre 2–5 gleich, Jahre 6–10 linear zum Endwachstum."""
    out = []
    for t in range(1, YEARS + 1):
        if t == 1:
            out.append(lev.growth_next)
        elif t <= 5:
            out.append(lev.growth_2_5)
        else:
            out.append(lev.growth_2_5 - (lev.growth_2_5 - lev.growth_terminal) * (t - 5) / 5)
    return out


def dcf(base: Base, levers: Levers) -> DcfResult:
    lev, warn = check_levers(levers, base)
    growth = growth_path(lev)
    revs = [base.revenue]
    for g in growth:
        revs.append(revs[-1] * (1 + g))
    revs.append(revs[-1] * (1 + lev.growth_terminal))  # Jahr 11
    rows: list[YearRow] = []
    ic = base.invested_capital
    nol = max(base.nol, 0.0)
    discount = 1.0
    pv_sum = 0.0
    for t in range(1, YEARS + 1):
        g = growth[t - 1]
        rev = revs[t]
        if t >= lev.margin_year:
            m = lev.target_margin
        else:
            m = lev.target_margin - (lev.target_margin - base.margin) * (lev.margin_year - t) / lev.margin_year
        ebit = rev * m
        tax_rate = base.tax_effective if t <= 5 else base.tax_effective + (base.tax_marginal - base.tax_effective) * (t - 5) / 5
        # Verlustvorträge zuerst verbrauchen
        if ebit <= 0:
            taxes = 0.0
            nol += -ebit
        else:
            use = min(nol, ebit)
            nol -= use
            taxes = (ebit - use) * tax_rate
        nopat = ebit - taxes
        # Reinvestition dieses Jahres finanziert das Umsatzwachstum des Folgejahres (wie in der Endwert-Formel:
        # neues Kapital bringt ab dem nächsten Jahr Rendite) – so ist Wachstum mit Rendite = Kapitalkosten wertneutral
        reinvest = (revs[t + 1] - rev) / lev.sales_to_capital
        fcff = nopat - reinvest
        wacc = lev.wacc if t <= 5 else lev.wacc + (lev.wacc_terminal - lev.wacc) * (t - 5) / 5
        discount /= 1 + wacc
        pv = fcff * discount
        pv_sum += pv
        roic = nopat / ic if ic > 0 else None
        ic += reinvest
        rows.append(YearRow(t, g, rev, m, ebit, tax_rate, nopat, reinvest, fcff, wacc, discount, pv, ic, roic))
    rev_prev = revs[YEARS]
    # Endwert (Jahr 11): Zielmarge, Grenzsteuersatz, Reinvestition = Wachstum / Kapitalrendite
    rev11 = revs[YEARS + 1]
    ebit11 = rev11 * lev.target_margin
    nopat11 = ebit11 * (1 - base.tax_marginal) if ebit11 > 0 else ebit11
    rr = lev.growth_terminal / lev.roic_terminal if lev.growth_terminal > 0 else 0.0
    fcff11 = nopat11 * (1 - rr)
    tv = fcff11 / (lev.wacc_terminal - lev.growth_terminal)
    pv_tv = tv * discount
    op_value = pv_sum + pv_tv
    distress = lev.failure_proceeds * max(base.invested_capital, 0.0)
    op_adj = op_value * (1 - lev.failure_prob) + distress * lev.failure_prob
    equity = op_adj - base.debt + base.cash
    per_share = equity / base.shares if base.shares > 0 else float("nan")
    share_tv = pv_tv / op_value if op_value > 0 else float("nan")
    if ebit11 <= 0:
        warn.append("Auch im Endwert kein operativer Gewinn – der Wert hängt dann am Ausfall-Erlös.")
    return DcfResult(rows, rev11, nopat11, rr, fcff11, tv, pv_tv, pv_sum, op_value, op_adj, equity, per_share, share_tv, warn)


def value_per_share(base: Base, lev: Levers) -> float:
    try:
        return dcf(base, lev).value_per_share
    except DcfError:
        return float("nan")


# ---------------------------------------------------------------------------------------------------------------
# Rückwärts-DCF: Was muss man glauben, damit der Kurs stimmt?
# ---------------------------------------------------------------------------------------------------------------


def _solve(f, lo: float, hi: float, target: float, iters: int = 80) -> Optional[float]:
    """Bisektion: f wächst mit x (wird geprüft). None, wenn das Ziel im Bereich nicht erreichbar ist."""
    flo, fhi = f(lo), f(hi)
    if any(math.isnan(v) for v in (flo, fhi)):
        return None
    if (flo - target) * (fhi - target) > 0:
        return None
    for _ in range(iters):
        mid = (lo + hi) / 2
        fm = f(mid)
        if math.isnan(fm):
            return None
        if (fm - target) * (flo - target) <= 0:
            hi, fhi = mid, fm
        else:
            lo, flo = mid, fm
    return (lo + hi) / 2


def implied_growth(base: Base, lev: Levers, price: float) -> Optional[float]:
    """Umsatzwachstum (Jahr 1 bis 5 gleich), das bei sonst gleichen Annahmen genau den Kurs ergibt."""
    return _solve(lambda g: value_per_share(base, replace(lev, growth_next=g, growth_2_5=g)), -0.30, 1.0, price)


def implied_margin(base: Base, lev: Levers, price: float) -> Optional[float]:
    """Zielmarge, die bei sonst gleichen Annahmen genau den Kurs ergibt."""
    return _solve(lambda m: value_per_share(base, replace(lev, target_margin=m)), -0.20, 0.80, price)


# ---------------------------------------------------------------------------------------------------------------
# Simulation: Bandbreite statt Punktwert
# ---------------------------------------------------------------------------------------------------------------


@dataclass
class Distribution:
    runs: int
    p10: float
    p25: float
    p50: float
    p75: float
    p90: float
    share_above_price: Optional[float]  # Anteil der Läufe mit Wert über dem Kurs
    bins: list[tuple[float, float, int]]  # (von, bis, Anzahl)


def _pct(sorted_vals: list[float], q: float) -> float:
    if not sorted_vals:
        return float("nan")
    k = (len(sorted_vals) - 1) * q
    lo = math.floor(k)
    hi = math.ceil(k)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


def simulate(base: Base, lev: Levers, price: Optional[float], runs: int = 1500, seed: int = 7, bins: int = 30) -> Distribution:
    """Hebel zufällig um ihre Werte streuen (fester Startwert → reproduzierbar):
    Wachstum ±(25–30 % des Werts, mindestens 3 Prozentpunkte), Marge ±20 % (mind. 2 Pp.), Umsatz/Kapital ±25 %
    (logarithmisch), Kapitalkosten ±1 Pp., Endwachstum zwischen 1 Pp. darunter und dem gesetzten Wert."""
    rnd = random.Random(seed)
    vals: list[float] = []
    for _ in range(runs):
        g1 = rnd.gauss(lev.growth_next, max(0.03, abs(lev.growth_next) * 0.25))
        g25 = rnd.gauss(lev.growth_2_5, max(0.03, abs(lev.growth_2_5) * 0.30))
        m = rnd.gauss(lev.target_margin, max(0.02, abs(lev.target_margin) * 0.20))
        s2c = lev.sales_to_capital * math.exp(rnd.gauss(0, 0.25))
        w = max(lev.wacc + rnd.gauss(0, 0.01), 0.02)
        gt = rnd.uniform(max(lev.growth_terminal - 0.01, 0.0), lev.growth_terminal) if lev.growth_terminal > 0 else lev.growth_terminal
        trial = replace(lev, growth_next=max(g1, -0.5), growth_2_5=max(g25, -0.5), target_margin=min(max(m, -0.5), 0.8),
                        sales_to_capital=s2c, wacc=w)
        trial.growth_terminal = min(gt, base.riskfree)
        v = value_per_share(base, trial)
        if math.isfinite(v):
            vals.append(v)
    vals.sort()
    if not vals:
        return Distribution(0, *(float("nan"),) * 5, None, [])
    lo, hi = _pct(vals, 0.01), _pct(vals, 0.99)
    width = (hi - lo) / bins if hi > lo else 1.0
    counts = [0] * bins
    for v in vals:
        if lo <= v <= hi:
            counts[min(int((v - lo) / width), bins - 1)] += 1
    hist = [(lo + i * width, lo + (i + 1) * width, c) for i, c in enumerate(counts)]
    above = sum(1 for v in vals if price is not None and v > price) / len(vals) if price else None
    return Distribution(len(vals), _pct(vals, 0.10), _pct(vals, 0.25), _pct(vals, 0.50), _pct(vals, 0.75), _pct(vals, 0.90),
                        above, hist)


# ---------------------------------------------------------------------------------------------------------------
# Lebenszyklus
# ---------------------------------------------------------------------------------------------------------------

LIFECYCLE = {
    "jung": ("Junges Wachstum", "Kaum Gewinne, der Wert steckt fast ganz in der Story und im Endwert – Bandbreite zählt mehr als der Punktwert."),
    "hochwachstum": ("Hochwachstum", "Hohes Wachstum: entscheidend ist, wie lange es anhält und ob die Kapitalrendite über den Kapitalkosten liegt."),
    "reifes_wachstum": ("Reifes Wachstum", "Wachstum lässt nach, die Zahlen tragen mehr Gewicht als die Story; Marge und Reinvestition prüfen."),
    "reif": ("Reif", "Wenig Wachstum: Wert kommt aus den bestehenden Anlagen – Geld zurückgeben kann mehr wert sein als Wachstum."),
    "rueckgang": ("Rückgang", "Schrumpfender Umsatz: Wachstumsannahmen vorsichtig, Ausfall- und Abbaurisiken beachten."),
    "umbau": ("Verluste ohne Wachstum", "Verluste bei schwachem Wachstum: Sanierungsfall – Ausfallwahrscheinlichkeit ansetzen."),
}


def lifecycle(growth_hist: Optional[float], margin: Optional[float]) -> str:
    g = growth_hist if growth_hist is not None else 0.0
    m = margin if margin is not None else 0.0
    if m < 0:
        return "jung" if g > 0.15 else "umbau"
    if g >= 0.20:
        return "hochwachstum"
    if g >= 0.08:
        return "reifes_wachstum"
    if g >= -0.02:
        return "reif"
    return "rueckgang"
