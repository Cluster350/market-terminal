"""Einflussgrößen (Zusatzreihen) für die Prognose: andere Länderkennzahlen, Konjunkturtermine und Kursreihen
werden auf die Zeitpunkte der Zielreihe gebracht.

Schlüssel einer Einflussgröße:
- ``m:DEU:inflation_consumer_prices_annual``  Länderkennzahl (Jahreswerte)
- ``e:US:Inflation Rate YoY``                 Konjunkturtermin (bisherige Veröffentlichungen)
- ``WTI.COMM`` / ``SPY US`` / ``US10Y.GBOND`` Kursreihe (Ticker wie in der Befehlszeile)

Ehrlichkeit: Zu jedem Zeitpunkt der Zielreihe zählt nur, was bis dahin bekannt war. Kurse gehen als
Veränderung in % ein (Jahresdurchschnitt gegen Vorjahr bzw. die letzten rund drei Monate vor dem Termin),
Renditen und Kennzahlen als Niveau.
"""

from __future__ import annotations

import bisect
from dataclasses import dataclass
from typing import Optional, Sequence

from ..errors import BadRequest, TerminalError
from ..providers.base import MACRO_INDICATORS, WORLD
from ..services.terminal import Terminal
from ..services.tickers import display, normalize
from .models import FcFeatureOption

MAX_FEATURES = 5
MIN_OVERLAP = 10  # so viele Zeitpunkte der Zielreihe müssen mit allen Einflussgrößen übrig bleiben
LOOKBACK_DAYS = 63  # Handelstage (rund drei Monate) für die Kursveränderung vor einem Termin


@dataclass
class Feature:
    key: str
    label: str
    values: list[Optional[float]]  # je Zeitpunkt der Zielreihe; None = (noch) kein Wert

    @property
    def first(self) -> Optional[int]:
        return next((i for i, v in enumerate(self.values) if v is not None), None)


def _fill(values: Sequence[Optional[float]]) -> list[Optional[float]]:
    """Lücken mit dem letzten bekannten Wert füllen (nie mit einem späteren)."""
    out: list[Optional[float]] = []
    last: Optional[float] = None
    for v in values:
        last = v if v is not None else last
        out.append(last)
    return out


def _year(t: str) -> int:
    return int(t[:4])


def align_prices(pairs: Sequence[tuple[str, float]], target_t: Sequence[str], freq: str, level: bool) -> list[Optional[float]]:
    """Kursreihe (Datum, Schluss) auf die Zeitpunkte der Zielreihe bringen.

    ``freq="year"``: Jahresdurchschnitt (``level``) bzw. dessen Veränderung zum Vorjahr in %.
    Sonst (Termine): letzter Schluss vor dem Termin (``level``) bzw. Veränderung in % über die
    ``LOOKBACK_DAYS`` Handelstage davor."""
    if freq == "year":
        sums: dict[int, list[float]] = {}
        for d, c in pairs:
            sums.setdefault(_year(d), []).append(c)
        avg = {y: sum(v) / len(v) for y, v in sums.items()}
        out: list[Optional[float]] = []
        for t in target_t:
            y = _year(t)
            a, b = avg.get(y), avg.get(y - 1)
            out.append(a if level else ((a / b - 1.0) * 100 if a is not None and b else None))
        return out
    dates = [d[:10] for d, _ in pairs]
    out = []
    for t in target_t:
        i = bisect.bisect_left(dates, t[:10]) - 1  # letzter Schluss VOR dem Termin
        if i < 0:
            out.append(None)
        elif level:
            out.append(pairs[i][1])
        else:
            j = i - LOOKBACK_DAYS
            out.append((pairs[i][1] / pairs[j][1] - 1.0) * 100 if j >= 0 and pairs[j][1] else None)
    return out


def align_annual(by_year: dict[int, float], target_t: Sequence[str], freq: str) -> list[Optional[float]]:
    """Jahreswerte: bei Jahresreihen dasselbe Jahr, bei Terminen das letzte abgeschlossene Jahr davor."""
    if freq == "year":
        return [by_year.get(_year(t)) for t in target_t]
    years = sorted(by_year)
    out: list[Optional[float]] = []
    for t in target_t:
        i = bisect.bisect_left(years, _year(t)) - 1
        out.append(by_year[years[i]] if i >= 0 else None)
    return out


def align_releases(rows: Sequence[tuple[str, float]], target_t: Sequence[str], freq: str) -> list[Optional[float]]:
    """Veröffentlichungen (Datum, Wert): bei Jahresreihen der Jahresdurchschnitt, bei Terminen der letzte
    Wert, der vor dem Termin veröffentlicht war."""
    if freq == "year":
        acc: dict[int, list[float]] = {}
        for d, v in rows:
            acc.setdefault(_year(d), []).append(v)
        return [sum(acc[y]) / len(acc[y]) if (y := _year(t)) in acc else None for t in target_t]
    dates = [d[:10] for d, _ in rows]
    out: list[Optional[float]] = []
    for t in target_t:
        i = bisect.bisect_left(dates, t[:10]) - 1
        out.append(rows[i][1] if i >= 0 else None)
    return out


def _iso3(cc: str) -> Optional[str]:
    return next((iso for iso, _, c2, _, _ in WORLD if c2 == cc), None)


def _cc2(iso3: str) -> Optional[str]:
    return next((c2 for iso, _, c2, _, _ in WORLD if iso == iso3), None)


