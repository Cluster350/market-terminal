"""Tests für Intervalle (1m/5m/15m/1h), Echtzeit-Verteiler, EODHD-WebSocket-Nachrichten und den Strom."""

import asyncio
import datetime as dt
import json

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.models import Intraday, Quote
from app.providers.demo import DemoProvider
from app.realtime.demo import DemoSource
from app.realtime.eodhd_ws import parse, ws_symbol
from app.realtime.hub import RealtimeHub, Tick, realtime_capable
from app.services.intraday import aggregate, bucket, merge_minutes

NOW = dt.datetime(2026, 11, 4, 15, 7, 30, tzinfo=dt.timezone.utc)  # Mittwoch, US-Handel läuft


def run(coro):
    return asyncio.run(coro)


def test_aggregate_buckets_and_ohlc():
    t0 = 1_762_268_400  # durch 3600 teilbar
    d = Intraday(ticker="X.US", interval="5m", t=[t0 + i * 300 for i in range(4)], o=[1, 2, 3, 4], h=[2, 5, 4, 6], l=[0.5, 1, 2, 3],
                 c=[2, 3, 4, 5], v=[10, 20, None, 5])
    a = aggregate(d, "15m")
    assert a.interval == "15m" and a.t == [t0, t0 + 900]
    assert (a.o[0], a.h[0], a.l[0], a.c[0], a.v[0]) == (1, 5, 0.5, 4, 30)
    assert (a.o[1], a.c[1], a.v[1]) == (4, 5, 5)
    assert bucket(t0 + 899, 15) == t0


def test_demo_minute_bars_add_up_to_five_minutes():
    p = DemoProvider(now_fn=lambda: NOW)
    m1 = run(p.intraday("NWND.US", 1, "1m"))
    m5 = run(p.intraday("NWND.US", 1, "5m"))
    assert m1.interval == "1m" and len(m1.t) >= len(m5.t) * 5 - 4
    agg = aggregate(m1, "5m")
    n = min(len(agg.t), len(m5.t))
    assert agg.t[:n] == m5.t[:n]
    for i in range(n - 1):  # die letzte 5-Minuten-Kerze kann noch unvollständig sein
        assert agg.o[i] == pytest.approx(m5.o[i], abs=1e-4) and agg.c[i] == pytest.approx(m5.c[i], abs=1e-4)
        assert agg.h[i] == pytest.approx(m5.h[i], abs=1e-4) and agg.l[i] == pytest.approx(m5.l[i], abs=1e-4)
    h1 = run(p.intraday("NWND.US", 1, "1h"))
    assert h1.interval == "1h" and all(t % 3600 == 0 for t in h1.t)


def test_demo_live_price_moves_within_the_minute():
    p1 = DemoProvider(now_fn=lambda: NOW)
    p2 = DemoProvider(now_fn=lambda: NOW + dt.timedelta(seconds=20))
    a, b = p1.live_price("NWND.US"), p2.live_price("NWND.US")
    assert a and b and a[0] != b[0] and b[1] - a[1] == 20_000
    night = DemoProvider(now_fn=lambda: dt.datetime(2026, 11, 4, 3, 0, tzinfo=dt.timezone.utc))
    assert night.live_price("NWND.US") is None  # US-Börse geschlossen


def test_merge_minutes_appends_running_candle():
    t0 = 1_762_268_400
    d = Intraday(ticker="X.US", interval="5m", t=[t0], o=[1.0], h=[1.2], l=[0.9], c=[1.1], v=[100])
    minutes = [(t0 + 240, 1.1, 1.3, 1.1, 1.25, None), (t0 + 300, 1.25, 1.26, 1.2, 1.22, 5), (t0 + 360, 1.22, 1.24, 1.21, 1.23, 3)]
    m = merge_minutes(d, minutes)
    assert m.t == [t0, t0 + 300]
    assert m.h[0] == 1.3 and m.c[0] == 1.25  # laufende Kerze ergänzt
    assert (m.o[1], m.h[1], m.l[1], m.c[1], m.v[1]) == (1.25, 1.26, 1.2, 1.23, 8)


