"""REST-Endpunkte des Bewertungstrends (BWT): KGVs von Sektoren und Ländern über die Zeit."""

from __future__ import annotations

from fastapi import APIRouter, Query, Request

from ..services.tickers import normalize
from ..valuation.models import ValBands, ValDetail, ValOverview
from ..valuation.service import ValuationService

router = APIRouter(prefix="/api/valuation")


def _vs(request: Request) -> ValuationService:
    return request.app.state.valuation


@router.get("/overview", response_model=ValOverview)
async def valuation_overview(
    request: Request,
    kind: str = Query("sector", pattern="^(sector|country)$"),
    region: str = Query("all", pattern="^(all|us|eu)$"),
):
    return _vs(request).overview(kind, region)


@router.get("/detail", response_model=ValDetail)
async def valuation_detail(
    request: Request,
    kind: str = Query("sector", pattern="^(sector|country)$"),
    key: str = Query(..., min_length=2, max_length=40),
    region: str = Query("all", pattern="^(all|us|eu)$"),
):
    return _vs(request).detail(kind, key, region)


@router.post("/refresh", response_model=ValOverview)
async def valuation_refresh(request: Request, kind: str = Query("sector", pattern="^(sector|country)$"), region: str = Query("all", pattern="^(all|us|eu)$")):
    """Neu berechnen (z. B. nach neuen Quartalszahlen)."""
    vs = _vs(request)
    if vs.state != "building":
        import asyncio

        vs._building = asyncio.create_task(vs.build())
    return vs.overview(kind, region)


@router.get("/bands/{ticker}", response_model=ValBands)
async def valuation_bands(request: Request, ticker: str):
    """KGV-Bänder einer Aktie (Kurschart): Kurs beim üblichen KGV, Fair Value, Ehrlichkeitsprüfung."""
    return await _vs(request).stock_bands(normalize(ticker))
