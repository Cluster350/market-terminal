"""Tests der Kryptoübersicht (CRYP), der Faktoren (FCTR) und der Faktorlast des Depots."""

import asyncio
import datetime as dt
import math
import random

import pytest
from fastapi.testclient import TestClient

from app.crypto import calc as ccalc
from app.eodhd.mapping import crypto_stats
from app.factors import calc as fcalc
from app.factors.service import FactorService
from app.factors.universe import REGIONS
from app.main import create_app
from app.models import SearchHit
from app.providers.demo import DemoProvider

NOW = dt.datetime(2026, 11, 6, 15, 0, tzinfo=dt.timezone.utc)


def _days(n: int, start: str = "2026-01-01") -> list[str]:
    d0 = dt.date.fromisoformat(start)
    return [(d0 + dt.timedelta(days=i)).isoformat() for i in range(n)]


def test_crypto_calc():
    days = _days(400)
    pts = [(d, 100 * math.exp(0.001 * i)) for i, d in enumerate(days)]
    assert ccalc.vol(pts, 30) == pytest.approx(0.0, abs=1e-9)  # gleichmäßiger Anstieg: keine Schwankung
    up_down = [(d, 100.0 if i % 2 else 110.0) for i, d in enumerate(days)]
    assert ccalc.vol(up_down, 30) > 100  # ±10 % täglich, mit 365 Tagen hochgerechnet
    hi, when = ccalc.from_high([("2026-01-01", 50.0), ("2026-01-02", 80.0), ("2026-01-03", 60.0)])
    assert hi == pytest.approx(-25.0) and when == "2026-01-02"
    a = ccalc.log_returns(pts)
    assert ccalc.corr(a, a) is None  # gleichbleibende Rendite: keine Streuung, keine Korrelation
    rng = random.Random(1)
    x = [(d, 100.0) for d in days]
    y = [(d, 100.0) for d in days]
    for i in range(1, len(days)):
        z = rng.gauss(0, 0.02)
        x[i] = (days[i], x[i - 1][1] * math.exp(z))
        y[i] = (days[i], y[i - 1][1] * math.exp(-z))
    assert ccalc.corr(ccalc.log_returns(x), ccalc.log_returns(y)) == pytest.approx(-1.0)
    rc = ccalc.rolling_corr(x, y, 90)
    assert len(rc) == len(days) - 90 and all(v == pytest.approx(-1.0) for _, v in rc)
    assert ccalc.ffill(["2026-01-01", "2026-01-03", "2026-01-05"], [("2026-01-02", 1.0), ("2026-01-04", 2.0)]) == [None, 1.0, 2.0]
    assert ccalc.sma(pts, 500) is None


def test_crypto_stats_mapping():
    data = {"General": {"Name": "Bitcoin"}, "Statistics": {"MarketCapitalization": "1.2e12", "CirculatingSupply": 19.9e6,
                                                            "maxSupply": 21e6, "MarketCapDominance": 56.1}}
    s = crypto_stats(data)
    assert s == {"market_cap": 1.2e12, "circulating_supply": 19.9e6, "max_supply": 21e6, "dominance": 56.1}
    assert crypto_stats({"General": {}}) == {} and crypto_stats(None) == {}


def test_ols_recovers_loadings():
    rng = random.Random(7)
    n = 300
    m = [rng.gauss(0, 0.02) for _ in range(n)]
    f1 = [rng.gauss(0, 0.01) for _ in range(n)]
    f2 = [rng.gauss(0, 0.01) for _ in range(n)]
    y = [0.0005 + 0.9 * a + 0.4 * b - 0.3 * c + rng.gauss(0, 0.002) for a, b, c in zip(m, f1, f2)]
    res = fcalc.ols(y, [m, f1, f2])
    assert res["beta"] == pytest.approx([0.9, 0.4, -0.3], abs=0.05)
    assert res["r2"] > 0.95 and all(abs(t) > 10 for t in res["t"])
    assert fcalc.ols(y[:5], [m[:5]]) is None  # zu wenige Beobachtungen
    assert fcalc.ols(y, [m, m]) is None  # identische Faktoren: nicht lösbar
    assert fcalc.solve([[2.0, 0.0], [0.0, 4.0]], [2.0, 8.0]) == [1.0, 2.0]