async def _one(t: Terminal, key: str, target_t: Sequence[str], freq: str) -> Feature:
    if key.startswith("m:"):
        _, cc, ind = (key.split(":", 2) + ["", ""])[:3]
        known = {k: label for k, label, _ in MACRO_INDICATORS}
        cc = cc.upper()
        if ind not in known or len(cc) != 3 or not cc.isalpha():
            raise BadRequest(f"Einflussgröße „{key}“ unbekannt.")
        data = await t._cached(f"macro:{cc}:{ind}", "macro", lambda: t.p.macro_indicator(cc, ind))
        by_year = {d.year: d.value for d in data if d.year is not None and d.value is not None}
        return Feature(f"m:{cc}:{ind}", f"{known[ind]} {cc}", align_annual(by_year, target_t, freq))
    if key.startswith("e:"):
        _, cc, name = (key.split(":", 2) + ["", ""])[:3]
        cc = cc.upper()
        if len(cc) != 2 or not cc.isalpha() or not name:
            raise BadRequest(f"Einflussgröße „{key}“ unbekannt.")
        now = t.now().isoformat().replace("+00:00", "Z")
        seen: dict[str, float] = {}
        for e in await t.calendar_history(cc, 6):
            if e.event == name and e.actual is not None and e.date <= now:
                seen[e.date[:10]] = e.actual
        return Feature(f"e:{cc}:{name}", f"{name} {cc}", align_releases(sorted(seen.items()), target_t, freq))
    ticker = normalize(key)
    hist = await t.history(ticker)
    pairs = [(d, c) for d, c in zip(hist.t, hist.c) if c is not None]
    level = ticker.endswith(".GBOND")  # Renditen als Niveau, Kurse als Veränderung
    label = f"{display(ticker)} ({'Rendite' if level else 'Veränderung %'})"
    return Feature(ticker, label, align_prices(pairs, target_t, freq, level))


async def resolve(t: Terminal, keys: Sequence[str], target_t: Sequence[str], freq: str) -> tuple[list[Feature], list[str]]:
    """Einflussgrößen laden und auf die Zielreihe bringen. Liefert die nutzbaren Reihen und Hinweise zu
    denen, die nicht nutzbar waren (unbekannt, zu kurz, ohne Bewegung)."""
    out: list[Feature] = []
    notes: list[str] = []
    seen: set[str] = set()
    for raw in keys:
        key = (raw or "").strip()
        if not key:
            continue
        if len(out) + len(notes) >= MAX_FEATURES:
            notes.append(f"Höchstens {MAX_FEATURES} Einflussgrößen – weitere wurden nicht berücksichtigt.")
            break
        try:
            f = await _one(t, key, target_t, freq)
        except TerminalError as exc:
            notes.append(f"{key}: {exc.message}")
            continue
        if f.key in seen:
            continue
        seen.add(f.key)
        f.values = _fill(f.values)
        vals = [v for v in f.values if v is not None]
        if len(vals) < MIN_OVERLAP:
            notes.append(f"{f.label}: zu wenig gemeinsamer Verlauf mit der Zielreihe ({len(vals)} Zeitpunkte, nötig {MIN_OVERLAP}).")
        elif max(vals) - min(vals) <= 1e-12:
            notes.append(f"{f.label}: ohne Bewegung im Zeitraum – nicht nutzbar.")
        else:
            out.append(f)
    return out, notes


def common_start(features: Sequence[Feature]) -> int:
    """Erster Zeitpunkt, ab dem alle Einflussgrößen einen Wert haben."""
    return max((f.first or 0) for f in features) if features else 0


async def options(t: Terminal, kind: str, country: str) -> list[FcFeatureOption]:
    """Vorschläge für die Auswahl: Märkte (Rohstoffe, Aktienindex, Renditen, Devisen) und andere
    Kennzahlen bzw. Konjunkturtermine desselben Landes. Jeder Ticker geht auch per Eingabe."""
    c = country.strip().upper()
    iso3 = c if len(c) == 3 else _iso3(c)
    cc2 = c if len(c) == 2 else (_cc2(c) if iso3 else None)
    out: list[FcFeatureOption] = []
    cat = t.p.catalog
    for ins in cat.commodities:
        out.append(FcFeatureOption(key=ins.ticker, label=ins.name, group="Rohstoffe"))
    index = next(((tk, name) for iso, _, _, tk, name in WORLD if iso == iso3 and tk), None)
    markets = [("GSPC.INDX", "S&P 500")] + ([index] if index and index[0] != "GSPC.INDX" else [])
    for tk, name in markets:
        out.append(FcFeatureOption(key=tk, label=name, group="Aktien"))
    for code in dict.fromkeys([cc2, "US"]):
        if code and code in cat.curves:
            out.append(FcFeatureOption(key=f"{code}10Y.GBOND", label=f"Rendite 10 Jahre {cat.curves[code][0]}", group="Zinsen"))
    for ins in cat.fx[:6]:
        out.append(FcFeatureOption(key=ins.ticker, label=ins.name, group="Devisen"))
    if iso3:
        for k, label, _ in MACRO_INDICATORS:
            out.append(FcFeatureOption(key=f"m:{iso3}:{k}", label=f"{label} (Jahreswert)", group="Kennzahlen"))
    if kind == "event" and cc2:
        try:
            now = t.now().isoformat().replace("+00:00", "Z")
            counts: dict[str, int] = {}
            for e in await t.calendar_history(cc2, 6):
                if e.actual is not None and e.date <= now:
                    counts[e.event] = counts.get(e.event, 0) + 1
            for name, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:40]:
                if n >= MIN_OVERLAP:
                    out.append(FcFeatureOption(key=f"e:{cc2}:{name}", label=name, group="Konjunkturtermine"))
        except TerminalError:
            pass
    return out

