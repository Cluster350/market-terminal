"""Tests der relativen Rotation (RRG): Rechenkern, Felder, Rückblick und Endpunkte."""

import datetime as dt
import math

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.providers.demo import DemoProvider
from app.rotation.calc import backtest, ema, heading, quadrant, rrg_lines, to_weekly, week_key, zscore

NOW = dt.datetime(2026, 11, 6, 15, 0, tzinfo=dt.timezone.utc)


def test_weekly_keys_and_smoothing():
    assert week_key("2026-11-02") == week_key("2026-11-06") == week_key("2026-11-08") == "2026-11-06"
    w = to_weekly(["2026-11-02", "2026-11-05", "2026-11-09", "2026-11-10"], [10.0, 11.0, None, 12.0])
    assert w == {"2026-11-06": 11.0, "2026-11-13": 12.0}
    assert ema([1.0, None, 3.0], 3) == [1.0, 1.0, 2.0]
    z = zscore([1.0, 2.0, 3.0, 4.0], 3)
    assert z[:2] == [None, None] and z[2] == pytest.approx(101.0) and z[3] == pytest.approx(101.0)
    assert zscore([5.0, 5.0, 5.0], 3)[-1] == 100.0  # ohne Schwankung: neutral


def test_cycle_rotates_clockwise_and_quadrants():
    vals = [100 * math.exp(0.05 * math.sin(i / 6)) for i in range(200)]
    rs, t, m = rrg_lines(vals, [100.0] * 200)
    qs = [quadrant(a, b) for a, b in zip(t, m)]
    seq = [q for i, q in enumerate(qs) if q and (i == 0 or q != qs[i - 1])]
    # Reihenfolge im Uhrzeigersinn: führend → schwächer → Nachzügler → erholend → führend
    order = ["fuehrend", "schwaecher", "nachzuegler", "erholend"]
    for a, b in zip(seq[1:], seq[2:]):
        assert order.index(b) == (order.index(a) + 1) % 4
    bt = backtest([(rs, t, m)])
    assert bt["clockwise_share"] == 1.0 and bt["counter"] == 0
    # nach „erholend“ steigt die relative Stärke im Zyklus, nach „schwächer“ fällt sie
    assert bt["quadrants"]["erholend"]["h13"]["avg"] > 0 > bt["quadrants"]["schwaecher"]["h13"]["avg"]
    assert quadrant(None, 100) is None and quadrant(101, 99) == "schwaecher" and quadrant(99, 101) == "erholend"
    hd, sp = heading([100, 101], [100, 101], 1)
    assert hd == pytest.approx(45) and sp == pytest.approx(math.sqrt(2))


def test_rotation_endpoints_demo(tmp_path, monkeypatch):
    monkeypatch.setenv("PORTFOLIO_DIR", str(tmp_path))
    from app.config import Settings

    with TestClient(create_app(DemoProvider(now_fn=lambda: NOW), cfg=Settings())) as c:
        first = c.get("/api/rotation", params={"universe": "sectors"}).json()
        assert first["state"] in ("building", "ready")
        import time

        for _ in range(100):
            r = c.get("/api/rotation", params={"universe": "sectors", "region": "us"}).json()
            if r["state"] == "ready":
                break
            time.sleep(0.1)
        assert r["state"] == "ready" and len(r["weeks"]) == 104 and len(r["members"]) >= 8
        tech = next(m for m in r["members"] if m["key"] == "Technology")
        assert len(tech["trend"]) == 104 and tech["quadrant"] in ("fuehrend", "schwaecher", "nachzuegler", "erholend")
        assert "fairGap" in tech and set(r["test"]["quadrants"]) == {"fuehrend", "schwaecher", "nachzuegler", "erholend"}
        s = c.get("/api/rotation", params={"universe": "sector", "region": "us", "sector": "Technology"}).json()
        assert s["members"] and all(m["ticker"].endswith(".US") for m in s["members"]) and "Sektorindex" in s["benchmark"]
        eur = c.get("/api/rotation", params={"universe": "countries", "ccy": "eur"}).json()
        loc = c.get("/api/rotation", params={"universe": "countries", "ccy": "local"}).json()
        assert len(loc["members"]) > len(eur["members"]) >= 10 and eur["skipped"]  # ohne Devisenkurs übersprungen
        assert any(m["label"] == "Deutschland" for m in eur["members"])
        fx = c.get("/api/rotation", params={"universe": "currencies", "bench": "basket"}).json()
        assert {m["key"] for m in fx["members"]} >= {"USD", "EUR", "GBP", "JPY", "CHF"}
        fx_eur = c.get("/api/rotation", params={"universe": "currencies", "bench": "eur"}).json()
        assert "EUR" not in {m["key"] for m in fx_eur["members"]} and fx_eur["benchmark"] == "Euro"
        assert c.get("/api/rotation", params={"universe": "x"}).status_code == 422
        assert c.get("/api/rotation", params={"universe": "sector", "sector": "Gibtsnicht"}).status_code == 404
