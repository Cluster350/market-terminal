"""REST-Endpunkt der Saisonalität (Funktion SAIS). Nur lesend."""

from __future__ import annotations

from fastapi import APIRouter, Query, Request

from ..seasonality.service import SeasonalityResult
from ..services.tickers import normalize

router = APIRouter(prefix="/api")


@router.get("/seasonality/{ticker}", response_model=SeasonalityResult)
async def seasonality(request: Request, ticker: str, years: int = Query(10, ge=1, le=30)):
    return await request.app.state.seasonality.seasonality(normalize(ticker), years)
