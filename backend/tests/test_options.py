"""Tests der Optionen: Black-Scholes, Kennzahlen, EODHD-Zuordnung, Demo-Ketten und API."""

import datetime as dt
import math

import pytest
from fastapi.testclient import TestClient

from app.eodhd import mapping
from app.main import create_app
from app.models import OptionContract
from app.providers.demo import DemoProvider
from app.services import options as opt
from app.services import options_math as bs

NOW = dt.datetime(2026, 10, 28, 15, 0, tzinfo=dt.timezone.utc)
TODAY = NOW.date()


def test_black_scholes_parity_and_greeks():
    s, k, t, r, q, iv = 100.0, 105.0, 0.5, 0.04, 0.01, 0.3
    c, p = bs.price("call", s, k, t, r, q, iv), bs.price("put", s, k, t, r, q, iv)
    assert c - p == pytest.approx(s * math.exp(-q * t) - k * math.exp(-r * t), abs=1e-9)  # Put-Call-Parität
    g = bs.greeks("call", s, k, t, r, q, iv)
    h = 0.01
    assert g["delta"] == pytest.approx((bs.price("call", s + h, k, t, r, q, iv) - bs.price("call", s - h, k, t, r, q, iv)) / (2 * h), rel=1e-4)
    assert g["vega"] == pytest.approx((bs.price("call", s, k, t, r, q, iv + 0.005) - bs.price("call", s, k, t, r, q, iv - 0.005)) / 1.0, rel=1e-3)
    assert -1 < bs.greeks("put", s, k, t, r, q, iv)["delta"] < 0
    assert bs.price("put", s, k, 0, r, q, iv) == 5.0  # verfallen: innerer Wert


def oc(kind, strike, exp="2026-11-20", **kw):
    return OptionContract(contract=f"X{kind}{strike}", type=kind, exp=exp, strike=strike, **kw)


def test_max_pain_and_expiry_summary():
    cs = [
        oc("call", 90, open_interest=100), oc("call", 100, open_interest=500), oc("call", 110, open_interest=2000),
        oc("put", 90, open_interest=2000), oc("put", 100, open_interest=500), oc("put", 110, open_interest=100),
    ]
    assert opt.max_pain(cs) == 100
    full = [
        oc("call", 100, bid=4.9, ask=5.1, volume=10, open_interest=100, iv=0.30, delta=0.5),
        oc("put", 100, bid=3.9, ask=4.1, volume=30, open_interest=300, iv=0.32, delta=-0.5),
        oc("call", 110, volume=5, open_interest=50, iv=0.28, delta=0.25),
        oc("put", 90, volume=5, open_interest=50, iv=0.36, delta=-0.25),
    ]
    s = opt.summarize_expiry("2026-11-20", full, 100.0, TODAY)
    assert s.monthly and s.dte == 23
    assert s.straddle == pytest.approx(9.0) and s.move_pct == pytest.approx(9.0)
    assert s.pc_volume == pytest.approx(35 / 15) and s.pc_oi == pytest.approx(350 / 150)
    assert s.skew25 == pytest.approx(8.0)  # 36 % − 28 %
    assert s.atm_iv == pytest.approx(0.30)  # am Kurs die Call-IV (außerhalb des Geldes ab 100)


def test_constant_maturity_and_realized_vol():
    e = [opt.ExpirySummary(exp="a", dte=20, monthly=False, atm_iv=0.20), opt.ExpirySummary(exp="b", dte=40, monthly=False, atm_iv=0.30)]
    iv30 = opt.constant_maturity_iv(e)
    assert 0.20 < iv30 < 0.30
    assert iv30 == pytest.approx(math.sqrt((0.5 * 0.04 * 20 + 0.5 * 0.09 * 40) / 30))
    closes = [100 * (1.01 if i % 2 else 0.99) ** 0 * (1 + 0.01 * (-1) ** i) for i in range(40)]
    assert opt.realized_vol(closes, 21) > 0.2
    assert opt.realized_vol([100, 101], 21) is None


def test_eodhd_mapping_is_tolerant():
    data = {"data": [
        {"id": "1", "attributes": {"contract": "AAPL261120C00200000", "type": "call", "exp_date": "2026-11-20", "strike": "200", "bid": 5.1, "ask": "5.3", "volume": 120, "open_interest": 3400, "volatility": 0.28, "delta": 0.52}},
        {"id": "2", "attributes": {"contract": "AAPL261120P00200000", "type": "PUT", "exp_date": "2026-11-20", "strike": 200, "volatility": 31.5}},
        {"id": "3", "attributes": {"type": "future", "strike": 1, "exp_date": "2026-11-20"}},
    ]}
    cs = mapping.option_contracts(data)
    assert [c.type for c in cs] == ["call", "put"]
    assert cs[0].strike == 200 and cs[0].ask == 5.3 and cs[0].iv == 0.28
    assert cs[1].iv == pytest.approx(0.315)  # Prozent erkannt


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app(DemoProvider(now_fn=lambda: NOW))) as c:
        yield c


def test_api_overview_and_chain(client):
    o = client.get("/api/options/NWND US/overview").json()
    assert o["ticker"] == "NWND.US" and o["contracts"] > 200
    assert 0.1 < o["iv30"] < 1.5 and o["hv30"] > 0
    f = o["focus"]
    assert f["monthly"] and f["dte"] >= 7 and f["movePct"] > 0 and f["maxPain"] is not None
    assert f["skew25"] > 0  # Puts teurer als Calls
    assert all(w["strike"] >= o["spot"] for w in o["callWalls"]) and all(w["strike"] <= o["spot"] for w in o["putWalls"])
    assert o["mostActive"][0]["volume"] >= o["mostActive"][-1]["volume"]
    exps = [e["exp"] for e in o["expirations"]]
    assert exps == sorted(exps) and len(exps) >= 10
    other = client.get(f"/api/options/NWND.US/overview?exp={exps[-1]}").json()
    assert other["focus"]["exp"] == exps[-1]
    ch = client.get(f"/api/options/NWND.US/chain?exp={exps[0]}").json()
    assert ch["exp"] == exps[0] and ch["expirations"] == exps
    row = next(r for r in ch["rows"] if r["strike"] == ch["atmStrike"])
    assert row["call"]["delta"] > 0 > row["put"]["delta"] and row["call"]["bid"] <= row["call"]["ask"]
    strikes = [r["strike"] for r in ch["rows"]]
    assert strikes == sorted(strikes)


def test_api_errors(client):
    r = client.get("/api/options/NRDW.XETRA/overview")
    assert r.status_code == 404 and "US-Aktien" in r.json()["error"]["message"]


def test_ai_options_tool(client):
    import asyncio

    from app.ai.tools import run_tool

    res = asyncio.run(run_tool(client.app.state.terminal, "optionen", {"ticker": "NWND"}))
    assert res["ticker"] == "NWND.US" and res["naechster_monatsverfall"]["erwartete_bewegung_prozent"] > 0
