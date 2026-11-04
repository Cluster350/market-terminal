"""Datenmodelle der Kursalarme und Kursmarken."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import Field, field_validator

from ..models import Model

Kind = Literal["price", "change"]  # Kursmarke bzw. Tagesveränderung in Prozent
Direction = Literal["above", "below"]


def _level(v: Optional[float]) -> Optional[float]:
    if v is not None and (v != v or v <= 0 or v > 1e9):
        raise ValueError("Wert muss größer als 0 sein")
    return v


class Alert(Model):
    id: str
    ticker: str
    kind: Kind = "price"
    level: float  # Kurs (price) oder Betrag der Tagesveränderung in Prozent (change)
    direction: Direction
    alarm: bool = True  # False: nur Kursmarke im Chart, ohne Benachrichtigung
    active: bool = True  # scharf; nach dem Auslösen False, bis erneut scharf geschaltet
    auto_dir: bool = True  # Richtung aus dem Kurs abgeleitet (Kursmarke); False: bewusst gewählt („unter 150“)
    wait_cross: bool = False  # Bedingung war beim Scharfschalten schon erfüllt: erst melden, wenn der Kurs sie neu erreicht
    note: str = ""
    created: str
    triggered_at: Optional[str] = None
    triggered_price: Optional[float] = None


class AlertIn(Model):
    ticker: str = Field(min_length=1, max_length=40)
    kind: Kind = "price"
    level: float
    direction: Optional[Direction] = None  # bei Kursmarken: automatisch aus dem aktuellen Kurs
    alarm: bool = True
    note: str = Field(default="", max_length=200)

    @field_validator("level")
    @classmethod
    def _check_level(cls, v: Optional[float]) -> Optional[float]:
        return _level(v)


class AlertPatch(Model):
    level: Optional[float] = None
    direction: Optional[Direction] = None
    alarm: Optional[bool] = None
    active: Optional[bool] = None
    note: Optional[str] = Field(default=None, max_length=200)

    @field_validator("level")
    @classmethod
    def _check_level(cls, v: Optional[float]) -> Optional[float]:
        return _level(v)


class AlertEvent(Model):
    id: str
    alert_id: str
    ticker: str
    kind: Kind
    level: float
    direction: Direction
    price: Optional[float] = None
    change_pct: Optional[float] = None
    at: str
    message: str


class AlertState(Model):
    alerts: list[Alert] = []
    events: list[AlertEvent] = []  # neueste zuerst


class AlertView(Alert):
    price: Optional[float] = None
    change_pct: Optional[float] = None
    distance_pct: Optional[float] = None  # Abstand des Kurses zur Marke in Prozent
    name: Optional[str] = None


class AlertsResponse(Model):
    alerts: list[AlertView]
    events: list[AlertEvent]
    interval: int
    checked_at: Optional[str] = None
