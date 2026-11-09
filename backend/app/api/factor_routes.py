"""REST-Endpunkte der Faktoren: Übersicht (FCTR) und Faktorlast des Depots (RISK)."""

from __future__ import annotations

from fastapi import APIRouter, Query, Request

from ..factors.service import FactorExposure, FactorOverview
from .portfolio_routes import current_portfolio

router = APIRouter(prefix="/api")


@router.get("/factors", response_model=FactorOverview)
async def factors(request: Request, region: str = Query("us", pattern="^(us|eu)$")):
    return await request.app.state.factors.overview(region)


@router.get("/portfolio/factors", response_model=FactorExposure)
async def portfolio_factors(request: Request, region: str = Query("auto", pattern="^(auto|us|eu)$")):
    return await request.app.state.factors.exposure(await current_portfolio(request.app), region)
