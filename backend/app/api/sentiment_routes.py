"""REST-Endpunkt des Stimmungsterminals (STIM)."""

from __future__ import annotations

from fastapi import APIRouter, Query, Request

from ..sentiment.service import SentimentResult

router = APIRouter(prefix="/api")


@router.get("/sentiment", response_model=SentimentResult)
async def sentiment(request: Request, region: str = Query("us", pattern="^(us|eu)$")):
    return await request.app.state.sentiment.stimmung(region)
