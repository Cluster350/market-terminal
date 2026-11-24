"""Stream Deck: Fernsteuerung des offenen Terminals und ein kompaktes Datenpaket für Live-Tasten.

- Fernsteuerung: Das Stream-Deck-Plugin schickt einen Auftrag (Befehl wie in der Befehlszeile, Seitenwechsel oder
  Maximieren) an POST /api/remote; das Terminal im Browser hört über GET /api/remote/events mit und führt ihn
  aus – im zuletzt benutzten Fenster. Es gibt nur Aufträge, die auch die Befehlszeile kann: nichts wird gekauft,
  verkauft, gespeichert oder gelöscht.
- Datenpaket GET /api/deck: Kurse der gewählten Werte, Angst-&-Gier-Wert (STIM), Kursalarme, Eilmeldungen und das
  Tagesergebnis des Depots – alles in einer Abfrage, die das Plugin alle paar Sekunden stellt.
Beides ist nur vom eigenen Rechner erreichbar (Zugriffsprüfung in main.py).
"""

from __future__ import annotations

import asyncio
import datetime as dt
import itertools
import logging
import re
import time
from typing import Any, Optional

from .errors import BadRequest, TerminalError
from .models import Model

log = logging.getLogger("terminal.deck")

PAGES = ("equity", "macro", "screener", "news", "depot")
# Befehle wie in der Befehlszeile: Buchstaben, Ziffern, Leerzeichen und die Zeichen von Tickern (.-^=&/:)
COMMAND_RE = re.compile(r"^[0-9A-Za-zÄÖÜäöüß .\-^=&/:]{1,80}$")
URGENT_HOURS = 3
DEPOT_SECONDS = 60
STIM_SECONDS = 600


class RemoteCommand(Model):
    command: Optional[str] = None  # z. B. "STIM", "SAP GR GP"
    page: Optional[str] = None  # equity | macro | screener | news | depot
    maximize: Optional[bool] = None  # aktives Panel maximieren bzw. zurück


class RemoteWindow(Model):
    window: str


class RemoteHub:
    """Verteilt Aufträge an die offenen Terminal-Fenster (Server-Sent Events)."""

    def __init__(self) -> None:
        self._queues: set[asyncio.Queue] = set()
        self._ids = itertools.count(1)
        self.active = "main"  # zuletzt benutztes Fenster
        self._active_at = 0.0

    def set_active(self, window: str) -> None:
        if re.fullmatch(r"[A-Za-z0-9_-]{1,40}", window or ""):
            self.active, self._active_at = window, time.time()

    def listen(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=20)
        self._queues.add(q)
        return q

    def drop(self, q: asyncio.Queue) -> None:
        self._queues.discard(q)

    @property
    def listeners(self) -> int:
        return len(self._queues)

    def send(self, cmd: RemoteCommand) -> dict[str, Any]:
        event: dict[str, Any] = {"id": next(self._ids), "target": self.active}
        if cmd.command is not None:
            text = " ".join(cmd.command.split())
            if not COMMAND_RE.match(text):
                raise BadRequest("Ungültiger Befehl – erlaubt sind Befehle wie in der Befehlszeile, z. B. „SAP GR GP“ oder „STIM“.")
            event["command"] = text
        elif cmd.page is not None:
            if cmd.page not in PAGES:
                raise BadRequest(f"Unbekannte Seite „{cmd.page}“ – erlaubt: {', '.join(PAGES)}.")
            event["page"] = cmd.page
        elif cmd.maximize is not None:
            event["maximize"] = bool(cmd.maximize)
        else:
            raise BadRequest("Leerer Auftrag: command, page oder maximize angeben.")
        for q in list(self._queues):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:  # Fenster hängt: ältesten Auftrag verwerfen
                try:
                    q.get_nowait()
                    q.put_nowait(event)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass
        return {"delivered": len(self._queues), "target": self.active}


class DeckQuote(Model):
    ticker: str
    name: Optional[str] = None
    last: Optional[float] = None
    change_pct: Optional[float] = None
    high: Optional[float] = None  # Tageshoch und -tief (Tagesspanne auf der Taste)
    low: Optional[float] = None
    prev_close: Optional[float] = None
    currency: Optional[str] = None


class DeckStim(Model):
    value: Optional[float] = None
    word: str = ""
    state: str = "building"


class DeckAlerts(Model):
    active: int = 0
    last_event_id: Optional[str] = None
    last_event_at: Optional[str] = None
    last_event: Optional[str] = None


class DeckNews(Model):
    urgent: int = 0  # Eilmeldungen der letzten URGENT_HOURS Stunden
    latest_id: Optional[str] = None
    latest_title: Optional[str] = None


class DeckDepot(Model):
    value: Optional[float] = None
    day_pnl: Optional[float] = None
    day_pnl_pct: Optional[float] = None
    currency: Optional[str] = None
    count: int = 0