def test_ratio_line_and_average():
    a = [("d1", 10.0), ("d2", 12.0), ("d3", 15.0)]
    b = [("d1", 5.0), ("d3", 5.0)]
    assert fcalc.ratio_line(a, b) == [("d1", 2.0), ("d3", 3.0)]
    assert fcalc.pct_vs_avg([("x", 1.0)] * 199 + [("y", 2.0)], 200) == pytest.approx((2 / 1.005 - 1) * 100)
    assert fcalc.pct_vs_avg([("x", 1.0)], 200) is None
    assert fcalc.returns([1.0, 2.0, None, 4.0]) == [1.0, None, None]
    cm = fcalc.corr_matrix([[0.1 * (i % 3) for i in range(30)], [-0.1 * (i % 3) for i in range(30)]])
    assert cm[0][0] == 1.0 and cm[0][1] == pytest.approx(-1.0)


class _FakeTerminal:
    """Suche liefert Börsenplätze; Kurse gibt es nur für die genannten Kürzel."""

    def __init__(self, hits, with_history):
        self.hits = hits
        self.with_history = set(with_history)
        self.searches = 0

    async def search(self, q, limit):
        self.searches += 1
        return self.hits

    async def history(self, ticker):
        from app.errors import NotFound
        from app.models import History

        if ticker not in self.with_history:
            raise NotFound(ticker)
        days = _days(30)
        return History(ticker=ticker, t=days, o=[1.0] * 30, h=[1.0] * 30, l=[1.0] * 30, c=[1.0] * 30, v=[None] * 30)


def test_isin_resolution_prefers_xetra_in_euro(tmp_path):
    f = REGIONS["eu"].factors[0]
    hits = [
        SearchHit(ticker="IEVL.LSE", name="x", exchange="LSE", currency="GBX"),
        SearchHit(ticker="CEMS.F", name="x", exchange="F", currency="EUR"),
        SearchHit(ticker="CEMS.XETRA", name="x", exchange="XETRA", currency="EUR"),
    ]
    t = _FakeTerminal(hits, {"CEMS.XETRA", "CEMS.F", "IEVL.LSE"})
    svc = FactorService(t, str(tmp_path), "eodhd")
    assert asyncio.run(svc.ticker_of(f, "EUR")) == "CEMS.XETRA"
    # gespeichert: kein zweiter Suchaufruf, auch nach dem Neustart des Dienstes
    svc2 = FactorService(t, str(tmp_path), "eodhd")
    assert asyncio.run(svc2.ticker_of(f, "EUR")) == "CEMS.XETRA" and t.searches == 1
    # Xetra ohne Kurse: nächster Euro-Platz; nichts gefunden: Vorschlag aus der Liste, sonst None
    t2 = _FakeTerminal(hits, {"CEMS.F"})
    assert asyncio.run(FactorService(t2, None, "eodhd").ticker_of(f, "EUR")) == "CEMS.F"
    t3 = _FakeTerminal([], {f.ticker})
    assert asyncio.run(FactorService(t3, None, "eodhd").ticker_of(f, "EUR")) == f.ticker
    assert asyncio.run(FactorService(_FakeTerminal([], set()), None, "eodhd").ticker_of(f, "EUR")) is None
    # Demo: kein Suchaufruf, Kürzel aus der Liste
    t4 = _FakeTerminal(hits, set())
    assert asyncio.run(FactorService(t4, None, "demo").ticker_of(f, "EUR")) == f.ticker and t4.searches == 0


