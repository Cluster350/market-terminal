"""Echtzeit-Kurse: Abos verwalten, Ticks sammeln, Minutenkerzen bilden und an die Browser verteilen.

Quellen:
- EODHD-WebSocket (Paket All-In-One bzw. EOD+Intraday): US-Aktien mit Vor- und Nachbörse, europäische
  Aktien (Cboe Europe, 18 Börsen, z. B. Xetra, London, Paris), Devisen und Krypto in Echtzeit,
  standardmäßig höchstens 50 Werte gleichzeitig.
- Demo: simulierter Strom aus den Demo-Kursen.
Für alle übrigen Werte (Indizes, Anleihen, Rohstoffe, Börsen ohne Strom) fragt der Verteiler die
verzögerten Kurse regelmäßig ab und kennzeichnet sie als verzögert.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional, Protocol

from ..errors import TerminalError
from ..models import Quote
from ..services.util import round_price

log = logging.getLogger("terminal.realtime")

MAX_SYMBOLS = 50  # EODHD-Standard je API-Schlüssel (über alle Verbindungen)
MAX_DELAYED = 20  # verzögert abgefragte Werte (je Abfrage 1 API-Call pro Wert)
DELAYED_EVERY = 60.0  # Sekunden; EODHD aktualisiert verzögerte Kurse etwa minütlich
# Europäische Börsen im EODHD-Echtzeitstrom (Cboe Europe): Kürzel wie SAP.XETRA, SHEL.LSE, ASML.AS
EU_SUFFIXES = ("XETRA", "LSE", "PA", "AS", "BR", "SW", "MI", "MC", "ST", "CO", "OL", "HE", "VI", "LS", "IR")
REALTIME_SUFFIXES = ("US", "FOREX", "CC", *EU_SUFFIXES)


def realtime_capable(ticker: str) -> bool:
    """Gibt es für diesen Wert einen Echtzeit-Strom? (US- und europäische Aktien/ETFs, Devisen, Krypto)"""
    return ticker.rpartition(".")[2] in REALTIME_SUFFIXES


@dataclass
class Tick:
    ticker: str
    price: float
    ts: int  # Millisekunden UTC
    volume: Optional[float] = None  # Stückzahl dieses Abschlusses, falls bekannt
    delayed: bool = False  # aus verzögerten Kursen (nicht Echtzeit)

    def as_dict(self) -> dict:
        d: dict[str, Any] = {"t": self.ticker, "p": round_price(self.price), "ts": self.ts}  # Kleinstkurse mit gültigen Stellen
        if self.volume:
            d["v"] = self.volume
        if self.delayed:
            d["d"] = 1
        return d


class Source(Protocol):
    name: str

    def set_symbols(self, symbols: list[str]) -> None: ...

    async def run(self, hub: "RealtimeHub") -> None: ...


class Listener:
    """Ein Browserfenster: sammelt die jeweils neuesten Ticks seiner Werte (zusammengefasst)."""

    def __init__(self, tickers: list[str]):
        self.tickers = set(tickers)
        self.order = list(tickers)
        self.pending: dict[str, Tick] = {}
        self.event = asyncio.Event()
        self.since = time.monotonic()

    def push(self, tick: Tick) -> None:
        self.pending[tick.ticker] = tick
        self.event.set()

    def take(self) -> list[Tick]:
        out = list(self.pending.values())
        self.pending.clear()
        self.event.clear()
        return out


class RealtimeHub:
    def __init__(
        self,
        source: Optional[Source],
        *,
        delayed_quotes: Optional[Callable[[list[str]], Awaitable[list[Quote]]]] = None,
        server_tickers: Optional[Callable[[], Awaitable[list[str]]]] = None,
        limit: int = MAX_SYMBOLS,
        now_ms: Callable[[], int] = lambda: int(time.time() * 1000),
    ):
        self.source = source
        self.delayed_quotes = delayed_quotes
        self.server_tickers = server_tickers
        self.limit = limit
        self.now_ms = now_ms
        self.last: dict[str, Tick] = {}
        self.bars: dict[str, dict[int, list[Optional[float]]]] = {}
        self.listeners: set[Listener] = set()
        self.server_wanted: list[str] = []
        self.symbols: list[str] = []  # aktuell im Echtzeit-Strom abonniert
        self.connected = False
        self.message: Optional[str] = None
        self._tasks: list[asyncio.Task] = []

    # --- Abos -------------------------------------------------------------------------

    @property
    def mode(self) -> str:
        return self.source.name if self.source else "aus"

    def capable(self, ticker: str) -> bool:
        if self.source is None:
            return False
        check = getattr(self.source, "capable", None)
        return check(ticker) if callable(check) else realtime_capable(ticker)

    def refresh(self) -> None:
        """Nach einer Änderung der Quelle (z. B. Europa-Strom nicht freigeschaltet) neu verteilen."""
        self._resubscribe()

    def listen(self, tickers: list[str]) -> Listener:
        lst = Listener(tickers)
        self.listeners.add(lst)
        self._resubscribe()
        # Sofort den letzten bekannten Stand schicken (Fenster öffnet mitten im Handel)
        for t in tickers:
            if t in self.last:
                lst.push(self.last[t])
        return lst

    def unlisten(self, lst: Listener) -> None:
        self.listeners.discard(lst)
        self._resubscribe()

    def set_server_wanted(self, tickers: list[str]) -> None:
        if tickers != self.server_wanted:
            self.server_wanted = tickers
            self._resubscribe()

    def wanted(self) -> list[str]:
        """Neueste Fenster zuerst, dann Alarme und Depot; nur echtzeitfähige Werte, höchstens `limit`."""
        out: list[str] = []
        for lst in sorted(self.listeners, key=lambda x: -x.since):
            out += lst.order
        out += self.server_wanted
        seen: set[str] = set()
        res = []
        for t in out:
            if t not in seen and self.capable(t):
                seen.add(t)
                res.append(t)
        return res[: self.limit]

    def _resubscribe(self) -> None:
        want = self.wanted()
        if want != self.symbols:
            self.symbols = want
            if self.source is not None:
                self.source.set_symbols(want)

    def delayed_wanted(self) -> list[str]:
        out: list[str] = []
        for lst in sorted(self.listeners, key=lambda x: -x.since):
            out += [t for t in lst.order if not self.capable(t) and t not in out]
        return out[:MAX_DELAYED]

    # --- Ticks ------------------------------------------------------------------------

    def on_tick(self, tick: Tick) -> None:
        prev = self.last.get(tick.ticker)
        if prev is not None and tick.ts < prev.ts:
            return  # verspätete Nachricht
        self.last[tick.ticker] = tick
        minute = tick.ts // 60_000 * 60
        bars = self.bars.setdefault(tick.ticker, {})
        bar = bars.get(minute)
        if bar is None:
            bars[minute] = [tick.price, tick.price, tick.price, tick.price, tick.volume]
            if len(bars) > 1500:  # nur etwa den letzten Tag behalten
                for k in sorted(bars)[: len(bars) - 1440]:
                    del bars[k]
        else:
            bar[1] = max(bar[1], tick.price)  # type: ignore[type-var]
            bar[2] = min(bar[2], tick.price)  # type: ignore[type-var]
            bar[3] = tick.price
            if tick.volume:
                bar[4] = (bar[4] or 0) + tick.volume
        for lst in self.listeners:
            if tick.ticker in lst.tickers:
                lst.push(tick)

    def minute_bars(self, ticker: str) -> list[tuple]:
        """Minutenkerzen (ts, o, h, l, c, v) der letzten 24 Stunden aus dem Strom."""
        bars = self.bars.get(ticker)
        if not bars:
            return []
        cutoff = self.now_ms() // 1000 - 86_400
        return [(ts, *b) for ts, b in sorted(bars.items()) if ts >= cutoff]

    def overlay(self, q: Quote) -> Quote:
        """Jüngeren Echtzeit-Kurs in einen (verzögerten) Kurs einsetzen."""
        tick = self.last.get(q.ticker)
        if tick is None or tick.delayed or q.last is None and q.prev_close is None:
            return q
        if q.timestamp:
            try:
                qts = dt.datetime.fromisoformat(q.timestamp.replace("Z", "+00:00")).timestamp() * 1000
            except ValueError:
                qts = 0
            if tick.ts <= qts:
                return q
        elif self.now_ms() - tick.ts > 300_000:
            return q
        price = tick.price
        upd: dict[str, Any] = {
            "last": price,
            "timestamp": dt.datetime.fromtimestamp(tick.ts / 1000, tz=dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "delayed": False,
        }
        if q.prev_close:
            upd["change"] = price - q.prev_close
            upd["change_pct"] = (price / q.prev_close - 1) * 100
        if q.high is not None:
            upd["high"] = max(q.high, price)
        if q.low is not None:
            upd["low"] = min(q.low, price)
        return q.model_copy(update=upd)

    def status(self, tickers: Optional[list[str]] = None) -> dict:
        tickers = tickers or []
        return {
            "mode": self.mode,
            "connected": self.connected,
            "live": [t for t in tickers if t in self.symbols],
            "delayed": [t for t in tickers if t not in self.symbols],
            "symbols": len(self.symbols),
            "limit": self.limit,
            "message": self.message,
        }

    # --- Hintergrund ------------------------------------------------------------------

    def start(self) -> None:
        if self._tasks:
            return
        if self.source is not None:
            self._tasks.append(asyncio.create_task(self._run_source()))
        if self.delayed_quotes is not None:
            self._tasks.append(asyncio.create_task(self._poll_delayed()))
        if self.server_tickers is not None:
            self._tasks.append(asyncio.create_task(self._refresh_server()))

    async def close(self) -> None:
        for t in self._tasks:
            t.cancel()
        for t in self._tasks:
            try:
                await t
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        self._tasks.clear()

    async def _run_source(self) -> None:
        backoff = 2.0
        while True:
            try:
                await self.source.run(self)  # type: ignore[union-attr]
                backoff = 2.0
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 – Strom fällt aus: verzögerte Kurse bleiben
                self.connected = False
                log.warning("Echtzeit-Strom unterbrochen: %s", exc)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60.0)

    async def _poll_delayed(self) -> None:
        """Verzögerte Kurse für Werte ohne Echtzeit-Strom (laufende Kerze mit Rückstand)."""
        while True:
            tickers = self.delayed_wanted()
            if tickers:
                try:
                    quotes = await self.delayed_quotes(tickers)  # type: ignore[misc]
                except TerminalError as exc:
                    log.debug("Verzögerte Kurse nicht abrufbar: %s", exc.message)
                    quotes = []
                for q in quotes:
                    if q.last is None or not q.timestamp:
                        continue
                    try:
                        ts = int(dt.datetime.fromisoformat(q.timestamp.replace("Z", "+00:00")).timestamp() * 1000)
                    except ValueError:
                        continue
                    self.on_tick(Tick(q.ticker, q.last, ts, None, delayed=True))
            await asyncio.sleep(DELAYED_EVERY)

    async def _refresh_server(self) -> None:
        """Alarm- und Depotwerte laufend im Strom halten (Alarme in Echtzeit, auch ohne Browser)."""
        while True:
            try:
                self.set_server_wanted(await self.server_tickers())  # type: ignore[misc]
            except Exception as exc:  # noqa: BLE001
                log.debug("Server-Abos nicht aktualisiert: %s", exc)
            await asyncio.sleep(60)
