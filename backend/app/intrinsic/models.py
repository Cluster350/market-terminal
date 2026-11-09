"""Antwortmodelle für den inneren Wert (Funktion DCF)."""

from __future__ import annotations

from typing import Literal, Optional

from ..models import Model


class IvLever(Model):
    key: str
    label: str
    value: float
    default: float
    unit: Literal["pct", "x", "year"]
    min: float
    max: float
    step: float
    hint: str = ""


class IvYear(Model):
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
    roic: Optional[float] = None


class IvRow(Model):
    """Eine Zeile einer Erklär-Tabelle (Bereinigung, Kapitalkosten, Wertbrücke)."""

    label: str
    value: Optional[float] = None
    unit: Literal["money", "pct", "x", "text", "num"] = "money"
    text: Optional[str] = None
    note: str = ""


class IvBin(Model):
    lo: float
    hi: float
    n: int


class IvDistribution(Model):
    runs: int
    p10: Optional[float] = None
    p25: Optional[float] = None
    p50: Optional[float] = None
    p75: Optional[float] = None
    p90: Optional[float] = None
    share_above_price: Optional[float] = None
    bins: list[IvBin] = []


class IvReverse(Model):
    growth: Optional[float] = None  # Umsatzwachstum p. a. (Jahre 1–5), das den Kurs rechtfertigt
    revenue_multiple_10y: Optional[float] = None  # Umsatz Jahr 10 ÷ heute bei diesem Wachstum
    margin: Optional[float] = None  # Zielmarge, die den Kurs rechtfertigt (bei gewähltem Wachstum)


class IvLifecycle(Model):
    key: str
    label: str
    text: str


class IvQuality(Model):
    roic_now: Optional[float] = None  # heutige Kapitalrendite nach Steuern (bereinigt)
    wacc: Optional[float] = None
    roic_marginal: Optional[float] = None  # Rendite auf neues Kapital laut Hebeln: Umsatz/Kapital × Marge × (1 − t)
    verdict: str = ""


class IntrinsicResult(Model):
    ticker: str
    name: str = ""
    state: Literal["ok", "not_applicable", "no_data", "invalid"] = "ok"
    message: str = ""
    currency: Optional[str] = None  # Berichtswährung (in ihr wird gerechnet)
    price: Optional[float] = None  # Kurs in Berichtswährung
    price_quote: Optional[float] = None  # Kurs in Handelswährung
    price_currency: Optional[str] = None
    fx_note: str = ""
    sector: Optional[str] = None
    industry: Optional[str] = None
    industry_used: str = ""  # Vergleichsbranche für Beta, Marge, Umsatz/Kapital
    industry_source: str = ""
    country: Optional[str] = None
    base_period: str = ""  # z. B. „letzte 12 Monate bis 30.09.2026“
    lifecycle: Optional[IvLifecycle] = None
    levers: list[IvLever] = []
    adjustments: list[IvRow] = []  # Bereinigung der Bilanz (F&E, Aktienvergütung, Leasing)
    cost_of_capital: list[IvRow] = []
    years: list[IvYear] = []
    terminal: list[IvRow] = []
    bridge: list[IvRow] = []  # operativer Wert → Eigenkapital → je Aktie
    value_per_share: Optional[float] = None
    value_gap: Optional[float] = None  # Wert ÷ Kurs − 1
    terminal_share: Optional[float] = None
    distribution: Optional[IvDistribution] = None
    reverse: Optional[IvReverse] = None
    quality: Optional[IvQuality] = None
    multiples: list[IvRow] = []  # Gegenprobe „Pricing“: KGV, EV/Umsatz, EV/EBITDA
    history: list[IvRow] = []  # Umsatzwachstum, Margen der letzten Jahre
    warnings: list[str] = []
    params_source: str = ""
    params_loaded_at: Optional[str] = None
