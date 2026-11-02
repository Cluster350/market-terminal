"""Tests des Depots: Statistik, Währungen, Speicher und API mit Demo-Daten."""

import asyncio
import dataclasses
import datetime as dt
import json

import pytest
from fastapi.testclient import TestClient

from app.cache import TTLCache
from app.config import settings
from app.errors import BadRequest
from app.main import create_app
from app.portfolio.analytics import FxBook, _drawdown, _quantile, analyze, ffill
from app.portfolio.models import Portfolio, Position
from app.portfolio.store import Conflict, PortfolioStore
from app.providers.demo import DemoProvider
from app.services.terminal import Terminal

UTC = dt.timezone.utc
NOW = dt.datetime(2026, 10, 28, 15, 0, tzinfo=UTC)


def run(coro):
    return asyncio.run(coro)


# --- Rechenbausteine -----------------------------------------------------------------


def test_quantile_drawdown_ffill():
    xs = sorted([-0.05, -0.02, 0.0, 0.01, 0.03])
    assert _quantile(xs, 0.0) == -0.05 and _quantile(xs, 1.0) == 0.03
    assert _quantile(xs, 0.25) == pytest.approx(-0.02)
    assert _quantile(xs, 0.1) == pytest.approx(-0.038)
    dd, peak, trough = _drawdown(["a", "b", "c", "d", "e"], [100, 120, 90, 110, 130])
    assert dd == pytest.approx(-25.0) and (peak, trough) == ("b", "c")
    assert _drawdown(["a", "b"], [1, 2])[0] == 0.0
    # Feiertag (02.) mit dem Vortag füllen, vor dem ersten Kurs None
    assert ffill(["2026-01-01", "2026-01-02", "2026-01-05"], ["2026-01-02", "2026-01-05"], [10, None]) == [None, 10, 10]


def test_fx_book_cross_rates_and_pence():
    fx = FxBook("EUR", {"USD": 1.0, "EUR": 1.10, "GBP": 1.30}, {"EUR": (["2026-01-02"], [1.05])})
    assert fx.now("USD") == pytest.approx(1 / 1.10)
    assert fx.now("EUR") == pytest.approx(1.0)
    assert fx.now("GBX") == pytest.approx(1.30 / 1.10 / 100)  # Londoner Kurse in Pence
    assert fx.at("USD", "2026-01-05") == pytest.approx(1 / 1.05)  # Kurs am Kaufdatum
    assert fx.now("JPY") is None


# --- Speicher -------------------------------------------------------------------------


def test_store_roundtrip_conflict_and_validation(tmp_path):
    store = PortfolioStore(tmp_path, "demo")
    assert store.load() is None
    p = Portfolio(positions=[Position(ticker="nwnd", quantity=10, cost=100.5, opened="2026-01-05")])
    saved = run(store.save(p, 0))
    assert saved.version == 1 and saved.positions[0].ticker == "NWND.US" and saved.positions[0].id
    assert store.load().positions[0].cost == 100.5
    with pytest.raises(Conflict):
        run(store.save(p, 0))  # veralteter Stand aus einem anderen Fenster
    with pytest.raises(BadRequest, match="doppelt"):
        run(store.save(Portfolio(positions=[Position(ticker="NWND", quantity=1), Position(ticker="NWND.US", quantity=2)]), 1))
    with pytest.raises(BadRequest, match="ETF"):
        run(store.save(Portfolio(positions=[Position(ticker="DAX Index", quantity=1)]), 1))
    # Datei im Benutzerformat (camelCase) und lesbar
    data = json.loads((tmp_path / "depot-demo.json").read_text(encoding="utf-8"))
    assert data["positions"][0]["ticker"] == "NWND.US" and data["version"] == 1


def test_store_sets_aside_a_broken_file(tmp_path):
    (tmp_path / "depot-demo.json").write_text("{kaputt", encoding="utf-8")
    store = PortfolioStore(tmp_path, "demo")
    assert store.load() is None
    assert any(f.name.startswith("depot-demo.defekt-") for f in tmp_path.iterdir())


def test_position_validation():
    with pytest.raises(ValueError):
        Position(ticker="X", quantity=0)
    with pytest.raises(ValueError):
        Position(ticker="X", quantity=1, cost=-5)
    with pytest.raises(ValueError):
        Position(ticker="X", quantity=1, opened="gestern")
    assert Position(ticker="X", quantity=1, currency="GBp").currency == "GBX"


# --- Kennzahlen ----------------------------------------------------------------------


def terminal() -> Terminal:
    return Terminal(DemoProvider(now_fn=lambda: NOW), TTLCache())


