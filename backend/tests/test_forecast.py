"""Tests der Prognose: Statistik-Motor, Rückblick-Test, Kalibrierung der Bänder, Auto-Auswahl,
Konsensvergleich, Datenquellen und Endpunkte (ohne Chronos-2; der echte Modelltest läuft nur mit
RUN_CHRONOS=1 und installiertem Zusatzpaket)."""

import asyncio
import datetime as dt
import math
import os
import random

import pytest
from fastapi.testclient import TestClient

from app.errors import BadRequest
from app.forecast.backtest import Pair, apply_scales, band_scales, cross_coverage, evaluate
from app.forecast.base import LEVELS, quantile
from app.forecast.service import ForecastOff, ForecastService, judge, normalize_mode
from app.forecast.simple import SimpleEngine, predict_one
from app.forecast.sources import realized_vol_blocks
from app.main import create_app
from app.providers.demo import DemoProvider

NOW = dt.datetime(2026, 11, 6, 15, 0, tzinfo=dt.timezone.utc)
Z = (-1.2815515655446004, -0.6744897501960817, 0.0, 0.6744897501960817, 1.2815515655446004)


def run(coro):
    return asyncio.run(coro)


class Fixed:
    """Testmotor: Median = Mittelwert der Reihe (oder letzter Wert), Bänder = sigma · z · scale."""

    def __init__(self, name="fixed", mode="mean", sigma=1.0, scale=1.0):
        self.name, self.label, self.mode, self.sigma, self.scale = name, name, mode, sigma, scale
        self.calls = 0

    def ready(self):
        return True

    def predict(self, series, h):
        self.calls += 1
        out = []
        for s in series:
            c = sum(s) / len(s) if self.mode == "mean" else s[-1]
            out.append([[c + self.sigma * self.scale * z for z in Z] for _ in range(h)])
        return out


def noise(n=80, seed=1, level=2.0, sd=1.0):
    r = random.Random(seed)
    return [level + r.gauss(0, sd) for _ in range(n)]


def test_quantile_matches_linear_interpolation():
    assert quantile([3, 1, 2, 4], 0.5) == 2.5
    assert quantile([1, 2, 3, 4, 5], 0.1) == pytest.approx(1.4)
    assert math.isnan(quantile([], 0.5))
    assert LEVELS == (0.1, 0.25, 0.5, 0.75, 0.9)


def test_simple_engine_follows_trend_and_widens_bands():
    y = [10 + 0.5 * i + random.Random(i).gauss(0, 0.1) for i in range(40)]
    rows = predict_one(y, 4)
    assert len(rows) == 4 and all(len(r) == 5 for r in rows)
    assert all(r == sorted(r) for r in rows)
    assert rows[0][2] > y[-1] and rows[3][2] > rows[0][2]  # Trend wird fortgeschrieben
    widths = [r[4] - r[0] for r in rows]
    assert all(b >= a - 1e-9 for a, b in zip(widths, widths[1:]))  # Bänder werden nicht schmaler
    assert predict_one([5.0, 5.0], 2)[0][2] == 5.0  # sehr kurze Reihe: letzter Wert


def test_backtest_skill_and_coverage():
    y = noise(80)
    good = evaluate(Fixed("mean"), y, 3)
    naive = evaluate(Fixed("last", mode="last"), y, 3)
    assert good.origins == 24 and good.pairs > 24
    assert good.skill > 0.2  # Rauschen um ein Niveau: Mittelwert schlägt „wie zuletzt“
    assert abs(naive.skill) < 1e-9  # die einfache Regel ist sich selbst gleich gut
    assert 0.6 <= good.cover80 <= 0.95 and 0.3 <= good.cover50 <= 0.7
    assert set(good.step1) == set(range(80 - 24, 80))
    short = evaluate(Fixed(), [1, 2, 3, 4, 5], 2)
    assert short.origins == 0 and short.mae is None


