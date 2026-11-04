"""Tests der Kursalarme: Bedingungen, einmaliges Auslösen, Scharfschalten, Datei und API."""

import asyncio
import dataclasses
import datetime as dt
import json

import pytest
from fastapi.testclient import TestClient

from app.alerts.models import Alert, AlertIn, AlertPatch
from app.alerts.service import AlertService, condition_text, is_met
from app.cache import TTLCache
from app.config import settings
from app.errors import BadRequest, NotFound
from app.main import create_app
from app.models import Quote
from app.providers.demo import DemoProvider
from app.services.terminal import Terminal

UTC = dt.timezone.utc
NOW = dt.datetime(2026, 10, 28, 15, 0, tzinfo=UTC)


def run(coro):
    return asyncio.run(coro)


def alert(**kw) -> Alert:
    return Alert(**{"id": "a", "ticker": "NWND.US", "level": 100.0, "direction": "above", "created": "2026-10-28T10:00:00Z", **kw})


def test_conditions():
    q = Quote(ticker="NWND.US", last=101.0, change_pct=-3.2)
    assert is_met(alert(), q)
    assert not is_met(alert(direction="below"), q)
    assert is_met(alert(direction="below", level=101.0), q)  # Marke genau erreicht
    assert is_met(alert(kind="change", level=3.0, direction="below"), q)
    assert not is_met(alert(kind="change", level=3.5, direction="below"), q)
    assert not is_met(alert(kind="change", level=1.0, direction="above"), q)
    assert not is_met(alert(), Quote(ticker="NWND.US"))  # ohne Kurs nie
    assert condition_text(alert(level=1234.5)) == "über 1.234,50"
    assert condition_text(alert(ticker="EURUSD.FOREX", level=1.08, direction="below")) == "unter 1,08000"
    assert condition_text(alert(kind="change", level=5, direction="below")) == "Tagesminus ab 5,0 %"


@pytest.fixture()
def svc(tmp_path):
    t = Terminal(DemoProvider(now_fn=lambda: NOW), TTLCache())
    return AlertService(t, tmp_path, "demo", 0)


def price(svc: AlertService) -> float:
    return run(svc.t.quotes(["NWND.US"]))[0].last


def test_create_direction_and_validation(svc):
    p = price(svc)
    up = run(svc.create(AlertIn(ticker="nwnd", level=p * 1.1)))
    down = run(svc.create(AlertIn(ticker="NWND US", level=p * 0.9)))
    assert (up.ticker, up.direction, down.direction) == ("NWND.US", "above", "below")
    with pytest.raises(NotFound):
        run(svc.create(AlertIn(ticker="GIBTSNICHT US", level=1)))
    with pytest.raises(BadRequest):
        run(svc.create(AlertIn(ticker="NWND", kind="change", level=2)))  # Richtung fehlt
    with pytest.raises(BadRequest):
        run(svc.create(AlertIn(ticker="NWND", kind="change", level=150, direction="above")))
    with pytest.raises(ValueError):
        AlertIn(ticker="NWND", level=0)
    assert svc.interval == 15


def test_fires_once_logs_and_rearms(svc, tmp_path):
    p = price(svc)
    a = run(svc.create(AlertIn(ticker="NWND", level=p * 1.2, direction="below", note="Stopp")))  # sofort erfüllt
    mark = run(svc.create(AlertIn(ticker="NWND", level=p * 1.2, direction="below", alarm=False)))  # nur Marke
    fired = run(svc.check())
    assert [e.alert_id for e in fired] == [a.id] and "Stopp" in fired[0].message
    assert run(svc.check()) == []  # einmalig, kein Dauerfeuer
    state = svc.load()
    first = next(x for x in state.alerts if x.id == a.id)
    assert not first.active and first.triggered_price == pytest.approx(p)
    assert next(x for x in state.alerts if x.id == mark.id).active  # Marke bleibt unberührt
    # Wieder scharf: bewusst gewählte Richtung bleibt („Stopp“), meldet sich aber erst nach neuem Erreichen
    re = run(svc.update(a.id, AlertPatch(active=True)))
    assert re.active and re.direction == "below" and re.wait_cross and re.triggered_at is None
    assert run(svc.check()) == []
    data = json.loads((tmp_path / "alarme-demo.json").read_text(encoding="utf-8"))
    assert len(data["events"]) == 1 and data["alerts"][0]["ticker"] == "NWND.US"
    run(svc.delete(mark.id))
    with pytest.raises(NotFound):
        run(svc.delete(mark.id))
    run(svc.clear_events())
    assert svc.load().events == []


