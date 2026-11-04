"""EODHD-Echtzeit über WebSocket: US-Aktien (Abschlüsse, mit Vor- und Nachbörse), Devisen, Krypto.

Endpunkte wss://ws.eodhistoricaldata.com/ws/{us|forex|crypto}?api_token=…; nach dem Verbinden
{"action": "subscribe", "symbols": "AAPL,TSLA"}. Nachrichten (tolerant gelesen):
- us:     {"s": "AAPL", "p": 227.3, "v": 100, "t": 1726…(ms)}
- forex:  {"s": "EURUSD", "a": 1.0937, "b": 1.0936, "t": …}
- crypto: {"s": "BTC-USD", "p": "64000.1", "q": "0.01", "t": …}
Status: {"status_code": 200, "message": "Authorized"}; Fehler mit status_code 4xx.
Der Zugang gehört zum Paket All-In-One bzw. EOD+Intraday All World Extended.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Optional

from .hub import RealtimeHub, Tick

log = logging.getLogger("terminal.realtime")

WS_BASE = "wss://ws.eodhistoricaldata.com/ws/"
ENDPOINT = {"US": "us", "FOREX": "forex", "CC": "crypto"}
SUFFIX = {v: k for k, v in ENDPOINT.items()}


def ws_symbol(ticker: str) -> tuple[Optional[str], str]:
    """Terminal-Ticker -> (Endpunkt, Kürzel im Strom): AAPL.US -> (us, AAPL), BTC-USD.CC -> (crypto, BTC-USD)."""
    code, _, ex = ticker.rpartition(".")
    return ENDPOINT.get(ex), code


def _num(x: Any) -> Optional[float]:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if v == v and v not in (float("inf"), float("-inf")) else None


def parse(endpoint: str, msg: Any) -> Optional[Tick]:
    """Eine Nachricht des Stroms in einen Tick übersetzen (None bei Status- oder unbrauchbaren Nachrichten)."""
    if not isinstance(msg, dict) or not msg.get("s"):
        return None
    sym = str(msg["s"])
    ts = _num(msg.get("t"))
    ts_ms = int(ts) if ts else int(time.time() * 1000)
    if ts_ms < 10_000_000_000:  # Sekunden statt Millisekunden
        ts_ms *= 1000
    if endpoint == "forex":
        a, b = _num(msg.get("a")), _num(msg.get("b"))
        price = (a + b) / 2 if a and b else a or b
        volume = None
    elif endpoint == "crypto":
        price, volume = _num(msg.get("p")), _num(msg.get("q"))
    else:
        price, volume = _num(msg.get("p")), _num(msg.get("v"))
        if msg.get("dp") is True:  # Dark-Pool-Meldung: Umsatz ja, Kurs nicht maßgeblich
            return None
    if not price or price <= 0:
        return None
    return Tick(f"{sym}.{SUFFIX[endpoint]}", price, ts_ms, volume)


class EodhdSource:
    name = "eodhd"

    def __init__(self, api_key: str, base: str = WS_BASE):
        self.key = api_key
        self.base = base
        self.desired: dict[str, set[str]] = {}
        self.version = 0
        self._tasks: dict[str, asyncio.Task] = {}
        self._changed = asyncio.Event()

    def set_symbols(self, symbols: list[str]) -> None:
        desired: dict[str, set[str]] = {}
        for t in symbols:
            ep, code = ws_symbol(t)
            if ep:
                desired.setdefault(ep, set()).add(code)
        self.desired = desired
        self.version += 1
        self._changed.set()

    async def run(self, hub: RealtimeHub) -> None:
        try:
            while True:
                for ep in self.desired:
                    if ep not in self._tasks or self._tasks[ep].done():
                        self._tasks[ep] = asyncio.create_task(self._connection(ep, hub))
                await self._changed.wait()
                self._changed.clear()
        finally:
            for t in self._tasks.values():
                t.cancel()

    async def _connection(self, ep: str, hub: RealtimeHub) -> None:
        try:
            import websockets  # mit uvicorn[standard] installiert
        except ImportError:  # pragma: no cover
            hub.message = "Echtzeit nicht verfügbar: Python-Paket „websockets“ fehlt."
            return
        backoff = 2.0
        while True:
            if not self.desired.get(ep):
                await asyncio.sleep(5)
                continue
            subscribed: set[str] = set()
            try:
                async with websockets.connect(f"{self.base}{ep}?api_token={self.key}", open_timeout=15, ping_interval=20, ping_timeout=20) as ws:
                    version = -1
                    while True:
                        if version != self.version:
                            want = set(self.desired.get(ep, set()))
                            remove, add = subscribed - want, want - subscribed
                            if remove:
                                await ws.send(json.dumps({"action": "unsubscribe", "symbols": ",".join(sorted(remove))}))
                            if add:
                                await ws.send(json.dumps({"action": "subscribe", "symbols": ",".join(sorted(add))}))
                            subscribed = want
                            version = self.version
                        try:
                            raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
                        except asyncio.TimeoutError:
                            continue
                        try:
                            msg = json.loads(raw)
                        except (TypeError, ValueError):
                            continue
                        if isinstance(msg, dict) and "status_code" in msg:
                            code = int(_num(msg.get("status_code")) or 0)
                            if code == 200:
                                hub.connected, hub.message, backoff = True, None, 2.0
                            else:
                                text = str(msg.get("message") or "")[:200]
                                hub.message = f"EODHD-Echtzeit ({ep}): {text or code}"
                                log.warning("EODHD-WebSocket %s: %s %s", ep, code, text)
                                if code in (401, 403):
                                    hub.connected = False
                                    raise PermissionError(text)
                            continue
                        tick = parse(ep, msg)
                        if tick is not None:
                            hub.on_tick(tick)
            except asyncio.CancelledError:
                raise
            except PermissionError:
                # Schlüssel/Paket ohne WebSocket: selten neu versuchen, verzögerte Kurse laufen weiter
                hub.message = hub.message or "Echtzeit nicht freigeschaltet (Paket ohne WebSocket?)."
                await asyncio.sleep(600)
            except Exception as exc:  # noqa: BLE001 – Netz weg, Server neu gestartet …
                hub.connected = False
                log.info("EODHD-WebSocket %s getrennt (%s), neuer Versuch in %.0f s", ep, exc, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60.0)
