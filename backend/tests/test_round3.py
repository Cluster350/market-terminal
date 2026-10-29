"""Regressionstests zur zweiten Abnahme (N1–N4 und Kleinbefunde)."""

import collections
import datetime as dt

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.providers.demo import DemoProvider
from app.services.tickers import normalize

UTC = dt.timezone.utc
NOW = dt.datetime(2026, 10, 29, 12, 51, tzinfo=UTC)


@pytest.fixture(scope="module")
def provider():
    return DemoProvider(now_fn=lambda: NOW)


@pytest.fixture(scope="module")
def client(provider):
    with TestClient(create_app(provider)) as c:
        yield c


def test_earnings_after_close_not_reported_before_release(client):
    """N1: Ein Bericht "nach Schluss" hat am Berichtstag mittags noch keinen Ist-Wert."""
    rows = client.get("/api/calendar/earnings", params={"from": "2026-10-29", "to": "2026-10-29"}).json()
    after = [r for r in rows if r["timing"] == "AfterMarket"]
    assert after, "Testdaten: am 29.10. berichtet mindestens ein Titel nach Schluss"
    assert all(r["epsActual"] is None for r in after)


@pytest.mark.parametrize("ticker", ["LMRE.PA", "VLTA.US", "NWND.US"])
def test_annual_equals_sum_of_quarters(client, ticker):
    """N2: Geschäftsjahr = Summe der vier Quartale (GuV)."""
    annual = client.get(f"/api/financials/{ticker}", params={"period": "annual"}).json()
    quarterly = client.get(f"/api/financials/{ticker}", params={"period": "quarterly"}).json()
    year = annual["periods"][0]  # jüngstes abgeschlossenes Geschäftsjahr
    y = int(year[:4])
    end = dt.date.fromisoformat(year)
    start = dt.date(y - 1, end.month, end.day)
    q_idx = [i for i, p in enumerate(quarterly["periods"]) if start < dt.date.fromisoformat(p) <= end]
    assert len(q_idx) == 4
    a_rows = {r["key"]: r for r in annual["income"]}
    q_rows = {r["key"]: r for r in quarterly["income"]}
    for key in ("totalRevenue", "operatingIncome", "netIncome"):
        total = sum(q_rows[key]["values"][i] for i in q_idx)
        assert a_rows[key]["values"][0] == pytest.approx(total, rel=1e-6)


def test_capex_is_outflow(client):
    fin = client.get("/api/financials/NWND.US", params={"period": "annual"}).json()
    capex = next(r for r in fin["cashflow"] if r["key"] == "capitalExpenditures")
    assert all(v is None or v <= 0 for v in capex["values"])
    ocf = next(r for r in fin["cashflow"] if r["key"] == "totalCashFromOperatingActivities")
    fcf = next(r for r in fin["cashflow"] if r["key"] == "freeCashFlow")
    assert fcf["values"][0] == pytest.approx(ocf["values"][0] + capex["values"][0], rel=1e-6)


def test_no_company_news_on_weekends_and_single_mna_per_window(provider):
    seen: dict[tuple[str, int], int] = collections.Counter()
    for k in range(120):
        d = dt.date(2026, 6, 1) + dt.timedelta(days=k)
        for n in provider._news_day(d):
            if d.weekday() >= 5:
                assert n.topic not in ("company", "analyst", "mna", "earnings"), (d, n.title)
            if n.topic == "mna":
                seen[(n.symbols[0], d.toordinal() // 30)] += 1
    assert seen and max(seen.values()) == 1


@pytest.mark.parametrize(
    "raw,expected",
    [("CL1 Comdty", "WTI.COMM"), ("CO1 COMDTY", "BRENT.COMM"), ("GC1 Comdty", "GOLD.COMM"), ("GOLD Comdty", "GOLD.COMM")],
)
def test_comdty_generics(raw, expected):
    assert normalize(raw) == expected


def test_comdty_generic_resolves(client):
    assert client.get("/api/resolve", params={"q": "CL1 Comdty"}).json()["ticker"] == "WTI.COMM"


def test_calendar_periods_respect_publication_lag(client):
    """N4: Harte Daten beziehen sich auf den vorletzten Monat, Umfragen auf den laufenden."""
    rows = client.get("/api/macro/calendar", params={"from": "2026-10-05", "to": "2026-11-13"}).json()
    got = {(e["date"][:10], e["country"], e["event"]): e for e in rows}
    assert got[("2026-10-07", "DE", "Industrial Production MoM")]["period"] == "Aug 2026"
    assert got[("2026-11-06", "US", "Trade Balance")]["period"] == "Sep 2026"
    assert got[("2026-10-09", "US", "Michigan Consumer Sentiment")]["period"] == "Okt 2026"
    assert got[("2026-10-30", "DE", "Unemployment Change")]["period"] == "Okt 2026"
    # Vorwert erst, wenn die vorherige Veröffentlichung stattgefunden hat
    assert got[("2026-11-12", "US", "Initial Jobless Claims")]["previous"] is None
    assert got[("2026-11-05", "US", "Initial Jobless Claims")]["previous"] == got[("2026-10-29", "US", "Initial Jobless Claims")]["actual"]


def test_company_news_does_not_repeat_within_window(provider):
    """R3: dieselbe Meldungsart je Unternehmen höchstens einmal je Fenster (z. B. Hochstufung)."""
    last: dict[tuple[str, str], dt.date] = {}
    for k in range(90):
        d = dt.date(2026, 7, 1) + dt.timedelta(days=k)
        titles = [n.title for n in provider._news_day(d)]
        assert len(titles) == len(set(titles)), d
        for n in provider._news_day(d):
            if n.topic != "analyst":
                continue
            kind = "up" if "hoch" in n.title else "down"
            key = (n.symbols[0], kind)
            if key in last:
                assert (d - last[key]).days >= 7, (key, last[key], d)
            last[key] = d
