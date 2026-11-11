"""Regressionstests Runde 8."""

import datetime as dt

import pytest
from fastapi.testclient import TestClient

from app.main import access_problem, create_app
from app.providers.demo import DemoProvider

NOW = dt.datetime(2026, 10, 28, 15, 0, tzinfo=dt.timezone.utc)


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app(DemoProvider(now_fn=lambda: NOW))) as c:
        yield c


def test_worldmap_note_matches_group(client):
    """Bei „equity“ überschrieb der Makro-Hinweis („Jahreswerte (Weltbank-Basis)…“) den Text zu den Aktienindizes."""
    eq = client.get("/api/macro/worldmap?group=equity").json()
    assert eq["note"].startswith("Wertentwicklung des wichtigsten Aktienindex")
    assert eq["indicators"] == [] and eq["asOf"]
    assert client.get("/api/macro/worldmap?group=rates").json()["note"].startswith("Rendite zehnjähriger")
    macro = client.get("/api/macro/worldmap?group=macro").json()
    assert "Jahreswerte" in macro["note"] and macro["indicators"]
    # der Realzins (Rendite minus Inflation) braucht im Makro-Bereich weiter die Anleihen
    by = {c["iso3"]: c for c in macro["countries"]}
    assert by["DEU"]["bond"] is not None and "real_interest_rate" in by["DEU"]["macro"]


@pytest.mark.parametrize("host", ["localhost.", "localhost.:8000", "LOCALHOST.:8000", "127.0.0.1.:8000"])
def test_host_with_trailing_dot_is_local(host):
    """„http://localhost.:8000“ (voll ausgeschriebener Name) ist derselbe Rechner und wurde mit 400 abgewiesen."""
    assert access_problem("GET", "/api/status", {"host": host}) is None
    origin = {"host": host, "origin": f"http://{host}", "content-type": "application/json", "content-length": "2"}
    assert access_problem("POST", "/api/alerts", origin) is None


@pytest.mark.parametrize("host", ["evil.example.", "localhost.evil.example", "localhost..", ".", "127.0.0.1.evil.example.:8000"])
def test_foreign_hosts_stay_rejected(host):
    assert access_problem("GET", "/api/status", {"host": host}) == (400, "host", access_problem("GET", "/", {"host": host})[2])
    assert access_problem("POST", "/api/alerts", {"host": "127.0.0.1:8000", "origin": f"http://{host}"})[0] == 403


def test_day_pnl_percent_has_sign_of_amount(client):
    """Reines Short-Depot bzw. Kredit größer als das Depot: „Heute“ zeigte Betrag und Prozent mit
    entgegengesetztem Vorzeichen (−43,76 und +2,62 %), weil durch den negativen Vortageswert geteilt wurde."""
    import asyncio

    from app.portfolio.analytics import analyze
    from app.portfolio.models import Portfolio, Position

    t = client.app.state.terminal
    for p in (
        Portfolio(base="EUR", positions=[Position(ticker="NWND.US", quantity=-10, cost=50)]),
        Portfolio(base="EUR", cash=-1e6, positions=[Position(ticker="NWND.US", quantity=10, cost=50)]),
        Portfolio(base="EUR", positions=[Position(ticker="NWND.US", quantity=10, cost=50)]),
    ):
        s = asyncio.run(analyze(t, p)).summary
        assert s.day_pnl and s.day_pnl_pct
        assert (s.day_pnl > 0) == (s.day_pnl_pct > 0)
        assert abs(s.day_pnl_pct) == pytest.approx(abs(s.day_pnl / (s.value - s.day_pnl)) * 100)


def test_no_weights_when_portfolio_value_is_negative(client):
    """Bei negativem Depotwert (Kredit größer als das Depot) bekam eine Kaufposition ein negatives Gewicht."""
    import asyncio

    from app.portfolio.analytics import analyze
    from app.portfolio.models import Portfolio, Position

    t = client.app.state.terminal
    a = asyncio.run(analyze(t, Portfolio(base="EUR", cash=-1e6, positions=[Position(ticker="NWND.US", quantity=10, cost=50)])))
    assert a.summary.value < 0 and all(r.weight is None for r in a.rows)
    assert all(s.weight == 0 for slices in a.allocation.values() for s in slices)
    a = asyncio.run(analyze(t, Portfolio(base="EUR", cash=100, positions=[Position(ticker="NWND.US", quantity=10, cost=50)])))
    assert a.rows[0].weight and a.rows[0].weight > 0
