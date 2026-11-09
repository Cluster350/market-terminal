"""REST-Endpunkte des KI-Helfers (nur lesend: Einordnen, Zusammenfassen, Fragen beantworten)."""

from __future__ import annotations

from fastapi import APIRouter, Request

from ..ai.models import AiStatus, AskRequest, AskResult, Brief, BriefRequest, NewsInsightResult, NewsRequest
from ..ai.service import AIService
from ..ai.valuation_coach import CoachRequest, CoachResult
from ..services.tickers import normalize
from .portfolio_routes import current_portfolio

router = APIRouter(prefix="/api/ai")


def AI(request: Request) -> AIService:
    return request.app.state.ai


@router.get("/status", response_model=AiStatus)
async def status(request: Request):
    return await AI(request).status()


@router.post("/news", response_model=NewsInsightResult)
async def news(request: Request, body: NewsRequest):
    return await AI(request).news(body)


@router.post("/brief", response_model=Brief)
async def brief(request: Request, body: BriefRequest):
    # Depotwerte gehören zu „Ihre Werte“ (früher nur die Watchlist)
    try:
        depot = [p.ticker for p in (await current_portfolio(request.app)).positions]
    except Exception:  # noqa: BLE001 – ohne Depot bleibt das Briefing bei der Watchlist
        depot = []
    return await AI(request).brief(body, depot)


@router.post("/ask", response_model=AskResult)
async def ask(request: Request, body: AskRequest):
    return await AI(request).ask(body)


@router.post("/valuation/{ticker}", response_model=CoachResult)
async def valuation_coach(request: Request, ticker: str, body: CoachRequest):
    """„Damodaran (KI-Persona)“ zur Bewertung in DCF – nur lesend, Hebel werden nur vorgeschlagen."""
    return await AI(request).valuation(request.app.state.intrinsic, normalize(ticker), body)
