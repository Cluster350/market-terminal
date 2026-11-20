"""Notebook (Funktion NB): Start, Schutz des Zugangsschlüssels, Einbettung, Beispiel und Voreinstellungen,
dazu das Modul mt (nur lesend) gegen das Demo-Terminal."""

import importlib.util
import json
import sys
import threading
import time
from pathlib import Path

import pytest
import uvicorn
from fastapi.testclient import TestClient

from app import notebook as nbmod
from app.main import create_app
from app.providers.demo import DemoProvider

REPO = Path(__file__).resolve().parents[2]
HAS_JUPYTER = importlib.util.find_spec("jupyterlab") is not None


def test_command_is_local_with_token_and_embeddable():
    cmd = nbmod.command(8890, "geheim", Path("/x"), 8000)
    assert "--ServerApp.ip=127.0.0.1" in cmd and "--IdentityProvider.token=geheim" in cmd and "--no-browser" in cmd
    csp = next(c for c in cmd if c.startswith("--ServerApp.tornado_settings="))
    assert "frame-ancestors 'self' http://127.0.0.1:8000 http://localhost:8000" in csp and "[::1]" not in csp
    assert "--ServerApp.port_retries=0" in cmd


def test_prepare_copies_example_and_settings_once(tmp_path):
    svc = nbmod.NotebookService(tmp_path, port=1, terminal_port=1)
    svc._prepare()
    ex = tmp_path / "notebooks" / "Beispiel.ipynb"
    theme = tmp_path / "jupyter-einstellungen" / "@jupyterlab/apputils-extension/themes.jupyterlab-settings"
    assert ex.is_file() and json.loads(theme.read_text())["theme"] == "JupyterLab Dark"
    ex.write_text("eigen")
    theme.write_text('{"theme": "JupyterLab Light"}')
    svc._prepare()
    assert ex.read_text() == "eigen" and "Light" in theme.read_text()  # eigene Änderungen bleiben


def test_status_without_jupyter(monkeypatch, tmp_path):
    monkeypatch.setattr(nbmod, "installed", lambda: False)
    with TestClient(create_app(DemoProvider())) as c:
        c.app.state.notebook = nbmod.NotebookService(tmp_path)
        s = c.get("/api/notebook").json()
        assert s["installed"] is False and s["token"] is None and "Notebook installieren" in s["message"]
        r = c.post("/api/notebook/start")
        assert r.status_code == 503 and "installieren" in r.json()["error"]["message"]
        # fremde Webseiten dürfen das Notebook nicht starten
        assert c.post("/api/notebook/start", headers={"Origin": "https://evil.example"}).status_code == 403


def test_example_notebook_is_valid():
    nb = json.loads((REPO / "notebook" / "Beispiel.ipynb").read_text(encoding="utf-8"))
    code = "\n".join("".join(c["source"]) for c in nb["cells"] if c["cell_type"] == "code")
    assert "import mt" in code and nb["nbformat"] == 4
    compile(code.replace("%matplotlib inline", ""), "Beispiel", "exec")


@pytest.fixture(scope="module")
def live_terminal():
    """Demo-Terminal auf einem freien Port, damit mt echte HTTP-Abfragen schickt."""
    import socket

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(create_app(DemoProvider(), realtime=False, valuation=False), host="127.0.0.1", port=port, log_level="warning"))
    th = threading.Thread(target=server.run, daemon=True)
    th.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.1)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    th.join(5)


@pytest.fixture()
def mt(live_terminal, monkeypatch):
    pytest.importorskip("pandas")
    sys.path.insert(0, str(REPO / "notebook"))
    try:
        import mt as module
    finally:
        sys.path.pop(0)
    monkeypatch.setattr(module, "URL", live_terminal)
    return module


