"""REST-Endpunkte der Terminkurse (berechnet aus Kassakursen und Zinsen)."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query, Request

from ..services.forwards import Forwards, FxForwards, HedgeTable, RateForwards

router = APIRouter(prefix="/api/forwards")


def F(request: Request) -> Forwards:
    return Forwards(request.app.state.terminal)


@router.get("/fx", response_model=FxForwards)
async def fx_forwards(request: Request, pair: str = Query("EURUSD", min_length=6, max_length=12)):
    """Devisen-Terminkurse 1 Woche bis 2 Jahre per gedeckter Zinsparität."""
    return await F(request).fx(pair)


@router.get("/hedge", response_model=HedgeTable)
async def hedge(request: Request, home: str = Query("EUR", min_length=3, max_length=3), currencies: Optional[str] = Query(None, max_length=200)):
    """Ertrag bzw. Kosten pro Jahr, Fremdwährungen per Termin in die Heimatwährung abzusichern."""
    return await F(request).hedge(home, [c.strip() for c in currencies.split(",") if c.strip()] if currencies else None)


@router.get("/rates", response_model=RateForwards)
async def rate_forwards(request: Request, country: str = Query("US", min_length=2, max_length=2)):
    """Vom Markt eingepreiste künftige Zinsen (Forward-Zinsen) aus der Zinskurve."""
    return await F(request).rates(country)
