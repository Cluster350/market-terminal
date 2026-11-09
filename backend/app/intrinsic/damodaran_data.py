"""Aktualisierung der Marktparameter aus Aswath Damodarans frei veröffentlichten Datensätzen (HTML-Fassungen auf
pages.stern.nyu.edu/~adamodar). Gelesen werden nur Zahlen-Tabellen; nichts davon wird ausgeführt.

- histimpl.html: implizite Aktien-Risikoprämie des S&P 500 (letzte Zeile)
- ctryprem.html: Länderrisikoprämien
- Betas.html: Beta ohne Verschuldung (um Barmittel bereinigt) je Branche (USA)
- margin.html: operative Marge vor Steuern (F&E- und Leasing-bereinigt, sonst unbereinigt) je Branche
- capex.html: Umsatz je eingesetztem Kapital je Branche

Gelingt etwas nicht (Seite nicht erreichbar, Aufbau geändert), bleiben die bisherigen Werte – es wird nur übernommen,
was sich eindeutig lesen lässt. Ergebnis: PORTFOLIO_DIR/damodaran.json (siehe params.apply_loaded).
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import re
from html.parser import HTMLParser
from pathlib import Path
from typing import Callable, Optional

import httpx

from .params import COUNTRY_BY_NAME

log = logging.getLogger("terminal.intrinsic")

BASE_URL = "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/"
PAGES = {"erp": "histimpl.html", "crp": "ctryprem.html", "beta": "Betas.html", "margin": "margin.html", "capex": "capex.html"}
SOURCE = "Damodaran Online (pages.stern.nyu.edu/~adamodar)"
MAX_AGE_DAYS = 180


class _Tables(HTMLParser):
    """Alle Tabellen einer Seite als Zeilen mit Zellentexten."""

    def __init__(self) -> None:
        super().__init__()
        self.tables: list[list[list[str]]] = []
        self._row: Optional[list[str]] = None
        self._cell: Optional[list[str]] = None
        self._depth = 0

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self._depth += 1
            self.tables.append([])
        elif tag == "tr" and self._depth:
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._cell is not None and self._row is not None:
            self._row.append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if self.tables and any(c for c in self._row):
                self.tables[-1].append(self._row)
            self._row = None
        elif tag == "table" and self._depth:
            self._depth -= 1

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def tables(html: str) -> list[list[list[str]]]:
    p = _Tables()
    p.feed(html)
    return [t for t in p.tables if t]


_NUM = re.compile(r"^\(?-?[\d,]*\.?\d+%?\)?%?$")


def parse_number(text: str, percent: bool = False) -> Optional[float]:
    """„4.33%“ → 0.0433; „1.23“ → 1.23; bei percent=True werden Zahlen > 1,5 ohne %-Zeichen als Prozent gelesen."""
    s = (text or "").strip().replace("−", "-").replace(" ", "")
    if not s or not _NUM.match(s):
        return None
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    is_pct = s.endswith("%") or text.strip().endswith("%)")
    s = s.rstrip("%").replace(",", "")
    try:
        v = float(s)
    except ValueError:
        return None
    if neg:
        v = -v
    if is_pct or (percent and abs(v) > 1.5):
        v /= 100
    return v


def _find(table: list[list[str]], first: Callable[[str], bool]) -> Optional[int]:
    """Index der Kopfzeile, deren erste Zelle passt."""
    for i, row in enumerate(table):
        if row and first(row[0].lower()):
            return i
    return None


def _column(header: list[str], *alternatives: tuple[str, ...]) -> Optional[int]:
    """Erste Spalte, deren Kopf alle Wörter einer Alternative enthält (Alternativen in Vorzugsreihenfolge)."""
    low = [h.lower() for h in header]
    for words in alternatives:
        for j, h in enumerate(low):
            if all(w in h for w in words):
                return j
    return None


def industry_column(html: str, *alternatives: tuple[str, ...], percent: bool) -> dict[str, float]:
    out: dict[str, float] = {}
    for t in tables(html):
        hi = _find(t, lambda c: c.startswith("industry"))
        if hi is None:
            continue
        col = _column(t[hi], *alternatives)
        if col is None:
            continue
        for row in t[hi + 1:]:
            if len(row) <= col or not row[0]:
                continue
            v = parse_number(row[col], percent=percent)
            if v is not None:
                out[row[0].strip()] = v
        if out:
            break
    return out


def parse_betas(html: str) -> dict[str, float]:
    return industry_column(html, ("unlevered", "cash"), ("unlevered", "beta"), percent=False)


def parse_margins(html: str) -> dict[str, float]:
    return industry_column(html, ("pre-tax", "r&d"), ("pre-tax", "unadjusted", "operating"), ("pre-tax", "operating"),
                           ("operating", "margin"), percent=True)


def parse_sales_to_capital(html: str) -> dict[str, float]:
    return industry_column(html, ("sales", "capital"), percent=False)


def parse_crp(html: str) -> dict[str, float]:
    """Länderrisikoprämie je Land (Schlüssel: Kürzel aus COUNTRY_BY_NAME, sonst der englische Name)."""
    out: dict[str, float] = {}
    for t in tables(html):
        hi = _find(t, lambda c: c.startswith("country"))
        if hi is None:
            continue
        col = _column(t[hi], ("country", "risk", "premium"), ("crp",))
        if col is None:
            continue
        for row in t[hi + 1:]:
            if len(row) <= col or not row[0]:
                continue
            v = parse_number(row[col], percent=True)
            if v is None:
                continue
            name = row[0].strip()
            out[COUNTRY_BY_NAME.get(name.lower(), name)] = v
        if out:
            break
    return out


def parse_erp(html: str) -> Optional[float]:
    """Implizite Risikoprämie (FCFE) der jüngsten Jahreszeile."""
    for t in tables(html):
        hi = _find(t, lambda c: c.startswith("year"))
        if hi is None:
            continue
        col = _column(t[hi], ("implied", "fcfe"), ("implied", "premium"), ("implied", "erp"))
        if col is None:
            continue
        last: Optional[float] = None
        for row in t[hi + 1:]:
            if len(row) > col and re.match(r"^\d{4}", row[0].strip()):
                v = parse_number(row[col], percent=True)
                if v is not None:
                    last = v
        if last is not None:
            return last
    return None


def build(pages: dict[str, str]) -> dict:
    """Aus den geladenen Seiten die Datei für params.apply_loaded bauen (nur lesbare Teile)."""
    data: dict = {"source": SOURCE, "loaded_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
    if "erp" in pages:
        erp = parse_erp(pages["erp"])
        if erp is not None:
            data["erp"] = erp
    if "crp" in pages:
        crp = parse_crp(pages["crp"])
        if crp:
            data["crp"] = crp
    betas = parse_betas(pages["beta"]) if "beta" in pages else {}
    margins = parse_margins(pages["margin"]) if "margin" in pages else {}
    s2c = parse_sales_to_capital(pages["capex"]) if "capex" in pages else {}
    inds: dict[str, dict[str, float]] = {}
    for name in set(betas) | set(margins) | set(s2c):
        row = {}
        if name in betas:
            row["beta_u"] = betas[name]
        if name in margins:
            row["margin"] = margins[name]
        if name in s2c:
            row["sales_to_capital"] = s2c[name]
        inds[name] = row
    if inds:
        data["industries"] = inds
    return data


async def fetch(transport: Optional[httpx.AsyncBaseTransport] = None, timeout: float = 25.0) -> dict[str, str]:
    pages: dict[str, str] = {}
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, transport=transport,
                                 headers={"User-Agent": "MarketTerminal/1.0 (Bewertungsparameter)"}) as client:
        for key, page in PAGES.items():
            try:
                r = await client.get(BASE_URL + page)
                if r.status_code == 200 and r.text:
                    pages[key] = r.text
                else:
                    log.info("Damodaran-Daten: %s → HTTP %s", page, r.status_code)
            except httpx.HTTPError as exc:
                log.info("Damodaran-Daten: %s nicht erreichbar (%s)", page, exc)
    return pages


def needs_update(data_dir: Path) -> bool:
    path = data_dir / "damodaran.json"
    if not path.exists():
        return True
    try:
        at = json.loads(path.read_text(encoding="utf-8")).get("loaded_at")
        when = dt.datetime.fromisoformat(at)
    except (OSError, ValueError, TypeError):
        return True
    return (dt.datetime.now(dt.timezone.utc) - when).days > MAX_AGE_DAYS


async def update(data_dir: Path, transport: Optional[httpx.AsyncBaseTransport] = None) -> tuple[bool, str]:
    """Laden, lesen, speichern. Rückgabe: (gespeichert?, Meldung)."""
    pages = await fetch(transport)
    if not pages:
        return False, "Damodarans Seite ist nicht erreichbar – eingebaute Richtwerte bleiben."
    data = build(pages)
    found = [k for k in ("erp", "crp", "industries") if k in data]
    if not found:
        return False, "Seite erreichbar, aber keine Tabelle lesbar (Aufbau geändert?) – bisherige Werte bleiben."
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "damodaran.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    parts = []
    if "erp" in data:
        parts.append(f"Risikoprämie {data['erp'] * 100:.2f} %".replace(".", ","))
    if "crp" in data:
        parts.append(f"{len(data['crp'])} Länder")
    if "industries" in data:
        parts.append(f"{len(data['industries'])} Branchen")
    return True, "Damodaran-Daten geladen: " + ", ".join(parts)
