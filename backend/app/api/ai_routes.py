"""REST-Endpunkte des KI-Helfers (nur lesend: Einordnen, Zusammenfassen, Fragen beantworten)."""

from __future__ import annotations

from fastapi import APIRouter, Request

from ..ai.models import AiStatus, AskRequest, AskResult, Brief, BriefRequest, NewsInsightResult, NewsRequest
from ..ai.service import AIService

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
    return await AI(request).brief(body)


@router.post("/ask", response_model=AskResult)
async def ask(request: Request, body: AskRequest):
    return await AI(request).ask(body)
