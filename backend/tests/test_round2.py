"""Regressionstests zu den Befunden der ersten Abnahme (B1–B3, M1–M6) und neuen Endpunkten."""

import datetime as dt

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.providers.demo import DemoProvider, holidays
from app.services import metrics

UTC = dt.timezone.utc
NOW = dt.datetime(2026, 10, 28, 15, 0, tzinfo=UTC)


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app(DemoProvider(now_fn=lambda: NOW))) as c:
        yield c


def test_perf_since_uses_close_before_period(client):
    h = client.get("/api/history/NWND.US").json()
    # 12M: Basis ist der letzte Schluss am oder vor dem gleichen Kalendertag vor einem Jahr
    cutoff = metrics.shift_date(dt.date.fromisoformat(h["t"][-1]), months=12).isoformat()
    base = [c for d, c in zip(h["t"], h["c"]) if d <= cutoff][-1]
    expected = (h["c"][-1] / base - 1) * 100
    assert metrics.perf_since(h["t"], h["c"], months=12) == pytest.approx(expected)
    row = client.post("/api/screener", json={"filters": [{"field": "name", "op": "contains", "value": "Northwind"}], "enrich": True}).json()["rows"][0]
    assert row["perf12m"] == pytest.approx(expected, abs=1e-6)


def test_52w_high_matches_history(client):
    h = client.get("/api/history/NWND.US").json()
    c = client.get("/api/company/NWND.US").json()
    hi, lo = metrics.window_high_low(h["t"], h["h"], h["l"])
    assert c["technicals"]["high52"] == pytest.approx(hi, abs=0.01)
    assert c["technicals"]["low52"] == pytest.approx(lo, abs=0.01)


def test_market_cap_in_usd_for_filters_and_sorting(client):
    rows = client.post("/api/screener", json={"filters": [], "sort": "market_cap", "limit": 50}).json()["rows"]
    caps = [r["marketCap"] for r in rows]
    assert caps == sorted(caps, reverse=True)
    eur = next(r for r in rows if r["currency"] == "EUR")
    eurusd = client.get("/api/quotes?tickers=EURUSD.FOREX").json()[0]["last"]
    assert eur["marketCap"] == pytest.approx(eur["marketCapLocal"] * eurusd, rel=1e-6)


def test_holidays_are_not_trading_days(client):
    us = client.get("/api/history/NWND.US").json()["t"]
    de = client.get("/api/history/ELBT.XETRA").json()["t"]
    assert "2025-12-25" not in us and "2026-01-01" not in us
    assert "2025-11-27" not in us  # Thanksgiving
    assert "2025-11-27" in de and "2025-12-24" not in de
    assert dt.date(2026, 4, 3) in holidays("eu", 2026)  # Karfreitag


def test_us_session_follows_daylight_saving(client):
    t = client.get("/api/intraday/NWND.US?days=1").json()["t"]
    assert dt.datetime.fromtimestamp(t[0], UTC).strftime("%H:%M") == "13:30"  # EDT
    with TestClient(create_app(DemoProvider(now_fn=lambda: dt.datetime(2026, 12, 2, 17, 0, tzinfo=UTC)))) as c:
        t = c.get("/api/intraday/NWND.US?days=1").json()["t"]
        assert dt.datetime.fromtimestamp(t[0], UTC).strftime("%H:%M") == "14:30"  # EST


def test_fx_crosses_are_arbitrage_free(client):
    q = {x["ticker"]: x["last"] for x in client.get("/api/quotes?tickers=EURUSD.FOREX,GBPUSD.FOREX,EURGBP.FOREX,USDJPY.FOREX,EURJPY.FOREX").json()}
    assert q["EURGBP.FOREX"] == pytest.approx(q["EURUSD.FOREX"] / q["GBPUSD.FOREX"], rel=2e-4)
    assert q["EURJPY.FOREX"] == pytest.approx(q["EURUSD.FOREX"] * q["USDJPY.FOREX"], rel=2e-4)


def test_peg_only_with_growth(client):
    for t in ("NWND.US", "LMRE.PA", "ORCX.US", "AQTN.PA"):
        c = client.get(f"/api/company/{t}").json()
        peg, pe = c["valuation"]["peg"], c["valuation"]["pe"]
        assert peg is None or peg != pe


def test_calendar_periods_and_previous_values(client):
    cal = client.get("/api/macro/calendar?from=2026-10-01&to=2026-10-30&country=US").json()
    claims = [e for e in cal if e["event"] == "Initial Jobless Claims"]
    assert all(e["period"].startswith("Woche bis") for e in claims)
    for a, b in zip(claims, claims[1:]):
        assert b["previous"] == a["actual"]  # Vorwert = letzter Ist-Wert
    assert len({e["actual"] for e in claims if e["actual"] is not None}) > 1
    gdp = next(e for e in cal if e["event"].startswith("GDP"))
    assert gdp["period"] == "Q3 2026"
    fed = [e for e in client.get("/api/macro/calendar?from=2026-10-15&to=2026-10-31").json() if "Interest Rate Decision" in e["event"]]
    assert all(e["period"] is None for e in fed)
    de = client.get("/api/macro/calendar?from=2026-10-19&to=2026-10-30&country=DE").json()
    ifo = next(e for e in de if e["event"] == "Ifo Business Climate")
    assert ifo["period"] == "Okt 2026"


def test_earnings_news_match_report_dates(client):
    news = client.get("/api/news?topic=earnings&limit=300").json()["items"]
    reports = client.get("/api/calendar/earnings?from=2026-10-12&to=2026-10-28").json()
    dates = {(r["ticker"], r["reportDate"]) for r in reports}
    for n in news:
        if "Quartal" in n["title"]:
            assert (n["symbols"][0], n["date"][:10]) in dates or n["date"][:10] < "2026-10-12"
    assert all(dt.date.fromisoformat(n["date"][:10]).weekday() < 5 for n in news)


def test_resolve_and_yellow_keys(client):
    assert client.get("/api/resolve?q=DAX INDEX").json()["ticker"] == "GDAXI.INDX"
    assert client.get("/api/resolve?q=EURUSD CURNCY").json()["ticker"] == "EURUSD.FOREX"
    r = client.get("/api/resolve?q=XYZQ US")
    assert r.status_code == 404 and "Unbekannter Ticker" in r.json()["error"]["message"]


def test_peers_and_earnings_calendar(client):
    p = client.get("/api/peers/ELBT.XETRA").json()
    assert p["rows"][0]["ticker"] == "ELBT.XETRA" and len(p["rows"]) >= 4
    assert p["median"]["ticker"] == "MEDIAN"
    ev = client.get("/api/calendar/earnings?from=2026-10-26&to=2026-11-08").json()
    assert ev and all("2026-10-26" <= e["reportDate"] <= "2026-11-08" for e in ev)
    future = [e for e in ev if e["reportDate"] > "2026-10-28"]
    assert all(e["epsActual"] is None for e in future)
    assert client.get("/api/calendar/earnings?from=2026-10-01&to=2026-12-31").status_code == 400


def test_balance_sheet_has_long_term_items(client):
    f = client.get("/api/financials/NWND.US?period=annual").json()
    keys = {r["key"] for r in f["balance"]}
    assert {"nonCurrentAssetsTotal", "nonCurrentLiabilitiesTotal"} <= keys
    cur = next(r for r in f["balance"] if r["key"] == "totalCurrentLiabilities")["values"]
    debt = next(r for r in f["balance"] if r["key"] == "shortLongTermDebtTotal")["values"]
    assert cur != debt