def test_demo_coins_and_factor_etfs():
    p = DemoProvider(now_fn=lambda: NOW)
    sol = asyncio.run(p.history("SOL-USD.CC"))
    assert sol.t[0] >= "2020-04-10" and sol.currency == "USD"  # Handel erst ab Listing
    shib = asyncio.run(p.history("SHIB-USD.CC"))
    assert 0 < shib.c[-1] < 0.01 and len({c for c in shib.c[-20:]}) > 10  # Kleinstkurse nicht auf 0 gerundet
    eth = asyncio.run(p.history("ETH-USD.CC"))
    assert eth.t[0] == "2016-01-04" and eth.t[-1] == "2026-11-06"
    v = asyncio.run(p.history("VLUE.US"))
    x = asyncio.run(p.history("IEFV.XETRA"))
    assert v.currency == "USD" and x.currency == "EUR" and len(v.t) > 2000
    assert asyncio.run(p.crypto_info("BTC-USD.CC"))["max_supply"] == 21e6
    names = [h.ticker for h in asyncio.run(p.search("solana", 5))]
    assert "SOL-USD.CC" in names


def test_endpoints_demo(tmp_path, monkeypatch):
    monkeypatch.setenv("PORTFOLIO_DIR", str(tmp_path))
    from app.config import Settings

    with TestClient(create_app(DemoProvider(now_fn=lambda: NOW), cfg=Settings())) as c:
        cr = c.get("/api/crypto").json()
        assert cr["ccy"] == "usd" and len(cr["rows"]) == 20 and cr["rows"][0]["symbol"] == "BTC"
        btc = cr["rows"][0]
        assert btc["corrBtc"] is None and btc["share"] == pytest.approx(cr["btcShare"]) and cr["shareBasis"] == "shown"
        assert sum(r["share"] for r in cr["rows"]) == pytest.approx(100.0)
        assert all(r["fromHigh"] <= 0 for r in cr["rows"]) and 0 <= cr["breadthUp"] <= cr["breadthN"] == 20
        assert {x["key"] for x in cr["cross"]} >= {"BTC-USD.CC", "NDX.INDX", "GOLD.COMM"}
        assert all(-1 <= v <= 1 for line in cr["corr"] for v in line["v"])
        eur = c.get("/api/crypto", params={"ccy": "eur"}).json()
        assert eur["rows"][0]["last"] < btc["last"]  # Euro ist mehr wert als der Dollar (Demo)

        us = c.get("/api/factors", params={"region": "us"}).json()
        assert us["bench"]["ticker"] == "SPY.US" and len(us["rows"]) == 8
        assert set(us["lines"]) == {"market", *(r["key"] for r in us["rows"])} and len(us["t"]) == len(us["lines"]["market"])
        val = next(r for r in us["rows"] if r["key"] == "value")
        # relative Entwicklung = Verhältnis der Entwicklungen zum Markt
        a, b = val["abs"]["1y"], us["bench"]["abs"]["1y"]
        assert val["rel"]["1y"] == pytest.approx(((1 + a / 100) / (1 + b / 100) - 1) * 100, abs=0.05)
        i, j = us["corrKeys"].index("value"), us["corrKeys"].index("growth")
        assert us["corr"][i][j] < -0.3  # Wachstum läuft im Demo gegen Value
        eu = c.get("/api/factors", params={"region": "eu"}).json()
        assert eu["bench"]["ticker"] == "EXSA.XETRA" and len(eu["rows"]) == 5
        assert c.get("/api/factors", params={"region": "xx"}).status_code == 422

        ex = c.get("/api/portfolio/factors").json()
        assert ex["auto"] and ex["region"] in ("us", "eu") and ex["weeks"] >= 52
        assert 0 <= ex["r2"] <= 1 and ex["market"]["beta"] > 0.3 and len(ex["factors"]) == 5
        ex_us = c.get("/api/portfolio/factors", params={"region": "us"}).json()
        assert ex_us["region"] == "us" and not ex_us["auto"]

        rc = c.get("/api/rotation", params={"universe": "crypto", "bench": "btc"}).json()
        assert rc["benchmark"] == "Bitcoin" and all(m["key"] != "BTC-USD.CC" for m in rc["members"]) and len(rc["members"]) >= 15
        rf = c.get("/api/rotation", params={"universe": "factors", "region": "us"}).json()
        assert {m["key"] for m in rf["members"]} >= {"value", "momentum", "lowvol"} and len(rf["weeks"]) == 104


