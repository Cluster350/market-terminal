"""REST-Endpunkte der Kursalarme und Kursmarken."""

from __future__ import annotations

from fastapi import APIRouter, Request

from ..alerts.models import Alert, AlertEvent, AlertIn, AlertPatch, AlertsResponse
from ..alerts.service import AlertService

router = APIRouter(prefix="/api/alerts")


def S(request: Request) -> AlertService:
    return request.app.state.alerts


@router.get("", response_model=AlertsResponse)
async def list_alerts(request: Request):
    return await S(request).view()


@router.post("", response_model=Alert)
async def create_alert(request: Request, body: AlertIn):
    return await S(request).create(body)


@router.patch("/{alert_id}", response_model=Alert)
async def update_alert(request: Request, alert_id: str, body: AlertPatch):
    return await S(request).update(alert_id, body)


@router.delete("/events")
async def clear_events(request: Request) -> dict:
    await S(request).clear_events()
    return {"ok": True}


@router.delete("/{alert_id}")
async def delete_alert(request: Request, alert_id: str) -> dict:
    await S(request).delete(alert_id)
    return {"ok": True}


@router.post("/check", response_model=list[AlertEvent])
async def check_now(request: Request):
    """Sofort prüfen (Knopf „Jetzt prüfen“); sonst prüft der Server im eingestellten Abstand."""
    return await S(request).check()
