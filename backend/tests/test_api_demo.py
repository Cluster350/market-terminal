"""API-Tests mit der Demo-Datenquelle und fester Uhrzeit."""

import datetime as dt

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.providers.demo import DemoProvider

UTC = dt.timezone.utc


def make_client(now: dt.datetime) -> TestClient:
    return TestClient(create_app(DemoProvider(now_fn=lambda: now)))


@pytest.fixture(scope="module")
def client():
    # Mittwoch, US-Handel läuft (15:00 UTC)
    with make_client(dt.datetime(2026, 10, 28, 15, 0, tzinfo=UTC)) as c:
        yield c


def test_status(client):
    r = client.get("/api/status").json()
    assert r["mode"] == "demo" and r["defaults"]["watchlist"]


def test_quote_history_consistency(client):
    q = client.get("/api/quotes?tickers=NWND.US").json()[0]
    h = client.get("/api/history/NWND.US").json()
    assert h["t"][-1] == "2026-10-28"
    assert q["last"] == pytest.approx(h["c"][-1])
    assert q["prevClose"] == pytest.approx(h["c"][-2])
    assert h["l"][-1] <= h["c"][-1] <= h["h"][-1]
    assert len(h["t"]) == len(h["c"]) == len(h["v"])


def test_intraday_only_until_now(client):
    r = client.get("/api/intraday/NWND.US?days=1").json()
    assert r["t"], "Handel läuft, es muss Balken geben"
    assert max(r["t"]) + 300 <= dt.datetime(2026, 10, 28, 15, 0, tzinfo=UTC).timestamp()


def test_before_open_shows_previous_session():
    with make_client(dt.datetime(2026, 10, 28, 7, 0, tzinfo=UTC)) as c:
        h = c.get("/api/history/NWND.US").json()
        assert h["t"][-1] == "2026-10-27"
        intra = c.get("/api/intraday/NWND.US?days=1").json()
        assert intra["t"] and dt.datetime.fromtimestamp(intra["t"][0], UTC).date() == dt.date(2026, 10, 27)


def test_weekend_uses_friday():
    with make_client(dt.datetime(2026, 10, 31, 12, 0, tzinfo=UTC)) as c:  # Samstag
        h = c.get("/api/history/NWND.US").json()
        assert h["t"][-1] == "2026-10-30"


def test_company_financials_earnings(client):
    c = client.get("/api/company/ELBT.XETRA").json()
    assert c["currency"] == "EUR" and c["valuation"]["pe"] is None or c["valuation"]["pe"] > 0
    f = client.get("/api/financials/ELBT.XETRA?period=quarterly").json()
    assert len(f["periods"]) == 8
    assert all(len(r["values"]) == 8 for r in f["income"])
    e = client.get("/api/earnings/ELBT.XETRA").json()
    assert e["next"]["reportDate"] >= "2026-10-28"
    assert client.get("/api/financials/ELBT.XETRA?period=weekly").status_code == 400


def test_errors_have_json_shape(client):
    for url, code in (("/api/history/AAPL.US", 404), ("/api/history/A..B", 400), ("/api/news?topic=bad", 422), ("/api/nope", 404)):
        r = client.get(url)
        assert r.status_code == code
        assert "message" in r.json()["error"]


def test_news_filters(client):
    all_items = client.get("/api/news?limit=300").json()["items"]
    assert all(a["date"] >= b["date"] for a, b in zip(all_items, all_items[1:]))
    assert all(n["date"] <= "2026-10-28T15:00:00Z" for n in all_items)
    earn = client.get("/api/news?topic=earnings").json()["items"]
    assert earn and all(n["topic"] == "earnings" for n in earn)
    nw = client.get("/api/news?tickers=NWND.US").json()["items"]
    assert all("NWND.US" in n["symbols"] for n in nw)
    newer = client.get(f"/api/news?since={all_items[3]['date']}").json()["items"]
    assert all(n["date"] > all_items[3]["date"] for n in newer)


def test_macro(client):
    idx = client.get("/api/macro/indices").json()
    assert len(idx) == 15 and all(r["last"] is not None for r in idx)
    curves = client.get("/api/macro/curves?countries=US,DE").json()
    assert [c["country"] for c in curves] == ["US", "DE"]
    assert all(p["y"] is not None for p in curves[0]["points"])
    cal = client.get("/api/macro/calendar?from=2026-10-26&to=2026-10-30").json()
    assert cal and all("2026-10-26" <= e["date"][:10] <= "2026-10-30" for e in cal)
    future = [e for e in cal if e["date"] > "2026-10-28T15:00:00Z"]
    assert all(e["actual"] is None for e in future)
    hi = client.get("/api/macro/calendar?from=2026-10-26&to=2026-10-30&importance=3").json()
    assert all(e["importance"] == 3 for e in hi)
    assert client.get("/api/macro/calendar?from=2026-10-30&to=2026-10-01").status_code == 400
    countries = client.get("/api/macro/countries").json()
    assert len(countries["rows"]) == 12
    spreads = client.get("/api/macro/spreads").json()
    assert {s["key"] for s in spreads} >= {"us2s10s", "us_de10"}


def test_screener_filters_are_respected(client):
    body = {
        "filters": [
            {"field": "market_cap", "op": "gt", "value": 5e10},
            {"field": "perf_12m", "op": "gt", "value": -100},
            {"field": "sector", "op": "in", "value": ["Technology", "Healthcare"]},
        ],
        "sort": "perf_12m",
        "desc": True,
        "limit": 50,
    }
    r = client.post("/api/screener", json=body).json()
    rows = r["rows"]
    assert rows
    assert all(x["marketCap"] > 5e10 and x["sector"] in ("Technology", "Healthcare") for x in rows)
    perfs = [x["perf12m"] for x in rows]
    assert perfs == sorted(perfs, reverse=True)


def test_screener_validation(client):
    bad = [
        {"filters": [{"field": "nope", "op": "gt", "value": 1}]},
        {"filters": [{"field": "pe", "op": "gt", "value": "abc"}]},
        {"filters": [{"field": "pe", "op": "xx", "value": 1}]},
        {"sort": "nope"},
        {"limit": "viele"},
    ]
    for body in bad:
        r = client.post("/api/screener", json=body)
        assert r.status_code == 400, body


def test_movers_and_heatmap(client):
    m = client.get("/api/market/movers").json()
    g = [x["chg1d"] for x in m["gainers"]]
    assert g == sorted(g, reverse=True)
    heat = client.get("/api/market/heatmap").json()
    caps = [x["marketCap"] for x in heat["rows"]]
    assert caps == sorted(caps, reverse=True)


def test_search(client):
    hits = client.get("/api/search?q=dax").json()
    assert any(h["ticker"] == "GDAXI.INDX" for h in hits)
    assert client.get("/api/search?q=").json() == []
