"""Kursalarme: Datei im Benutzerordner, Prüfung im Hintergrund, Protokoll der Auslösungen.

Ein Alarm löst einmal aus und ist danach „ausgelöst“, bis er wieder scharf geschaltet wird –
so meldet ein Kurs, der um die Marke pendelt, nicht jede Minute erneut.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
import os
import secrets
from pathlib import Path
from typing import Optional

from pydantic import ValidationError

from ..errors import BadRequest, NotFound, TerminalError
from ..models import Quote
from ..services.terminal import Terminal
from ..services.tickers import display, normalize
from .models import Alert, AlertEvent, AlertIn, AlertPatch, AlertsResponse, AlertState, AlertView

log = logging.getLogger("terminal.alerts")

MAX_ALERTS = 200
MAX_EVENTS = 200


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _de(x: float, digits: int) -> str:
    return f"{x:,.{digits}f}".replace(",", "§").replace(".", ",").replace("§", ".")


def _digits(ticker: str, x: float) -> int:
    if ticker.endswith(".FOREX"):
        return 3 if abs(x) >= 20 else 5
    if ticker.endswith(".GBOND"):
        return 3
    return 2 if abs(x) >= 1 else 4


def condition_text(a: Alert) -> str:
    if a.kind == "change":
        return f"Tages{'plus' if a.direction == 'above' else 'minus'} ab {_de(a.level, 2 if a.level < 1 else 1)} %"
    return f"{'über' if a.direction == 'above' else 'unter'} {_de(a.level, _digits(a.ticker, a.level))}"


def is_met(a: Alert, q: Quote) -> bool:
    if a.kind == "price":
        if q.last is None:
            return False
        return q.last >= a.level if a.direction == "above" else q.last <= a.level
    if q.change_pct is None:
        return False
    return q.change_pct >= a.level if a.direction == "above" else q.change_pct <= -a.level


class AlertService:
    def __init__(self, terminal: Terminal, directory: str | Path, mode: str, interval: int):
        self.t = terminal
        self.path = Path(directory) / f"alarme-{mode}.json"
        self.interval = interval or (15 if mode == "demo" else 60)
        self._lock = asyncio.Lock()
        self._task: Optional[asyncio.Task] = None
        self.checked_at: Optional[str] = None

    # --- Datei ----------------------------------------------------------------

    def load(self) -> AlertState:
        try:
            raw = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return AlertState()
        except OSError as exc:
            raise TerminalError(f"Alarmdatei nicht lesbar ({self.path}): {exc}") from exc
        try:
            return AlertState.model_validate(json.loads(raw))
        except (ValueError, ValidationError) as exc:
            backup = self.path.with_suffix(f".defekt-{dt.datetime.now():%Y%m%d-%H%M%S}.json")
            try:
                self.path.replace(backup)
            except OSError:
                pass
            log.error("Alarmdatei %s unlesbar (%s), gesichert als %s", self.path, exc, backup.name)
            return AlertState()

    def _save(self, state: AlertState) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(state.model_dump(by_alias=True), ensure_ascii=False, indent=1), encoding="utf-8")
            os.replace(tmp, self.path)
        except OSError as exc:
            raise TerminalError(f"Alarme konnten nicht gespeichert werden ({self.path}): {exc}") from exc

    # --- Kurse ----------------------------------------------------------------

    async def _quotes(self, tickers: list[str]) -> dict[str, Quote]:
        out: dict[str, Quote] = {}
        uniq = sorted(set(tickers))
        for i in range(0, len(uniq), 40):
            try:
                for q in await self.t.quotes(uniq[i : i + 40]):
                    out[q.ticker] = q
            except TerminalError as exc:
                log.warning("Kurse für Alarme nicht abrufbar: %s", exc.message)
        return out

    async def _direction(self, ticker: str, level: float) -> str:
        q = (await self._quotes([ticker])).get(ticker)
        if q is None or q.last is None:
            raise BadRequest(f"Für {display(ticker)} gibt es gerade keinen Kurs – bitte die Richtung (über/unter) wählen.")
        return "above" if level > q.last else "below"

    # --- Bearbeiten -------------------------------------------------------------

    async def create(self, body: AlertIn) -> Alert:
        ticker = normalize(body.ticker)
        await self.t.resolve(ticker)  # unbekannte Ticker mit Vorschlägen ablehnen
        if body.kind == "change" and body.level > 100:
            raise BadRequest("Tagesveränderung bitte als Prozentwert bis 100 eingeben.")
        direction = body.direction
        if direction is None:
            if body.kind == "change":
                raise BadRequest("Bitte Tagesplus oder Tagesminus wählen.")
            direction = await self._direction(ticker, body.level)
        alert = Alert(
            id=secrets.token_hex(6), ticker=ticker, kind=body.kind, level=body.level, direction=direction,  # type: ignore[arg-type]
            alarm=body.alarm, active=True, note=" ".join(body.note.split()), created=_now(),
        )
        async with self._lock:
            state = self.load()
            if len(state.alerts) >= MAX_ALERTS:
                raise BadRequest(f"Höchstens {MAX_ALERTS} Alarme und Marken.")
            state.alerts.append(alert)
            self._save(state)
        return alert

    async def update(self, alert_id: str, patch: AlertPatch) -> Alert:
        async with self._lock:
            state = self.load()
            i = next((k for k, a in enumerate(state.alerts) if a.id == alert_id), None)
            if i is None:
                raise NotFound("Alarm nicht gefunden (in einem anderen Fenster gelöscht?).")
            a = state.alerts[i]
            upd: dict = {k: v for k, v in patch.model_dump(exclude_unset=True).items() if v is not None}
            if "note" in upd:
                upd["note"] = " ".join(str(upd["note"]).split())
            rearm = "level" in upd or upd.get("active") is True or (upd.get("alarm") is True and not a.alarm)
            if rearm:
                upd.update(active=True, triggered_at=None, triggered_price=None)
                # Kursmarke neu ausrichten: Alarm gilt in Richtung der Marke vom heutigen Kurs aus
                if a.kind == "price" and "direction" not in upd:
                    try:
                        upd["direction"] = await self._direction(a.ticker, upd.get("level", a.level))
                    except BadRequest:
                        pass
            state.alerts[i] = a.model_copy(update=upd)
            self._save(state)
            return state.alerts[i]

    async def delete(self, alert_id: str) -> None:
        async with self._lock:
            state = self.load()
            keep = [a for a in state.alerts if a.id != alert_id]
            if len(keep) == len(state.alerts):
                raise NotFound("Alarm nicht gefunden.")
            state.alerts = keep
            self._save(state)

    async def clear_events(self) -> None:
        async with self._lock:
            state = self.load()
            state.events = []
            self._save(state)

    # --- Prüfen -----------------------------------------------------------------

    async def check(self) -> list[AlertEvent]:
        """Scharfe Alarme gegen die aktuellen Kurse prüfen; ausgelöste werden protokolliert."""
        async with self._lock:
            state = self.load()
            armed = [a for a in state.alerts if a.alarm and a.active]
            self.checked_at = _now()
            if not armed:
                return []
            quotes = await self._quotes([a.ticker for a in armed])
            fired: list[AlertEvent] = []
            for i, a in enumerate(state.alerts):
                q = quotes.get(a.ticker)
                if not (a.alarm and a.active) or q is None or not is_met(a, q):
                    continue
                now = _now()
                state.alerts[i] = a.model_copy(update={"active": False, "triggered_at": now, "triggered_price": q.last})
                if a.kind == "price":
                    msg = f"{display(a.ticker)} {condition_text(a)}: {_de(q.last or 0, _digits(a.ticker, q.last or 0))}"
                else:
                    sign = "+" if (q.change_pct or 0) >= 0 else "−"
                    msg = f"{display(a.ticker)} {condition_text(a)}: {sign}{_de(abs(q.change_pct or 0), 2)} %"
                if a.note:
                    msg += f" – {a.note}"
                fired.append(AlertEvent(
                    id=secrets.token_hex(6), alert_id=a.id, ticker=a.ticker, kind=a.kind, level=a.level, direction=a.direction,
                    price=q.last, change_pct=q.change_pct, at=now, message=msg,
                ))
            if fired:
                state.events = (list(reversed(fired)) + state.events)[:MAX_EVENTS]
                self._save(state)
                for e in fired:
                    log.info("Alarm ausgelöst: %s", e.message)
            return fired

    async def view(self) -> AlertsResponse:
        state = self.load()
        quotes = await self._quotes([a.ticker for a in state.alerts]) if state.alerts else {}
        views = []
        for a in state.alerts:
            q = quotes.get(a.ticker)
            dist = None
            if q and q.last and a.kind == "price":
                dist = (a.level / q.last - 1.0) * 100
            views.append(AlertView(**a.model_dump(), price=q.last if q else None, change_pct=q.change_pct if q else None,
                                   distance_pct=dist, name=q.name if q else None))
        return AlertsResponse(alerts=views, events=state.events[:50], interval=self.interval, checked_at=self.checked_at)

    # --- Hintergrund ------------------------------------------------------------

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run(), name="kursalarme")

    async def close(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _run(self) -> None:
        while True:
            try:
                await self.check()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 – die Prüfung darf nie dauerhaft stehen bleiben
                log.warning("Alarmprüfung fehlgeschlagen: %s", exc)
            await asyncio.sleep(self.interval)