def test_analytics_values_pnl_and_shorts():
    t = terminal()
    q = run(t.quotes(["NRDW.XETRA"]))[0]
    p = Portfolio(base="EUR", cash=1000, positions=[
        Position(id="a", ticker="NRDW.XETRA", quantity=10, cost=q.last / 2),
        Position(id="b", ticker="ALPV.XETRA", quantity=-5, cost=1.0),
    ])
    a = run(analyze(t, p))
    long, short = a.rows
    assert long.value == pytest.approx(10 * q.last) and long.fx == 1.0
    assert long.pnl == pytest.approx(10 * q.last / 2) and long.pnl_pct == pytest.approx(100.0)
    assert short.value < 0 and short.pnl < 0 and short.pnl_pct < 0  # Leerverkauf verliert bei steigendem Kurs
    assert a.summary.value == pytest.approx(long.value + short.value + 1000)
    assert sum(r.weight for r in a.rows) + 1000 / a.summary.value * 100 == pytest.approx(100.0)


def test_analytics_risk_is_consistent():
    t = terminal()
    p = Portfolio(base="EUR", positions=[
        Position(ticker="NWND.US", quantity=500), Position(ticker="NRDW.XETRA", quantity=80),
        Position(ticker="GLTS.SW", quantity=10), Position(ticker="THMS.LSE", quantity=30),
    ])
    a = run(analyze(t, p))
    r = a.risk
    assert 200 < r.days < 270 and r.vol > 0 and r.beta is not None
    assert sum(x.risk_share for x in a.rows) == pytest.approx(100.0)
    assert r.es95 >= r.var95 > 0 and r.max_drawdown <= 0
    assert len(a.series.t) == len(a.series.portfolio) == len(a.series.benchmark) and a.series.portfolio[0] == 100.0
    m = a.correlation.matrix
    assert all(m[i][i] == pytest.approx(1.0) for i in range(len(m))) and m[0][1] == m[1][0]
    assert a.benchmark == "GSPC.INDX"  # größter Anteil an US-Börsen -> S&P 500
    assert {s.key for s in a.allocation["currency"]} == {"USD", "EUR", "CHF", "GBP"}


# --- API ------------------------------------------------------------------------------


@pytest.fixture()
def client(tmp_path):
    cfg = dataclasses.replace(settings, llm_mode="demo", portfolio_dir=str(tmp_path))
    with TestClient(create_app(DemoProvider(now_fn=lambda: NOW), cfg)) as c:
        yield c


def test_api_sample_save_and_analytics(client, tmp_path):
    p = client.get("/api/portfolio").json()
    assert p["sample"] and len(p["positions"]) >= 8 and p["version"] == 0
    assert not (tmp_path / "depot-demo.json").exists()  # Muster wird erst beim Speichern zur Datei
    a = client.get("/api/portfolio/analytics").json()
    assert a["summary"]["count"] == len(p["positions"]) and a["risk"]["vol"] > 0

    body = {**p, "positions": p["positions"][:2] + [{"ticker": "MTHR SW", "quantity": 7, "cost": 90}], "benchmark": "DAX Index"}
    saved = client.put("/api/portfolio", json=body).json()
    assert saved["version"] == 1 and not saved["sample"] and saved["benchmark"] == "GDAXI.INDX"
    assert saved["positions"][2]["ticker"] == "MTHR.SW"
    a = client.get("/api/portfolio/analytics").json()
    assert a["summary"]["count"] == 3 and a["benchmarkName"] == "DAX"

    r = client.put("/api/portfolio", json={**saved, "positions": [{"ticker": "GIBTSNICHT US", "quantity": 1}]})
    assert r.status_code == 404
    r = client.put("/api/portfolio", json={**saved, "version": 0})
    assert r.status_code == 409 and "anderen Fenster" in r.json()["error"]["message"]
    r = client.put("/api/portfolio", json={**saved, "benchmark": "NWND US"})
    assert r.status_code == 400


def test_ai_depot_tool_and_demo_answer(client):
    a = client.post("/api/ai/ask", json={"question": "Wie riskant ist mein Depot?"}).json()
    assert a["trace"][0]["tool"] == "depot" and a["trace"][0]["ok"]
    assert "Ihr Depot ist" in a["answer"] and a["unverified"] == []
    assert a["suggestions"][0]["fn"] == "PORT"


def test_api_base_change_converts_cash(client):
    p = client.get("/api/portfolio").json()
    saved = client.put("/api/portfolio", json={**p, "base": "USD"}).json()
    eurusd = client.get("/api/quotes?tickers=EURUSD.FOREX").json()[0]["last"]
    assert saved["base"] == "USD" and saved["cash"] == pytest.approx(p["cash"] * eurusd, rel=1e-3)
    # Kasse und Basis zugleich geändert: der eingegebene Betrag gilt
    again = client.put("/api/portfolio", json={**saved, "base": "EUR", "cash": 1234}).json()
    assert again["cash"] == 1234
