"""Tests der Terminkurse: Zinsparität, Absicherung, Forward-Zinsen und API."""

import datetime as dt

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.providers.demo import DemoProvider
from app.services.forwards import annualized, forward_rate, fx_forward, growth, hedge_pa, interp

NOW = dt.datetime(2026, 10, 28, 15, 0, tzinfo=dt.timezone.utc)


def test_interest_parity():
    # EUR 2 %, USD 4 %: EUR notiert per Termin mit Aufschlag, gleich dem Zinsvorteil des USD
    f = fx_forward(1.10, base_rate=2.0, quote_rate=4.0, t=1.0)
    assert f == pytest.approx(1.10 * 1.04 / 1.02)
    assert annualized(f / 1.10, 1.0) == pytest.approx((1.04 / 1.02 - 1) * 100)
    assert fx_forward(1.10, 3.0, 3.0, 0.5) == pytest.approx(1.10)  # gleiche Zinsen: kein Auf-/Abschlag
    assert growth(4.0, 0.25) == pytest.approx(1.01)  # einfach bis 1 Jahr
    assert growth(4.0, 2.0) == pytest.approx(1.0816)  # darüber mit Zinseszins


def test_hedge_sign():
    # Euro-Anleger mit Dollar-Anlagen: niedrigerer Heimatzins -> Absicherung kostet
    assert hedge_pa(2.0, 4.0, 1.0) < 0
    assert hedge_pa(2.0, 0.5, 0.25) > 0  # Franken-Anlagen: Absicherung bringt Ertrag
    assert hedge_pa(2.0, 2.0, 1.0) == pytest.approx(0.0)


def test_forward_rates_and_interpolation():
    curve = [(1.0, 3.0), (2.0, 4.0), (10.0, 4.5)]
    # Par-Renditen -> Abzinsungsfaktoren (Bootstrapping): DF1 = 1/1,03; DF2 = (1 − 0,04·DF1)/1,04
    df1 = 1 / 1.03
    df2 = (1 - 0.04 * df1) / 1.04
    assert forward_rate(curve, 1, 1) == pytest.approx((df1 / df2 - 1) * 100)
    assert forward_rate(curve, 0, 2) == pytest.approx((df2 ** -0.5 - 1) * 100)  # Nullkuponsatz 2 J. ≈ 4,02 %
    assert forward_rate(curve, 0, 1) == pytest.approx(3.0)
    # glatte Forwards: keine Sägezähne zwischen den Stützstellen
    fw = [forward_rate(curve, s, 1) for s in range(2, 9)]
    assert all(abs(b - a) < 0.25 for a, b in zip(fw, fw[1:]))
    assert forward_rate(curve, 5, 10) is None  # über das Kurvenende hinaus
    assert interp(curve, 0.25) == 3.0 and interp(curve, 1.5) == pytest.approx(3.5) and interp(curve, 30) == 4.5
    assert interp([], 1) is None


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app(DemoProvider(now_fn=lambda: NOW))) as c:
        yield c


def test_api_fx(client):
    d = client.get("/api/forwards/fx?pair=EUR/USD").json()
    assert d["pair"] == "EURUSD" and d["base"] == "EUR" and d["quote"] == "USD" and d["pip"] == 0.0001
    assert [r["tenor"] for r in d["rows"]][:3] == ["1W", "1M", "2M"]
    one_year = next(r for r in d["rows"] if r["tenor"] == "1Y")
    assert one_year["outright"] == pytest.approx(fx_forward(d["spot"], one_year["baseRate"], one_year["quoteRate"], 1.0))
    assert one_year["points"] == pytest.approx((one_year["outright"] - d["spot"]) / 0.0001)
    jpy = client.get("/api/forwards/fx?pair=USDJPY").json()
    assert jpy["pip"] == 0.01 and jpy["rows"][3]["points"] < 0  # hoher USD-Zins: USD mit Abschlag gegen JPY
    assert client.get("/api/forwards/fx?pair=EURXYZ").status_code == 400


def test_api_hedge_and_rates(client):
    h = client.get("/api/forwards/hedge?home=EUR&currencies=USD,CHF,EUR").json()
    assert [r["currency"] for r in h["rows"]] == ["USD", "CHF"]  # Heimatwährung selbst entfällt
    usd, chf = h["rows"]
    assert usd["hedge1yPa"] < 0 < chf["hedge1yPa"]
    r = client.get("/api/forwards/rates?country=DE").json()
    assert r["name"] == "Deutschland" and r["forwards"][0]["start"] == 0
    keys = {k["label"]: k for k in r["keys"]}
    assert {"1Y1Y", "5Y5Y", "10Y10Y"} <= set(keys) and keys["5Y5Y"]["change1mBp"] is not None
    assert client.get("/api/forwards/rates?country=XX").status_code == 400
