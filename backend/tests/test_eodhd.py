"""EODHD-Client und Mapping gegen nachgebaute API-Antworten (ohne Netz)."""

import asyncio
import datetime as dt
import json

import httpx
import pytest

from app.config import Settings
from app.eodhd import mapping
from app.eodhd.client import EODHDClient
from app.errors import AuthError, BudgetExceeded, NotFound, PlanNotIncluded, UpstreamError
from app.providers.base import ScreenFilter
from app.providers.eodhd import EODHDProvider

FUNDAMENTALS = {
    "General": {
        "Code": "AAPL", "Name": "Apple Inc", "Exchange": "NASDAQ", "CurrencyCode": "USD",
        "CountryName": "USA", "Sector": "Technology", "Industry": "Consumer Electronics",
        "Description": "Apple designs smartphones.", "FullTimeEmployees": "161000",
        "Officers": {"0": {"Name": "Mr. Example", "Title": "CEO", "YearBorn": "1960"}},
    },
    "Highlights": {
        "MarketCapitalization": 3400000000000, "PERatio": "33.1", "DividendYield": "0.0044",
        "EarningsShare": 6.57, "ProfitMargin": 0.24, "RevenueTTM": "391035000000",
        "WallStreetTargetPrice": 245.5,
    },
    "Valuation": {"TrailingPE": 33.1, "ForwardPE": "30.2", "EnterpriseValueEbitda": "NA"},
    "Technicals": {"Beta": 1.2, "52WeekHigh": 237.2, "52WeekLow": 164.1},
    "AnalystRatings": {"Rating": "4.1", "TargetPrice": 245.5, "StrongBuy": 20, "Buy": 8, "Hold": 12, "Sell": 1, "StrongSell": 2},
    "Earnings": {
        "History": {
            "2026-12-31": {"reportDate": "2027-01-29", "date": "2026-12-31", "epsActual": None, "epsEstimate": 2.4},
            "2026-09-30": {"reportDate": "2026-10-30", "date": "2026-09-30", "epsActual": 1.64, "epsEstimate": 1.6, "surprisePercent": 2.5},
            "2026-06-30": {"reportDate": "2026-07-31", "date": "2026-06-30", "epsActual": 1.40, "epsEstimate": 1.35},
        }
    },
    "Financials": {
        "Income_Statement": {
            "currency_symbol": "USD",
            "yearly": {
                "2025-09-30": {"date": "2025-09-30", "totalRevenue": "391035000000.00", "grossProfit": "180683000000.00", "operatingIncome": "123216000000.00", "netIncome": "93736000000.00"},
                "2024-09-30": {"date": "2024-09-30", "totalRevenue": "383285000000.00", "grossProfit": None, "netIncome": "96995000000.00"},
            },
            "quarterly": {},
        },
        "Balance_Sheet": {"currency_symbol": "USD", "yearly": {"2025-09-30": {"totalAssets": "364980000000.00", "cashAndShortTermInvestments": "65171000000"}}},
        "Cash_Flow": {"yearly": {"2025-09-30": {"totalCashFromOperatingActivities": "118254000000", "capitalExpenditures": "9447000000"}}},
    },
}


def test_history_adjusts_ohlc_and_sorts():
    raw = [
        {"date": "2026-01-03", "open": 200, "high": 210, "low": 190, "close": 200, "adjusted_close": 100, "volume": 5},
        {"date": "2026-01-02", "open": 98, "high": 101, "low": 97, "close": 100, "adjusted_close": 100, "volume": 7},
        {"date": "2026-01-04", "close": None, "adjusted_close": None},
    ]
    h = mapping.history(raw, "X.US")
    assert h.t == ["2026-01-02", "2026-01-03"]
    assert h.c == [100, 100]
    assert h.h[1] == pytest.approx(105)  # 210 * 0.5 (Split-Faktor)