def test_calibration_widens_too_narrow_bands_honestly():
    y = noise(120, seed=3)
    narrow = evaluate(Fixed(scale=0.3), y, 2)
    assert narrow.raw_cover80 < 0.45  # vor der Kalibrierung viel zu eng
    assert narrow.scale80 > 2.0
    assert 0.65 <= narrow.cover80 <= 0.92  # über Kreuz geprüft nach der Kalibrierung
    row = apply_scales([0, 1, 2, 3, 4], 2.0, 3.0)
    assert row == [-4.0, 0.0, 2.0, 4.0, 8.0]
    assert apply_scales([1, 1.9, 2, 2.1, 3], 4.0, 0.75)[0] <= 1.6  # 80-%-Band nie enger als das 50-%-Band
    few = [Pair(0, 0, 1.0, (0, 0.5, 1, 1.5, 2))] * 5
    assert band_scales(few) == (1.0, 1.0)
    assert cross_coverage([]) == (None, None)


def test_service_auto_picks_better_engine_and_compares_consensus():
    y = noise(60, seed=5)
    good, bad = Fixed("gut"), Fixed("schlecht", mode="last")
    fs = ForecastService("auto", chronos=bad)
    fs.simple = good  # Statistik durch den guten Testmotor ersetzen
    t = [f"2020-{i:03d}" for i in range(60)]
    consensus = [v + 0.05 for v in y]  # Konsens fast exakt
    res = run(fs.forecast(kind="event", key="X", label="X", unit="%", freq="release", t=t, y=y, h=2,
                          future_t=["a", "b"], consensus=consensus, next_consensus=2.1))
    assert res.engine == "gut"
    assert {c.engine for c in res.quality.compared} == {"gut", "schlecht"}
    assert res.forecast.t == ["a", "b"] and len(res.forecast.median) == 2
    assert res.forecast.lo80[0] <= res.forecast.lo50[0] <= res.forecast.median[0] <= res.forecast.hi50[0] <= res.forecast.hi80[0]
    assert res.quality.consensus_n == 24 and res.quality.consensus_mae < res.quality.model_mae1
    assert "Konsens" in res.verdict_text and res.next_consensus == 2.1
    calls = good.calls
    again = run(fs.forecast(kind="event", key="X", label="X", unit="%", freq="release", t=t, y=y, h=2,
                            future_t=["a", "b"], consensus=consensus, next_consensus=2.1))
    assert again is res and good.calls == calls  # aus dem Zwischenspeicher


def test_service_modes_and_errors():
    assert normalize_mode("Statistik") == "simple" and normalize_mode("aus") == "off" and normalize_mode("x") == "auto"
    off = ForecastService("off")
    with pytest.raises(ForecastOff):
        run(off.forecast(kind="macro", key="k", label="k", unit=None, freq="year", t=["1"] * 10, y=[1.0] * 10, h=1, future_t=["2"]))
    assert off.status().active is None and "aus" in off.status().message
    s = ForecastService("simple")
    with pytest.raises(BadRequest):
        run(s.forecast(kind="macro", key="k", label="k", unit=None, freq="year", t=["1"] * 3, y=[1.0, 2.0, 3.0], h=1, future_t=["2"]))
    st = s.status()
    assert st.mode == "simple" and st.active == "simple" and st.engines[-1].ready


def test_judge_wording():
    from app.forecast.models import FcQuality

    assert judge(FcQuality(origins=2, skill=0.5))[0] == "wenig"
    v, text = judge(FcQuality(origins=20, skill=0.3, cover80=0.5))
    assert v == "gut" and "30 %" in text and "zu eng" in text
    assert judge(FcQuality(origins=20, skill=0.04))[0] == "knapp"
    assert judge(FcQuality(origins=20, skill=-0.2))[0] == "schwach"


def test_realized_vol_blocks():
    closes = [100 * math.exp(0.01 * i * (1 if i % 2 else -1)) for i in range(64)]
    dates = [f"2026-01-{i:02d}" for i in range(64)]
    t, v = realized_vol_blocks(closes, dates, window=21)
    assert len(v) == 3 and t[-1] == dates[-1]
    flat = realized_vol_blocks([100.0] * 50, dates[:50], window=21)[1]
    assert flat == [0.0, 0.0]


