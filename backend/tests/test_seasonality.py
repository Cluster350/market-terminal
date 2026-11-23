"""Saisonalität (SAIS): Monats-/Tagesrenditen, Vergleich zum Zufall, Beständigkeit, Jahresverlauf, Endpunkt."""

import datetime as dt
import random

from fastapi.testclient import TestClient

from app.main import create_app
from app.providers.demo import DemoProvider
from app.seasonality import calc as C

NOW = dt.datetime(2026, 11, 20, 15, 0, tzinfo=dt.timezone.utc)


def _series(start: dt.date, n_days: int, ret):
    dates, closes, x = [], [], 100.0
    d = start
    while len(dates) < n_days:
        if d.weekday() < 5:
            x *= 1 + ret(d) / 100
            dates.append(d.isoformat())
            closes.append(x)
        d += dt.timedelta(days=1)
    return dates, closes


def test_monthly_returns_skip_running_month_and_gaps():
    dates = ["2025-01-31", "2025-02-28", "2025-04-30", "2025-05-30", "2025-06-02"]
    closes = [100.0, 110.0, 121.0, 133.1, 140.0]
    m = C.monthly_returns(dates, closes)
    # Februar gegen Januar; April fehlt der Vormonat (März), Juni läuft noch
    assert [(y, mo) for y, mo, _ in m] == [(2025, 2), (2025, 5)]
    assert abs(m[0][2] - 10.0) < 1e-9


def test_strong_pattern_is_found_and_noise_is_not():
    rng = random.Random(1)
    # Montags deutlich schwächer, sonst Rauschen
    dates, closes = _series(dt.date(2010, 1, 4), 2500, lambda d: rng.gauss(-0.4 if d.weekday() == 0 else 0.05, 1.0))
    daily = C.daily_returns(dates, closes)
    vals, labs = [r for _, r in daily], [d.weekday() for d, _ in daily]
    t = C.permutation_test(vals, labs, list(range(5)), n_perm=300)
    assert t["pAll"] < 0.01 and t["p"][0] < 0.01 and C.verdict(t["pAll"])[0] == "deutlich"
    rng2 = random.Random(2)
    dates, closes = _series(dt.date(2010, 1, 4), 2500, lambda d: rng2.gauss(0.03, 1.0))
    daily = C.daily_returns(dates, closes)
    t = C.permutation_test([r for _, r in daily], [d.weekday() for d, _ in daily], list(range(5)), n_perm=300)
    assert t["pAll"] > 0.05 and C.verdict(t["pAll"])[0] == "zufall"
    # gleiche Eingabe, gleiches Ergebnis (fester Zufallsstart)
    assert C.permutation_test([r for _, r in daily], [d.weekday() for d, _ in daily], list(range(5)), n_perm=300) == t
    assert C.permutation_test([1.0, 2.0], [0, 1], [0, 1])["pAll"] is None


def test_turn_of_month_and_stability():
    rng = random.Random(3)
    dates, closes = _series(dt.date(2015, 1, 1), 1500, lambda d: rng.gauss(0.0, 0.5))
    daily = C.daily_returns(dates, closes)
    vals, labs, years = C.turn_of_month(daily)
    # je Monat: letzter Handelstag + erste drei Tage (erster Monat ohne Monatsende davor, letzter ohne Folgemonat)
    months = len({(d.year, d.month) for d, _ in daily})
    assert sum(labs) == 4 * months - 4
    st = C.stability([1.0, 1.0, -1.0, 1.0], [0, 0, 0, 0], [2010, 2011, 2012, 2013], [0])
    assert st["cut"] == 2012 and st["groups"][0]["same"] is False


def test_year_path_average_and_current():
    rng = random.Random(4)
    dates, closes = _series(dt.date(2019, 1, 1), 1900, lambda d: 0.05 + rng.gauss(0, 0.2))
    p = C.year_path(dates, closes, 2026)
    assert p["years"] and 2019 not in p["years"] and 2026 not in p["years"]  # 2019 ohne Vorjahresschluss, 2026 läuft
    assert len(p["average"]) == 365 and p["average"][-1] > 0
    assert p["plusShare"][-1] == 100.0


def test_endpoint_demo(tmp_path, monkeypatch):
    monkeypatch.setenv("PORTFOLIO_DIR", str(tmp_path))
    from app.config import Settings

    with TestClient(create_app(DemoProvider(now_fn=lambda: NOW), cfg=Settings())) as c:
        r = c.get("/api/seasonality/GSPC.INDX")
        assert r.status_code == 200
        j = r.json()
        assert [g["label"] for g in j["months"]["groups"]][:2] == ["Januar", "Februar"] and len(j["months"]["groups"]) == 12
        assert [g["label"] for g in j["weekdays"]["groups"]] == ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"]
        assert j["months"]["verdict"] in ("deutlich", "schwach", "zufall") and j["months"]["sentence"].startswith("Stärkster Monat")
        assert j["turn"]["sentence"].startswith("Am Monatswechsel") and "keine Empfehlung" in j["note"]
        long = c.get("/api/seasonality/GSPC.INDX", params={"years": 25}).json()
        assert long["first"] < j["first"]
        assert c.get("/api/seasonality/XXXX.US").status_code == 404