def test_quotes_single_and_multi():
    single = {"code": "AAPL.US", "timestamp": 1790000000, "close": 230.5, "previousClose": 228, "change": 2.5, "change_p": 1.0965}
    q = mapping.quotes(single, ["AAPL.US"])[0]
    assert q.last == 230.5 and q.change_pct == pytest.approx(1.0965) and q.timestamp.endswith("Z")
    multi = [single, {"code": "MSFT.US", "close": "NA"}]
    out = mapping.quotes(multi, ["AAPL.US", "MSFT.US", "NVDA.US"])
    assert out[0].last == 230.5 and out[1].last is None and out[2].ticker == "NVDA.US"


def test_company_and_financials_mapping():
    c = mapping.company(FUNDAMENTALS, "AAPL.US")
    assert c.name == "Apple Inc" and c.employees == 161000
    assert c.valuation.forward_pe == pytest.approx(30.2)
    assert c.valuation.ev_ebitda is None
    assert c.per_share.dividend_yield == pytest.approx(0.0044)
    assert c.officers[0].name == "Mr. Example"

    f = mapping.financials(FUNDAMENTALS, "AAPL.US", "annual")
    assert f.periods == ["2025-09-30", "2024-09-30"]
    rev = next(r for r in f.income if r.key == "totalRevenue")
    assert rev.values[0] == pytest.approx(391035000000.0)
    margin = next(r for r in f.income if r.key == "grossProfitMargin")
    assert margin.kind == "ratio" and margin.values[1] is None
    cash = next(r for r in f.balance if r.key == "cash")
    assert cash.values[0] == pytest.approx(65171000000)  # Ersatzschlüssel
    fcf = next(r for r in f.cashflow if r.key == "freeCashFlow")
    assert fcf.values[0] == pytest.approx(118254000000 - 9447000000)


def test_financials_empty():
    f = mapping.financials({}, "X.US", "quarterly")
    assert f.periods == [] and f.income == []


def test_earnings_next_and_history():
    e = mapping.earnings(FUNDAMENTALS, "AAPL.US", today=dt.date(2026, 11, 1))
    assert e.next is not None and e.next.report_date == "2027-01-29"
    assert [h.date for h in e.history] == ["2026-09-30", "2026-06-30"]
    assert e.history[1].surprise_pct == pytest.approx((1.40 - 1.35) / 1.35 * 100)


def test_dividends_and_split_ratio():
    d = mapping.dividends(
        [{"date": "2026-08-10", "value": 0.26, "currency": "USD"}, {"date": "2024-01-10", "value": 0.24}],
        [{"date": "2020-08-31", "split": "4.000000/1.000000"}],
        "AAPL.US",
        today=dt.date(2026, 10, 1),
    )
    assert d.ttm == pytest.approx(0.26)
    assert d.splits[0].ratio == "4:1"


def test_news_mapping_topic_and_date():
    items = mapping.news(
        [
            {"date": "2026-10-28T13:30:00+00:00", "title": "Apple beats earnings estimates", "content": "x",
             "link": "https://www.example.com/a", "symbols": ["AAPL.US"], "tags": ["EARNINGS"],
             "sentiment": {"polarity": 0.9, "neg": 0, "neu": 0.1, "pos": 0.9}},
            {"title": "missing date"},
        ]
    )
    assert len(items) == 1
    n = items[0]
    assert n.date == "2026-10-28T13:30:00Z" and n.topic == "earnings" and n.source == "example.com"
    assert n.sentiment.polarity == 0.9


def test_econ_events_mapping():
    ev = mapping.econ_events(
        [{"type": "CPI", "comparison": "yoy", "country": "US", "date": "2026-10-15 12:30:00",
          "actual": 3.1, "estimate": "3.0", "previous": 2.9, "period": "Sep"}]
    )
    assert ev[0].event == "CPI YOY" and ev[0].surprise == pytest.approx(0.1) and ev[0].importance == 3
    assert ev[0].date == "2026-10-15T12:30:00Z"


