"""Prognose mit Einflussgrößen: Ausrichtung auf die Zielreihe (ohne Blick in die Zukunft), Statistik-Motor mit
Zusatzreihen, ehrlicher Vergleich mit/ohne im Rückblick-Test, Endpunkte."""

import asyncio
import dataclasses
import datetime as dt
import random
import urllib.parse

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.forecast import features as fx
from app.forecast.backtest import evaluate
from app.forecast.features import Feature, align_annual, align_prices, align_releases
from app.forecast.service import ForecastService
from app.forecast.simple import SimpleEngine, predict_one, predict_one_x
from app.main import create_app
from app.providers.demo import DemoProvider

NOW = dt.datetime(2026, 11, 6, 15, 0, tzinfo=dt.timezone.utc)


def run(coro):
    return asyncio.run(coro)


def leading(n=90, seed=3, noise=0.15):
    """Zielreihe, die der Einflussgröße einen Schritt hinterherläuft."""
    r = random.Random(seed)
    x = [r.gauss(0, 1) for _ in range(n)]
    y = [0.0] + [0.9 * x[i - 1] + noise * r.gauss(0, 1) for i in range(1, n)]
    return x, y


def test_align_prices_uses_only_the_past():
    pairs = [(f"2024-{m:02d}-15", 100.0 + m) for m in range(1, 13)] + [(f"2025-{m:02d}-15", 200.0) for m in range(1, 13)]
    # Jahresreihe: Durchschnitt bzw. Veränderung zum Vorjahr; ohne Vorjahr kein Wert
    assert align_prices(pairs, ["2024", "2025", "2026"], "year", level=True) == [106.5, 200.0, None]
    chg = align_prices(pairs, ["2024", "2025"], "year", level=False)
    assert chg[0] is None and chg[1] == pytest.approx((200 / 106.5 - 1) * 100)
    # Termine: der letzte Schluss VOR dem Termin, nie der vom selben Tag
    assert align_prices(pairs, ["2024-03-15", "2024-03-16", "2023-12-01"], "release", level=True) == [102.0, 103.0, None]
    daily = [((dt.date(2024, 1, 1) + dt.timedelta(days=i)).isoformat(), 100.0 + i) for i in range(100)]
    v = align_prices(daily, ["2024-04-01"], "release", level=False)[0]  # Schluss vom 31.3. gegen 63 Tage davor
    assert v == pytest.approx((190 / 127 - 1) * 100)


def test_align_annual_and_releases():
    by = {2020: 1.0, 2021: 2.0, 2023: 4.0}
    assert align_annual(by, ["2020", "2022", "2023"], "year") == [1.0, None, 4.0]
    # Termin im Jahr 2023: das letzte abgeschlossene Jahr davor ist 2021 – nicht 2023 selbst
    assert align_annual(by, ["2023-06-01", "2020-05-01"], "release") == [2.0, None]
    rows = [("2024-01-10", 1.0), ("2024-02-10", 2.0), ("2025-01-10", 5.0)]
    assert align_releases(rows, ["2024-02-10", "2024-02-11", "2024-01-01"], "release") == [1.0, 2.0, None]
    assert align_releases(rows, ["2024", "2025", "2026"], "year") == [1.5, 5.0, None]


def test_simple_engine_uses_a_leading_feature():
    x, y = leading()
    e = SimpleEngine()
    base, with_x = evaluate(e, y, 1), evaluate(e, y, 1, None, [x])
    assert with_x.mae < base.mae * 0.6  # die vorlaufende Reihe erklärt den nächsten Wert
    noise = [random.Random(9).gauss(0, 1) for _ in y]
    assert evaluate(e, y, 1, None, [noise]).mae < base.mae * 1.15  # Rauschen schadet kaum (gedämpfte Regression)
    # zu kurze Reihe oder keine Einflussgröße: wie ohne
    assert predict_one_x(y[:8], [x[:8]], 2) == predict_one(y[:8], 2)
    assert predict_one_x(y, [], 2) == predict_one(y, 2)