def test_mt_reads_terminal_data(mt):
    assert mt.status()["mode"] == "demo"
    t = mt.status()["defaults"]["watchlist"][0]
    h = mt.history(t, start="2026-01-01")
    assert list(h.columns) == ["open", "high", "low", "close", "volume"] and h.index.is_monotonic_increasing and len(h) > 50
    assert h.attrs["ticker"] == t
    q = mt.quotes([t, "SPY US"])
    assert q.loc[t, "last"] > 0
    c = mt.closes(["SPY US", "GOLD Comdty"], start="2026-06-01")
    assert list(c.columns) == ["SPY US", "GOLD Comdty"]
    infl = mt.countries("Inflation")
    assert "USA" in infl.columns and infl.index.max() >= 2024
    assert list(mt.curves(["US", "DE"]).columns) == ["US", "DE"]
    f = mt.forecast("USA", "Inflation", x=["Gold", "US10Y.GBOND"])
    assert set(f["kind"]) == {"Ist", "Prognose"} and f.attrs["features"] and "ohne_einflussgroessen" in f.columns
    o = mt.options(t)
    assert o.index.name == "strike" and "call_iv" in o.columns
    d0 = mt.dcf(t)
    d1 = mt.dcf(t, {"growth_next": d0["levers"][0]["value"] + 0.05})
    assert d1["valuePerShare"] > d0["valuePerShare"]
    assert mt.portfolio().attrs["summary"]["value"] > 0


def test_mt_errors_in_words_and_read_only(mt):
    with pytest.raises(mt.MTError, match="Unbekannter Ticker"):
        mt.history("GIBTSNICHT XX")
    with pytest.raises(mt.MTError, match="Kennzahl"):
        mt.countries("Bananen")
    src = (REPO / "notebook" / "mt.py").read_text(encoding="utf-8")
    # schreibende Aufrufe gibt es nicht: POST nur für die DCF-Rechnung
    assert src.count('method="POST"') == 1 and "PUT" not in src and "DELETE" not in src and "PATCH" not in src
    old = mt.URL
    mt.URL = "http://127.0.0.1:9"
    try:
        with pytest.raises(mt.MTError, match="nicht erreichbar"):
            mt.status()
    finally:
        mt.URL = old


@pytest.mark.skipif(not HAS_JUPYTER, reason="JupyterLab nicht installiert")
def test_start_and_stop_jupyter(tmp_path):
    import asyncio
    import socket
    import urllib.request

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    svc = nbmod.NotebookService(tmp_path, port=port, terminal_port=8000)

    async def go():
        st = await svc.start()
        assert st.running and st.token and (tmp_path / "notebooks" / "Beispiel.ipynb").is_file()
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/lab?token={st.token}", timeout=10) as r:
            assert "frame-ancestors" in r.headers["Content-Security-Policy"]
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/contents", timeout=10)
            raise AssertionError("ohne Schlüssel erreichbar")
        except urllib.error.HTTPError as e:
            assert e.code == 403
        assert (await svc.start()).token == st.token  # zweiter Start: dasselbe Jupyter
        st = await svc.stop()
        assert not st.running and st.token is None

    asyncio.run(go())


