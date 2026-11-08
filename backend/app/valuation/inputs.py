"""Eingangsdaten je Firma aus den Fundamentaldaten (EODHD-Format; die Demo liefert dasselbe Format):
berichtete Gewinne je Aktie (Quartale, Geschäftsjahre) und Analystenschätzungen mit ihrem Verlauf."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Any, Optional

from ..services.util import num, text


@dataclass
class Estimate:
    """Konsens für ein Geschäftsjahr (EODHD Earnings::Trend, Zeitraum 0y bzw. +1y)."""

    end: dt.date  # Ende des Geschäftsjahres
    period: str  # "0y" (laufend) oder "+1y" (nächstes)
    eps: Optional[float]  # aktueller Konsens Gewinn je Aktie
    analysts: Optional[int] = None
    ago: dict[int, Optional[float]] = field(default_factory=dict)  # Tage zurück -> damaliger Konsens (7, 30, 60, 90)
    up7: int = 0
    up30: int = 0
    down7: int = 0
    down30: int = 0


@dataclass
class ValInputs:
    ticker: str
    name: str
    sector: Optional[str]
    country: Optional[str]
    exchange: Optional[str]
    currency: Optional[str]
    pe_ref: Optional[float]  # KGV laut Datenquelle (Prüfung der Einheiten/Währung)
    forward_pe_ref: Optional[float]
    quarters: list[tuple[dt.date, float]]  # berichtete Quartals-EPS, älteste zuerst
    annual: list[tuple[dt.date, float]]  # berichtete Geschäftsjahres-EPS, älteste zuerst
    estimates: list[Estimate]
    isin: Optional[str] = None  # Wertpapierkennung: gleiche Aktie an mehreren Börsen hat dieselbe ISIN


def _date(x: Any) -> Optional[dt.date]:
    s = text(x)
    if not s:
        return None
    try:
        return dt.date.fromisoformat(s[:10])
    except ValueError:
        return None


def _records(block: Any) -> list[dict]:
    if isinstance(block, dict):
        return [r for r in block.values() if isinstance(r, dict)]
    if isinstance(block, list):
        return [r for r in block if isinstance(r, dict)]
    return []


def _int(x: Any) -> int:
    v = num(x)
    return int(v) if v is not None else 0


def from_fundamentals(data: Any, ticker: str) -> ValInputs:
    data = data if isinstance(data, dict) else {}
    g = data.get("General") or {}
    hl = data.get("Highlights") or {}
    val = data.get("Valuation") or {}
    earn = data.get("Earnings") or {}

    quarters: dict[dt.date, float] = {}
    for r in _records(earn.get("History")):
        d, eps = _date(r.get("date")), num(r.get("epsActual"))
        if d and eps is not None:
            quarters[d] = eps
    annual: dict[dt.date, float] = {}
    for r in _records(earn.get("Annual")):
        d, eps = _date(r.get("date")), num(r.get("epsActual"))
        if d and eps is not None:
            annual[d] = eps

    trend = earn.get("Trend") or {}
    # EODHD v1.1 trennt in "Annual" und "Quarterly", v1 liefert eine flache Liste mit "period"
    rows = _records(trend.get("Annual")) if isinstance(trend, dict) and "Annual" in trend else _records(trend)
    estimates: list[Estimate] = []
    for r in rows:
        period = text(r.get("period")) or ""
        end = _date(r.get("date"))
        if period not in ("0y", "+1y") or end is None:
            continue
        eps = num(r.get("earningsEstimateAvg"))
        if eps is None:
            eps = num(r.get("epsTrendCurrent"))
        estimates.append(Estimate(
            end=end, period=period, eps=eps, analysts=_int(r.get("earningsEstimateNumberOfAnalysts")) or None,
            ago={d: num(r.get(f"epsTrend{d}daysAgo")) for d in (7, 30, 60, 90)},
            up7=_int(r.get("epsRevisionsUpLast7days")), up30=_int(r.get("epsRevisionsUpLast30days")),
            down7=_int(r.get("epsRevisionsDownLast7days")), down30=_int(r.get("epsRevisionsDownLast30days")),
        ))
    estimates.sort(key=lambda e: e.end)

    return ValInputs(
        ticker=ticker,
        name=text(g.get("Name")) or ticker,
        sector=text(g.get("Sector")) or text(g.get("GicSector")),
        country=text(g.get("CountryName")),
        exchange=text(g.get("Exchange")),
        currency=text(g.get("CurrencyCode")),
        pe_ref=num(val.get("TrailingPE")) or num(hl.get("PERatio")),
        forward_pe_ref=num(val.get("ForwardPE")),
        quarters=sorted(quarters.items()),
        annual=sorted(annual.items()),
        estimates=estimates,
        isin=(text(g.get("ISIN")) or "").upper() or None,
    )
