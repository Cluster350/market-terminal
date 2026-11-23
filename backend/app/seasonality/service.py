"""Saisonalität (Funktion SAIS): Gibt es bei einem Wert Wochentags-, Monats- oder Monatswechsel-Muster – und sind
sie deutlicher als der Zufall? Rechnet nur auf vorhandenen Schlusskursen; nichts wird gespeichert."""

from __future__ import annotations

import asyncio
import time
from typing import Any, Optional

from ..errors import NotFound, TerminalError
from ..models import Model
from ..services.tickers import display
from . import calc as C

CACHE_SECONDS = 3600
NOTE = ("Vergleich zum Zufall: Die Renditen bleiben gleich, nur Wochentag bzw. Monat werden {n}-mal zufällig neu verteilt. "
        "Gemessen wird das ganze Muster, denn bei 12 Monaten fällt fast immer einer zufällig auf. Auch ein deutliches "
        "Muster aus der Vergangenheit muss sich nicht wiederholen – Beschreibung, keine Empfehlung.")


class SeasonGroup(Model):
    key: int
    label: str
    n: int
    mean: Optional[float] = None
    median: Optional[float] = None
    plus: Optional[float] = None  # Anteil positiver Fälle in %
    p: Optional[float] = None  # Vergleich zum Zufall für diese Gruppe allein
    first: Optional[float] = None  # Mittel in der ersten bzw. zweiten Hälfte der Jahre
    second: Optional[float] = None
    same: Optional[bool] = None


class SeasonBlock(Model):
    title: str
    unit: str  # „je Tag“ / „je Monat“
    groups: list[SeasonGroup]
    overall: Optional[float] = None
    p_all: Optional[float] = None
    verdict: str = "wenig"  # deutlich | schwach | zufall | wenig
    verdict_text: str = ""
    sentence: str = ""
    stable: Optional[str] = None  # „7 von 12 Monaten in beiden Hälften gleich“


class SeasonalityResult(Model):
    ticker: str
    name: str
    currency: Optional[str] = None
    first: str
    last: str
    years: int
    months: SeasonBlock
    weekdays: SeasonBlock
    turn: SeasonBlock
    path: dict[str, Any]
    note: str


def _pct(v: Optional[float], d: int = 1) -> str:
    if v is None:
        return "–"
    s = f"{abs(v):.{d}f}".replace(".", ",")
    return f"{'+' if v > 0 else '−' if v < 0 else '±'}{s} %"


def _block(title: str, unit: str, values: list[float], labels: list[int], years: list[int], groups: list[int],
           names: dict[int, str], what: str) -> SeasonBlock:
    stats = C.group_stats(values, labels, groups)
    test = C.permutation_test(values, labels, groups)
    stab = C.stability(values, labels, years, groups)
    out = []
    for s in stats:
        if not s["n"]:
            continue
        st = stab.get("groups", {}).get(s["key"], {}) if stab else {}
        out.append(SeasonGroup(key=s["key"], label=names[s["key"]], n=s["n"], mean=s["mean"], median=s["median"], plus=s["plus"],
                               p=test["p"].get(s["key"]), first=st.get("first"), second=st.get("second"), same=st.get("same")))
    v, text = C.verdict(test["pAll"])
    blk = SeasonBlock(title=title, unit=unit, groups=out, overall=sum(values) / len(values) if values else None,
                      p_all=test["pAll"], verdict=v, verdict_text=text)
    ranked = [g for g in out if g.mean is not None]
    if len(ranked) >= 2:
        best = max(ranked, key=lambda g: g.mean)  # type: ignore[arg-type, return-value]
        worst = min(ranked, key=lambda g: g.mean)  # type: ignore[arg-type, return-value]
        blk.sentence = (f"Stärkster {what}: {best.label} ({_pct(best.mean, 2 if unit == 'je Tag' else 1)} im Schnitt, "
                        f"{best.plus:.0f} % der Fälle im Plus). Schwächster: {worst.label} ({_pct(worst.mean, 2 if unit == 'je Tag' else 1)}, "
                        f"{worst.plus:.0f} % im Plus).")
    same = [g for g in out if g.same is not None]
    if same and stab:
        blk.stable = f"{sum(1 for g in same if g.same)} von {len(same)} in beiden Hälften (vor/ab {stab['cut']}) mit gleicher Richtung"
    return blk


class SeasonalityService:
    def __init__(self, terminal: Any):
        self.t = terminal
        self._cache: dict[tuple, tuple[float, SeasonalityResult]] = {}

    async def seasonality(self, ticker: str, years: int = 10) -> SeasonalityResult:
        years = 25 if years > 10 else 10
        key = (ticker, years, self.t.now().date().isoformat())
        hit = self._cache.get(key)
        if hit and time.time() - hit[0] < CACHE_SECONDS:
            return hit[1]
        try:
            h = await (self.t.history_long(ticker, years) if years > 10 else self.t.history(ticker))
        except TerminalError:
            raise
        if not h.t or len([c for c in h.c if c]) < 260:
            raise NotFound(f"Für {display(ticker)} gibt es zu wenig Kursverlauf (mindestens gut ein Jahr).")
        name = ticker
        try:
            q = (await self.t.quotes([ticker]))[0]
            name = q.name or ticker
        except (TerminalError, IndexError):
            pass
        res = await asyncio.to_thread(self._compute, ticker, name, h, years)
        if len(self._cache) > 50:
            self._cache.clear()
        self._cache[key] = (time.time(), res)
        return res

    def _compute(self, ticker: str, name: str, h: Any, years: int) -> SeasonalityResult:
        cutoff = f"{self.t.now().year - years}-01-01"
        pairs = [(d[:10], c) for d, c in zip(h.t, h.c) if d[:10] >= cutoff]
        dates = [d for d, _ in pairs]
        closes = [c for _, c in pairs]
        daily = C.daily_returns(dates, closes)
        wd_vals = [r for _, r in daily]
        wd_lab = [d.weekday() for d, _ in daily]
        wd_years = [d.year for d, _ in daily]
        wd_groups = sorted(set(wd_lab))
        weekdays = _block("Wochentage", "je Tag", wd_vals, wd_lab, wd_years, wd_groups, dict(enumerate(C.WEEKDAYS)), "Wochentag")
        monthly = C.monthly_returns(dates, closes)
        months = _block("Monate", "je Monat", [r for _, _, r in monthly], [m for _, m, _ in monthly], [y for y, _, _ in monthly],
                        list(range(1, 13)), {i + 1: n for i, n in enumerate(C.MONTHS)}, "Monat")
        tv, tl, ty = C.turn_of_month(daily)
        turn = _block("Monatswechsel", "je Tag", tv, tl, ty, [0, 1], {0: "übrige Tage", 1: "Monatswechsel (letzter + erste 3 Tage)"}, "Abschnitt")
        if len(turn.groups) == 2 and turn.groups[0].mean is not None and turn.groups[1].mean is not None:
            tm, rest = turn.groups[1], turn.groups[0]
            turn.sentence = (f"Am Monatswechsel im Schnitt {_pct(tm.mean, 3)} je Tag, an den übrigen Tagen {_pct(rest.mean, 3)} "
                             f"({tm.n} gegen {rest.n} Tage).")
        path = C.year_path(dates, closes, self.t.now().year)
        return SeasonalityResult(ticker=ticker, name=name, currency=getattr(h, "currency", None), first=dates[0], last=dates[-1],
                                 years=len(path["years"]) or years, months=months, weekdays=weekdays, turn=turn, path=path,
                                 note=NOTE.format(n=C.PERMUTATIONS))
