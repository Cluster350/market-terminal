"""EODHD-Echtzeit über WebSocket: US- und europäische Aktien (Abschlüsse), Devisen, Krypto.

Endpunkte wss://ws.eodhistoricaldata.com/ws/{us|eu|forex|crypto}?api_token=…; nach dem Verbinden
{"action": "subscribe", "symbols": "AAPL,TSLA"} bzw. für Europa "SAP.XETRA,SHEL.LSE".
Nachrichten (tolerant gelesen):
- us, eu: {"s": "AAPL" bzw. "SAP.XETRA", "p": 227.3, "v": 100, "t": 1726…(ms)}
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

from .hub import EU_SUFFIXES, RealtimeHub, Tick

log = logging.getLogger("terminal.realtime")

WS_BASE = "wss://ws.eodhistoricaldata.com/ws/"
ENDPOINT = {"US": "us", "FOREX": "forex", "CC": "crypto", **{ex: "eu" for ex in EU_SUFFIXES}}
SUFFIX = {"us": "US", "forex": "FOREX", "crypto": "CC"}


def ws_symbol(ticker: str) -> tuple[Optional[str], str]:
    """Terminal-Ticker -> (Endpunkt, Kürzel im Strom): AAPL.US -> (us, AAPL), SAP.XETRA -> (eu, SAP.XETRA),
    BTC-USD.CC -> (crypto, BTC-USD)."""
    code, _, ex = ticker.rpartition(".")
    ep = ENDPOINT.get(ex)
    return ep, (ticker if ep == "eu" else code)


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
    if endpoint == "eu" and "." not in sym:
        return None  # europäische Kürzel kommen mit Börse (SAP.XETRA)
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
    return Tick(sym if endpoint == "eu" else f"{sym}.{SUFFIX[endpoint]}", price, ts_ms, volume)


class EodhdSource:
    name = "eodhd"

    def __init__(self, api_key: str, base: str = WS_BASE):
        self.key = api_key
        self.base = base
        self.desired: dict[str, set[str]] = {}
        self.version = 0
        self.disabled: set[str] = set()  # Endpunkte, die der Schlüssel nicht freigibt (z. B. eu)
        self._tasks: dict[str, asyncio.Task] = {}
        self._changed = asyncio.Event()

    def capable(self, ticker: str) -> bool:
        ep, _ = ws_symbol(ticker)
        return ep is not None and ep not in self.disabled

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
                                # Schlüssel/Paket ohne diesen Strom (beim Europa-Strom jeder 4xx außer
                                # „nur begrenzte Symbole“): Endpunkt abschalten, Werte laufen verzögert
                                if code in (401, 402, 403) or (ep == "eu" and 400 <= code < 500 and code != 422):
                                    if ep != "eu":
                                        hub.connected = False
                                    raise PermissionError(text)
                            continue
                        tick = parse(ep, msg)
                        if tick is not None:
                            hub.on_tick(tick)
            except asyncio.CancelledError:
                raise
            except PermissionError:
                await self._disable(ep, hub)
            except Exception as exc:  # noqa: BLE001 – Netz weg, Server neu gestartet …
                # Handshake mit 4xx (Endpunkt im Paket nicht enthalten): wie fehlende Freischaltung
                status = getattr(exc, "status_code", None) or getattr(getattr(exc, "response", None), "status_code", None)
                if isinstance(status, int) and 400 <= status < 500:
                    hub.message = f"EODHD-Echtzeit ({ep}): HTTP {status}"
                    await self._disable(ep, hub)
                    continue
                if ep != "eu":
                    hub.connected = False
                log.info("EODHD-WebSocket %s getrennt (%s), neuer Versuch in %.0f s", ep, exc, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60.0)

    async def _disable(self, ep: str, hub: RealtimeHub) -> None:
        """Schlüssel/Paket ohne diesen Strom: Werte laufen über die verzögerten Kurse weiter,
        nach 10 Minuten ein neuer Versuch."""
        hub.message = hub.message or "Echtzeit nicht freigeschaltet (Paket ohne WebSocket?)."
        self.disabled.add(ep)
        hub.refresh()
        await asyncio.sleep(600)
        self.disabled.discard(ep)
        hub.refresh()
