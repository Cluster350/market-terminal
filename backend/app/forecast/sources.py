"""Reihen für die Prognose aus den Terminal-Daten: Länderkennzahlen (jährlich), frühere
Veröffentlichungen eines Konjunkturtermins und die Schwankung (Volatilität) eines Werts."""

from __future__ import annotations

import datetime as dt
import math
import statistics
from typing import Any, Optional

from ..errors import BadRequest, NotFound
from ..providers.base import MACRO_INDICATORS, WORLD
from ..services.terminal import Terminal
from ..services.tickers import display
from . import features as fx
from .models import ForecastResult
from .service import ForecastService

VOL_WINDOW = 21  # Handelstage je Block (etwa ein Monat)


def _country_name(t: Terminal, iso3: str) -> str:
    names = {iso: name for iso, name, *_ in WORLD}
    return t.p.catalog.countries.get(iso3) or names.get(iso3) or iso3


async def macro(fs: ForecastService, t: Terminal, country: str, indicator: str, h: int, x: Optional[list[str]] = None) -> ForecastResult:
    known = {k: (label, unit) for k, label, unit in MACRO_INDICATORS}
    if indicator not in known:
        raise BadRequest(f"Kennzahl „{indicator}“ unbekannt.")
    cc = country.strip().upper()
    data = await t._cached(f"macro:{cc}:{indicator}", "macro", lambda: t.p.macro_indicator(cc, indicator))
    pts = [(d.year, d.value) for d in data if d.year is not None and d.value is not None]
    pts.sort()
    if not pts:
        raise NotFound(f"Keine Werte für {indicator} in {cc}.")
    label, unit = known[indicator]
    last = pts[-1][0]
    # die Zielreihe selbst ist keine Einflussgröße
    feats, notes = await fx.resolve(t, [k for k in x or [] if k != f"m:{cc}:{indicator}"], [str(y) for y, _ in pts], "year")
    return await fs.forecast(
        kind="macro", key=f"{cc}:{indicator}", label=f"{label} · {_country_name(t, cc)}", unit=unit, freq="year",
        t=[str(y) for y, _ in pts], y=[v for _, v in pts], h=h, future_t=[str(last + k) for k in range(1, h + 1)],
        note="Jahreswerte (Weltbank-Basis). Prognose ohne Wissen über Politik oder Ereignisse – nur aus dem bisherigen Verlauf"
             + (" und den gewählten Einflussgrößen." if feats else "."),
        features=feats, feature_notes=notes,
    )


async def event(fs: ForecastService, t: Terminal, country: str, name: str, h: int, years: int = 6, x: Optional[list[str]] = None) -> ForecastResult:
    cc = country.strip().upper()
    events = [e for e in await t.calendar_history(cc, years) if e.event == name]
    if not events:
        raise NotFound(f"Keine früheren Veröffentlichungen von „{name}“ ({cc}) gefunden.")
    now = t.now().isoformat().replace("+00:00", "Z")
    past: dict[str, Any] = {}
    upcoming = None
    for e in events:
        if e.actual is not None and e.date <= now:
            past[e.date[:10]] = e  # gleicher Tag doppelt: der letzte Eintrag gilt
        elif e.actual is None and e.date > now and upcoming is None:
            upcoming = e
    rows = sorted(past.items())
    if len(rows) < 6:
        raise BadRequest(f"Zu wenige frühere Veröffentlichungen von „{name}“ ({len(rows)}) für eine Prognose.")
    dates = [d for d, _ in rows]
    gaps = [(dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days for a, b in zip(dates, dates[1:])]
    step = max(1, round(statistics.median(gaps[-12:]))) if gaps else 30
    first = dt.date.fromisoformat(upcoming.date[:10]) if upcoming else dt.date.fromisoformat(dates[-1]) + dt.timedelta(days=step)
    future = [(first + dt.timedelta(days=step * k)).isoformat() for k in range(h)]
    unit = next((e.unit for _, e in reversed(rows) if e.unit), None)
    feats, notes = await fx.resolve(t, [k for k in x or [] if k != f"e:{cc}:{name}"], dates, "release")
    return await fs.forecast(
        kind="event", key=f"{cc}:{name}", label=f"{name} · {cc}", unit=unit, freq="release",
        t=dates, y=[e.actual for _, e in rows], h=h, future_t=future,
        consensus=[e.estimate for _, e in rows], next_consensus=upcoming.estimate if upcoming else None,
        note="Aus den bisherigen Veröffentlichungen. Termine nach der nächsten sind geschätzt.",
        features=feats, feature_notes=notes,
    )


def realized_vol_blocks(closes: list[float], dates: list[str], window: int = VOL_WINDOW) -> tuple[list[str], list[float]]:
    """Schwankung je Block von `window` Handelstagen (annualisiert, in %), vom jüngsten Tag rückwärts
    in vollen Blöcken gezählt; Ergebnis älteste zuerst."""
    rets: list[float] = []
    rdates: list[str] = []
    for i in range(1, len(closes)):
        a, b = closes[i - 1], closes[i]
        if a and b and a > 0 and b > 0:
            rets.append(math.log(b / a))
            rdates.append(dates[i])
    out_t: list[str] = []
    out_v: list[float] = []
    end = len(rets)
    while end - window >= 0:
        block = rets[end - window : end]
        out_v.append(math.sqrt(252 * sum(r * r for r in block) / window) * 100)
        out_t.append(rdates[end - 1])
        end -= window
    return out_t[::-1], out_v[::-1]


async def vol(fs: ForecastService, t: Terminal, ticker: str, h: int, implied: Optional[float] = None) -> ForecastResult:
    hist = await t.history(ticker)
    pairs = [(d, c) for d, c in zip(hist.t, hist.c) if c]
    ts, vs = realized_vol_blocks([c for _, c in pairs], [d for d, _ in pairs])
    if len(vs) < 12:
        raise BadRequest("Zu wenig Kursverlauf für eine Schwankungsprognose (mindestens etwa ein Jahr).")
    last = dt.date.fromisoformat(ts[-1][:10])
    future = [(last + dt.timedelta(days=30 * k)).isoformat() for k in range(1, h + 1)]
    extra: dict[str, Optional[float]] = {"lastRealized": vs[-1]}
    if implied is not None:
        extra["implied"] = implied
    return await fs.forecast(
        kind="vol", key=f"vol:{ticker}", label=f"Schwankung {display(ticker)} (je {VOL_WINDOW} Handelstage)", unit="% p. a.", freq="month",
        t=ts, y=vs, h=h, future_t=future, extra=extra,
        note="Tatsächliche Schwankung je Monat (annualisiert). Sagt nichts über die Richtung des Kurses.",
    )
