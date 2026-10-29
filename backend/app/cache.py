"""TTL-Cache mit Single-Flight und Stale-Fallback.

- Single-Flight: Mehrere gleichzeitige Anfragen auf denselben Schlüssel lösen nur
  einen Abruf bei der Datenquelle aus.
- Stale-Fallback: Schlägt eine Aktualisierung fehl, wird der letzte bekannte Wert
  ausgeliefert (markiert als veraltet), statt das Panel leer zu lassen.
"""

from __future__ import annotations

import asyncio
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Awaitable, Callable


@dataclass
class _Entry:
    value: Any
    stored_at: float
    ttl: float
    weight: int = 1

    def fresh(self, now: float) -> bool:
        return now - self.stored_at < self.ttl


def _weight(value: Any) -> int:
    """Grobes Gewicht eines Eintrags in Datenzeilen (eine 10-Jahres-Historie ≈ 2.600)."""
    series = getattr(value, "t", None)
    if isinstance(series, list):
        return len(series) + 1
    if isinstance(value, tuple):
        return sum(_weight(v) for v in value)
    if isinstance(value, list):
        return len(value) + 1
    return 1


class TTLCache:
    def __init__(
        self,
        max_entries: int = 5000,
        stale_max_age: float = 7 * 24 * 3600,
        max_weight: int = 1_500_000,  # ≈ 250 MB an Kurshistorien
    ):
        self._data: OrderedDict[str, _Entry] = OrderedDict()
        self._locks: dict[str, asyncio.Lock] = {}
        self._max = max_entries
        self._max_weight = max_weight
        self._weight = 0
        self._stale_max_age = stale_max_age
        self.hits = 0
        self.misses = 0
        self.stale_served = 0

    def _lock(self, key: str) -> asyncio.Lock:
        lock = self._locks.get(key)
        if lock is None:
            if len(self._locks) > 2 * self._max:
                # Sperren von Schlüsseln ohne Eintrag (z. B. dauerhaft fehlschlagende Ticker)
                # aufräumen, sonst wächst das Dict mit jeder ungültigen Anfrage
                for k in [k for k, lk in self._locks.items() if k not in self._data and not lk.locked()]:
                    del self._locks[k]
            lock = self._locks[key] = asyncio.Lock()
        return lock

    def _store(self, key: str, value: Any, ttl: float) -> None:
        old = self._data.pop(key, None)
        if old is not None:
            self._weight -= old.weight
        entry = _Entry(value, time.monotonic(), ttl, _weight(value))
        self._data[key] = entry
        self._weight += entry.weight
        # Älteste Einträge verdrängen – nach Anzahl und nach Datenmenge
        while len(self._data) > 1 and (len(self._data) > self._max or self._weight > self._max_weight):
            old_key, old_entry = self._data.popitem(last=False)
            self._weight -= old_entry.weight
            self._locks.pop(old_key, None)

    async def get_or_load(
        self, key: str, ttl: float, loader: Callable[[], Awaitable[Any]]
    ) -> tuple[Any, bool]:
        """Gibt (wert, stale) zurück. stale=True heißt: Aktualisierung fehlgeschlagen."""
        now = time.monotonic()
        entry = self._data.get(key)
        if entry and entry.fresh(now):
            self.hits += 1
            self._data.move_to_end(key)
            return entry.value, False

        async with self._lock(key):
            # Ein anderer Aufrufer hat evtl. gerade geladen.
            entry = self._data.get(key)
            now = time.monotonic()
            if entry and entry.fresh(now):
                self.hits += 1
                return entry.value, False
            self.misses += 1
            try:
                value = await loader()
            except Exception:
                if entry and now - entry.stored_at < self._stale_max_age:
                    self.stale_served += 1
                    return entry.value, True
                raise
            self._store(key, value, ttl)
            return value, False

    def clear(self) -> None:
        self._data.clear()
        self._locks.clear()
        self._weight = 0

    def stats(self) -> dict[str, int]:
        return {
            "entries": len(self._data),
            "hits": self.hits,
            "misses": self.misses,
            "staleServed": self.stale_served,
        }
