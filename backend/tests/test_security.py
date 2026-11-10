"""Sicherheitsprüfung: Zugriff nur lokal (DNS-Rebinding, Anfragen fremder Webseiten), kein API-Schlüssel im
Protokoll, keine quadratisch langsamen Eingaben (lange Ticker, fremde Damodaran-Seiten)."""

import asyncio
import dataclasses
import datetime as dt
import logging
import sys
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.eodhd.client import EODHDClient
from app.errors import BadRequest
from app.intrinsic import damodaran_data
from app.main import LOCAL_HOSTS, HideSecrets, access_problem, create_app
from app.providers.demo import DemoProvider
from app.services.tickers import normalize

UTC = dt.timezone.utc
NOW = dt.datetime(2026, 10, 28, 15, 0, tzinfo=UTC)
ALERT = {"ticker": "NWND US", "level": 1.0, "note": "fremd"}


@pytest.fixture
def client(tmp_path):
    cfg = dataclasses.replace(settings, llm_mode="demo", portfolio_dir=str(tmp_path), alert_interval=3600)
    with TestClient(create_app(DemoProvider(now_fn=lambda: NOW), cfg)) as c:
        yield c


def _alerts(c: TestClient) -> list:
    return c.get("/api/alerts").json()["alerts"]


# --- Host-Kopf (DNS-Rebinding) -------------------------------------------------------------------------------


def test_foreign_host_header_is_rejected(client):
    # Eine fremde Seite, deren Name auf 127.0.0.1 umgebogen wurde, schickt ihren eigenen Namen als Host
    for host in ("attacker.example:8000", "127.0.0.1.attacker.example", "evil@127.0.0.1", ""):
        r = client.get("/api/portfolio", headers={"host": host})
        assert r.status_code == 400 and r.json()["error"]["code"] == "host", host
    for host in ("127.0.0.1:8000", "localhost:8000", "LOCALHOST", "[::1]:8000"):
        assert client.get("/api/realtime/status", headers={"host": host}).status_code == 200, host


def test_production_hosts_do_not_include_test_host():
    assert "testserver" not in LOCAL_HOSTS
    assert access_problem("GET", "/api/status", {"host": "testserver"})[0] == 400
    assert access_problem("GET", "/api/status", {"host": "127.0.0.1:8000"}) is None


# --- Anfragen fremder Webseiten (CSRF) -----------------------------------------------------------------------


