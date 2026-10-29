"""Ticker-Normalisierung.

Akzeptiert EODHD-Format (SAP.XETRA), Bloomberg-ähnliche Kürzel (SAP GR) und
nackte US-Ticker (AAPL). Ergebnis ist immer CODE.BÖRSE in Großbuchstaben.
"""

from __future__ import annotations

import re

from ..errors import BadRequest

# Bloomberg-Börsenkürzel -> EODHD-Börsencode
BBG_EXCHANGES = {
    "US": "US", "UN": "US", "UW": "US", "UQ": "US",
    "GR": "XETRA", "GY": "XETRA", "GF": "F",
    "LN": "LSE", "FP": "PA", "NA": "AS", "BB": "BR",
    "SW": "SW", "SE": "SW", "IM": "MI", "SM": "MC",
    "JT": "TSE", "JP": "TSE", "HK": "HK", "CN": "TO", "CT": "TO",
    "AU": "AU", "SS": "ST", "DC": "CO", "NO": "OL", "FH": "HE",
}

# Gelbe Bloomberg-Tasten -> EODHD-"Börse"
YELLOW_KEYS = {"INDEX": "INDX", "CURNCY": "FOREX", "GOVT": "GBOND", "COMDTY": "COMM"}

# Bloomberg-Indexkürzel -> EODHD-Ticker (nur zusammen mit "INDEX")
INDEX_ALIASES = {
    "SPX": "GSPC", "INDU": "DJI", "CCMP": "IXIC", "NDX": "NDX", "RTY": "RUT", "SPTSX": "GSPTSE",
    "DAX": "GDAXI", "MDAX": "MDAXI", "SX5E": "STOXX50E", "CAC": "FCHI", "UKX": "FTSE", "SMI": "SSMI",
    "NKY": "N225", "HSI": "HSI", "AS51": "AXJO", "VIX": "VIX",
}

_VALID = re.compile(r"^[A-Z0-9][A-Z0-9\-_=^&]{0,24}\.[A-Z0-9]{1,10}$")


def normalize(raw: str, default_exchange: str = "US") -> str:
    s = (raw or "").strip().upper()
    if not s:
        raise BadRequest("Ticker fehlt.")
    s = re.sub(r"\s+EQUITY$", "", s)
    m = re.match(r"^(\S+)\s+(INDEX|CURNCY|GOVT|COMDTY)$", s)
    if m and "." not in m.group(1):
        code, key = m.groups()
        if key == "INDEX":
            code = INDEX_ALIASES.get(code, code)
        exch = "CC" if key == "CURNCY" and "-" in code else YELLOW_KEYS[key]
        s = f"{code}.{exch}"
    parts = s.split()
    if len(parts) == 2 and "." not in parts[0]:
        code, exch = parts
        s = f"{code}.{BBG_EXCHANGES.get(exch, exch)}"
    elif len(parts) > 1:
        raise BadRequest(f"Ticker „{raw}“ nicht erkannt.")
    if "." not in s:
        s = f"{s}.{default_exchange}"
    if not _VALID.match(s):
        raise BadRequest(f"Ticker „{raw}“ enthält ungültige Zeichen.")
    return s


def split(ticker: str) -> tuple[str, str]:
    code, _, exch = ticker.rpartition(".")
    return code, exch


def normalize_list(raw: str, limit: int = 50) -> list[str]:
    items = [p for p in re.split(r"[,;]", raw or "") if p.strip()]
    if len(items) > limit:
        raise BadRequest(f"Maximal {limit} Ticker pro Anfrage.")
    seen: list[str] = []
    for item in items:
        t = normalize(item)
        if t not in seen:
            seen.append(t)
    return seen
