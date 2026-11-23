"""Tests des Stimmungsterminals (STIM): Rechenkern, keine Ersatzgrößen je Region, Put/Call-Aufzeichnung, Endpunkt."""

import asyncio
import datetime as dt
import json
import time
import types

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.models import OptionContract
from app.providers.demo import DemoProvider
from app.sentiment import calc as C
from app.sentiment.service import COMPS, SentimentService, lage, SentComponent

NOW = dt.datetime(2026, 11, 20, 15, 0, tzinfo=dt.timezone.utc)


def test_expanding_rank_uses_only_the_past():
    xs = [float(i % 7) for i in range(400)]
    r = C.expanding_rank(xs, min_history=250)
    assert r[:250] == [None] * 250 and all(0 <= x <= 100 for x in r[250:] if x is not None)
    # ein späterer Ausreißer ändert frühere Ränge nicht (kein Blick in die Zukunft)
    r2 = C.expanding_rank(xs + [1000.0], min_history=250)
    assert r2[:400] == r and r2[-1] == 100.0
    assert C.expanding_rank(xs + [1000.0], invert=True, min_history=250)[-1] == 0.0
    # Gleichstände zählen halb
    assert C.expanding_rank([1.0] * 5, min_history=4)[-1] == 50.0


def test_breadth_counts_and_windows():
    n = 300
    up = [100.0 + i for i in range(n)]  # steigt jeden Tag: über dem 200-Tage-Schnitt, ab Tag 252 neue Hochs
    down = [400.0 - i for i in range(n)]
    gap = [None if i == 100 else 50.0 for i in range(n)]  # Lücke setzt die Fenster zurück
    b = C.breadth(n, [("A", up, [10.0] * n), ("B", down, [30.0] * n), ("A", gap, [1.0] * n)])
    assert b.adv[1] == 1 and b.dec[1] == 1 and b.upvol[1] == 10.0 and b.downvol[1] == 30.0
    assert b.n200[198] == 0 and b.n200[199] == 2 and b.above200[199] == 1  # „gap“ ab Tag 101 neu, erst ab 300 dabei
    assert b.n252[251] == 0 and b.n252[252] == 2 and b.highs[252] == 1 and b.lows[252] == 1
    assert b.sectors["A"][1][199] == 1 and b.sectors["B"][0][199] == 0
    assert b.n_vol[19] == 0 and b.n_vol[20] == 3  # 20 Tagesrenditen nötig
    assert C.trin(b)[1] == pytest.approx((1 / 1) / (10 / 30))


def test_sma_change_align_combine_word():
    assert C.sma([1.0, None, 3.0, 5.0], 2, 1) == [1.0, 1.0, 3.0, 4.0]
    assert C.change([100.0, 110.0, None], 1)[1] == pytest.approx(10.0)
    dates = [f"2026-01-{d:02d}" for d in range(1, 11)]
    a = C.align(dates, {"2026-01-01": 5.0}, ffill=3)
    assert a[:4] == [5.0] * 4 and a[4] is None  # nur kurze Lücken füllen, nie mit späteren Werten
    tot, cnt = C.combine({"a": [10.0, None, None], "b": [30.0, 40.0, None]}, ["a", "b"])
    assert tot == [20.0, 40.0, None] and cnt == [2, 1, 0]
    assert C.word(3) == "extrem selten so ängstlich" and C.word(50) == "gewöhnlich" and C.word(97) == "extrem selten so sorglos"
    assert C.rank_sentence(30, "2015") == "niedriger als an 70 von 100 Tagen seit 2015"


def test_backtest_counts_episodes_not_days():
    total = ([10.0] * 30 + [50.0] * 30) * 20
    prices = [100.0 * (1.001 ** i) for i in range(len(total))]
    bt = C.backtest(total, prices, 10.0)
    assert bt["episodes"] == 20  # 20 Phasen, nicht 600 Tage
    assert bt["band"] == [0, 20] and {r["label"] for r in bt["rows"]} == {"1 Monat", "3 Monate", "6 Monate"}
    assert C.backtest(total, prices, None)["state"] == "wenig"


def test_lage_singular_and_inverted_wording():
    comps = [SentComponent(key="vix", label="VIX", unit="num", explain="", value=35.0, rank=3.0),
             SentComponent(key="breite", label="Marktbreite", unit="pct", explain="", value=50.0, rank=50.0)]
    text = lage("ängstlich", comps)
    # VIX: Rang 3 (Angst) heißt „höher als an 97 von 100 Tagen“
    assert "VIX steht bei 35,0" in text and "höher als an 97 von 100 Tagen" in text
    assert "1 von 2 Bausteinen zeigt Vorsicht" in text and "1 liegt im gewöhnlichen Bereich" in text