def test_ai_tools_krypto_faktoren():
    from app.ai.tools import TOOL_BY_NAME, run_tool
    from app.cache import TTLCache
    from app.crypto.service import CryptoService
    from app.factors.service import FactorService
    from app.portfolio.analytics import sample_portfolio
    from app.services.terminal import Terminal

    t = Terminal(DemoProvider(now_fn=lambda: NOW), TTLCache())
    assert asyncio.run(run_tool(t, "krypto", {}))["fehler"]  # ohne Dienst: klare Meldung statt Absturz
    t.crypto, t.factors = CryptoService(t), FactorService(t)

    async def depot():
        return await sample_portfolio(t)

    t.portfolio_source = depot

    async def main():
        k = await run_tool(t, "krypto", {"name": "Ethereum", "waehrung": "eur"})
        f = await run_tool(t, "faktoren", {"region": "europa", "depot": True})
        return k, f

    k, f = asyncio.run(main())
    assert {"krypto", "faktoren"} <= set(TOOL_BY_NAME)
    assert k["waehrung"] == "EUR" and [c["kuerzel"] for c in k["coins"]] == ["ETH"]
    assert f["region"] == "Europa" and len(f["faktoren_gegenueber_markt_prozent"]) == 5
    assert f["depot_faktorlast"]["wochen"] >= 52 and len(f["depot_faktorlast"]["stile"]) == 5


def test_change_24h_from_intraday_bars():
    now = 1_000_000.0
    bars = [(int(now - 86400 - 600 + 300 * k), 100.0 + k, 99.0 + k, 99.5 + k) for k in range(300)]
    chg, ref, hi, lo = ccalc.change_24h(bars, now, last=110.0)
    # Bezug: Schluss des Balkens, in dem „jetzt − 24 h“ liegt (Balken 2: Start 300 s vor dem Stichtag)
    assert ref == 101.5 and chg == pytest.approx((110 / 101.5 - 1) * 100)
    assert hi == max(110.0, max(b[1] for b in bars if b[0] > now - 86400)) and lo == 102.0
    # Lücke: kein Kurs in der Nähe von „jetzt − 24 h“ (z. B. Wochenende ohne Handel) -> nichts erfinden
    assert ccalc.change_24h([(int(now - 5 * 86400), 1.0, 1.0, 1.0)], now) == (None, None, None, None)
    assert ccalc.change_24h([], now) == (None, None, None, None)


def test_rotation_daily_cadence(tmp_path, monkeypatch):
    monkeypatch.setenv("PORTFOLIO_DIR", str(tmp_path))
    from app.config import Settings

    with TestClient(create_app(DemoProvider(now_fn=lambda: NOW), cfg=Settings())) as c:
        import time

        for _ in range(150):
            r = c.get("/api/rotation", params={"universe": "sectors", "freq": "d"}).json()
            if r.get("state") == "ready":
                break
            time.sleep(0.1)
        assert r["state"] == "ready" and r["freq"] == "d" and r["periods"] == [5, 20] and len(r["weeks"]) == 250
        assert all(dt.date.fromisoformat(d).weekday() < 5 for d in r["weeks"]) and r["weeks"][-1] == "2026-11-06"
        assert "h20" in r["test"]["quadrants"]["fuehrend"] and len(r["members"]) >= 8
        w = c.get("/api/rotation", params={"universe": "sectors"}).json()
        assert w["freq"] == "w" and w["periods"] == [4, 13] and len(w["weeks"]) == 104
        for u, extra in (("countries", {}), ("currencies", {}), ("crypto", {"bench": "btc"}), ("factors", {"region": "us"})):
            d = c.get("/api/rotation", params={"universe": u, "freq": "d", **extra}).json()
            assert d["freq"] == "d" and len(d["weeks"]) == 250 and d["members"], u
            assert all(m["trend"][-1] is not None for m in d["members"]), u
        cr = c.get("/api/crypto").json()
        assert all(isinstance(r["chg24h"], float) for r in cr["rows"][:5])  # Freitag 15 Uhr: 24 Stunden vorhanden
        assert c.get("/api/rotation", params={"freq": "x"}).status_code == 422
