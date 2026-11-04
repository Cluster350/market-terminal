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
    data["data"][1]["attributes"]["volatility"] = 0.315
    cs = mapping.option_contracts(data)
    assert [c.type for c in cs] == ["call", "put"]
    assert cs[0].strike == 200 and cs[0].ask == 5.3 and cs[0].iv == 0.28
    # Einheit je Antwort: eine Dezimal-IV von 4,5 (450 %) bleibt 4,5, statt zu 0,045 zu werden
    dec = {"data": [{"attributes": {"type": "call", "exp_date": "2026-11-20", "strike": s, "volatility": v}} for s, v in ((100, 0.3), (105, 0.32), (300, 4.5))]}
    assert [c.iv for c in mapping.option_contracts(dec)] == [0.3, 0.32, 4.5]
    pct = {"data": [{"attributes": {"type": "put", "exp_date": "2026-11-20", "strike": s, "volatility": v}} for s, v in ((100, 31.5), (105, 30.0), (110, 2.5))]}
    assert [c.iv for c in mapping.option_contracts(pct)] == pytest.approx([0.315, 0.30, 0.025])  # Prozent erkannt


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


# --- Testrunde 2: amerikanische Bewertung, Feiertage, Ereignisse, Skew, Abruf -------------


def _crr(kind, s, k, t, r, q, v, n=600):
    """Binomialbaum (Cox-Ross-Rubinstein) als Referenz für amerikanische Optionen."""
    dtt = t / n
    u = math.exp(v * math.sqrt(dtt))
    d = 1 / u
    p = (math.exp((r - q) * dtt) - d) / (u - d)
    disc = math.exp(-r * dtt)
    pay = (lambda x: max(0.0, x - k)) if kind == "call" else (lambda x: max(0.0, k - x))
    vals = [pay(s * u**j * d ** (n - j)) for j in range(n + 1)]
    for i in range(n - 1, -1, -1):
        vals = [max(disc * (p * vals[j + 1] + (1 - p) * vals[j]), pay(s * u**j * d ** (i - j))) for j in range(i + 1)]
    return vals[0]


@pytest.mark.parametrize("case", [
    ("put", 100, 120, 1.0, 0.04, 0.0, 0.3), ("put", 100, 100, 0.5, 0.04, 0.0, 0.4),
    ("call", 100, 80, 1.0, 0.04, 0.05, 0.25), ("put", 100, 90, 0.25, 0.04, 0.02, 0.5),
])
def test_american_price_matches_binomial_tree(case):
    kind, s, k = case[:3]
    a = bs.american_price(*case)
    assert a == pytest.approx(_crr(*case), rel=0.01)
    assert a >= max(0.0, (s - k) if kind == "call" else (k - s)) - 1e-9
    assert a >= bs.price(*case) - 1e-9


def test_american_deep_itm_put_never_below_intrinsic_and_theta_not_positive():
    # europäisch läge dieser Put unter dem inneren Wert und hätte positives Theta (Befund Optionshändler)
    assert bs.price("put", 100, 300, 1.2, 0.04, 0.0, 0.4) < 200
    assert bs.american_price("put", 100, 300, 1.2, 0.04, 0.0, 0.4) == pytest.approx(200)
    assert bs.american_greeks("put", 145, 160, 2 / 365, 0.039, 0.0, 0.4)["theta"] <= 0
    g = bs.american_greeks("put", 100, 100, 0.5, 0.04, 0.0, 0.4)
    assert -1 < g["delta"] < 0 and g["gamma"] > 0 and g["vega"] > 0 and g["theta"] < 0


def test_demo_chain_is_arbitrage_free_and_stable_intraday():
    early = DemoProvider(now_fn=lambda: dt.datetime(2026, 10, 28, 14, 0, tzinfo=dt.timezone.utc))
    late = DemoProvider(now_fn=lambda: dt.datetime(2026, 10, 28, 19, 30, tzinfo=dt.timezone.utc))
    a, b = (asyncio_run(p.options("NWND.US")) for p in (early, late))
    spot = asyncio_run(late.quotes(["NWND.US"]))[0].last
    for c in b:
        intrinsic = max(0.0, (spot - c.strike) if c.type == "call" else (c.strike - spot))
        assert c.ask >= intrinsic - 1e-9, c.contract
        assert (c.theta or 0) <= 0, c.contract
        if c.last is not None:
            assert c.bid - 1e-9 <= c.last <= c.ask + 1e-9, c.contract
    # Open Interest und Umsatz hängen am Vortagesschluss: über den Tag unverändert
    oi_a = {c.contract: (c.open_interest, c.volume) for c in a}
    assert all(oi_a.get(c.contract) == (c.open_interest, c.volume) for c in b)


