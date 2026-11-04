"""Depot als JSON-Datei: eine Datei je Datenquelle, atomar geschrieben, mit Versionsprüfung.

Die Versionsnummer verhindert, dass zwei Terminal-Fenster sich gegenseitig Änderungen
überschreiben: Wer mit einem veralteten Stand speichert, bekommt einen Konflikt (409).
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

from ..errors import BadRequest, TerminalError
from ..services.tickers import display, normalize
from .models import Portfolio, Position

log = logging.getLogger("terminal.portfolio")

NOT_HOLDABLE = {
    "INDX": "Indizes lassen sich nicht direkt halten – bitte einen ETF auf den Index wählen (mit EODHD z. B. EXS1 GR für den DAX; die Demo-Daten enthalten keine ETFs).",
    "GBOND": "Anleihe-Renditen lassen sich nicht als Position führen.",
    "FOREX": "Devisenpaare lassen sich nicht als Position führen; Kasse bitte im Feld „Kasse“ eintragen.",
}


class Conflict(TerminalError):
    status = 409
    code = "conflict"


def clean_positions(positions: list[Position]) -> list[Position]:
    """Ticker vereinheitlichen, Doppelte und nicht haltbare Instrumente ablehnen, IDs vergeben."""
    out: list[Position] = []
    seen: set[str] = set()
    for p in positions:
        ticker = normalize(p.ticker)
        exch = ticker.rpartition(".")[2]
        if exch in NOT_HOLDABLE:
            raise BadRequest(f"{display(ticker)}: {NOT_HOLDABLE[exch]}")
        if ticker in seen:
            raise BadRequest(f"{display(ticker)} steht doppelt im Depot. Bitte zu einer Position zusammenfassen (Durchschnittskurs).")
        seen.add(ticker)
        out.append(p.model_copy(update={"ticker": ticker, "id": p.id or secrets.token_hex(6), "note": " ".join(p.note.split())}))
    return out


class PortfolioStore:
    def __init__(self, directory: str | Path, mode: str):
        self.dir = Path(directory)
        self.path = self.dir / f"depot-{mode}.json"
        self._lock = asyncio.Lock()

    def load(self) -> Optional[Portfolio]:
        try:
            raw = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return None
        except OSError as exc:
            raise TerminalError(f"Depotdatei nicht lesbar ({self.path}): {exc}") from exc
        try:
            return Portfolio.model_validate(json.loads(raw))
        except (ValueError, ValidationError) as exc:
            # Kaputte Datei nicht überschreiben, sondern beiseitelegen
            backup = self.path.with_suffix(f".defekt-{dt.datetime.now():%Y%m%d-%H%M%S}.json")
            try:
                self.path.replace(backup)
            except OSError:
                pass
            log.error("Depotdatei %s unlesbar (%s), gesichert als %s", self.path, exc, backup.name)
            return None

    async def save(self, p: Portfolio, expected_version: Optional[int]) -> Portfolio:
        async with self._lock:
            current = self.load()
            current_version = current.version if current else 0
            if expected_version is not None and expected_version != current_version:
                raise Conflict("Das Depot wurde inzwischen in einem anderen Fenster geändert. Die Ansicht wurde neu geladen; bitte die Änderung wiederholen.")
            saved = p.model_copy(
                update={
                    "version": current_version + 1,
                    "positions": clean_positions(p.positions),
                    "updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
                    "sample": False,
                }
            )
            try:
                self.dir.mkdir(parents=True, exist_ok=True)
                tmp = self.path.with_suffix(".tmp")
                tmp.write_text(json.dumps(saved.model_dump(by_alias=True), ensure_ascii=False, indent=1), encoding="utf-8")
                os.replace(tmp, self.path)
            except OSError as exc:
                raise TerminalError(f"Depot konnte nicht gespeichert werden ({self.path}): {exc}") from exc
            return saved
