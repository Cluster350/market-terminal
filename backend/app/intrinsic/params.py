"""Marktparameter für die Bewertung nach Aswath Damodarans veröffentlichter Methode.

- Aktien-Risikoprämie (implizite ERP des S&P 500), Länderrisikoprämien, Grenzsteuersätze
- Rating-Tabelle: Zinsdeckung → synthetisches Rating → Kreditaufschlag (große Firmen außerhalb der Finanzbranche)
- Branchenwerte: Beta ohne Verschuldung, operative Marge vor Steuern, Umsatz je eingesetztem Kapital und die
  Abschreibungsdauer für Forschung & Entwicklung

Die eingebauten Werte sind GERUNDETE RICHTWERTE, angelehnt an Damodarans frei veröffentlichte Daten (Stand Januar
2025). Sie werden durch die Aktualisierung (damodaran_data.py → PORTFOLIO_DIR/damodaran.json) überschrieben, wenn
seine Seite erreichbar ist. Jeder Wert trägt seine Quelle, damit sichtbar bleibt, was eingebaut und was geladen ist.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Optional

log = logging.getLogger("terminal.intrinsic")

BUILTIN_SOURCE = "Richtwert (gerundet, angelehnt an Damodarans Daten, Jan. 2025)"

# Implizite Aktien-Risikoprämie des S&P 500 (Damodaran, 1. Januar 2025)
ERP = 0.0433


@dataclass(frozen=True)
class Country:
    code: str
    name: str
    crp: float  # Länderrisikoprämie (zusätzlich zur ERP reifer Märkte)
    tax: float  # Grenzsteuersatz Unternehmen


COUNTRIES: dict[str, Country] = {
    c.code: c
    for c in [
        Country("US", "USA", 0.0, 0.25),
        Country("DE", "Deutschland", 0.0, 0.30),
        Country("NL", "Niederlande", 0.0, 0.258),
        Country("CH", "Schweiz", 0.0, 0.196),
        Country("FR", "Frankreich", 0.0063, 0.25),
        Country("UK", "Großbritannien", 0.0076, 0.25),
        Country("JP", "Japan", 0.0091, 0.306),
        Country("CN", "China", 0.0091, 0.25),
        Country("ES", "Spanien", 0.0195, 0.25),
        Country("IT", "Italien", 0.0286, 0.279),
        Country("CA", "Kanada", 0.0, 0.265),
        Country("AU", "Australien", 0.0, 0.30),
        Country("SE", "Schweden", 0.0, 0.206),
        Country("DK", "Dänemark", 0.0, 0.22),
        Country("NO", "Norwegen", 0.0, 0.22),
        Country("AT", "Österreich", 0.0050, 0.23),
        Country("BE", "Belgien", 0.0076, 0.25),
        Country("IE", "Irland", 0.0063, 0.125),
    ]
}
DEFAULT_TAX = 0.24  # weltweiter Durchschnitt, falls das Land fehlt

# Ländername der Datenquelle (englisch) → Kürzel
COUNTRY_BY_NAME = {
    "usa": "US", "united states": "US", "germany": "DE", "deutschland": "DE", "netherlands": "NL", "switzerland": "CH",
    "france": "FR", "united kingdom": "UK", "uk": "UK", "great britain": "UK", "japan": "JP", "china": "CN",
    "spain": "ES", "italy": "IT", "canada": "CA", "australia": "AU", "sweden": "SE", "denmark": "DK",
    "norway": "NO", "austria": "AT", "belgium": "BE", "ireland": "IE",
}
# Börsenkürzel → Land (falls die Firma kein Land angibt)
COUNTRY_BY_EXCHANGE = {
    "US": "US", "XETRA": "DE", "F": "DE", "PA": "FR", "AS": "NL", "SW": "CH", "LSE": "UK", "MI": "IT", "MC": "ES",
    "TO": "CA", "AU": "AU", "ST": "SE", "CO": "DK", "OL": "NO", "VI": "AT", "BR": "BE", "IR": "IE", "TSE": "JP",
}
# Währung → Land der Zinskurve für den risikolosen Zins (Euro: Bundesanleihe)
CURVE_BY_CURRENCY = {"USD": "US", "EUR": "DE", "GBP": "UK", "JPY": "JP"}
# Währungen ohne Zinskurve im Terminal: gerundete zehnjährige Staatsanleihe-Rendite als Richtwert
FALLBACK_RF = {
    "CHF": 0.0045, "SEK": 0.024, "DKK": 0.023, "NOK": 0.039, "CAD": 0.032, "AUD": 0.043, "CNY": 0.018, "HKD": 0.038,
}


@dataclass(frozen=True)
class RatingStep:
    min_coverage: float  # Zinsdeckung (EBIT / Zinsaufwand) ab
    rating: str
    spread: float  # Kreditaufschlag über dem risikolosen Zins


# Große Firmen außerhalb der Finanzbranche (Damodaran, Januar 2025, gerundet)
RATINGS: list[RatingStep] = [
    RatingStep(8.5, "AAA", 0.0059),
    RatingStep(6.5, "AA", 0.0070),
    RatingStep(5.5, "A+", 0.0092),
    RatingStep(4.25, "A", 0.0107),
    RatingStep(3.0, "A−", 0.0121),
    RatingStep(2.5, "BBB", 0.0147),
    RatingStep(2.25, "BB+", 0.0174),
    RatingStep(2.0, "BB", 0.0221),
    RatingStep(1.75, "B+", 0.0275),
    RatingStep(1.5, "B", 0.0321),
    RatingStep(1.25, "B−", 0.0423),
    RatingStep(0.8, "CCC", 0.0585),
    RatingStep(0.65, "CC", 0.0820),
    RatingStep(0.2, "C", 0.1200),
    RatingStep(float("-inf"), "D", 0.1700),
]


@dataclass(frozen=True)
class Industry:
    key: str  # Name bei Damodaran (englisch, für die Aktualisierung)
    name: str  # deutsch
    beta_u: float  # Beta ohne Verschuldung (um Barmittel bereinigt)
    margin: float  # operative Marge vor Steuern
    sales_to_capital: float  # Umsatz je eingesetztem Kapital
    rd_life: int  # Abschreibungsdauer F&E in Jahren
    source: str = BUILTIN_SOURCE


# (Schlüsselwörter in der Branche der Datenquelle, Branche). Reihenfolge zählt: spezieller zuerst.
_INDUSTRIES: list[tuple[tuple[str, ...], Industry]] = [
    (("semiconductor equipment",), Industry("Semiconductor Equip", "Halbleiterausrüstung", 1.30, 0.28, 1.0, 5)),
    (("semiconductor",), Industry("Semiconductor", "Halbleiter", 1.35, 0.30, 0.9, 5)),
    (("software",), Industry("Software (System & Application)", "Software", 1.20, 0.30, 1.4, 3)),
    (("internet", "information technology services"), Industry("Software (Internet)", "Internet & IT-Dienste", 1.15, 0.18, 1.6, 3)),
    (("biotech",), Industry("Drugs (Biotechnology)", "Biotechnologie", 1.15, 0.15, 0.8, 10)),
    (("drug", "pharma"), Industry("Drugs (Pharmaceutical)", "Pharma", 0.95, 0.28, 0.9, 10)),
    (("medical", "health"), Industry("Healthcare Products", "Medizintechnik & Gesundheit", 0.95, 0.20, 1.0, 5)),
    (("scientific", "instrument", "electronic component", "computer hardware", "electronics"),
     Industry("Electronics (General)", "Elektronik & Instrumente", 1.05, 0.15, 1.3, 5)),
    (("auto",), Industry("Auto & Truck", "Fahrzeugbau", 1.15, 0.07, 1.4, 5)),
    (("luxury", "apparel", "footwear"), Industry("Apparel", "Bekleidung & Luxus", 1.00, 0.22, 1.2, 3)),
    (("grocery", "food distribution"), Industry("Retail (Grocery and Food)", "Lebensmittelhandel", 0.60, 0.04, 3.5, 3)),
    (("retail",), Industry("Retail (General)", "Einzelhandel", 0.95, 0.07, 2.5, 3)),
    (("beverage",), Industry("Beverage (Soft)", "Getränke", 0.60, 0.20, 1.2, 3)),
    (("food", "farm", "confection"), Industry("Food Processing", "Nahrungsmittel", 0.55, 0.12, 1.6, 3)),
    (("household", "personal product"), Industry("Household Products", "Haushalt & Körperpflege", 0.65, 0.18, 1.6, 3)),
    (("oil", "gas"), Industry("Oil/Gas (Integrated)", "Öl & Gas", 0.80, 0.13, 1.0, 3)),
    (("utilit",), Industry("Utility (General)", "Versorger", 0.40, 0.20, 0.4, 3)),
    (("aerospace", "defense"), Industry("Aerospace/Defense", "Luft-/Raumfahrt & Verteidigung", 0.95, 0.12, 1.3, 5)),
    (("freight", "logistic", "trucking", "airline", "railroad", "marine shipping"),
     Industry("Transportation", "Transport & Logistik", 0.95, 0.09, 1.6, 3)),
    (("chemical",), Industry("Chemical (Specialty)", "Chemie", 0.90, 0.13, 1.2, 5)),
    (("gold", "silver", "mining", "metal", "steel", "aluminum", "copper"),
     Industry("Metals & Mining", "Bergbau & Metalle", 1.00, 0.18, 0.8, 3)),
    (("telecom",), Industry("Telecom. Services", "Telekommunikation", 0.60, 0.18, 0.6, 3)),
    (("entertainment", "gaming", "media", "broadcast", "publishing", "advertising"),
     Industry("Entertainment", "Medien & Unterhaltung", 1.00, 0.15, 1.3, 3)),
    (("reit", "real estate"), Industry("R.E.I.T.", "Immobilien", 0.60, 0.30, 0.3, 3)),
    (("machinery", "industrial", "building", "electrical equipment", "tools", "construction"),
     Industry("Machinery", "Maschinenbau & Industrie", 0.95, 0.14, 1.5, 5)),
]
_SECTORS: dict[str, Industry] = {
    "Technology": Industry("Technology", "Technologie (Sektor)", 1.15, 0.22, 1.2, 5),
    "Healthcare": Industry("Healthcare", "Gesundheit (Sektor)", 0.95, 0.18, 1.0, 5),
    "Consumer Cyclical": Industry("Consumer Discretionary", "Zyklischer Konsum (Sektor)", 1.00, 0.10, 1.8, 3),
    "Consumer Defensive": Industry("Consumer Staples", "Basiskonsum (Sektor)", 0.60, 0.11, 1.8, 3),
    "Energy": Industry("Energy", "Energie (Sektor)", 0.85, 0.13, 1.0, 3),
    "Utilities": Industry("Utilities", "Versorger (Sektor)", 0.40, 0.20, 0.4, 3),
    "Industrials": Industry("Industrials", "Industrie (Sektor)", 0.95, 0.12, 1.5, 5),
    "Communication Services": Industry("Communication Services", "Kommunikation (Sektor)", 0.85, 0.18, 0.9, 3),
    "Basic Materials": Industry("Materials", "Grundstoffe (Sektor)", 0.95, 0.15, 1.0, 5),
    "Real Estate": Industry("Real Estate", "Immobilien (Sektor)", 0.60, 0.30, 0.3, 3),
}
MARKET = Industry("Total Market", "Gesamtmarkt", 0.90, 0.13, 1.3, 5)

# Finanzbranche: Fremdkapital ist dort Rohstoff, kein Finanzierungsmittel – FCFF-DCF passt nicht
FINANCIAL_SECTORS = ("financial services", "financial", "financials", "finanzen")
FINANCIAL_WORDS = ("bank", "insurance", "versicherung", "capital markets", "credit services", "mortgage", "asset management",
                   "financial data", "brokerage", "reinsurance")


@dataclass
class Params:
    erp: float = ERP
    erp_source: str = BUILTIN_SOURCE
    countries: dict[str, Country] = field(default_factory=lambda: dict(COUNTRIES))
    country_source: str = BUILTIN_SOURCE
    ratings: list[RatingStep] = field(default_factory=lambda: list(RATINGS))
    industries: list[tuple[tuple[str, ...], Industry]] = field(default_factory=lambda: list(_INDUSTRIES))
    sectors: dict[str, Industry] = field(default_factory=lambda: dict(_SECTORS))
    loaded_at: Optional[str] = None  # Zeitpunkt der letzten erfolgreichen Aktualisierung

    def country(self, code: Optional[str]) -> Optional[Country]:
        return self.countries.get(code or "")

    def industry_for(self, sector: Optional[str], industry: Optional[str]) -> Industry:
        text = (industry or "").lower()
        for words, ind in self.industries:
            if any(w in text for w in words):
                return ind
        return self.sectors.get(sector or "", MARKET)

    def rating_for(self, coverage: Optional[float]) -> RatingStep:
        if coverage is None:
            return next(r for r in self.ratings if r.rating == "BBB")
        for step in self.ratings:
            if coverage >= step.min_coverage:
                return step
        return self.ratings[-1]


def is_financial(sector: Optional[str], industry: Optional[str]) -> bool:
    s = (sector or "").lower()
    i = (industry or "").lower()
    return s in FINANCIAL_SECTORS or any(w in i for w in FINANCIAL_WORDS)


def country_code(country: Optional[str], exchange: Optional[str]) -> Optional[str]:
    c = (country or "").strip().lower()
    if c in COUNTRY_BY_NAME:
        return COUNTRY_BY_NAME[c]
    if len(c) == 2 and c.upper() in COUNTRIES:
        return c.upper()
    return COUNTRY_BY_EXCHANGE.get((exchange or "").upper())


def load_params(data_dir: Optional[Path]) -> Params:
    """Eingebaute Richtwerte, überschrieben durch die zuletzt geladenen Damodaran-Daten (falls vorhanden)."""
    p = Params()
    if data_dir is None:
        return p
    path = Path(data_dir) / "damodaran.json"
    if not path.exists():
        return p
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return apply_loaded(p, data)
    except (OSError, ValueError, TypeError, KeyError) as exc:
        log.warning("Damodaran-Daten unlesbar (%s) – eingebaute Richtwerte gelten", exc)
        return p


def apply_loaded(p: Params, data: dict) -> Params:
    """Geladene Werte (Format von damodaran_data.save) über die eingebauten legen – nur plausible Werte."""
    src = str(data.get("source") or "Damodaran Online")
    at = data.get("loaded_at")
    erp = data.get("erp")
    if isinstance(erp, (int, float)) and 0.02 <= erp <= 0.10:
        p.erp, p.erp_source = float(erp), f"{src} (implizite ERP)"
    crps = data.get("crp") or {}
    if isinstance(crps, dict) and crps:
        countries = dict(p.countries)
        for code, c in countries.items():
            v = crps.get(c.code)
            if v is None:  # nicht „or“: eine geladene Prämie von 0 % (Aaa-Land) muss den Richtwert ersetzen
                v = crps.get(c.name)
            if isinstance(v, (int, float)) and 0 <= v <= 0.25:
                countries[code] = replace(c, crp=float(v))
        p.countries, p.country_source = countries, f"{src} (Länderrisiko)"
    inds = data.get("industries") or {}
    if isinstance(inds, dict) and inds:
        def upd(ind: Industry) -> Industry:
            row = inds.get(ind.key)
            if not isinstance(row, dict):
                return ind
            beta = row.get("beta_u")
            margin = row.get("margin")
            s2c = row.get("sales_to_capital")
            return replace(
                ind,
                beta_u=float(beta) if isinstance(beta, (int, float)) and 0.1 <= beta <= 3 else ind.beta_u,
                margin=float(margin) if isinstance(margin, (int, float)) and -0.5 <= margin <= 0.8 else ind.margin,
                sales_to_capital=float(s2c) if isinstance(s2c, (int, float)) and 0.05 <= s2c <= 20 else ind.sales_to_capital,
                source=f"{src} (Branche „{ind.key}“)",
            )

        p.industries = [(w, upd(ind)) for w, ind in p.industries]
        p.sectors = {k: upd(v) for k, v in p.sectors.items()}
    p.loaded_at = str(at) if at else None
    return p