def test_view_distance(svc):
    p = price(svc)
    run(svc.create(AlertIn(ticker="NWND", level=p * 1.05)))
    v = run(svc.view())
    assert v.alerts[0].distance_pct == pytest.approx(5.0) and v.alerts[0].price == pytest.approx(p)


def test_broken_file_is_set_aside(tmp_path):
    (tmp_path / "alarme-demo.json").write_text("[kaputt", encoding="utf-8")
    svc = AlertService(Terminal(DemoProvider(now_fn=lambda: NOW), TTLCache()), tmp_path, "demo", 0)
    assert svc.load().alerts == []
    assert any(f.name.startswith("alarme-demo.defekt-") for f in tmp_path.iterdir())


def test_api_and_ai_tool(tmp_path):
    cfg = dataclasses.replace(settings, llm_mode="demo", portfolio_dir=str(tmp_path), alert_interval=3600)
    with TestClient(create_app(DemoProvider(now_fn=lambda: NOW), cfg)) as c:
        p = c.get("/api/quotes?tickers=NWND.US").json()[0]["last"]
        a = c.post("/api/alerts", json={"ticker": "NWND US", "level": p * 2, "direction": "below"}).json()
        assert a["direction"] == "below" and a["active"]
        assert c.post("/api/alerts", json={"ticker": "NWND", "level": -1}).status_code == 422
        events = c.post("/api/alerts/check").json()
        assert len(events) == 1 and events[0]["alertId"] == a["id"]
        v = c.get("/api/alerts").json()
        assert v["interval"] == 3600 and v["events"][0]["message"].startswith("NWND US unter")
        assert c.patch(f"/api/alerts/{a['id']}", json={"note": "  neu  "}).json()["note"] == "neu"
        assert c.patch("/api/alerts/xyz", json={"active": True}).status_code == 404
        ans = c.post("/api/ai/ask", json={"question": "Welche Alarme habe ich?"}).json()
        assert ans["trace"][0]["tool"] == "alarme" and "1 Alarme" in ans["answer"]
        assert c.delete("/api/alerts/events").json() == {"ok": True}
        assert c.delete(f"/api/alerts/{a['id']}").json() == {"ok": True}
        assert c.get("/api/alerts").json()["alerts"] == []


def test_patch_keeps_percent_limit(svc):
    a = run(svc.create(AlertIn(ticker="NWND", kind="change", level=5, direction="above")))
    with pytest.raises(BadRequest):
        run(svc.update(a.id, AlertPatch(level=500)))


def test_rearmed_stop_waits_for_new_cross(svc, monkeypatch):
    """Stopp „unter 150“ bei 145: nach ↻ erst melden, wenn der Kurs über 150 war und wieder fällt."""
    px = {"v": 145.0}

    async def quotes(tickers):
        return {t: Quote(ticker=t, last=px["v"], change_pct=0.0) for t in tickers}

    monkeypatch.setattr(svc, "_quotes", quotes)
    a = run(svc.create(AlertIn(ticker="NWND", level=150, direction="below")))
    assert not a.auto_dir
    assert len(run(svc.check())) == 1  # bewusst so angelegt: meldet sofort
    re = run(svc.update(a.id, AlertPatch(active=True)))
    assert re.direction == "below" and re.wait_cross
    assert run(svc.check()) == []  # noch unter 150: wartet
    px["v"] = 152.0
    assert run(svc.check()) == []  # über 150: jetzt scharf
    assert not next(x for x in svc.load().alerts if x.id == a.id).wait_cross
    px["v"] = 149.0
    assert len(run(svc.check())) == 1  # neu unterschritten
    # Kursmarke (Richtung automatisch) wird beim Wieder-Scharfschalten neu ausgerichtet
    m = run(svc.create(AlertIn(ticker="NWND", level=140)))
    assert m.auto_dir and m.direction == "below"
