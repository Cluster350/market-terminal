"""Stream Deck: Fernsteuerung (Aufträge an das offene Terminal) und Datenpaket für Live-Tasten."""

import asyncio
import datetime as dt
import time

from fastapi.testclient import TestClient

from app.deck import RemoteCommand, RemoteHub
from app.main import access_problem, create_app
from app.providers.demo import DemoProvider

NOW = dt.datetime(2026, 11, 24, 15, 0, tzinfo=dt.timezone.utc)
LOCAL = {"host": "127.0.0.1:8000"}


def test_remote_hub_validates_and_targets_last_window():
    hub = RemoteHub()
    q1, q2 = hub.listen(), hub.listen()
    assert hub.send(RemoteCommand(command="  sap   gr  gp ")) == {"delivered": 2, "target": "main"}
    ev = q1.get_nowait()
    assert ev["command"] == "sap gr gp" and ev["target"] == "main" and q2.get_nowait()["id"] == ev["id"]
    hub.set_active("makro")
    hub.set_active("<böse>")  # ungültiger Fenstername wird ignoriert
    assert hub.send(RemoteCommand(page="macro"))["target"] == "makro"
    for bad in (RemoteCommand(command="<script>"), RemoteCommand(command="x" * 81), RemoteCommand(page="admin"), RemoteCommand()):
        try:
            hub.send(bad)
        except Exception as e:  # noqa: BLE001
            assert getattr(e, "status", None) == 400
        else:
            raise AssertionError(f"angenommen: {bad}")
    hub.drop(q1)
    hub.drop(q2)
    assert hub.send(RemoteCommand(maximize=True))["delivered"] == 0
    # ein hängendes Fenster läuft nicht über
    q = hub.listen()
    for _ in range(30):
        hub.send(RemoteCommand(command="TOP"))
    assert q.qsize() == 20


def test_access_rules_for_stream_deck():
    # Plugin (Node, ohne Origin) darf; fremde Webseiten nicht; Inhalt nur als JSON
    assert access_problem("POST", "/api/remote", {**LOCAL, "content-type": "application/json", "content-length": "20"}) is None
    assert access_problem("POST", "/api/remote", {**LOCAL, "origin": "https://boese.example", "content-type": "application/json"})[1] == "cross_site"
    assert access_problem("POST", "/api/remote", {**LOCAL, "sec-fetch-site": "cross-site"})[1] == "cross_site"
    assert access_problem("POST", "/api/remote", {**LOCAL, "content-type": "text/plain", "content-length": "20"})[1] == "content_type"
    assert access_problem("GET", "/api/deck", {"host": "evil.example:8000"})[1] == "host"


def test_deck_data_and_remote_endpoint(tmp_path, monkeypatch):
    monkeypatch.setenv("PORTFOLIO_DIR", str(tmp_path))
    from app.config import Settings

    with TestClient(create_app(DemoProvider(now_fn=lambda: NOW), cfg=Settings())) as c:
        params = {"tickers": "GDAXI.INDX,GSPC.INDX,quatsch!!,GDAXI.INDX,NWND", "parts": "news,alerts,depot,stim_us,unbekannt"}
        for _ in range(120):
            j = c.get("/api/deck", params=params).json()
            if j["stim"]["us"]["state"] == "ready":
                break
            time.sleep(0.5)
        assert [q["ticker"] for q in j["quotes"]] == ["GDAXI.INDX", "GSPC.INDX", "NWND.US"]
        assert j["quotes"][2]["requested"] == ["NWND"]  # Kurzform: Taste findet ihren Kurs wieder
        dax = j["quotes"][0]
        assert dax["low"] <= dax["last"] <= dax["high"] and dax["prevClose"]
        assert j["stim"]["us"]["state"] == "ready" and 0 <= j["stim"]["us"]["value"] <= 100 and "eu" not in j["stim"]
        assert j["depot"]["count"] > 0 and j["depot"]["currency"] == "EUR"
        assert set(j["alerts"]) >= {"active", "lastEventId"} and set(j["news"]) >= {"urgent", "latestId"}
        assert j["windows"] == 0
        r = c.post("/api/remote", json={"command": "STIM"})
        assert r.status_code == 200 and r.json()["delivered"] == 0
        assert c.post("/api/remote", json={"command": "rm -rf /;"}).status_code == 400
        assert c.post("/api/remote/active", json={"window": "makro"}).json() == {"active": "makro"}
        # Datenpaket ohne Teile: nur das Nötigste
        assert c.get("/api/deck").json()["quotes"] == []


def test_remote_events_stream_delivers(tmp_path, monkeypatch):
    monkeypatch.setenv("PORTFOLIO_DIR", str(tmp_path))
    from app.api.deck_routes import remote_events
    from app.config import Settings

    app = create_app(DemoProvider(now_fn=lambda: NOW), cfg=Settings())

    async def run():
        app.state.remote = RemoteHub()

        class Req:
            def __init__(self):
                self.app = app

            async def is_disconnected(self):
                return False

        resp = await remote_events(Req())
        it = resp.body_iterator
        first = await it.__anext__()
        assert "hello" in first
        app.state.remote.send(RemoteCommand(command="SAIS"))
        msg = await asyncio.wait_for(it.__anext__(), 2)
        assert '"command": "SAIS"' in msg and msg.startswith("data: ")
        await it.aclose()
        assert app.state.remote.listeners == 0  # Fenster geschlossen: abgemeldet

    asyncio.run(run())


def test_stim_key_keeps_last_value_while_recalculating(monkeypatch):
    """Beim Nachrechnen alle 10 Minuten bleibt der alte Wert stehen, statt kurz „rechnet …“ zu zeigen."""
    import asyncio
    from types import SimpleNamespace as NS

    import app.deck as deck

    async def run():
        calls = {"n": 0}

        async def stimmung(region):
            calls["n"] += 1
            await asyncio.sleep(0.05)
            return NS(state="ready", total=NS(value=40 + calls["n"], word="w"))

        svc = deck.DeckService(NS(state=NS(sentiment=NS(stimmung=stimmung))))
        clock = [1000.0]
        monkeypatch.setattr(deck.time, "time", lambda: clock[0])
        seen = [svc._stim_part("us").state]
        await asyncio.sleep(0.1)
        seen.append(svc._stim_part("us").value)
        clock[0] += deck.STIM_SECONDS + 1
        seen.append(svc._stim_part("us").value)  # startet die neue Rechnung
        clock[0] += 5
        seen.append(svc._stim_part("us").value)  # Rechnung läuft noch
        await asyncio.sleep(0.1)
        seen.append(svc._stim_part("us").value)
        return seen

    assert asyncio.run(run()) == ["building", 41, 41, 41, 42]
