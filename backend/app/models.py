"""Antwortmodelle der Terminal-API.

Beide Datenquellen (EODHD und Demo) liefern exakt diese Strukturen, damit das
Frontend nicht wissen muss, woher die Daten stammen. Feldnamen erscheinen im
JSON in camelCase.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict


def to_camel(name: str) -> str:
    """change_pct -> changePct, chg_1w -> chg1w, dist_52w_high -> dist52wHigh"""
    head, *rest = name.split("_")
    return head + "".join(part if part[:1].isdigit() else part[:1].upper() + part[1:] for part in rest)


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# --- Kurse -----------------------------------------------------------------


class Quote(Model):
    ticker: str
    name: Optional[str] = None
    last: Optional[float] = None
    change: Optional[float] = None
    change_pct: Optional[float] = None
    open: Optional[float] = None
    high: Optional[float] = None
    low: Optional[float] = None
    prev_close: Optional[float] = None
    volume: Optional[float] = None
    timestamp: Optional[str] = None  # ISO 8601, UTC
    delayed: bool = True
    currency: Optional[str] = None


class History(Model):
    """Tägliche, split- und dividendenbereinigte Kurse in Spaltenform."""

    ticker: str
    currency: Optional[str] = None
    t: list[str]  # YYYY-MM-DD
    o: list[Optional[float]]
    h: list[Optional[float]]
    l: list[Optional[float]]
    c: list[Optional[float]]
    v: list[Optional[float]]


class Intraday(Model):
    ticker: str
    interval: str
    t: list[int]  # Unix-Sekunden UTC
    o: list[Optional[float]]
    h: list[Optional[float]]
    l: list[Optional[float]]
    c: list[Optional[float]]
    v: list[Optional[float]]


# --- Unternehmen ------------------------------------------------------------


class Officer(Model):
    name: str
    title: Optional[str] = None


class Valuation(Model):
    pe: Optional[float] = None
    forward_pe: Optional[float] = None
    peg: Optional[float] = None
    price_sales: Optional[float] = None
    price_book: Optional[float] = None
    ev: Optional[float] = None
    ev_revenue: Optional[float] = None
    ev_ebitda: Optional[float] = None


class Profitability(Model):
    profit_margin: Optional[float] = None  # Anteil, 0.25 = 25 %
    operating_margin: Optional[float] = None
    roe: Optional[float] = None
    roa: Optional[float] = None
    revenue_ttm: Optional[float] = None
    ebitda: Optional[float] = None
    revenue_growth_yoy: Optional[float] = None
    earnings_growth_yoy: Optional[float] = None


class PerShare(Model):
    eps: Optional[float] = None
    eps_estimate_cy: Optional[float] = None
    eps_estimate_ny: Optional[float] = None
    book_value: Optional[float] = None
    dividend_share: Optional[float] = None
    dividend_yield: Optional[float] = None  # Anteil


class Technicals(Model):
    beta: Optional[float] = None
    high52: Optional[float] = None
    low52: Optional[float] = None
    ma50: Optional[float] = None
    ma200: Optional[float] = None


class SharesInfo(Model):
    outstanding: Optional[float] = None
    float_shares: Optional[float] = None
    pct_insiders: Optional[float] = None  # Prozentwert, 5.2 = 5,2 %
    pct_institutions: Optional[float] = None


class Analyst(Model):
    rating: Optional[float] = None  # 1 = Strong Sell … 5 = Strong Buy
    target_price: Optional[float] = None
    strong_buy: Optional[int] = None
    buy: Optional[int] = None
    hold: Optional[int] = None
    sell: Optional[int] = None
    strong_sell: Optional[int] = None


class Company(Model):
    ticker: str
    name: str
    exchange: Optional[str] = None
    currency: Optional[str] = None
    country: Optional[str] = None
    sector: Optional[str] = None
    industry: Optional[str] = None
    description: Optional[str] = None
    employees: Optional[int] = None
    website: Optional[str] = None
    ipo_date: Optional[str] = None
    isin: Optional[str] = None
    market_cap: Optional[float] = None
    officers: list[Officer] = []
    valuation: Valuation = Valuation()
    profitability: Profitability = Profitability()
    per_share: PerShare = PerShare()
    technicals: Technicals = Technicals()
    shares: SharesInfo = SharesInfo()
    analyst: Analyst = Analyst()
    updated_at: Optional[str] = None


class StatementRow(Model):
    key: str
    label: str
    values: list[Optional[float]]
    kind: Literal["money", "ratio", "pershare"] = "money"
    emphasis: bool = False


class Financials(Model):
    ticker: str
    period: Literal["annual", "quarterly"]
    currency: Optional[str] = None
    periods: list[str]  # Periodenenden, neueste zuerst
    income: list[StatementRow]
    balance: list[StatementRow]
    cashflow: list[StatementRow]


class EarningsItem(Model):
    date: str  # Periodenende
    report_date: Optional[str] = None
    eps_actual: Optional[float] = None
    eps_estimate: Optional[float] = None
    surprise_pct: Optional[float] = None
    timing: Optional[str] = None  # BeforeMarket / AfterMarket


class Earnings(Model):
    ticker: str
    currency: Optional[str] = None
    history: list[EarningsItem]  # neueste zuerst
    next: Optional[EarningsItem] = None


class DividendItem(Model):
    ex_date: str
    pay_date: Optional[str] = None
    value: Optional[float] = None
    currency: Optional[str] = None


class SplitItem(Model):
    date: str
    ratio: str


class Dividends(Model):
    ticker: str
    dividends: list[DividendItem]  # neueste zuerst
    splits: list[SplitItem]
    ttm: Optional[float] = None
    yield_ttm: Optional[float] = None  # Anteil


# --- News -------------------------------------------------------------------


class Sentiment(Model):
    polarity: Optional[float] = None  # -1 … +1
    pos: Optional[float] = None
    neu: Optional[float] = None
    neg: Optional[float] = None


class NewsItem(Model):
    id: str
    date: str  # ISO 8601 UTC
    title: str
    content: str = ""
    link: Optional[str] = None
    source: Optional[str] = None
    symbols: list[str] = []
    tags: list[str] = []
    topic: str = "company"  # company | earnings | analyst | mna | macro | markets
    sentiment: Sentiment = Sentiment()
    urgent: bool = False


class NewsPage(Model):
    items: list[NewsItem]
    sources_note: Optional[str] = None


# --- Makro ------------------------------------------------------------------


class MarketRow(Model):
    ticker: str
    name: str
    region: Optional[str] = None
    last: Optional[float] = None
    change: Optional[float] = None
    change_pct: Optional[float] = None
    chg_1w: Optional[float] = None  # Prozent
    chg_1m: Optional[float] = None
    chg_ytd: Optional[float] = None
    spark: list[float] = []  # letzte ~30 Schlusskurse
    as_of: Optional[str] = None


class CurvePoint(Model):
    tenor: str
    years: float
    y: Optional[float] = None
    y_1m: Optional[float] = None
    y_1y: Optional[float] = None


class Curve(Model):
    country: str
    name: str
    as_of: Optional[str] = None
    points: list[CurvePoint]


class Series(Model):
    key: str
    label: str
    unit: str = "bp"
    t: list[str]
    v: list[Optional[float]]


class EconEvent(Model):
    id: str
    date: str  # ISO 8601 UTC
    country: str
    event: str
    period: Optional[str] = None
    actual: Optional[float] = None
    estimate: Optional[float] = None
    previous: Optional[float] = None
    surprise: Optional[float] = None  # actual - estimate
    importance: int = 1  # 1 niedrig … 3 hoch
    unit: Optional[str] = None


class CountryValue(Model):
    year: Optional[int] = None
    value: Optional[float] = None


class CountryRow(Model):
    country: str  # ISO3
    name: str
    values: dict[str, CountryValue]
    history: dict[str, list[CountryValue]] = {}


class Indicator(Model):
    key: str
    label: str
    unit: str


class CountryTable(Model):
    indicators: list[Indicator]
    rows: list[CountryRow]
    note: Optional[str] = None


# --- Weltkarte -----------------------------------------------------------------


class WorldIndex(Model):
    ticker: str
    name: str
    last: Optional[float] = None
    change_pct: Optional[float] = None
    chg_1w: Optional[float] = None
    chg_1m: Optional[float] = None
    chg_ytd: Optional[float] = None


class WorldBond(Model):
    ticker: str
    value: Optional[float] = None  # Rendite in %
    chg_1m_bp: Optional[float] = None


class WorldCountry(Model):
    iso3: str
    name: str
    index: Optional[WorldIndex] = None
    bond: Optional[WorldBond] = None
    macro: dict[str, CountryValue] = {}


class WorldMap(Model):
    group: Literal["equity", "rates", "macro"]
    countries: list[WorldCountry]
    indicators: list[Indicator] = []
    as_of: Optional[str] = None
    note: Optional[str] = None


# --- Screener ---------------------------------------------------------------


class ScreenRow(Model):
    ticker: str
    name: Optional[str] = None
    exchange: Optional[str] = None
    sector: Optional[str] = None
    industry: Optional[str] = None
    currency: Optional[str] = None
    price: Optional[float] = None
    chg_1d: Optional[float] = None  # Prozent
    chg_5d: Optional[float] = None
    market_cap: Optional[float] = None  # in USD umgerechnet
    market_cap_local: Optional[float] = None  # in Handelswährung
    eps: Optional[float] = None
    pe: Optional[float] = None
    div_yield: Optional[float] = None  # Prozent
    avg_vol: Optional[float] = None
    perf_1m: Optional[float] = None
    perf_3m: Optional[float] = None
    perf_12m: Optional[float] = None
    rsi14: Optional[float] = None
    vol_1y: Optional[float] = None  # annualisiert, Prozent
    dist_52w_high: Optional[float] = None  # Prozent, <= 0


class ScreenResult(Model):
    rows: list[ScreenRow]
    total: int
    truncated: bool = False
    notes: list[str] = []


class ScreenField(Model):
    key: str
    label: str
    group: Literal["descriptive", "fundamental", "technical"]
    kind: Literal["number", "percent", "money", "text", "choice"]
    choices: list[str] = []
    enriched: bool = False  # nur nach Kursanreicherung verfügbar


class Movers(Model):
    gainers: list[ScreenRow]
    losers: list[ScreenRow]
    active: list[ScreenRow]
    as_of: Optional[str] = None


class SearchHit(Model):
    ticker: str
    name: str
    exchange: Optional[str] = None
    type: Optional[str] = None
    country: Optional[str] = None
    currency: Optional[str] = None


class EarningsEvent(Model):
    ticker: str
    name: Optional[str] = None
    report_date: str
    period_end: Optional[str] = None
    timing: Optional[str] = None  # BeforeMarket / AfterMarket
    eps_estimate: Optional[float] = None
    eps_actual: Optional[float] = None
    surprise_pct: Optional[float] = None
    currency: Optional[str] = None


class PeerResult(Model):
    ticker: str
    basis: str  # "industry" oder "sector"
    group: Optional[str] = None
    rows: list[ScreenRow]
    median: ScreenRow
