"""Simulierter Echtzeit-Strom für den Demo-Modus: jede Sekunde ein Kurs je abonniertem Wert."""

from __future__ import annotations

import asyncio
from typing import Any

from .hub import RealtimeHub, Tick


class DemoSource:
    name = "demo"

    def __init__(self, provider: Any, every: float = 1.0):
        self.p = provider
        self.every = every
        self.symbols: list[str] = []

    def set_symbols(self, symbols: list[str]) -> None:
        self.symbols = list(symbols)

    async def run(self, hub: RealtimeHub) -> None:
        hub.connected = True
        hub.message = None
        last: dict[str, float] = {}
        while True:
            for t in list(self.symbols):
                lp = self.p.live_price(t)
                if lp is None:
                    continue  # außerhalb der Handelszeit
                price, ts = lp
                if last.get(t) != round(price, 6):
                    last[t] = round(price, 6)
                    hub.on_tick(Tick(t, price, ts))
            await asyncio.sleep(self.every)
