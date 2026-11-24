"""Stream Deck: Fernsteuerung des Terminals und Datenpaket für Live-Tasten (nur lesend, nur vom eigenen Rechner)."""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from ..deck import DeckData, RemoteCommand, RemoteWindow
from ..errors import TerminalError
from ..services.tickers import normalize

router = APIRouter(prefix="/api")
PARTS = {"news", "alerts", "depot", "stim_us", "stim_eu"}


@router.get("/deck", response_model=DeckData)
async def deck(request: Request, tickers: str = Query("", max_length=600), parts: str = Query("", max_length=100)):
    tks: list[str] = []
    for raw in tickers.split(","):
        if raw.strip():
            try:
                t = normalize(raw)
            except TerminalError:
                continue
            if t not in tks:
                tks.append(t)
    want = {p.strip() for p in parts.split(",") if p.strip() in PARTS}
    return await request.app.state.deck.data(tks[:20], want)


@router.post("/remote")
async def remote(request: Request, cmd: RemoteCommand):
    """Auftrag an das offene Terminal: Befehl wie in der Befehlszeile, Seite oder Maximieren."""
    return request.app.state.remote.send(cmd)


@router.post("/remote/active")
async def remote_active(request: Request, body: RemoteWindow):
    """Das Terminal meldet, welches Fenster zuletzt benutzt wurde (dorthin gehen die Aufträge)."""
    request.app.state.remote.set_active(body.window)
    return {"active": request.app.state.remote.active}


@router.get("/remote/events")
async def remote_events(request: Request):
    hub = request.app.state.remote
    q = hub.listen()

    async def gen():
        try:
            yield "event: hello\ndata: {}\n\n"
            while True:
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    if await request.is_disconnected():
                        return
                    yield ": lebt\n\n"
                    continue
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
        finally:
            hub.drop(q)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