def test_forecast_endpoints_demo():
    with TestClient(create_app(DemoProvider(now_fn=lambda: NOW))) as c:
        st = c.get("/api/forecast/status").json()
        assert st["mode"] == "simple" and st["active"] == "simple"
        m = c.get("/api/forecast/macro", params={"country": "DEU", "indicator": "inflation_consumer_prices_annual", "h": 3}).json()
        assert m["kind"] == "macro" and m["freq"] == "year" and m["forecast"]["t"] == ["2026", "2027", "2028"]
        assert m["history"]["t"][-1] == "2025" and "Deutschland" in m["label"] and m["unit"] == "%"
        assert m["quality"]["origins"] > 5 and m["verdict"] in ("gut", "knapp", "schwach", "wenig")
        e = c.get("/api/forecast/event", params={"country": "US", "event": "CPI YoY", "h": 2}).json()
        assert e["freq"] == "release" and len(e["consensus"]["v"]) == len(e["history"]["v"]) > 40
        assert e["nextConsensus"] is not None and e["forecast"]["t"][0] > e["history"]["t"][-1]
        assert e["quality"]["consensusN"] > 10
        v = c.get("/api/forecast/vol/NWND US", params={"h": 2, "iv": 30}).json()
        assert v["kind"] == "vol" and v["extra"]["implied"] == 30 and v["extra"]["lastRealized"] > 0
        assert all(x > 0 for x in v["forecast"]["median"])
        assert c.get("/api/forecast/event", params={"country": "US", "event": "Gibt es nicht"}).status_code == 404
        assert c.get("/api/forecast/macro", params={"country": "DE", "indicator": "x"}).status_code == 422
        assert c.get("/api/forecast/macro", params={"country": "DEU", "indicator": "x"}).status_code == 400
    with TestClient(create_app(DemoProvider(now_fn=lambda: NOW), forecast="off")) as c:
        r = c.get("/api/forecast/macro", params={"country": "DEU", "indicator": "gdp_growth_annual"})
        assert r.status_code == 503 and r.json()["error"]["code"] == "forecast_off"


@pytest.mark.skipif(os.environ.get("RUN_CHRONOS") != "1", reason="echtes Modell nur mit RUN_CHRONOS=1")
def test_chronos_engine_real_model():  # pragma: no cover – braucht das Zusatzpaket und die Gewichte
    from app.forecast.chronos_engine import ChronosEngine

    e = ChronosEngine()
    e.load()
    assert e.ready(), e.error
    rows = e.predict([noise(60), noise(30, seed=2)], 3)
    assert len(rows) == 2 and len(rows[0]) == 3 and all(r == sorted(r) for r in rows[0])
    s = evaluate(e, noise(80), 2)
    assert s.mae is not None and s.skill > 0


def test_ask_tool_and_demo_ai_use_forecast():
    with TestClient(create_app(DemoProvider(now_fn=lambda: NOW))) as c:
        r = c.post("/api/ai/ask", json={"question": "Wie entwickelt sich die Inflation in Deutschland? Prognose bitte."}).json()
        assert r["trace"][0]["tool"] == "prognose" and r["trace"][0]["ok"]
        assert "Modellprognose" in r["answer"] and "80-%-Band" in r["answer"] and "keine Empfehlung" in r["answer"]
        r2 = c.post("/api/ai/ask", json={"question": "Wie ist die erwartete Schwankung?", "ticker": "NWND.US"}).json()
        assert r2["trace"][0]["tool"] == "prognose" and "Schwankung" in r2["answer"]

    from app.ai.tools import run_tool, summarize
    from app.services.terminal import Terminal

    t = Terminal(DemoProvider(now_fn=lambda: NOW))
    assert "fehler" in run(run_tool(t, "prognose", {"art": "kennzahl"}))  # ohne Prognose-Dienst
    t.forecast = ForecastService("simple")
    res = run(run_tool(t, "prognose", {"art": "termin", "land": "US", "termin": "CPI YoY"}))
    assert res["methode"].startswith("Statistik") and len(res["prognose"]) == 3 and res["rueckblick_test"]["startpunkte"] > 5
    assert res["konsens_naechster_termin"] is not None
    assert summarize("prognose", {}, res).startswith("Prognose CPI YoY")
    assert "fehler" in run(run_tool(t, "prognose", {"art": "termin", "land": "USA"}))