def test_hub_ticks_bars_overlay_and_subscriptions():
    class FakeSource:
        name = "test"

        def __init__(self):
            self.symbols: list[str] = []

        def set_symbols(self, symbols):
            self.symbols = list(symbols)

        async def run(self, hub):  # pragma: no cover
            await asyncio.sleep(3600)

    src = FakeSource()
    hub = RealtimeHub(src, limit=2, now_ms=lambda: 1_762_268_500_000)
    lst = hub.listen(["NWND.US", "ELBT.XETRA", "EURUSD.FOREX", "BTC-USD.CC"])
    assert src.symbols == ["NWND.US", "EURUSD.FOREX"]  # nur echtzeitfähige, höchstens limit
    assert hub.delayed_wanted() == ["ELBT.XETRA"]
    hub.on_tick(Tick("NWND.US", 100.0, 1_762_268_460_000, 10))
    hub.on_tick(Tick("NWND.US", 101.0, 1_762_268_470_000, 5))
    hub.on_tick(Tick("NWND.US", 99.0, 1_762_268_400_000))  # verspätet: ignoriert
    bars = hub.minute_bars("NWND.US")
    assert bars == [(1_762_268_460, 100.0, 101.0, 100.0, 101.0, 15)]
    assert [t.price for t in lst.take()] == [101.0]
    q = Quote(ticker="NWND.US", last=98.0, prev_close=97.0, high=99.0, low=96.0, timestamp="2025-11-04T14:00:00Z")
    o = hub.overlay(q)
    assert o.last == 101.0 and o.high == 101.0 and o.change_pct == pytest.approx((101 / 97 - 1) * 100) and not o.delayed
    hub.on_tick(Tick("ELBT.XETRA", 50.0, 1_762_268_470_000, delayed=True))
    assert hub.overlay(Quote(ticker="ELBT.XETRA", last=49.0, prev_close=48.0)).last == 49.0  # verzögerte Ticks ersetzen keine Kurse
    hub.unlisten(lst)
    assert src.symbols == []
    assert realtime_capable("AAPL.US") and not realtime_capable("SAP.XETRA")


def test_eodhd_message_parsing():
    t = parse("us", {"s": "AAPL", "p": 227.31, "v": 100, "t": 1726000000123, "c": [12]})
    assert (t.ticker, t.price, t.volume, t.ts) == ("AAPL.US", 227.31, 100, 1726000000123)
    f = parse("forex", {"s": "EURUSD", "a": 1.0937, "b": 1.0935, "t": 1726000000000})
    assert f.ticker == "EURUSD.FOREX" and f.price == pytest.approx(1.0936)
    c = parse("crypto", {"s": "BTC-USD", "p": "64000.5", "q": "0.01", "t": 1726000000})
    assert c.ticker == "BTC-USD.CC" and c.price == 64000.5 and c.ts == 1726000000000
    assert parse("us", {"status_code": 200, "message": "Authorized"}) is None
    assert parse("us", {"s": "AAPL", "p": 0}) is None
    assert parse("us", {"s": "AAPL", "p": 1.0, "dp": True}) is None
    assert ws_symbol("BTC-USD.CC") == ("crypto", "BTC-USD") and ws_symbol("SAP.XETRA")[0] is None


def test_demo_source_feeds_hub():
    p = DemoProvider(now_fn=lambda: NOW)
    hub = RealtimeHub(DemoSource(p, every=0.01))
    hub.listen(["NWND.US"])

    async def go():
        task = asyncio.create_task(hub._run_source())
        await asyncio.sleep(0.05)
        task.cancel()

    run(go())
    assert hub.connected and "NWND.US" in hub.last


def test_intervals_and_stream_endpoints():
    with TestClient(create_app(DemoProvider(now_fn=lambda: NOW), realtime=True)) as c:
        r = c.get("/api/intraday/NWND US", params={"days": 1, "interval": "15m"}).json()
        assert r["interval"] == "15m" and all(t % 900 == 0 for t in r["t"])
        assert c.get("/api/intraday/NWND US", params={"interval": "2m"}).status_code == 422
        s = c.get("/api/realtime/status", params={"tickers": "NWND US,ELBT GR"}).json()
        assert s["mode"] == "demo" and "ELBT.XETRA" in s["delayed"]  # NWND kann als Depotwert schon im Strom sein
        with c.stream("GET", "/api/stream", params={"tickers": "NWND US,ELBT GR", "once": "1"}) as resp:
            assert resp.headers["content-type"].startswith("text/event-stream")
            body = "".join(resp.iter_text())
        status = json.loads(body.split("event: status\ndata: ")[1].split("\n")[0])
        assert status["live"] == ["NWND.US"] and status["delayed"] == ["ELBT.XETRA"]
