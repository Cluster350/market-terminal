"""HTTP-Client für die EODHD-API.

Aufgaben:
- Begrenzung gleichzeitiger Anfragen (Semaphore)
- Wiederholung mit exponentiellem Backoff bei Timeouts, 429 und 5xx
- Übersetzung der HTTP-Fehler in verständliche Meldungen
- Zähler für das tägliche Call-Budget (Kosten pro Endpunkt laut EODHD-Doku,
  Werte bei Bedarf in CALL_COSTS anpassen)
"""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
from typing import Any

import httpx

from ..errors import (
    AuthError,
    BudgetExceeded,
    NotFound,
    PlanNotIncluded,
    RateLimited,
    UpstreamError,
)

log = logging.getLogger("eodhd")

# Geschätzte API-Call-Kosten pro Anfrage. Der Screener (5) ist dokumentiert,
# die übrigen Werte stammen aus der EODHD-Doku und sollten mit dem eigenen Plan
# abgeglichen werden (/api/user zeigt den echten Verbrauch).
CALL_COSTS: dict[str, int] = {
    "eod": 1,
    "real-time": 1,
    "intraday": 5,
    "fundamentals": 10,
    "screener": 5,
    "news": 5,
    "technical": 5,
    "eod-bulk-last-day": 100,
    "economic-events": 1,
    "macro-indicator": 1,
    "search": 1,
    "div": 1,
    "splits": 1,
    "calendar": 1,
    "exchange-symbol-list": 1,
    "user": 0,
}


def _endpoint_family(path: str) -> str:
    first = path.strip("/").split("/")[0]
    return first or "unknown"


class CallBudget:
    """Zählt die geschätzten Calls pro UTC-Tag und blockiert bei Überschreitung."""

    def __init__(self, daily_limit: int):
        self.daily_limit = daily_limit
        self._day = dt.datetime.now(dt.timezone.utc).date()
        self.used = 0
        self.by_endpoint: dict[str, int] = {}

    def _roll(self) -> None:
        today = dt.datetime.now(dt.timezone.utc).date()
        if today != self._day:
            self._day = today
            self.used = 0
            self.by_endpoint = {}

    def reserve(self, family: str, units: int) -> None:
        self._roll()
        if self.daily_limit > 0 and self.used + units > self.daily_limit:
            raise BudgetExceeded(
                f"Tagesbudget von {self.daily_limit:,} API-Calls erreicht. "
                "Gecachte Daten bleiben verfügbar, neue Abrufe ab 00:00 UTC.".replace(",", ".")
            )
        self.used += units
        self.by_endpoint[family] = self.by_endpoint.get(family, 0) + units

    def snapshot(self) -> dict[str, Any]:
        self._roll()
        return {
            "day": self._day.isoformat(),
            "used": self.used,
            "limit": self.daily_limit,
            "byEndpoint": dict(sorted(self.by_endpoint.items(), key=lambda kv: -kv[1])),
        }


class EODHDClient:
    def __init__(
        self,
        api_key: str,
        base_url: str = "https://eodhd.com/api",
        *,
        daily_budget: int = 100_000,
        max_concurrency: int = 8,
        timeout: float = 20.0,
        transport: httpx.AsyncBaseTransport | None = None,
        max_retries: int = 3,
        backoff_base: float = 0.8,
    ):
        if not api_key:
            raise ValueError("EODHD_API_KEY fehlt")
        self._key = api_key
        self._base = base_url.rstrip("/")
        self._sem = asyncio.Semaphore(max(1, max_concurrency))
        self._client = httpx.AsyncClient(timeout=timeout, transport=transport)
        self._retries = max_retries
        self._backoff = backoff_base
        self.budget = CallBudget(daily_budget)

    async def close(self) -> None:
        await self._client.aclose()

    async def get(self, path: str, params: dict[str, Any] | None = None, *, cost: int | None = None) -> Any:
        family = _endpoint_family(path)
        units = cost if cost is not None else CALL_COSTS.get(family, 1)
        query = {k: v for k, v in (params or {}).items() if v is not None and v != ""}
        query["api_token"] = self._key
        query.setdefault("fmt", "json")
        url = f"{self._base}/{path.lstrip('/')}"

        self.budget.reserve(family, units)
        attempt = 0
        while True:
            attempt += 1
            try:
                async with self._sem:
                    resp = await self._client.get(url, params=query)
            except httpx.RequestError as exc:  # Timeout, Netz, kaputte Kompression (DecodingError) …
                if attempt <= self._retries:
                    await asyncio.sleep(self._backoff * 2 ** (attempt - 1))
                    continue
                raise UpstreamError(
                    f"EODHD nicht erreichbar ({type(exc).__name__}). Netzwerk oder Firewall prüfen."
                ) from exc

            status = resp.status_code
            if status == 200:
                return self._parse(resp, path)
            if status in (429,) or status >= 500:
                if attempt <= self._retries:
                    retry_after = resp.headers.get("Retry-After")
                    delay = float(retry_after) if retry_after and retry_after.isdigit() else self._backoff * 2 ** (attempt - 1)
                    await asyncio.sleep(min(delay, 30.0))
                    continue
                if status == 429:
                    raise RateLimited("EODHD meldet zu viele Anfragen (429). Bitte kurz warten.")
                raise UpstreamError(f"EODHD-Serverfehler {status} bei {family}.")
            if status == 401:
                raise AuthError("EODHD lehnt den API-Key ab (401). EODHD_API_KEY prüfen.")
            if status in (402, 403):
                raise PlanNotIncluded(
                    f"Der EODHD-Plan enthält den Endpunkt „{family}“ nicht ({status})."
                )
            if status == 404:
                raise NotFound(f"EODHD kennt diese Anfrage nicht: {path}")
            raise UpstreamError(f"Unerwartete EODHD-Antwort {status} bei {family}.")

    @staticmethod
    def _parse(resp: httpx.Response, path: str) -> Any:
        text = resp.text.strip()
        if not text:
            return None
        try:
            data = resp.json()
        except ValueError as exc:
            # EODHD antwortet bei unbekannten Tickern teils mit Klartext.
            lowered = text.lower()
            if "not found" in lowered or "no data" in lowered or "ticker" in lowered:
                raise NotFound(f"Keine Daten für {path}") from exc
            raise UpstreamError(f"EODHD lieferte kein JSON für {path}.") from exc
        if isinstance(data, dict) and data.get("error") and len(data) <= 3:
            msg = str(data.get("error"))
            if "not found" in msg.lower():
                raise NotFound(msg)
            raise UpstreamError(f"EODHD-Fehler: {msg}")
        return data
