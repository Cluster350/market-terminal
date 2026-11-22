"""Jupyter-Notebook im Terminal (Funktion NB): startet JupyterLab als eigenen Prozess auf dem eigenen Rechner.

- Nur 127.0.0.1, mit zufälligem Zugangsschlüssel je Start; das Terminal reicht den Schlüssel nur an die eigene
  Oberfläche weiter (fremde Webseiten können ihn wegen der Zugriffsprüfung in main.py nicht abfragen).
- Die eigenen Notebooks liegen im Datenordner (wie das Depot, Standard ~/.market-terminal/notebooks) und
  überstehen so eine neue Version des Terminals. Das Modul ``mt`` (Daten des Terminals, nur lesend) und das
  Beispiel kommen aus dem Ordner ``notebook`` des Terminals; das Beispiel wird beim ersten Start kopiert.
- JupyterLab darf sich ins Terminal einbetten lassen (frame-ancestors), sonst nur in eigenem Fenster.
- Optional: braucht das Zusatzpaket aus requirements-notebook.txt (werkzeuge\\Notebook installieren.bat).
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import logging
import os
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

from .errors import TerminalError
from .models import Model

log = logging.getLogger("terminal.notebook")

TEMPLATE = Path(__file__).resolve().parents[2] / "notebook"  # mt.py und Beispiel.ipynb
DEFAULT_PORT = 8890
START_TIMEOUT = 90.0
# Schlüssel aus der .env (config.py lädt sie in die Umgebung), die Jupyter und seine Kernel nicht erben sollen
SECRETS = ("EODHD_API_KEY", "LLM_API_KEY", "ANTHROPIC_API_KEY")
# ohne Proxy: urllib schickte 127.0.0.1 sonst über einen eingestellten Proxy (HTTP_PROXY, Windows-Systemproxy) –
# der Start schlüge fehl und der Zugangsschlüssel ginge an den Proxy
_DIRECT = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class NotebookUnavailable(TerminalError):
    status = 503
    code = "notebook_unavailable"


class NotebookStatus(Model):
    installed: bool
    running: bool = False
    starting: bool = False
    port: int
    token: Optional[str] = None  # nur für die eigene Oberfläche (Adresse baut das Frontend mit dem eigenen Rechnernamen)
    path: str = "lab/tree/Beispiel.ipynb"
    message: Optional[str] = None


def installed() -> bool:
    try:
        return importlib.util.find_spec("jupyterlab") is not None
    except (ImportError, ValueError):
        return False


def _port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


def command(port: int, token: str, root: Path, terminal_port: int) -> list[str]:
    """Aufruf von JupyterLab: nur lokal, ohne eigenes Browserfenster, einbettbar im Terminal."""
    hosts = " ".join(f"http://{h}:{terminal_port}" for h in ("127.0.0.1", "localhost"))  # IPv6-Adressen kennt frame-ancestors nicht
    csp = f"frame-ancestors 'self' {hosts}"
    return [
        sys.executable, "-m", "jupyterlab",
        "--no-browser",
        "--ServerApp.ip=127.0.0.1",
        f"--ServerApp.port={port}",
        "--ServerApp.port_retries=0",
        f"--IdentityProvider.token={token}",
        f"--ServerApp.root_dir={root}",
        "--ServerApp.tornado_settings=" + repr({"headers": {"Content-Security-Policy": csp}}),
        "--LabApp.check_for_updates_class=jupyterlab.NeverCheckForUpdate",
        "--LabApp.news_url=",
    ] + (["--allow-root"] if hasattr(os, "geteuid") and os.geteuid() == 0 else [])  # Linux-Container laufen oft als root


class NotebookService:
    def __init__(self, data_dir: Path, port: Optional[int] = None, terminal_port: Optional[int] = None, template: Path = TEMPLATE):
        self.port = port or int(os.environ.get("NOTEBOOK_PORT", DEFAULT_PORT))
        self.terminal_port = terminal_port or int(os.environ.get("PORT", "8000"))
        self.root = Path(data_dir) / "notebooks"
        self.settings = Path(data_dir) / "jupyter-einstellungen"
        self.template = template
        self.proc: Optional[subprocess.Popen] = None
        self.token: Optional[str] = None
        self.starting = False
        self.error: Optional[str] = None
        self._lock = asyncio.Lock()

    def running(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def status(self) -> NotebookStatus:
        ok = installed()
        msg = self.error
        if not ok:
            msg = "Jupyter ist nicht installiert – einmal werkzeuge\\Notebook installieren.bat doppelklicken, dann das Terminal neu starten."
        elif self.proc is not None and not self.running() and not self.starting:
            msg = msg or "Das Notebook wurde beendet."
        running = self.running() and not self.starting
        return NotebookStatus(installed=ok, running=running, starting=self.starting, port=self.port,
                              token=self.token if running else None, message=msg)

    async def start(self) -> NotebookStatus:
        if not installed():
            raise NotebookUnavailable(self.status().message or "Jupyter ist nicht installiert.")
        async with self._lock:
            if self.running():
                return self.status()
            if _port_open(self.port):
                self.error = (f"Port {self.port} ist schon belegt – meist läuft noch ein Notebook von vorher. Einmal "
                              f"„Market Terminal beenden“ doppelklicken und das Terminal neu starten. Hilft das nicht (anderes "
                              f"Programm auf dem Port), in der .env einen anderen Port eintragen: NOTEBOOK_PORT={self.port + 1}")
                raise NotebookUnavailable(self.error)
            self.error, self.starting = None, True
            self.token = secrets.token_urlsafe(24)
            env = dict(os.environ)
            env["PYTHONPATH"] = os.pathsep.join(p for p in (str(self.template), env.get("PYTHONPATH", "")) if p)
            env["MT_URL"] = f"http://127.0.0.1:{self.terminal_port}"
            env["JUPYTERLAB_SETTINGS_DIR"] = str(self.settings)
            for secret in SECRETS:  # das Notebook spricht nur mit dem Terminal, nicht direkt mit EODHD oder der KI
                env.pop(secret, None)
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
            self._prepare()
            try:
                self.proc = subprocess.Popen(command(self.port, self.token, self.root, self.terminal_port), cwd=str(self.root), env=env,
                                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags)
                ok = await asyncio.to_thread(self._wait_ready)
            finally:
                self.starting = False
            if not ok:
                self.error = "Jupyter ist nicht rechtzeitig gestartet. Bitte erneut versuchen."
                await self.stop()
                raise NotebookUnavailable(self.error)
            log.info("Notebook: JupyterLab läuft auf Port %d (Ordner %s)", self.port, self.root)
            return self.status()

    def _prepare(self) -> None:
        """Notebook-Ordner anlegen und das Beispiel hineinkopieren, falls es dort noch fehlt (eigene Änderungen
        am Beispiel bleiben so erhalten)."""
        self.root.mkdir(parents=True, exist_ok=True)
        # Voreinstellungen von JupyterLab (nur wenn noch keine da sind – eigene Änderungen bleiben):
        # dunkles Design wie das Terminal, keine Nachrichten- und Update-Abfragen aus dem Internet
        defaults = {
            "@jupyterlab/apputils-extension/themes.jupyterlab-settings": {"theme": "JupyterLab Dark"},
            "@jupyterlab/apputils-extension/notification.jupyterlab-settings": {"fetchNews": "false", "checkForUpdates": False},
        }
        for rel, data in defaults.items():
            f = self.settings / rel
            if not f.exists():
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_text(json.dumps(data, indent=2), encoding="utf-8")
        example = self.template / "Beispiel.ipynb"
        if example.is_file() and not (self.root / example.name).exists():
            shutil.copyfile(example, self.root / example.name)

    def _wait_ready(self) -> bool:
        end = time.monotonic() + START_TIMEOUT
        while time.monotonic() < end:
            if self.proc is None or self.proc.poll() is not None:
                return False
            try:
                with _DIRECT.open(f"http://127.0.0.1:{self.port}/api/status?token={self.token}", timeout=2) as r:
                    if r.status == 200:
                        return True
            except (urllib.error.URLError, OSError):
                pass
            time.sleep(0.5)
        return False

    async def stop(self) -> NotebookStatus:
        p, self.proc, self.token = self.proc, None, None
        if p is not None and p.poll() is None:
            p.terminate()
            try:
                await asyncio.to_thread(p.wait, 10)
            except subprocess.TimeoutExpired:
                p.kill()
        return self.status()
