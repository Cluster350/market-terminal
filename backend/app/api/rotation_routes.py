"""REST-Endpunkt der relativen Rotation (RRG)."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query, Request

from ..rotation.service import RotationResult

router = APIRouter(prefix="/api")


@router.get("/rotation", response_model=RotationResult)
async def rotation(
    request: Request,
    universe: str = Query("sectors", pattern="^(sectors|sector|countries|currencies|crypto|factors)$"),
    region: str = Query("us", pattern="^(us|eu|all)$"),
    sector: Optional[str] = Query(None, max_length=40),
    ccy: str = Query("eur", pattern="^(eur|local)$"),
    bench: str = Query("basket", pattern="^(basket|eur|btc)$"),
):
    return await request.app.state.rotation.rotation(universe, region, sector, ccy, bench)