def test_service_compares_with_and_without():
    x, y = leading()
    t = [f"{1900 + i}" for i in range(len(y))]
    noise = [random.Random(5).gauss(0, 1) for _ in y]
    fs = ForecastService(mode="simple")
    feats = [Feature("lead", "Vorläufer", [None, None] + x[2:]), Feature("noise", "Rauschen", list(noise))]
    r = run(fs.forecast(kind="macro", key="k", label="L", unit="%", freq="year", t=t, y=y, h=1, future_t=["1990"],
                        features=feats, feature_notes=["X: unbekannt"]))
    f = r.features
    assert f.helps and f.gain > 0.3 and f.mae_with < f.mae_base and f.points == len(y) - 2
    by = {q.key: q for q in f.features}
    assert by["lead"].gain > 0.3 and by["noise"].gain < 0.1 and "Vorläufer" in f.text
    assert f.notes == ["X: unbekannt"] and len(f.baseline.median) == 1 and r.forecast.median != f.baseline.median
    assert [c.engine for c in r.quality.compared] == ["simple", "simple+x"]
    assert len(r.history.v) == len(y)  # angezeigt wird der ganze Verlauf
    # ohne nutzbare Reihe: Prognose wie ohne, mit Hinweis
    r2 = run(fs.forecast(kind="macro", key="k", label="L", unit="%", freq="year", t=t, y=y, h=1, future_t=["1990"], feature_notes=["X: unbekannt"]))
    plain = run(fs.forecast(kind="macro", key="k", label="L", unit="%", freq="year", t=t, y=y, h=1, future_t=["1990"]))
    assert r2.features.features == [] and r2.forecast.median == plain.forecast.median and plain.features is None
    # gemeinsamer Verlauf zu kurz
    short = [Feature("s", "kurz", [None] * (len(y) - 5) + x[-5:])]
    r3 = run(fs.forecast(kind="macro", key="k", label="L", unit="%", freq="year", t=t, y=y, h=1, future_t=["1990"], features=short))
    assert r3.features.features == [] and "zu kurz" in r3.features.notes[0]


def test_engine_without_feature_support_is_skipped():
    class Plain:
        name, label = "plain", "plain"

        def ready(self):
            return True

        def predict(self, series, h):
            return [[[s[-1]] * 5 for _ in range(h)] for s in series]

    x, y = leading()
    fs = ForecastService(mode="auto", chronos=Plain())
    r = run(fs.forecast(kind="macro", key="k", label="L", unit=None, freq="year", t=[str(i) for i in range(len(y))], y=y, h=1,
                        future_t=["x"], features=[Feature("lead", "Vorläufer", list(x))]))
    assert r.engine == "simple" and r.features.helps


@pytest.fixture(scope="module")
def client():
    cfg = dataclasses.replace(settings, forecast_mode="simple")
    with TestClient(create_app(DemoProvider(now_fn=lambda: NOW), cfg)) as c:
        yield c


def test_feature_options_and_endpoints(client):
    opts = client.get("/api/forecast/features?kind=event&country=US").json()
    groups = {o["group"] for o in opts}
    assert {"Rohstoffe", "Aktien", "Zinsen", "Devisen", "Kennzahlen", "Konjunkturtermine"} <= groups
    assert any(o["key"] == "US10Y.GBOND" for o in opts) and any(o["key"].startswith("m:USA:") for o in opts)
    macro_opts = client.get("/api/forecast/features?kind=macro&country=DEU").json()
    assert not any(o["group"] == "Konjunkturtermine" for o in macro_opts) and any(o["key"] == "DE10Y.GBOND" for o in macro_opts)

    events = [o for o in opts if o["group"] == "Konjunkturtermine"]
    name, other = events[0]["label"], events[1]["key"]
    q = urllib.parse.urlencode([("country", "US"), ("event", name), ("x", "WTI.COMM"), ("x", other), ("x", "US10Y.GBOND"), ("x", f"e:US:{name}")])
    r = client.get(f"/api/forecast/event?{q}").json()
    f = r["features"]
    assert [x["key"] for x in f["features"]] == ["WTI.COMM", other, "US10Y.GBOND"]  # die Zielreihe selbst zählt nicht
    assert f["maeBase"] and f["maeWith"] and f["text"] and len(f["baseline"]["median"]) == 3
    assert all(x["mae"] is not None for x in f["features"])

    r = client.get("/api/forecast/macro?country=USA&indicator=inflation_consumer_prices_annual&x=m:USA:gdp_growth_annual&x=NIXDA&x=m:XXX:quatsch").json()
    f = r["features"]
    assert [x["key"] for x in f["features"]] == ["m:USA:gdp_growth_annual"] and len(f["notes"]) == 2
    assert client.get("/api/forecast/macro?country=USA&indicator=gdp_growth_annual").json()["features"] is None
    assert client.get("/api/forecast/macro?country=USA&indicator=gdp_growth_annual" + "&x=A" * 6).status_code == 422


def test_resolve_limits_and_duplicates(client):
    t = client.app.state.terminal
    dates = [f"{y}" for y in range(2000, 2026)]
    feats, notes = run(fx.resolve(t, ["m:USA:gdp_growth_annual", "m:usa:gdp_growth_annual", " "], dates, "year"))
    assert len(feats) == 1 and notes == []
    assert all(v is None or isinstance(v, float) for v in feats[0].values)
