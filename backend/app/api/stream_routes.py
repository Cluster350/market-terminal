"""Echtzeit-Kurse für den Browser: Server-Sent Events (ein offener Strom je Fenster)."""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from ..errors import TerminalError
from ..services.tickers import normalize

router = APIRouter(prefix="/api")


def _tickers(raw: str) -> list[str]:
    out: list[str] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            t = normalize(part)
        except TerminalError:
            continue
        if t not in out:
            out.append(t)
    return out[:60]


@router.get("/realtime/status")
async def realtime_status(request: Request, tickers: str = Query("", max_length=2000)):
    return request.app.state.realtime.status(_tickers(tickers))


@router.get("/stream")
async def stream(request: Request, tickers: str = Query("", max_length=2000), once: bool = False):
    """Ticks der gewünschten Werte, höchstens viermal pro Sekunde gebündelt; dazu alle 15 s ein
    Lebenszeichen und bei Änderungen der Status (welche Werte live, welche verzögert sind)."""
    hub = request.app.state.realtime
    tks = _tickers(tickers)
    lst = hub.listen(tks)

    async def gen():
        try:
            status = hub.status(tks)
            yield f"event: status\ndata: {json.dumps(status)}\n\n"
            if once:
                ticks = lst.take()
                if ticks:
                    yield f"data: {json.dumps([t.as_dict() for t in ticks])}\n\n"
                return
            while True:
                try:
                    await asyncio.wait_for(lst.event.wait(), timeout=15)
                except asyncio.TimeoutError:
                    now = hub.status(tks)
                    if now != status:
                        status = now
                        yield f"event: status\ndata: {json.dumps(status)}\n\n"
                    yield ": ping\n\n"
                    continue
                ticks = lst.take()
                if ticks:
                    yield f"data: {json.dumps([t.as_dict() for t in ticks])}\n\n"
                await asyncio.sleep(0.25)
        finally:
            hub.unlisten(lst)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