def test_start_passes_no_secrets_to_jupyter(monkeypatch, tmp_path):
    """Jupyter und seine Kernel erben keine Schlüssel aus der .env (weder EODHD noch die KI)."""
    import asyncio

    seen: dict = {}

    class FakeProc:
        def poll(self):
            return None

    def fake_popen(cmd, **kw):
        seen.update(kw["env"])
        return FakeProc()

    monkeypatch.setenv("EODHD_API_KEY", "eodhd-geheim")
    monkeypatch.setenv("LLM_API_KEY", "ki-geheim")
    monkeypatch.setattr(nbmod, "installed", lambda: True)
    monkeypatch.setattr(nbmod, "_port_open", lambda port: False)
    monkeypatch.setattr(nbmod.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(nbmod.NotebookService, "_wait_ready", lambda self: True)
    svc = nbmod.NotebookService(tmp_path, port=1, terminal_port=8123)
    st = asyncio.run(svc.start())
    assert st.running and seen["MT_URL"] == "http://127.0.0.1:8123"
    assert "EODHD_API_KEY" not in seen and "LLM_API_KEY" not in seen
    assert not any(v in ("eodhd-geheim", "ki-geheim") for v in seen.values())
    svc.proc = None


def test_mt_edge_cases(mt):
    t = mt.status()["defaults"]["watchlist"][0]
    # Zeitraum ohne Kurse: leere Tabelle mit den üblichen Spalten statt KeyError
    h = mt.history(t, start="2099-01-01")
    assert h.empty and list(h.columns) == ["open", "high", "low", "close", "volume"]
    assert mt.closes([t, "SPY US"], start="2099-01-01").empty
    # unbekannter Teil der Finanzdaten: Fehler in Worten statt leerer Tabelle
    with pytest.raises(mt.MTError, match="income"):
        mt.financials(t, part="guv")
    # Quartalsenden der Gewinne sind Tagesangaben wie der Index von history – vergleichbar ohne Zeitzonenfehler
    e = mt.earnings(t)
    assert e["date"].dt.tz is None and e["reportDate"].dt.tz is None
    assert mt.history(t).index[0] < e["date"].max()


def test_busy_port_suggests_another_port(monkeypatch, tmp_path):
    import asyncio

    monkeypatch.setattr(nbmod, "installed", lambda: True)
    monkeypatch.setattr(nbmod, "_port_open", lambda port: True)
    svc = nbmod.NotebookService(tmp_path, port=8891, terminal_port=8000)
    with pytest.raises(nbmod.NotebookUnavailable) as e:
        asyncio.run(svc.start())
    assert "NOTEBOOK_PORT=8892" in e.value.message and svc.status().message == e.value.message


def test_local_requests_ignore_proxy(monkeypatch, mt, tmp_path):
    """Ein eingestellter Proxy (HTTP_PROXY, unter Windows der Systemproxy) darf Anfragen an 127.0.0.1 nicht umleiten:
    sonst schlüge der Start fehl, mt erreichte das Terminal nicht und der Zugangsschlüssel ginge an den Proxy."""
    import http.server
    import socket
    import urllib.request

    for name in ("http_proxy", "HTTP_PROXY"):
        monkeypatch.setenv(name, "http://127.0.0.1:9")  # kein Proxy erreichbar
    for name in ("no_proxy", "NO_PROXY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(urllib.request, "_opener", None)  # urlopen liest die Umgebung neu
    assert mt.status()["mode"] == "demo"

    class Ok(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            self.send_response(200)
            self.end_headers()

        def log_message(self, *a):
            pass

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    srv = http.server.HTTPServer(("127.0.0.1", port), Ok)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        svc = nbmod.NotebookService(tmp_path, port=port, terminal_port=8000)
        svc.token = "t"
        svc.proc = type("P", (), {"poll": lambda self: None})()
        monkeypatch.setattr(nbmod, "START_TIMEOUT", 3.0)
        assert svc._wait_ready()
    finally:
        srv.shutdown()
        svc.proc = None


def test_mt_countries_by_name_and_forecast_axis(mt):
    assert mt.land("Deutschland") == "DEU" and mt.land("germany", "iso2") == "DE" and mt.land("UK", "kurve") == "UK"
    assert mt.land("Großbritannien", "iso2") == "GB" and mt.land("eurozone", "iso2") == "EU"
    with pytest.raises(mt.MTError, match="Land"):
        mt.land("Atlantis")
    f = mt.forecast("Deutschland", "Inflation")
    # Jahre als Zahl: als Text zeichnete matplotlib die Prognose an den Anfang der Achse
    assert str(f.index.dtype).startswith("int") and f.index.is_monotonic_increasing
    assert list(mt.curves(["USA", "Deutschland"]).columns) == ["US", "DE"]
    e = mt.forecast_event("USA", mt.calendar("USA").iloc[0]["event"]) if len(mt.calendar("USA")) else None
    if e is not None:
        assert str(e.index.dtype).startswith("datetime64")


def test_mt_warns_and_errors_clearly(mt):
    with pytest.warns(UserWarning, match="nicht gefunden"):
        f = mt.forecast("USA", "Inflation", x=["Goldd XX"])
    assert f.attrs["notes"]
    with pytest.raises(mt.MTError):
        mt.dcf("PNCL US")  # Bank: kein DCF – Fehler in Worten statt stillem dict

