"""Tests der Weltkarte: Länderdaten je Bereich, Demo-Abdeckung und API."""

import datetime as dt

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.providers.base import WORLD
from app.providers.demo import DemoProvider

NOW = dt.datetime(2026, 10, 28, 15, 0, tzinfo=dt.timezone.utc)


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app(DemoProvider(now_fn=lambda: NOW))) as c:
        yield c


def test_world_catalog_is_consistent():
    isos = [w[0] for w in WORLD]
    assert len(isos) == len(set(isos)) >= 30
    assert all(len(iso) == 3 and iso.isupper() for iso in isos)
    tickers = [w[3] for w in WORLD if w[3]]
    assert len(tickers) == len(set(tickers)) and all(t.endswith(".INDX") for t in tickers)


def test_equity_group(client):
    d = client.get("/api/macro/worldmap?group=equity").json()
    by = {c["iso3"]: c for c in d["countries"]}
    assert len(by) == len(WORLD)
    de = by["DEU"]["index"]
    assert de["ticker"] == "GDAXI.INDX" and de["name"] == "DAX" and de["last"] > 0 and de["chgYtd"] is not None
    # Jedes Land mit Index hat im Demo-Modus Kurse
    assert all(by[iso]["index"] for iso, _, _, t, _ in WORLD if t)
    assert by["SAU"]["index"] is None


def test_rates_group(client):
    d = client.get("/api/macro/worldmap?group=rates").json()
    by = {c["iso3"]: c for c in d["countries"]}
    assert by["DEU"]["bond"]["ticker"] == "DE10Y.GBOND"
    tr, ch = by["TUR"]["bond"]["value"], by["CHE"]["bond"]["value"]
    assert tr > 15 and ch < 2  # Größenordnungen der Demo-Daten
    assert by["DEU"]["bond"]["chg1mBp"] is not None
    assert by["TWN"]["bond"] is None  # ohne Anleihe im Katalog


def test_macro_group(client):
    d = client.get("/api/macro/worldmap?group=macro").json()
    assert [i["key"] for i in d["indicators"]][:2] == ["gdp_growth_annual", "inflation_consumer_prices_annual"]
    by = {c["iso3"]: c for c in d["countries"]}
    assert by["ARG"]["macro"]["inflation_consumer_prices_annual"]["value"] > 20
    assert all(by[iso]["macro"]["gdp_growth_annual"]["value"] is not None for iso in by)
    # Die Ländertabelle ECST bleibt bei ihren 12 Ländern
    assert len(client.get("/api/macro/countries").json()["rows"]) == 12


def test_invalid_group(client):
    assert client.get("/api/macro/worldmap?group=sonstwas").status_code == 422


def test_new_tickers_open_in_the_terminal(client):
    assert client.get("/api/resolve?q=SSEC.INDX").json()["name"] == "Shanghai Composite"
    h = client.get("/api/history/ES10Y.GBOND").json()
    assert h["c"][-1] > 0 and len(h["t"]) > 1000


def test_real_rate_is_ten_year_minus_inflation(client):
    d = client.get("/api/macro/worldmap", params={"group": "macro"}).json()
    tur = next(c for c in d["countries"] if c["iso3"] == "TUR")
    real, infl = tur["macro"]["real_interest_rate"]["value"], tur["macro"]["inflation_consumer_prices_annual"]["value"]
    assert tur["bond"] is not None and real == pytest.approx(tur["bond"]["value"] - infl, abs=0.01)
