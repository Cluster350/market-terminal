"""Schnittstelle der Datenquellen und Instrumentenkatalog."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Any, Optional, Protocol

from ..models import (
    Company,
    EarningsEvent,
    CountryValue,
    Dividends,
    Earnings,
    EconEvent,
    Financials,
    History,
    Intraday,
    NewsItem,
    OptionContract,
    Quote,
    ScreenRow,
    SearchHit,
)


@dataclass(frozen=True)
class Instrument:
    ticker: str
    name: str
    region: str = ""


@dataclass(frozen=True)
class Catalog:
    indices: list[Instrument]
    fx: list[Instrument]
    commodities: list[Instrument]
    # Land -> (Name, [(Laufzeit, Jahre, Ticker)])
    curves: dict[str, tuple[str, list[tuple[str, float, str]]]]
    default_watchlist: list[str]
    default_news: list[str]
    screener_exchanges: list[str]
    heatmap_exchange: str = "US"
    countries: dict[str, str] = field(default_factory=dict)  # ISO3 -> Name


@dataclass(frozen=True)
class ScreenFilter:
    field: str
    op: str  # gt, gte, lt, lte, eq, neq, in, contains
    value: Any


class Provider(Protocol):
    mode: str
    catalog: Catalog

    async def search(self, query: str, limit: int) -> list[SearchHit]: ...
    async def quotes(self, tickers: list[str]) -> list[Quote]: ...
    async def history(self, ticker: str) -> History: ...
    async def intraday(self, ticker: str, days: int) -> Intraday: ...
    async def company(self, ticker: str) -> Company: ...
    async def financials(self, ticker: str, period: str) -> Financials: ...
    async def earnings(self, ticker: str) -> Earnings: ...
    async def dividends(self, ticker: str) -> Dividends: ...
    async def news(self, tickers: Optional[list[str]], limit: int) -> list[NewsItem]: ...
    async def calendar(self, start: dt.date, end: dt.date, country: Optional[str]) -> list[EconEvent]: ...
    async def macro_indicator(self, country: str, indicator: str) -> list[CountryValue]: ...
    async def options(self, ticker: str) -> list[OptionContract]:
        """Optionskette (alle Verfälle des nächsten gut eines Jahres); nur US-Aktien und -ETFs."""
        ...
    async def screener(
        self, filters: list[ScreenFilter], sort: str, desc: bool, max_rows: int
    ) -> tuple[list[ScreenRow], list[ScreenFilter], list[str]]:
        """Gibt (Zeilen, nicht serverseitig angewandte Filter, Hinweise) zurück."""
        ...
    async def earnings_calendar(self, start: dt.date, end: dt.date) -> list[EarningsEvent]: ...
    async def resolve(self, ticker: str) -> Optional[SearchHit]:
        """Kanonischer Eintrag zum Ticker oder None, wenn unbekannt."""
        ...
    async def status(self) -> dict[str, Any]: ...
    async def close(self) -> None: ...


MACRO_INDICATORS: list[tuple[str, str, str]] = [
    ("gdp_growth_annual", "BIP-Wachstum", "%"),
    ("inflation_consumer_prices_annual", "Inflation (VPI)", "%"),
    ("unemployment_total_percent", "Arbeitslosenquote", "%"),
    ("debt_percent_gdp", "Staatsschulden/BIP", "%"),
    ("real_interest_rate", "Realzins", "%"),
    ("gdp_per_capita_usd", "BIP pro Kopf", "USD"),
    ("gdp_current_usd", "BIP", "USD"),
]

COUNTRIES: dict[str, str] = {
    "USA": "USA",
    "DEU": "Deutschland",
    "FRA": "Frankreich",
    "GBR": "Großbritannien",
    "ITA": "Italien",
    "ESP": "Spanien",
    "JPN": "Japan",
    "CHN": "China",
    "IND": "Indien",
    "BRA": "Brasilien",
    "CAN": "Kanada",
    "AUS": "Australien",
}

INDICES = [
    Instrument("GSPC.INDX", "S&P 500", "Amerika"),
    Instrument("NDX.INDX", "Nasdaq 100", "Amerika"),
    Instrument("DJI.INDX", "Dow Jones Industrial", "Amerika"),
    Instrument("RUT.INDX", "Russell 2000", "Amerika"),
    Instrument("GSPTSE.INDX", "S&P/TSX Composite", "Amerika"),
    Instrument("GDAXI.INDX", "DAX", "Europa"),
    Instrument("MDAXI.INDX", "MDAX", "Europa"),
    Instrument("STOXX50E.INDX", "Euro Stoxx 50", "Europa"),
    Instrument("FCHI.INDX", "CAC 40", "Europa"),
    Instrument("FTSE.INDX", "FTSE 100", "Europa"),
    Instrument("SSMI.INDX", "SMI", "Europa"),
    Instrument("N225.INDX", "Nikkei 225", "Asien/Pazifik"),
    Instrument("HSI.INDX", "Hang Seng", "Asien/Pazifik"),
    Instrument("AXJO.INDX", "S&P/ASX 200", "Asien/Pazifik"),
    Instrument("VIX.INDX", "CBOE Volatility (VIX)", "Volatilität"),
]

FX = [
    Instrument("EURUSD.FOREX", "EUR/USD"),
    Instrument("GBPUSD.FOREX", "GBP/USD"),
    Instrument("USDJPY.FOREX", "USD/JPY"),
    Instrument("USDCHF.FOREX", "USD/CHF"),
    Instrument("AUDUSD.FOREX", "AUD/USD"),
    Instrument("USDCAD.FOREX", "USD/CAD"),
    Instrument("NZDUSD.FOREX", "NZD/USD"),
    Instrument("EURGBP.FOREX", "EUR/GBP"),
    Instrument("EURCHF.FOREX", "EUR/CHF"),
    Instrument("EURJPY.FOREX", "EUR/JPY"),
    Instrument("USDCNH.FOREX", "USD/CNH"),
    Instrument("BTC-USD.CC", "Bitcoin/USD"),
]

# Weltkarte (WMAP): Länder mit Aktienindex und zehnjähriger Staatsanleihe (Kürzel {Land}10Y.GBOND).
# ISO3, Name, Anleihe-Land (oder None), Index (oder None), Indexname
WORLD: list[tuple[str, str, Optional[str], Optional[str], Optional[str]]] = [
    ("USA", "USA", "US", "GSPC.INDX", "S&P 500"),
    ("CAN", "Kanada", "CA", "GSPTSE.INDX", "S&P/TSX Composite"),
    ("MEX", "Mexiko", "MX", "MXX.INDX", "IPC Mexiko"),
    ("BRA", "Brasilien", "BR", "BVSP.INDX", "Bovespa"),
    ("ARG", "Argentinien", None, "MERV.INDX", "Merval"),
    ("CHL", "Chile", "CL", None, None),
    ("DEU", "Deutschland", "DE", "GDAXI.INDX", "DAX"),
    ("FRA", "Frankreich", "FR", "FCHI.INDX", "CAC 40"),
    ("GBR", "Großbritannien", "UK", "FTSE.INDX", "FTSE 100"),
    ("ITA", "Italien", "IT", "FTSEMIB.INDX", "FTSE MIB"),
    ("ESP", "Spanien", "ES", "IBEX.INDX", "IBEX 35"),
    ("NLD", "Niederlande", "NL", "AEX.INDX", "AEX"),
    ("BEL", "Belgien", "BE", "BFX.INDX", "BEL 20"),
    ("AUT", "Österreich", "AT", "ATX.INDX", "ATX"),
    ("CHE", "Schweiz", "CH", "SSMI.INDX", "SMI"),
    ("SWE", "Schweden", "SE", "OMXS30.INDX", "OMX Stockholm 30"),
    ("NOR", "Norwegen", "NO", None, None),
    ("DNK", "Dänemark", "DK", None, None),
    ("FIN", "Finnland", "FI", None, None),
    ("POL", "Polen", "PL", "WIG20.INDX", "WIG 20"),
    ("PRT", "Portugal", "PT", "PSI20.INDX", "PSI 20"),
    ("GRC", "Griechenland", "GR", None, None),
    ("IRL", "Irland", "IE", None, None),
    ("TUR", "Türkei", "TR", "XU100.INDX", "BIST 100"),
    ("ISR", "Israel", "IL", "TA125.INDX", "TA-125"),
    ("SAU", "Saudi-Arabien", None, None, None),
    ("ZAF", "Südafrika", "ZA", None, None),
    ("JPN", "Japan", "JP", "N225.INDX", "Nikkei 225"),
    ("CHN", "China", "CN", "SSEC.INDX", "Shanghai Composite"),
    ("IND", "Indien", "IN", "NSEI.INDX", "Nifty 50"),
    ("KOR", "Südkorea", "KR", "KS11.INDX", "KOSPI"),
    ("TWN", "Taiwan", None, "TWII.INDX", "Taiex"),
    ("IDN", "Indonesien", "ID", "JKSE.INDX", "Jakarta Composite"),
    ("AUS", "Australien", "AU", "AXJO.INDX", "S&P/ASX 200"),
    ("NZL", "Neuseeland", "NZ", "NZ50.INDX", "NZX 50"),
]

CURVE_TENORS = [
    ("3M", 0.25), ("6M", 0.5), ("1Y", 1.0), ("2Y", 2.0), ("3Y", 3.0), ("5Y", 5.0),
    ("7Y", 7.0), ("10Y", 10.0), ("20Y", 20.0), ("30Y", 30.0),
]

CURVE_COUNTRIES = {
    "US": "USA",
    "DE": "Deutschland",
    "UK": "Großbritannien",
    "FR": "Frankreich",
    "IT": "Italien",
    "JP": "Japan",
}


def curve_catalog() -> dict[str, tuple[str, list[tuple[str, float, str]]]]:
    return {
        cc: (name, [(tenor, years, f"{cc}{tenor}.GBOND") for tenor, years in CURVE_TENORS])
        for cc, name in CURVE_COUNTRIES.items()
    }
