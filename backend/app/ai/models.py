"""Datenmodelle des KI-Helfers (API und interne Übergabe)."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import Field

from ..models import Model

# Ereignisarten der News-Einordnung (Schlüssel; Beschriftung im Frontend)
EVENTS = (
    "quartalszahlen", "prognose", "uebernahme", "analyst", "management", "produkt", "auftrag",
    "kapitalmassnahme", "rechtliches", "restrukturierung", "makro", "markt", "sonstiges",
)

Engine = Literal["lmstudio", "demo"]


class NewsInput(Model):
    """Eine Meldung, wie das Frontend sie anzeigt (Text wird als Daten behandelt)."""

    id: str = Field(min_length=1, max_length=80)
    title: str = Field(max_length=500)
    content: str = ""
    date: str = ""
    source: Optional[str] = None
    symbols: list[str] = []
    topic: Optional[str] = None
    polarity: Optional[float] = None  # Stimmung der Datenquelle, falls vorhanden
    urgent: bool = False


class NewsInsight(Model):
    id: str
    summary: str
    sentiment: float  # −1 … +1
    reason: str
    tickers: list[str] = []
    sectors: list[str] = []
    event: str = "sonstiges"
    relevance: int = 0  # 0 unwichtig … 3 stark kursbewegend
    horizon: Literal["kurzfristig", "strukturell"] = "kurzfristig"
    engine: Engine
    model: str
    created: str


class NewsRequest(Model):
    items: list[NewsInput] = Field(default_factory=list, max_length=40)
    priority: Literal["high", "normal"] = "normal"


class NewsInsightResult(Model):
    engine: Optional[Engine] = None
    insights: dict[str, NewsInsight] = {}
    pending: list[str] = []
    failed: dict[str, str] = {}


class BriefPoint(Model):
    text: str
    sources: list[str] = []  # Meldungs-IDs oder Funktionskürzel (WEI, ECO, EVTS …)


class BriefSection(Model):
    title: str
    points: list[BriefPoint]


class Brief(Model):
    headline: str
    sections: list[BriefSection]
    news: dict[str, str] = {}  # Meldungs-ID -> Titel (für die Quellenverweise)
    engine: Engine
    model: str
    created: str


class BriefRequest(Model):
    tickers: list[str] = Field(default_factory=list, max_length=60)
    refresh: bool = False


class ChatTurn(Model):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=6000)


class AskRequest(Model):
    question: str = Field(min_length=1, max_length=2000)
    ticker: Optional[str] = None  # aktives Wertpapier im Terminal
    watchlist: list[str] = Field(default_factory=list, max_length=60)
    history: list[ChatTurn] = Field(default_factory=list, max_length=12)


class ToolTrace(Model):
    tool: str
    args: dict = {}
    summary: str = ""
    ok: bool = True


class Suggestion(Model):
    """Vorschlag, den erst ein Klick im Terminal ausführt (die KI selbst ändert nichts)."""

    label: str
    fn: Optional[str] = None
    ticker: Optional[str] = None


class AskResult(Model):
    answer: str
    trace: list[ToolTrace] = []
    unverified: list[str] = []  # Zahlen ohne Beleg in den abgefragten Daten
    suggestions: list[Suggestion] = []
    engine: Engine
    model: str
    steps: int = 0
    seconds: float = 0.0


class AiStatus(Model):
    mode: Literal["lmstudio", "demo", "off", "offline"]
    configured: str  # LLM_MODE
    base_url: str
    model: Optional[str] = None
    models: list[str] = []
    queue: int = 0
    message: str
