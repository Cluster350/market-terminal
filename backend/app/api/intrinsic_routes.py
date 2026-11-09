"""REST-Endpunkte für den inneren Wert (Funktion DCF, Methode nach Damodaran). Nur lesend: Es wird gerechnet,
nichts gespeichert oder gehandelt."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel

from ..intrinsic.models import IntrinsicResult
from ..intrinsic.service import IntrinsicService
from ..services.tickers import normalize

router = APIRouter(prefix="/api/intrinsic")


def _svc(request: Request) -> IntrinsicService:
    return request.app.state.intrinsic


class LeverRequest(BaseModel):
    levers: dict[str, float] = {}
    simulate: bool = True


@router.get("/params")
async def params_status(request: Request):
    """Woher Risikoprämie, Länder- und Branchenwerte stammen (eingebaut oder von Damodarans Seite geladen)."""
    return _svc(request).params_status()


@router.post("/params/refresh")
async def params_refresh(request: Request):
    ok, msg = await _svc(request).refresh_params()
    return {"ok": ok, "message": msg, **_svc(request).params_status()}


@router.get("/{ticker}", response_model=IntrinsicResult)
async def intrinsic(request: Request, ticker: str):
    return await _svc(request).value(normalize(ticker))


@router.post("/{ticker}", response_model=IntrinsicResult)
async def intrinsic_levers(request: Request, ticker: str, body: Optional[LeverRequest] = None):
    body = body or LeverRequest()
    return await _svc(request).value(normalize(ticker), body.levers, simulate=body.simulate)
