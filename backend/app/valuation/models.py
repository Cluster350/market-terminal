"""Antwortformate des Bewertungstrends (camelCase wie alle Modelle)."""

from __future__ import annotations

from typing import Optional

from ..models import Model


class ValRow(Model):
    key: str  # Sektor (englischer EODHD-Name) bzw. Börse
    label: str
    kind: str  # sector | country
    region: str  # all | us | eu (Sektoren) bzw. Region des Landes
    n: int  # Zahl der Firmen
    pe_years: dict[str, Optional[float]]  # "2021" … "2027"
    coverage: dict[str, int] = {}  # Jahr -> Zahl der Firmen mit Gewinn und Kurs (IPOs fehlen in frühen Jahren)
    negative_years: list[int] = []
    pe_ttm: Optional[float] = None  # KGV heute (Gewinn der letzten zwölf Monate)
    avg: Optional[float] = None  # Durchschnitt 10 Jahre (Monatswerte)
    low: Optional[float] = None
    high: Optional[float] = None
    position: Optional[float] = None  # Lage in der 10-Jahres-Spanne (0–1)
    chg12m: Optional[float] = None  # Veränderung des KGV in zwölf Monaten (Punkte)
    growth_next: Optional[float] = None  # erwartetes Gewinnwachstum nächstes Jahr (Anteil)
    rev30: Optional[float] = None  # Veränderung des Konsenses fürs nächste Jahr in 30 Tagen (Anteil)
    rev90: Optional[float] = None
    up30: int = 0
    down30: int = 0
    dist52: Optional[float] = None  # Abstand zum 52-Wochen-Hoch (Anteil)
    median: Optional[float] = None  # übliches KGV (Median der Monatswerte, zehn Jahre)
    fair_gap: Optional[float] = None  # Kurs beim üblichen KGV auf den Gewinn nächstes Jahr ÷ heute − 1
    state: str = "nahe"  # baer (< −20 %) | korrektur (−10 … −20 %) | nahe


class ValMember(Model):
    ticker: str
    name: str
    mcap: float  # USD
    pe_years: dict[str, Optional[float]]
    pe_ttm: Optional[float] = None
    rev90: Optional[float] = None
    dist52: Optional[float] = None
    median: Optional[float] = None
    fair_gap: Optional[float] = None
    notes: list[str] = []


class ValSeries(Model):
    t: list[str]
    v: list[Optional[float]]


class ValBands(Model):
    """KGV-Bänder: Kurslinien beim KGV der Bänder, Fortsetzung mit Analystenschätzungen, Prüfung."""

    ticker: Optional[str] = None
    name: Optional[str] = None
    t: list[str]
    pe: list[Optional[float]]
    level: list[Optional[float]]
    lines: dict[str, list[Optional[float]]]
    future_t: list[str]
    future: dict[str, list[Optional[float]]]
    pct: dict[str, float]
    pe_now: Optional[float] = None
    position: Optional[float] = None
    fair_now: Optional[float] = None
    fair_next: Optional[float] = None
    fair_year: Optional[int] = None
    fair_gap: Optional[float] = None
    test: dict[str, dict[str, Optional[float]]] = {}
    loss: bool = False  # Gewinn der letzten zwölf Monate ≤ 0: kein aktuelles KGV
    note: str = ""
    sector: Optional["ValSectorRel"] = None  # Bewertung relativ zum Sektor (nur Einzelaktien)


class ValSectorRel(Model):
    """Sektor-KGV als Maßstab: Fair Value beim heutigen Sektor-KGV und bei der üblichen Prämie zum Sektor."""

    key: str  # Sektor (EODHD-Name)
    label: str
    region: str  # us | eu | all
    n: int  # Firmen im Sektor (ohne die Aktie)
    pe_now: Optional[float] = None
    pe_next: Optional[float] = None
    rel_now: Optional[float] = None  # KGV Aktie ÷ KGV Sektor heute
    rel_median: Optional[float] = None  # übliches Verhältnis (Median zehn Jahre)
    fair_sector: Optional[float] = None
    fair_sector_gap: Optional[float] = None
    fair_relative: Optional[float] = None  # übliches Verhältnis × Sektor-KGV × Gewinnschätzung
    fair_relative_gap: Optional[float] = None
    bands: Optional[ValBands] = None  # Kurslinien beim üblichen Verhältnis zum Sektor


class ValDetail(Model):
    row: ValRow
    years: list[int]
    est_years: list[int]
    monthly: ValSeries  # KGV der letzten zwölf Monate, Monatsende, zehn Jahre
    forward_path: ValSeries  # KGV aufs nächste Jahr vor 90/60/30/7/0 Tagen
    recorded: ValSeries  # eigene tägliche Aufzeichnung (KGV aufs nächste Jahr)
    decomposition: dict[str, dict[str, Optional[float]]]
    coverage: dict[str, int]
    members: list[ValMember]
    bands: Optional[ValBands] = None


class ValOverview(Model):
    kind: str
    region: str
    years: list[int]
    est_years: list[int]
    rows: list[ValRow]
    state: str  # building | ready | error
    done: int = 0
    total: int = 0
    built_at: Optional[str] = None
    message: Optional[str] = None
    note: str = ""


ValBands.model_rebuild()
