"""REST-Endpunkte der Prognose: Länderkennzahlen, Konjunkturtermine und Schwankung."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query, Request

from ..forecast import sources
from ..forecast.models import ForecastResult, ForecastStatus
from ..forecast.service import ForecastService
from ..services.terminal import Terminal
from ..services.tickers import normalize

router = APIRouter(prefix="/api/forecast")


def _fs(request: Request) -> ForecastService:
    return request.app.state.forecast


def _t(request: Request) -> Terminal:
    return request.app.state.terminal


@router.get("/status", response_model=ForecastStatus)
async def forecast_status(request: Request):
    return _fs(request).status()


@router.get("/macro", response_model=ForecastResult)
async def forecast_macro(
    request: Request,
    country: str = Query(..., pattern="^[A-Za-z]{3}$"),
    indicator: str = Query(..., max_length=60),
    h: int = Query(3, ge=1, le=5),
):
    return await sources.macro(_fs(request), _t(request), country, indicator, h)


@router.get("/event", response_model=ForecastResult)
async def forecast_event(
    request: Request,
    country: str = Query(..., pattern="^[A-Za-z]{2}$"),
    event: str = Query(..., min_length=2, max_length=120),
    h: int = Query(3, ge=1, le=6),
):
    return await sources.event(_fs(request), _t(request), country, event, h)


@router.get("/vol/{ticker}", response_model=ForecastResult)
async def forecast_vol(
    request: Request,
    ticker: str,
    h: int = Query(3, ge=1, le=6),
    iv: Optional[float] = Query(None, ge=0, le=500, description="implizite Volatilität in % zum Vergleich"),
):
    return await sources.vol(_fs(request), _t(request), normalize(ticker), h, iv)