def _wait(c, region):
    for _ in range(200):
        j = c.get("/api/sentiment", params={"region": region}).json()
        if j["state"] == "ready":
            return j
        time.sleep(0.3)
    raise AssertionError("STIM wurde nicht fertig")


def test_endpoint_regions_without_proxies(tmp_path, monkeypatch):
    monkeypatch.setenv("PORTFOLIO_DIR", str(tmp_path))
    from app.config import Settings

    with TestClient(create_app(DemoProvider(now_fn=lambda: NOW), cfg=Settings())) as c:
        us = _wait(c, "us")
        eu = _wait(c, "eu")
        assert c.get("/api/sentiment", params={"region": "de"}).status_code == 422
    assert [x["key"] for x in us["components"]] == [x.key for x in COMPS]
    assert us["total"]["nTotal"] == 9 and eu["total"]["nTotal"] == 6
    by = {x["key"]: x for x in eu["components"]}
    for k in ("vix", "putcall", "risiko"):  # nur USA – in Europa sichtbar ohne Wert, nichts vertritt sie
        assert by[k]["note"] == "nur USA" and by[k]["value"] is None and not by[k]["inTotal"] and not by[k]["available"]
    usby = {x["key"]: x for x in us["components"]}
    assert usby["putcall"]["approx"] and usby["risiko"]["approx"] and usby["news"]["inTotal"]
    assert 0 <= us["total"]["value"] <= 100 and us["lage"].startswith("Die Stimmung")
    assert not us["trend"]["inTotal"]
    assert len(us["dates"]) == len(us["totalSeries"]) == len(us["indexSeries"])
    assert us["heatmap"]["weeks"] and us["heatmap"]["rows"] and us["backtest"]["rows"]
    assert set(us["breadth"]) == {"adl", "breadthVol", "trin", "pct200", "nhnl", "trust"}


def test_putcall_is_recorded_daily_outside_demo(tmp_path):
    def chain(t):
        return [OptionContract(contract=f"{t}P", type="put", exp="2026-12-18", strike=1, volume=120),
                OptionContract(contract=f"{t}C", type="call", exp="2026-12-18", strike=1, volume=100)]

    async def options(t):
        return chain(t)

    clock = {"now": NOW}  # 15 Uhr UTC: US-Börse noch offen
    term = types.SimpleNamespace(options=options, now=lambda: clock["now"])
    svc = SentimentService(term, None, tmp_path, mode="eodhd")
    (tmp_path / "stimmung").mkdir()
    (tmp_path / "stimmung" / "putcall.json").write_text(json.dumps({"2026-11-19": 0.9, "kaputt": "x"}))
    hist, _ = asyncio.run(svc._putcall(["2026-11-19", "2026-11-20"], [None, None]))
    assert hist == {"2026-11-19": 0.9}  # vor Börsenschluss nichts aufzeichnen
    clock["now"] = NOW.replace(hour=21, minute=30)
    hist, _ = asyncio.run(svc._putcall(["2026-11-18", "2026-11-19"], [None, None]))
    assert "2026-11-20" not in hist  # heute kein Handelstag mit Kurs (Feiertag): nicht mitzählen
    hist, note = asyncio.run(svc._putcall(["2026-11-19", "2026-11-20"], [None, None]))
    assert hist == {"2026-11-19": 0.9, "2026-11-20": 1.2}
    assert note == "sammelt noch: 2 von 250 Tagen aufgezeichnet"
    assert json.loads((tmp_path / "stimmung" / "putcall.json").read_text())["2026-11-20"] == 1.2


def test_eodhd_sentiments_mapping():
    from app.providers.eodhd import EODHDProvider

    calls = []

    class Client:
        async def get(self, path, params=None, *, cost=None):
            calls.append((path, params))
            return {"AAPL.US": [{"date": "2026-11-19", "count": 3, "normalized": 0.4},
                                {"date": "2026-11-18", "count": 0, "normalized": 0.1},
                                {"date": "2026-11-17", "count": 2, "normalized": 7}],
                    "FREMD.US": [{"date": "2026-11-19", "count": 1, "normalized": 0.1}]}

    p = EODHDProvider.__new__(EODHDProvider)
    p.client = Client()
    out = asyncio.run(p.sentiments(["aapl.us"], dt.date(2026, 11, 1)))
    assert out == {"aapl.us": {"2026-11-19": (0.4, 3)}}  # ohne Artikel oder außerhalb −1…+1: verworfen
    assert calls[0][0] == "sentiments" and calls[0][1]["s"] == "aapl.us"