def test_cross_site_write_is_rejected(client):
    # fetch(..., {mode: "no-cors", body: new Blob([json])}) schickt keinen Content-Type – FastAPI las das als JSON
    r = client.post("/api/alerts", content=b'{"ticker": "NWND US", "level": 1}', headers={"origin": "https://evil.example"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "cross_site"
    r = client.post("/api/alerts", content=b'{"ticker": "NWND US", "level": 1}', headers={"content-type": ""})
    assert r.status_code == 415
    r = client.post("/api/ai/ask", content=b'{"question": "x"}', headers={"content-type": "text/plain", "origin": "null"})
    assert r.status_code == 403
    r = client.post("/api/alerts", json=ALERT, headers={"origin": "https://evil.example"})
    assert r.status_code == 403
    assert client.post("/api/valuation/refresh", headers={"origin": "http://attacker.example:8000"}).status_code == 403
    assert client.delete("/api/alerts/events", headers={"sec-fetch-site": "cross-site"}).status_code == 403
    assert _alerts(client) == []


def test_cross_site_read_is_rejected(client):
    # Bilder und no-cors-Abrufe fremder Seiten kosten im EODHD-Modus Abrufe vom Tagesbudget
    r = client.get("/api/company/NWND.US", headers={"sec-fetch-site": "cross-site"})
    assert r.status_code == 403
    # Die Oberfläche selbst darf eine fremde Seite weiter verlinken (nur /api/ ist geschützt)
    assert client.get("/", headers={"sec-fetch-site": "cross-site"}).status_code not in (400, 403)


def test_own_requests_still_work(client):
    same = {"origin": "http://127.0.0.1:8000", "sec-fetch-site": "same-origin"}
    assert client.post("/api/alerts", json=ALERT, headers=same).status_code == 200
    # Entwicklung mit Vite (Proxy auf Port 5173) und Aufruf über localhost
    assert client.post("/api/alerts", json={**ALERT, "level": 2.0}, headers={"origin": "http://localhost:5173"}).status_code == 200
    # Startskripte (MSXML2.ServerXMLHTTP), curl und Tests senden weder Origin noch Sec-Fetch-Site
    assert client.post("/api/alerts", json={**ALERT, "level": 3.0}).status_code == 200
    assert client.post("/api/alerts/check", headers=same).status_code == 200  # POST ohne Body
    assert client.get("/api/status", headers={"sec-fetch-site": "none"}).status_code == 200  # Adressleiste
    assert client.post("/api/ai/ask", json={"question": "Wie steht NWND?"}, headers={"content-type": "application/json; charset=utf-8", **same}).status_code == 200
    assert len(_alerts(client)) == 3


def test_access_problem_details():
    h = {"host": "127.0.0.1:8000"}
    assert access_problem("POST", "/api/alerts", {**h, "origin": "null"})[0] == 403
    assert access_problem("POST", "/api/alerts", {**h, "origin": "file://"})[0] == 403
    assert access_problem("POST", "/api/alerts", {**h, "origin": "https://localhost.evil.example"})[0] == 403
    assert access_problem("PUT", "/api/portfolio", {**h, "origin": "http://localhost:8000", "content-length": "12",
                                                    "content-type": "application/json"}) is None
    assert access_problem("PUT", "/api/portfolio", {**h, "content-length": "12", "content-type": "text/plain"})[0] == 415
    assert access_problem("POST", "/api/alerts/check", {**h, "content-length": "0"}) is None
    assert access_problem("GET", "/assets/app.js", {**h, "sec-fetch-site": "cross-site"}) is None


# --- API-Schlüssel nicht im Protokoll ------------------------------------------------------------------------


def test_api_key_is_masked_in_log(caplog):
    async def go():
        c = EODHDClient("TESTKEY123", transport=httpx.MockTransport(lambda r: httpx.Response(200, json=[{"close": 1}])))
        try:
            await c.get("eod/AAPL.US", {"from": "2026-01-01"})
        finally:
            await c.close()

    with caplog.at_level(logging.INFO):
        asyncio.run(go())
    assert "HTTP Request" in caplog.text  # httpx protokolliert die Anfrage weiterhin …
    assert "TESTKEY123" not in caplog.text and "api_token=***" in caplog.text  # … aber ohne Schlüssel


def test_api_key_is_masked_in_tracebacks():
    try:
        raise ValueError("wss://ws.example/ws/us?api_token=TESTKEY123 ist keine gültige Adresse")
    except ValueError:
        record = logging.LogRecord("terminal", logging.ERROR, __file__, 1, "Fehler bei %s", ("https://x/api?api_token=TESTKEY123&fmt=json",), sys.exc_info())
    HideSecrets().filter(record)
    formatted = logging.Formatter().format(record)
    assert "TESTKEY123" not in formatted and formatted.count("api_token=***") >= 2 and "&fmt=json" in formatted


# --- Eingaben, die den Server blockierten -------------------------------------------------------------------


def test_long_ticker_is_rejected_fast():
    t0 = time.perf_counter()
    with pytest.raises(BadRequest):
        normalize("A" + " " * 200_000 + "B")  # vorher quadratisch: rund 4 Minuten, Server blockiert
    assert time.perf_counter() - t0 < 0.5
    assert normalize("  aapl us equity ") == "AAPL.US"
    assert normalize("W 1 Comdty") == "WHEAT.COMM"
    assert normalize("BTC-USD Curncy") == "BTC-USD.CC"


def test_long_ticker_in_api_body_does_not_block(client):
    t0 = time.perf_counter()
    r = client.post("/api/ai/ask", json={"question": "Kurs?", "ticker": "A" + " " * 200_000 + "B"})
    assert r.status_code in (200, 400) and time.perf_counter() - t0 < 5


def test_damodaran_number_and_page_limits(monkeypatch):
    t0 = time.perf_counter()
    assert damodaran_data.parse_number("1" * 100_000 + "x") is None  # vorher quadratisch (Minuten)
    assert time.perf_counter() - t0 < 0.5
    assert damodaran_data.parse_number("(12,345.67%)") == pytest.approx(-123.4567)

    monkeypatch.setattr(damodaran_data, "MAX_PAGE_BYTES", 1000)
    small = "<table><tr><td>Year</td><td>Implied FCFE</td></tr><tr><td>2025</td><td>4.33%</td></tr></table>"

    def handler(req: httpx.Request) -> httpx.Response:
        name = req.url.path.rsplit("/", 1)[-1]
        return httpx.Response(200, text=small if name == "histimpl.html" else "<p>" + "x" * 5000 + "</p>")

    pages = asyncio.run(damodaran_data.fetch(httpx.MockTransport(handler)))
    assert list(pages) == ["erp"] and damodaran_data.parse_erp(pages["erp"]) == pytest.approx(0.0433)
