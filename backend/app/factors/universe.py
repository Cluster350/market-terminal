"""Faktoren: Stil-ETFs je Region und ihr Maßstab.

Gemessen wird mit handelbaren ETFs (Kurse von EODHD), nicht mit akademischen Long-Short-Faktoren:
„Value läuft besser“ heißt hier, der Value-ETF hat sich besser entwickelt als der breite Markt.

USA: Ticker eindeutig. Europa: Die Börsenkürzel der UCITS-ETFs unterscheiden sich je Handelsplatz;
im EODHD-Modus wird jede ISIN über die Suche aufgelöst (bevorzugt Xetra in Euro), das Kürzel hier
ist nur der Vorschlag, falls die Suche nichts findet. Eigene Auswahl: Liste unten anpassen.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class FactorDef:
    key: str  # value, growth, momentum, quality, size, lowvol, dividend, equal
    label: str
    ticker: str
    name: str
    isin: Optional[str] = None
    in_model: bool = True  # in der Regression der Depot-Faktorlast


@dataclass(frozen=True)
class Region:
    key: str
    label: str
    bench: FactorDef
    factors: tuple[FactorDef, ...]


FACTOR_HELP = {
    "value": "günstig bewertete Firmen (niedriges KGV/KBV)",
    "growth": "Firmen mit starkem Umsatz- und Gewinnwachstum",
    "momentum": "Aktien, die in den letzten 6–12 Monaten am stärksten gestiegen sind",
    "quality": "hohe Rentabilität, stabile Gewinne, wenig Schulden",
    "size": "kleinere Firmen (Nebenwerte)",
    "lowvol": "Aktien mit geringer Schwankung",
    "dividend": "Firmen mit hoher Dividendenrendite",
    "equal": "alle Firmen des Index gleich gewichtet (statt nach Börsenwert) – zeigt die Marktbreite",
}

REGIONS: dict[str, Region] = {
    "us": Region(
        key="us",
        label="USA",
        bench=FactorDef("market", "Markt (S&P 500)", "SPY.US", "SPDR S&P 500 ETF Trust"),
        factors=(
            FactorDef("value", "Value", "VLUE.US", "iShares MSCI USA Value Factor ETF"),
            FactorDef("growth", "Wachstum", "IWF.US", "iShares Russell 1000 Growth ETF", in_model=False),
            FactorDef("momentum", "Momentum", "MTUM.US", "iShares MSCI USA Momentum Factor ETF"),
            FactorDef("quality", "Qualität", "QUAL.US", "iShares MSCI USA Quality Factor ETF"),
            FactorDef("size", "Kleine Firmen", "IWM.US", "iShares Russell 2000 ETF"),
            FactorDef("lowvol", "Niedrige Schwankung", "USMV.US", "iShares MSCI USA Min Vol Factor ETF"),
            FactorDef("dividend", "Dividende", "VYM.US", "Vanguard High Dividend Yield ETF", in_model=False),
            FactorDef("equal", "Gleichgewichtet", "RSP.US", "Invesco S&P 500 Equal Weight ETF", in_model=False),
        ),
    ),
    "eu": Region(
        key="eu",
        label="Europa",
        bench=FactorDef("market", "Markt (STOXX Europe 600)", "EXSA.XETRA", "iShares STOXX Europe 600 UCITS ETF (DE)", "DE0002635307"),
        factors=(
            FactorDef("value", "Value", "IEFV.XETRA", "iShares Edge MSCI Europe Value Factor UCITS ETF", "IE00BQN1K901"),
            FactorDef("momentum", "Momentum", "IEFM.XETRA", "iShares Edge MSCI Europe Momentum Factor UCITS ETF", "IE00BQN1K786"),
            FactorDef("quality", "Qualität", "IEFQ.XETRA", "iShares Edge MSCI Europe Quality Factor UCITS ETF", "IE00BQN1K562"),
            FactorDef("size", "Kleine Firmen", "IEFS.XETRA", "iShares Edge MSCI Europe Size Factor UCITS ETF", "IE00BQN1KC32"),
            FactorDef("lowvol", "Niedrige Schwankung", "IEMV.XETRA", "iShares Edge MSCI Europe Minimum Volatility UCITS ETF", "IE00B86MWN23"),
        ),
    ),
}


def all_defs() -> list[FactorDef]:
    out: list[FactorDef] = []
    for r in REGIONS.values():
        out.append(r.bench)
        out.extend(r.factors)
    return out
