"""Antwortformate der Prognose (camelCase für das Frontend wie alle übrigen Modelle)."""

from __future__ import annotations

from typing import Optional

from ..models import Model


class FcSeries(Model):
    t: list[str]
    v: list[Optional[float]]


class FcBand(Model):
    """Prognose je Schritt: Median, 50-%-Band (25–75 %) und 80-%-Band (10–90 %)."""

    t: list[str]
    median: list[float]
    lo50: list[float]
    hi50: list[float]
    lo80: list[float]
    hi80: list[float]


class FcEngineScore(Model):
    engine: str
    label: str
    mae: Optional[float] = None
    skill: Optional[float] = None


class FcQuality(Model):
    """Ergebnis des Rückblick-Tests der gewählten Methode."""

    origins: int = 0  # Zahl der Startpunkte in der Vergangenheit
    pairs: int = 0  # verglichene Werte (Startpunkt × Schritt)
    mae: Optional[float] = None  # mittlerer Fehler des Medians
    mae_naive: Optional[float] = None  # mittlerer Fehler von „bleibt wie zuletzt“
    skill: Optional[float] = None  # 1 − mae / mae_naive (> 0: besser als die einfache Regel)
    cover50: Optional[float] = None  # Anteil der Werte im 50-%-Band
    cover80: Optional[float] = None  # Anteil der Werte im 80-%-Band
    raw_cover80: Optional[float] = None  # vor der Kalibrierung der Bänder
    band_scale: float = 1.0  # Faktor, um den das 80-%-Band nach dem Rückblick-Test verbreitert wurde
    compared: list[FcEngineScore] = []
    # Konjunkturtermine: Fehler bei der jeweils nächsten Veröffentlichung, Modell gegen Konsens
    model_mae1: Optional[float] = None
    consensus_mae: Optional[float] = None
    consensus_n: int = 0


class FcFeature(Model):
    """Eine Einflussgröße und ihr Nutzen im Rückblick-Test, wenn sie allein dazukommt."""

    key: str
    label: str
    mae: Optional[float] = None  # Fehler der Prognose nur mit dieser Einflussgröße
    gain: Optional[float] = None  # 1 − mae / Fehler ohne Einflussgrößen (> 0: hilft)


class FcFeatureEffect(Model):
    """Vergleich der Prognose mit und ohne die gewählten Einflussgrößen (gleicher Zeitraum, gleicher Test)."""

    features: list[FcFeature] = []
    mae_base: Optional[float] = None  # Rückblick-Fehler ohne Einflussgrößen
    mae_with: Optional[float] = None  # … mit allen gewählten
    gain: Optional[float] = None  # 1 − mae_with / mae_base
    helps: Optional[bool] = None
    text: str = ""
    baseline: Optional[FcBand] = None  # Prognose ohne Einflussgrößen zum Vergleich
    base_engine_label: Optional[str] = None
    points: int = 0  # gemeinsame Zeitpunkte von Zielreihe und Einflussgrößen
    notes: list[str] = []  # nicht nutzbare Einflussgrößen


class FcFeatureOption(Model):
    key: str
    label: str
    group: str


class ForecastResult(Model):
    kind: str  # macro | event | vol
    key: str
    label: str
    unit: Optional[str] = None
    freq: str  # year | release | month
    history: FcSeries
    consensus: Optional[FcSeries] = None  # frühere Konsensschätzungen (gleiche Zeitpunkte wie history)
    next_consensus: Optional[float] = None  # Konsens für die nächste Veröffentlichung
    forecast: FcBand
    engine: str
    engine_label: str
    quality: FcQuality
    verdict: str  # gut | knapp | schwach | wenig
    verdict_text: str
    note: Optional[str] = None
    extra: dict[str, Optional[float]] = {}  # z. B. implizite Volatilität zum Vergleich
    features: Optional[FcFeatureEffect] = None  # nur wenn Einflussgrößen gewählt wurden


class FcEngineStatus(Model):
    name: str
    label: str
    ready: bool
    loading: bool = False
    error: Optional[str] = None


class ForecastStatus(Model):
    mode: str  # auto | chronos | simple | off
    active: Optional[str] = None  # bevorzugter Motor, der gerade bereit ist
    engines: list[FcEngineStatus] = []
    model: Optional[str] = None
    device: Optional[str] = None
    installed: bool = False  # Zusatzpaket für Chronos-2 vorhanden
    message: Optional[str] = None