class DeckData(Model):
    time: str
    mode: str
    windows: int  # offene Terminal-Fenster (0 = Tasten können nichts öffnen)
    quotes: list[DeckQuote] = []
    stim: dict[str, DeckStim] = {}
    alerts: DeckAlerts = DeckAlerts()
    news: DeckNews = DeckNews()
    depot: Optional[DeckDepot] = None


class DeckService:
    def __init__(self, app: Any):
        self.app = app
        self._stim: dict[str, tuple[float, asyncio.Task]] = {}
        self._depot: Optional[tuple[float, Optional[DeckDepot]]] = None
        self._depot_lock = asyncio.Lock()

    async def data(self, tickers: list[str], parts: set[str]) -> DeckData:
        st = self.app.state
        t = st.terminal
        out = DeckData(time=dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"), mode=t.p.mode,
                       windows=st.remote.listeners)
        jobs = []
        if tickers:
            jobs.append(self._quotes(out, tickers))
        if "news" in parts:
            jobs.append(self._news(out))
        if "depot" in parts:
            jobs.append(self._depot_part(out))
        await asyncio.gather(*jobs)
        if "alerts" in parts:
            self._alerts(out)
        for region in ("us", "eu"):
            if f"stim_{region}" in parts:
                out.stim[region] = self._stim_part(region)
        return out

    async def _quotes(self, out: DeckData, tickers: list[str]) -> None:
        try:
            qs = await self.app.state.terminal.quotes(tickers)
        except TerminalError as e:
            log.info("Stream Deck: Kurse nicht verfügbar (%s)", e)
            return
        out.quotes = [DeckQuote(ticker=q.ticker, name=q.name, last=q.last, change_pct=q.change_pct, high=q.high, low=q.low,
                              prev_close=q.prev_close, currency=q.currency) for q in qs]

    def _stim_part(self, region: str) -> DeckStim:
        """Stimmung ohne zu warten: Die Rechnung läuft im Hintergrund, die Taste zeigt das letzte fertige Ergebnis."""
        hit = self._stim.get(region)
        now = time.time()
        ready = hit is not None and self._stim_from(hit[1]).state == "ready"
        # fertig: alle STIM_SECONDS neu; noch im Aufbau (Firmenliste aus BWT fehlt): alle 10 s nachfragen
        if hit is None or (hit[1].done() and now - hit[0] > (STIM_SECONDS if ready else 10)):
            task = asyncio.ensure_future(self.app.state.sentiment.stimmung(region))
            task.add_done_callback(lambda t: t.exception() if not t.cancelled() else None)  # Fehler nicht unbeachtet lassen
            if hit is not None and hit[1].done() and not hit[1].cancelled() and hit[1].exception() is None:
                # bis die neue Rechnung fertig ist, das alte Ergebnis behalten
                prev = hit[1]
                self._stim[region] = (now, task)
                return self._stim_from(prev)
            self._stim[region] = (now, task)
            hit = self._stim[region]
        return self._stim_from(hit[1])

    @staticmethod
    def _stim_from(task: asyncio.Task) -> DeckStim:
        if not task.done() or task.cancelled() or task.exception() is not None:
            return DeckStim()
        res = task.result()
        if res.state != "ready":
            return DeckStim()
        return DeckStim(value=res.total.value, word=res.total.word, state="ready")

    def _alerts(self, out: DeckData) -> None:
        try:
            state = self.app.state.alerts.load()
        except Exception as e:  # noqa: BLE001 – kaputte Datei: Taste zeigt nur nichts
            log.info("Stream Deck: Alarme nicht lesbar (%s)", e)
            return
        ev = state.events[0] if state.events else None
        out.alerts = DeckAlerts(active=sum(1 for a in state.alerts if a.active), last_event_id=ev.id if ev else None,
                                last_event_at=ev.at if ev else None, last_event=ev.message if ev else None)

    async def _news(self, out: DeckData) -> None:
        try:
            page = await self.app.state.terminal.news(None, None, None, 60, 0, None)
        except TerminalError:
            return
        cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=URGENT_HOURS)).isoformat()
        urgent = [n for n in page.items if n.urgent and n.date >= cutoff[:19]]
        out.news = DeckNews(urgent=len(urgent), latest_id=urgent[0].id if urgent else None,
                            latest_title=urgent[0].title if urgent else None)

    async def _depot_part(self, out: DeckData) -> None:
        async with self._depot_lock:
            if self._depot and time.time() - self._depot[0] < DEPOT_SECONDS:
                out.depot = self._depot[1]
                return
            from .api.portfolio_routes import current_portfolio
            from .portfolio.analytics import analyze

            dep: Optional[DeckDepot] = None
            try:
                p = await current_portfolio(self.app)
                if p.positions:
                    a = await analyze(self.app.state.terminal, p)
                    s = a.summary
                    dep = DeckDepot(value=s.value, day_pnl=s.day_pnl, day_pnl_pct=s.day_pnl_pct, currency=a.base, count=s.count)
            except TerminalError as e:
                log.info("Stream Deck: Depot nicht verfügbar (%s)", e)
            self._depot = (time.time(), dep)
            out.depot = dep