def asyncio_run(coro):
    import asyncio
    return asyncio.run(coro)


def test_expiries_move_off_us_holidays():
    exps = DemoProvider._option_expirations(dt.date(2027, 3, 1))
    assert dt.date(2027, 3, 25) in exps and dt.date(2027, 3, 26) not in exps  # Karfreitag
    exps = DemoProvider._option_expirations(dt.date(2027, 5, 1))
    assert dt.date(2027, 6, 17) in exps and dt.date(2027, 6, 18) not in exps  # Juneteenth (beobachtet)
    assert opt.is_monthly("2027-06-17") and opt.is_monthly("2025-04-17") and not opt.is_monthly("2027-06-10")


def test_same_day_after_close_earnings_are_priced():
    p = DemoProvider(now_fn=lambda: NOW)
    raw = p._fundamentals_raw("NWND.US")
    rec = next(r for r in raw["Earnings"]["History"].values() if r.get("reportDate") and r["reportDate"] > TODAY.isoformat())
    rep = dt.date.fromisoformat(rec["reportDate"])
    # am Berichtstag selbst (nachbörslich) muss der nächste Verfall die Ereignisvarianz tragen
    on_day = DemoProvider(now_fn=lambda: dt.datetime.combine(rep, dt.time(15, 0), tzinfo=dt.timezone.utc))
    on_day._fundamentals_raw = lambda t: {**raw, "Earnings": {"History": {"x": {**rec, "beforeAfterMarket": "AfterMarket"}}}}  # type: ignore[method-assign]
    cs = asyncio_run(on_day.options("NWND.US"))
    spot = asyncio_run(on_day.quotes(["NWND.US"]))[0].last
    exps = sorted({c.exp for c in cs})
    first, later = (opt.summarize_expiry(e, [c for c in cs if c.exp == e], spot, rep) for e in exps[:2])
    assert first.atm_iv > later.atm_iv * 1.15


def test_skew_interpolates_between_strikes():
    mk = lambda d, iv: OptionContract(contract=f"P{d}", type="put", exp="2026-11-20", strike=100 + d * 100, delta=d, iv=iv)  # noqa: E731
    cs = [mk(-0.40, 0.30), mk(-0.30, 0.34), mk(-0.20, 0.38)]
    assert opt.iv_at_delta(cs, "put", -0.25) == pytest.approx(0.36)
    assert opt.iv_at_delta(cs, "put", -0.05) is None


def test_unknown_expiry_is_reported(client):
    r = client.get("/api/options/NWND US/chain", params={"exp": "2026-11-21"})
    assert r.status_code == 404 and "Kein Verfall" in r.json()["error"]["message"]


def test_eodhd_option_paging_counts_raw_rows():
    import httpx

    from app.config import Settings
    from app.eodhd.client import EODHDClient
    from app.providers.eodhd import EODHDProvider

    calls = []

    def handler(req: httpx.Request) -> httpx.Response:
        off = int(req.url.params.get("page[offset]", "0"))
        calls.append(off)
        n = 1000 if off == 0 else 10 if off == 1000 else 0
        rows = [{"attributes": {"type": "call", "exp_date": "2027-01-15", "strike": None if (off == 0 and i == 5) else 100 + i + off}} for i in range(n)]
        return httpx.Response(200, json={"data": rows})

    client = EODHDClient("KEY", "https://example.test/api", transport=httpx.MockTransport(handler), backoff_base=0.0)
    out = asyncio_run(EODHDProvider(Settings(eodhd_api_key="KEY"), client=client).options("AAPL.US"))
    assert calls == [0, 1000] and len(out) == 1009