def test_screen_rows_mapping():
    rows = mapping.screen_rows({"data": [
        {"code": "AAPL", "name": "Apple", "exchange": "US", "adjusted_close": 230, "earnings_share": 6.5,
         "dividend_yield": 0.0044, "market_capitalization": 3.4e12, "refund_1d_p": 1.2, "sector": "Technology"},
        {"code": "LOSS", "exchange": "US", "adjusted_close": 10, "earnings_share": -1},
    ]})
    assert rows[0].ticker == "AAPL.US" and rows[0].pe == pytest.approx(230 / 6.5)
    assert rows[0].div_yield == pytest.approx(0.44)
    assert rows[1].pe is None


def _client(handler, **kw):
    return EODHDClient("KEY", "https://example.test/api", transport=httpx.MockTransport(handler), backoff_base=0.0, **kw)


def test_client_errors_and_retry():
    async def run():
        calls = {"n": 0}

        def flaky(request: httpx.Request):
            calls["n"] += 1
            assert request.url.params["api_token"] == "KEY"
            if calls["n"] < 3:
                return httpx.Response(429)
            return httpx.Response(200, json=[{"date": "2026-01-02", "close": 1}])

        c = _client(flaky)
        assert await c.get("eod/AAPL.US") == [{"date": "2026-01-02", "close": 1}]
        assert calls["n"] == 3

        for status, exc in ((401, AuthError), (403, PlanNotIncluded), (404, NotFound)):
            c = _client(lambda r, s=status: httpx.Response(s))
            with pytest.raises(exc):
                await c.get("eod/AAPL.US")

        c = _client(lambda r: httpx.Response(500))
        with pytest.raises(UpstreamError):
            await c.get("eod/AAPL.US")

        c = _client(lambda r: httpx.Response(200, text="Ticker Not Found."))
        with pytest.raises(NotFound):
            await c.get("eod/NOPE.US")

        c = _client(lambda r: httpx.Response(200, json={}), daily_budget=12)
        await c.get("fundamentals/AAPL.US")  # 10 Einheiten
        with pytest.raises(BudgetExceeded):
            await c.get("fundamentals/MSFT.US")

    asyncio.run(run())


def test_provider_screener_request_building():
    seen = []

    def handler(request: httpx.Request):
        seen.append(request)
        return httpx.Response(200, json={"data": [{"code": "AAPL", "exchange": "US", "adjusted_close": 1, "earnings_share": 1}]})

    async def run():
        cfg = Settings(eodhd_api_key="KEY")
        client = _client(handler)
        prov = EODHDProvider(cfg, client=client)
        rows, local, notes = await prov.screener(
            [ScreenFilter("exchange", "eq", "US"), ScreenFilter("div_yield", "gt", 2), ScreenFilter("pe", "lt", 20)],
            "chg_1d", True, 50,
        )
        assert len(rows) == 1 and [f.field for f in local] == ["pe"]
        params = seen[0].url.params
        assert json.loads(params["filters"]) == [["exchange", "=", "us"], ["dividend_yield", ">", 0.02]]
        assert params["sort"] == "refund_1d_p.desc" and params["limit"] == "50"
        await prov.close()

    asyncio.run(run())


def test_provider_resolves_commodity_codes_to_etf_proxies():
    """'CL1 Comdty' -> WTI.COMM gibt es bei EODHD nicht; aufgelöst wird der ETF aus CMDT."""
    seen = []

    def handler(request: httpx.Request):
        seen.append(request.url.path)
        return httpx.Response(200, json={"code": "USO.US", "timestamp": 1761768000, "close": 75.1, "previousClose": 74.0, "change": 1.1, "change_p": 1.49})

    async def run():
        prov = EODHDProvider(Settings(eodhd_api_key="KEY"), client=_client(handler))
        hit = await prov.resolve("WTI.COMM")
        assert hit is not None and hit.ticker == "USO.US"
        assert seen and seen[0].endswith("/real-time/USO.US")
        await prov.close()

    asyncio.run(run())
