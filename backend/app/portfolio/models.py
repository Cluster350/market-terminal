"""Datenmodelle des Depots (gespeicherte Positionen und berechnete Kennzahlen)."""

from __future__ import annotations

import datetime as dt
import re
from typing import Literal, Optional

from pydantic import Field, field_validator

from ..models import Model

BASES = ("EUR", "USD", "CHF", "GBP")
Base = Literal["EUR", "USD", "CHF", "GBP"]


class Position(Model):
    id: str = Field(default="", max_length=40)
    ticker: str = Field(min_length=1, max_length=40)
    quantity: float  # Stück; negativ = Leerverkauf
    cost: Optional[float] = None  # Einstandskurs je Stück in Handelswährung
    opened: Optional[str] = None  # Kaufdatum JJJJ-MM-TT
    currency: Optional[str] = None  # nur falls die Handelswährung von der Börse abweicht
    note: str = Field(default="", max_length=200)

    @field_validator("quantity")
    @classmethod
    def _quantity(cls, v: float) -> float:
        if v != v or v == 0 or abs(v) > 1e9:
            raise ValueError("Stückzahl muss eine Zahl ungleich 0 sein")
        return v

    @field_validator("cost")
    @classmethod
    def _cost(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and (v != v or v <= 0 or v > 1e9):
            raise ValueError("Einstandskurs muss größer als 0 sein")
        return v

    @field_validator("opened")
    @classmethod
    def _opened(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return None
        try:
            d = dt.date.fromisoformat(v[:10])
        except ValueError as exc:
            raise ValueError("Kaufdatum im Format JJJJ-MM-TT") from exc
        if d.year < 1950 or d > dt.date.today() + dt.timedelta(days=1):
            raise ValueError("Kaufdatum liegt außerhalb des möglichen Bereichs")
        return d.isoformat()

    @field_validator("currency")
    @classmethod
    def _currency(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return None
        if v in ("GBp", "GBX", "gbx"):
            return "GBX"
        if not re.fullmatch(r"[A-Za-z]{3}", v):
            raise ValueError("Währung als dreistelliger Code, z. B. USD")
        return v.upper()


class Portfolio(Model):
    version: int = 0
    base: Base = "EUR"
    benchmark: Optional[str] = Field(default=None, max_length=40)  # None = automatisch nach Schwerpunkt
    cash: float = Field(default=0.0, ge=-1e12, le=1e12)  # Kasse in Basiswährung
    positions: list[Position] = Field(default_factory=list, max_length=200)
    updated: Optional[str] = None
    sample: bool = False  # Muster-Depot im Demo-Modus, noch nicht gespeichert


# --- Kennzahlen ------------------------------------------------------------------


class PositionRow(Model):
    id: str
    ticker: str
    name: Optional[str] = None
    quantity: float
    cost: Optional[float] = None
    opened: Optional[str] = None
    note: str = ""
    currency: Optional[str] = None
    price: Optional[float] = None
    change_pct: Optional[float] = None
    fx: Optional[float] = None  # 1 Einheit Handelswährung in Basiswährung
    value: Optional[float] = None  # Basiswährung
    weight: Optional[float] = None  # Prozent des Depotwerts
    day_pnl: Optional[float] = None
    pnl: Optional[float] = None  # seit Kauf, Basiswährung (inkl. Währungseffekt, wenn Kaufdatum bekannt)
    pnl_pct: Optional[float] = None  # seit Kauf in Handelswährung
    pnl_pct_base: Optional[float] = None
    sector: Optional[str] = None
    country: Optional[str] = None
    vol: Optional[float] = None  # Prozent p. a.
    beta: Optional[float] = None
    risk_share: Optional[float] = None  # Prozent des Depotrisikos
    issue: Optional[str] = None


class Slice(Model):
    key: str
    value: float
    weight: float


class Summary(Model):
    value: float = 0.0
    positions_value: float = 0.0
    cash: float = 0.0
    invested: Optional[float] = None
    day_pnl: Optional[float] = None
    day_pnl_pct: Optional[float] = None
    pnl: Optional[float] = None
    pnl_pct: Optional[float] = None
    count: int = 0


class Risk(Model):
    days: int = 0
    vol: Optional[float] = None
    beta: Optional[float] = None
    return_1y: Optional[float] = None
    bench_return_1y: Optional[float] = None
    bench_vol: Optional[float] = None
    max_drawdown: Optional[float] = None
    drawdown_peak: Optional[str] = None
    drawdown_trough: Optional[str] = None
    var95: Optional[float] = None  # Basiswährung, 1 Tag, historisch
    var95_pct: Optional[float] = None
    es95: Optional[float] = None
    effective_n: Optional[float] = None
    top5_weight: Optional[float] = None
    largest: Optional[str] = None
    largest_weight: Optional[float] = None


class Correlation(Model):
    tickers: list[str] = []
    matrix: list[list[Optional[float]]] = []


class ValueSeries(Model):
    t: list[str] = []
    portfolio: list[float] = []
    benchmark: list[Optional[float]] = []


class Analytics(Model):
    base: Base
    benchmark: Optional[str] = None
    benchmark_name: Optional[str] = None
    as_of: Optional[str] = None
    summary: Summary
    rows: list[PositionRow]
    allocation: dict[str, list[Slice]] = {}
    risk: Risk = Risk()
    series: ValueSeries = ValueSeries()
    correlation: Correlation = Correlation()
    notes: list[str] = []
