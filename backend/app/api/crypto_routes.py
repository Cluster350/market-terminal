"""REST-Endpunkt der Kryptoübersicht (CRYP)."""

from __future__ import annotations

from fastapi import APIRouter, Query, Request

from ..crypto.service import CryptoOverview

router = APIRouter(prefix="/api")


@router.get("/crypto", response_model=CryptoOverview)
async def crypto(request: Request, ccy: str = Query("usd", pattern="^(usd|eur)$")):
    return await request.app.state.crypto.overview(ccy)
