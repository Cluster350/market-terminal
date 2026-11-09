"""Relative Rotation: Daten für Sektoren, Firmen im Sektor, Länderindizes und Währungen."""

from __future__ import annotations

import asyncio
import bisect
import datetime as dt
import math
import time
from dataclasses import dataclass
from typing import Any, Optional

from ..errors import BadRequest, NotFound, TerminalError
from ..models import Model
from ..providers.base import WORLD
from ..services.tickers import display
from ..crypto.universe import COINS
from ..factors.universe import FACTOR_HELP, REGIONS as FACTOR_REGIONS
from ..valuation.service import SECTOR_DE, SECTORS, ValuationService
from .calc import HISTORY_WEEKS, MOM_WEEKS, SMOOTH, TREND_WEEKS, Series, backtest, heading, quadrant, rrg_lines, to_daily, to_weekly

CACHE_SECONDS = 1800
YEARS = 5


@dataclass(frozen=True)
class Takt:
    """Zeitraster der Rotation: Wochen (klassisch, ruhiger) oder Tage (kurzfristig)."""

    key: str  # "w" | "d"
    smooth: int
    trend: int
    mom: int
    history: int  # Zeitpunkte für Anzeige und Abspielen
    horizons: tuple[int, int]  # Rückblick und relative Entwicklung (kurz, lang)
    days_back: int  # Kalendertage Kursdaten


WEEKLY = Takt("w", SMOOTH, TREND_WEEKS, MOM_WEEKS, HISTORY_WEEKS, (4, 13), YEARS * 365)
# Tage: Trend gegenüber den letzten 30 Handelstagen, Schwung gegenüber 10 Tagen, etwas stärker geglättet
DAILY = Takt("d", 5, 30, 10, 250, (5, 20), 2 * 365)

# Währung je Land (ISO3) für die Umrechnung der Indizes in Euro
COUNTRY_CCY = {
    "USA": "USD", "CAN": "CAD", "MEX": "MXN", "BRA": "BRL", "ARG": "ARS", "CHL": "CLP", "DEU": "EUR", "FRA": "EUR",
    "GBR": "GBP", "ITA": "EUR", "ESP": "EUR", "NLD": "EUR", "BEL": "EUR", "AUT": "EUR", "CHE": "CHF", "SWE": "SEK",
    "NOR": "NOK", "DNK": "DKK", "FIN": "EUR", "POL": "PLN", "PRT": "EUR", "GRC": "EUR", "IRL": "EUR", "TUR": "TRY",
    "ISR": "ILS", "SAU": "SAR", "ZAF": "ZAR", "JPN": "JPY", "CHN": "CNH", "IND": "INR", "KOR": "KRW", "TWN": "TWD",
    "IDN": "IDR", "AUS": "AUD", "NZL": "NZD",
}
# Wert einer Währung in US-Dollar: (Paar, +1 = Paar ist CCYUSD, −1 = Paar ist USDCCY)
FX_PAIRS: dict[str, tuple[str, int]] = {
    "EUR": ("EURUSD.FOREX", 1), "GBP": ("GBPUSD.FOREX", 1), "JPY": ("USDJPY.FOREX", -1), "CHF": ("USDCHF.FOREX", -1),
    "AUD": ("AUDUSD.FOREX", 1), "CAD": ("USDCAD.FOREX", -1), "NZD": ("NZDUSD.FOREX", 1), "CNH": ("USDCNH.FOREX", -1),
    "SEK": ("USDSEK.FOREX", -1), "NOK": ("USDNOK.FOREX", -1),
}
CURRENCY_NAMES = {
    "USD": "US-Dollar", "EUR": "Euro", "GBP": "Pfund", "JPY": "Yen", "CHF": "Franken", "AUD": "Austral-Dollar",
    "CAD": "Kanada-Dollar", "NZD": "Neuseeland-Dollar", "CNH": "Renminbi", "SEK": "Schwed. Krone", "NOK": "Norw. Krone",
}
NOTE = (
    "Offene Näherung an Relative Rotation Graphs auf Wochenbasis: Trend = relative Stärke gegenüber ihren letzten "
    "20 Wochen, Schwung = Trend gegenüber seinen letzten 10 Wochen (je als z-Wert um 100). Zeigt nur, wer besser oder "
    "schlechter läuft als der Maßstab – nicht, ob der Maßstab selbst steigt. Keine Empfehlung."
)

NOTE_DAILY = (
    "Offene Näherung an Relative Rotation Graphs auf Tagesbasis (kurzfristig, unruhiger als die Wochensicht): Trend = "
    "relative Stärke (über 5 Tage geglättet) gegenüber ihren letzten 30 Handelstagen, Schwung = Trend gegenüber seinen "
    "letzten 10 Handelstagen (je als z-Wert um 100). Zeigt nur, wer besser oder schlechter läuft als der Maßstab – nicht, "
    "ob der Maßstab selbst steigt. Keine Empfehlung."
)


class RotMember(Model):
    key: str
    label: str
    ticker: Optional[str] = None
    trend: list[Optional[float]]
    momentum: list[Optional[float]]
    quadrant: Optional[str] = None
    heading: Optional[float] = None  # Grad, 0 = nach rechts, 90 = nach oben
    speed: Optional[float] = None
    rel4: Optional[float] = None  # relative Entwicklung gegenüber dem Maßstab, 4 bzw. 13 Wochen
    rel13: Optional[float] = None
    fair_gap: Optional[float] = None  # aus dem Bewertungstrend (Sektoren, Firmen)
    detail: Optional[str] = None


class RotationResult(Model):
    universe: str
    title: str
    benchmark: str
    weeks: list[str]  # Zeitpunkte (Wochen-Freitage bzw. Handelstage)
    freq: str = "w"
    periods: list[int] = [4, 13]  # kurze und lange Vergleichsspanne (rel4/rel13, Rückblick)
    members: list[RotMember]
    test: dict[str, Any]
    state: str = "ready"  # ready | building
    note: str = NOTE
    skipped: list[str] = []


def _align(series: dict[str, dict[str, float]], keys: list[str], fill: int = 0) -> dict[str, list[Optional[float]]]:
    """Reihen auf das Raster legen; ``fill`` > 0 überbrückt so viele fehlende Zeitpunkte mit dem letzten Wert
    (Tage: unterschiedliche Feiertage der Börsen)."""
    out: dict[str, list[Optional[float]]] = {}
    for k, v in series.items():
        row: list[Optional[float]] = []
        last, gap = None, 0
        for w in keys:
            x = v.get(w)
            if x is not None:
                last, gap = x, 0
            elif last is not None and gap < fill:
                x, gap = last, gap + 1
            row.append(x)
        out[k] = row
    return out


def _asof(series: dict[str, float]):
    """Wert am oder vor einem Datum (Devisenkurse bei abweichenden Feiertagen)."""
    keys = sorted(series)
    vals = [series[k] for k in keys]

    def get(day: str) -> Optional[float]:
        i = bisect.bisect_right(keys, day) - 1
        return vals[i] if i >= 0 and (dt.date.fromisoformat(day) - dt.date.fromisoformat(keys[i])).days <= 7 else None

    return get


def _chain_mean(values: list[list[Optional[float]]], weights: Optional[list[float]] = None) -> list[Optional[float]]:
    """Index aus den Wochenveränderungen aller Reihen (gleich gewichtet im Logarithmus bzw. nach Gewicht);
    fehlende Werte lassen den Index nicht springen."""
    n = len(values[0]) if values else 0
    out: list[Optional[float]] = []
    level: Optional[float] = None
    for i in range(n):
        if level is None:
            if any(v[i] for v in values):
                level = 100.0
            out.append(level)
            continue
        acc = wsum = 0.0
        for j, v in enumerate(values):
            if v[i - 1] and v[i]:
                w = weights[j] if weights else 1.0
                acc += w * math.log(v[i] / v[i - 1])  # type: ignore[operator]
                wsum += w
        if wsum:
            level *= math.exp(acc / wsum)
        out.append(level)
    return out


class RotationService:
    def __init__(self, terminal: Any, valuation: ValuationService, factors: Any = None):
        self.t = terminal
        self.v = valuation
        self.f = factors  # FactorService (Kürzel der europäischen Faktor-ETFs)
        self._cache: dict[tuple, tuple[float, RotationResult]] = {}

    async def rotation(self, universe: str, region: str = "us", sector: Optional[str] = None, ccy: str = "eur",
                       bench: str = "basket", freq: str = "w") -> RotationResult:
        tk = DAILY if freq == "d" else WEEKLY
        key = (universe, region, sector, ccy, bench, tk.key, self.t.now().date().isoformat(), self.v.result.get("built_at") if self.v.result else None)
        hit = self._cache.get(key)
        # Tage: kürzer zwischenspeichern, der laufende Tag bewegt sich
        if hit and time.time() - hit[0] < (CACHE_SECONDS if tk.key == "w" else 300):
            return hit[1]
        if universe == "sectors":
            res = self._sectors(region, tk)
        elif universe == "sector":
            res = await self._sector_members(region, sector or "", tk)
        elif universe == "countries":
            res = await self._countries(ccy, tk)
        elif universe == "currencies":
            res = await self._currencies(bench, tk)
        elif universe == "crypto":
            res = await self._crypto(bench, tk)
        elif universe == "factors":
            res = await self._factors(region, tk)
        else:
            raise BadRequest(f"Unbekannter Bereich „{universe}“.")
        # Wochen tragen den Freitag als Schlüssel; die laufende Woche reicht aber nur bis heute – sonst stand
        # montags „bis 13.11.“ (ein Datum in der Zukunft) über dem Diagramm und im CSV
        today = self.t.now().date().isoformat()
        if res.weeks and res.weeks[-1] > today:
            res.weeks[-1] = today
        if res.state == "ready":
            if len(self._cache) > 100:
                self._cache.clear()
            self._cache[key] = (time.time(), res)
        return res

    # --- gemeinsame Rechnung -------------------------------------------------------------

    @staticmethod
    def _compute(universe: str, title: str, bench_label: str, weeks: list[str], bench: list[Optional[float]],
                 series: list[Series], skipped: Optional[list[str]] = None, tk: Takt = WEEKLY) -> RotationResult:
        lines = []
        members: list[RotMember] = []
        skipped = [] if skipped is None else skipped  # sonst gingen „zu wenig Verlauf“-Hinweise verloren (Sektoren, Firmen)
        hist = tk.history
        short, long_ = tk.horizons
        for s in series:
            rs, trend, mom = rrg_lines(s.values, bench, tk.smooth, tk.trend, tk.mom)
            if not any(x is not None for x in mom[-hist:]):
                skipped.append(f"{s.label} (zu wenig Verlauf)")
                continue
            lines.append((rs, trend, mom))
            i = len(rs) - 1
            hd, sp = heading(trend, mom, i)

            def rel(h: int) -> Optional[float]:
                return rs[i] / rs[i - h] - 1 if i - h >= 0 and rs[i] and rs[i - h] else None

            members.append(RotMember(
                key=s.key, label=s.label, ticker=s.ticker, trend=trend[-hist:], momentum=mom[-hist:],
                quadrant=quadrant(trend[i], mom[i]), heading=hd, speed=sp, rel4=rel(short), rel13=rel(long_),
                fair_gap=s.extra.get("fair_gap"), detail=s.extra.get("detail"),
            ))
        test = backtest(lines, tk.horizons)
        test["clockwiseShare"] = test.pop("clockwise_share")  # wie alle Felder für das Frontend in camelCase
        return RotationResult(universe=universe, title=title, benchmark=bench_label, weeks=weeks[-hist:], freq=tk.key,
                              periods=list(tk.horizons), members=members, test=test, skipped=skipped,
                              note=NOTE if tk.key == "w" else NOTE_DAILY)

    async def _histories(self, tickers: list[str], tk: Takt) -> dict[str, dict[str, float]]:
        """Schlusskurse je Woche bzw. je Tag."""
        sem = asyncio.Semaphore(6)
        conv = to_daily if tk.key == "d" else to_weekly

        async def one(t: str) -> tuple[str, Optional[dict[str, float]]]:
            async with sem:
                try:
                    h = await self.t.history(t)
                except TerminalError:
                    return t, None
            return t, conv(h.t, h.c)

        return {t: w for t, w in await asyncio.gather(*(one(t) for t in tickers)) if w}

    def _grid(self, sets: list[dict[str, float]], tk: Takt, weekends: bool = False) -> list[str]:
        """Zeitpunkte des Rasters; Tage ohne Wochenenden (außer Krypto, die rund um die Uhr handelt)."""
        cutoff = (self.t.now().date() - dt.timedelta(days=tk.days_back)).isoformat()
        keys = sorted({w for s in sets for w in s if w >= cutoff})
        if tk.key == "d" and not weekends:
            keys = [k for k in keys if dt.date.fromisoformat(k).weekday() < 5]
        return keys

    @staticmethod
    def _fill(tk: Takt) -> int:
        return 4 if tk.key == "d" else 0

    # --- Sektoren -------------------------------------------------------------------------

    def _sectors(self, region: str, tk: Takt = WEEKLY) -> RotationResult:
        r = self.v.result
        part = "daily" if tk.key == "d" else "weekly"
        if not r or part not in r:
            # ältere gespeicherte Berechnung ohne Tagesindizes: neu rechnen lassen
            self.v.ensure() if not r else self.v.ensure_part(part)
            return RotationResult(universe="sectors", title="Sektoren", benchmark="", weeks=[], members=[], test={}, state="building", freq=tk.key)
        weekly = r[part]
        bench = weekly["groups"].get(f"market:{region}")
        if not bench:
            raise NotFound("Für diese Region gibt es keine Sektordaten.")
        series = []
        for sector in SECTORS:
            gid = f"sector:{region}:{sector}"
            vals = weekly["groups"].get(gid)
            if vals:
                row = r["rows"].get(gid) or {}
                series.append(Series(key=sector, label=SECTOR_DE.get(sector, sector), values=vals,
                                     extra={"fair_gap": row.get("fair_gap"), "detail": f"{row.get('n', '?')} Firmen"}))
        reg = {"us": "USA", "eu": "Europa", "all": "USA + Europa"}[region]
        return self._compute("sectors", f"Sektoren · {reg}", f"Gesamtmarkt {reg} (alle Sektoren, gleiche Firmen)", weekly["t"], bench, series, tk=tk)

    async def _sector_members(self, region: str, sector: str, tk: Takt = WEEKLY) -> RotationResult:
        r = self.v.result
        if not r:
            self.v.ensure()
            return RotationResult(universe="sector", title=sector, benchmark="", weeks=[], members=[], test={}, state="building", freq=tk.key)
        det = r["details"].get(f"sector:{region}:{sector}") or r["details"].get(f"sector:all:{sector}")
        if not det:
            raise NotFound(f"Keine Firmen für den Sektor „{sector}“.")
        members = det["members"]
        weekly = await self._histories([m["ticker"] for m in members], tk)
        weeks = self._grid(list(weekly.values()), tk)
        aligned = _align(weekly, weeks, self._fill(tk))
        tickers = [m["ticker"] for m in members if m["ticker"] in aligned]
        # Sektorindex: Börsenwert-gewichtet aus denselben Kursen (gleiche Bereinigung wie die Firmen)
        weights = [next(m["mcap"] for m in members if m["ticker"] == t) for t in tickers]
        bench = _chain_mean([aligned[t] for t in tickers], weights)
        series = [
            Series(key=m["ticker"], label=m["name"], ticker=m["ticker"], values=aligned[m["ticker"]],
                   extra={"fair_gap": m.get("fair_gap"), "detail": display(m["ticker"])})
            for m in members if m["ticker"] in aligned
        ]
        label = SECTOR_DE.get(sector, sector)
        return self._compute("sector", f"Im Sektor {label}", f"Sektorindex {label} (Börsenwert-gewichtet)", weeks, bench, series, tk=tk)

    # --- Länder ---------------------------------------------------------------------------

    async def _usd_values(self, ccys: set[str], tk: Takt = WEEKLY) -> dict[str, dict[str, float]]:
        """Wert je Währungseinheit in US-Dollar, je Woche bzw. Tag (USD = 1)."""
        pairs = {c: FX_PAIRS.get(c, (f"USD{c}.FOREX", -1)) for c in ccys if c != "USD"}
        weekly = await self._histories(list({p for p, _ in pairs.values()}), tk)
        out: dict[str, dict[str, float]] = {}
        for c, (pair, sign) in pairs.items():
            w = weekly.get(pair)
            if w:
                out[c] = {k: (v if sign > 0 else 1 / v) for k, v in w.items() if v}
        return out

    async def _countries(self, ccy: str, tk: Takt = WEEKLY) -> RotationResult:
        entries = [(iso, name, ticker) for iso, name, _, ticker, _ in WORLD if ticker]
        weekly = await self._histories([t for _, _, t in entries], tk)
        skipped: list[str] = []
        if ccy == "eur":
            fx_raw = await self._usd_values({COUNTRY_CCY.get(iso, "USD") for iso, _, _ in entries} | {"EUR"}, tk)
            fx = {c: _asof(v) for c, v in fx_raw.items()}  # Kurs am oder vor dem Tag (abweichende Feiertage)
            eur = fx.get("EUR")
            converted: dict[str, dict[str, float]] = {}
            for iso, name, t in entries:
                c = COUNTRY_CCY.get(iso, "USD")
                w = weekly.get(t)
                if not w:
                    continue
                if c == "EUR":
                    converted[t] = w
                    continue
                rate = fx.get(c) if c != "USD" else None
                if (c != "USD" and rate is None) or eur is None:
                    skipped.append(f"{name} (kein Kurs für {c})")
                    continue
                conv: dict[str, float] = {}
                for k, v in w.items():
                    e, r_ = eur(k), (rate(k) if rate else 1.0)
                    if e and r_:
                        conv[k] = v * r_ / e
                converted[t] = conv
            weekly = converted
        weeks = self._grid(list(weekly.values()), tk)
        aligned = _align(weekly, weeks, self._fill(tk))
        names = {t: (iso, name) for iso, name, t in entries}
        tickers = list(aligned)
        bench = _chain_mean([aligned[t] for t in tickers])
        series = [Series(key=names[t][0], label=names[t][1], ticker=t, values=aligned[t], extra={"detail": display(t)}) for t in tickers]
        cur = "in Euro" if ccy == "eur" else "in Landeswährung"
        return self._compute("countries", f"Länderindizes {cur}", f"Durchschnitt aller Länder (gleich gewichtet, {cur})", weeks, bench, series, skipped, tk)

    # --- Währungen ------------------------------------------------------------------------

    async def _currencies(self, bench_mode: str, tk: Takt = WEEKLY) -> RotationResult:
        ccys = set(FX_PAIRS) | {"USD"}
        usd = await self._usd_values(ccys, tk)
        weeks = self._grid(list(usd.values()), tk)
        aligned = _align(usd, weeks, self._fill(tk))
        aligned["USD"] = [1.0] * len(weeks)
        skipped = [f"{CURRENCY_NAMES.get(c, c)} (keine Kurse)" for c in sorted(ccys - set(aligned))]
        order = [c for c in ("USD", "EUR", "GBP", "JPY", "CHF", "CNH", "AUD", "CAD", "NZD", "SEK", "NOK") if c in aligned]
        if bench_mode == "eur":
            if "EUR" not in aligned:
                raise NotFound("Keine Euro-Kurse verfügbar.")
            bench = aligned["EUR"]
            order = [c for c in order if c != "EUR"]
            bench_label = "Euro"
        else:
            bench = _chain_mean([aligned[c] for c in order])
            bench_label = "Währungskorb (alle gezeigten Währungen, gleich gewichtet)"
        series = [
            Series(key=c, label=f"{CURRENCY_NAMES.get(c, c)} ({c})", ticker=FX_PAIRS[c][0] if c in FX_PAIRS else "EURUSD.FOREX",
                   values=aligned[c], extra={"detail": c})
            for c in order
        ]
        return self._compute("currencies", "Währungen", bench_label, weeks, bench, series, skipped, tk)

    # --- Kryptowährungen ------------------------------------------------------------------

    async def _crypto(self, bench_mode: str, tk: Takt = WEEKLY) -> RotationResult:
        names = dict(COINS)
        weekly = await self._histories(list(names), tk)
        weeks = self._grid(list(weekly.values()), tk, weekends=True)
        aligned = _align(weekly, weeks, self._fill(tk))
        skipped = [f"{names[t]} (keine Kurse)" for t in names if t not in aligned]
        if bench_mode == "btc":
            if "BTC-USD.CC" not in aligned:
                raise NotFound("Keine Bitcoin-Kurse verfügbar.")
            bench = aligned["BTC-USD.CC"]
            members = [t for t in names if t in aligned and t != "BTC-USD.CC"]
            bench_label = "Bitcoin"
        else:
            members = [t for t in names if t in aligned]
            bench = _chain_mean([aligned[t] for t in members])
            bench_label = "Korb aller gezeigten Coins (gleich gewichtet)"
        series = [Series(key=t, label=names[t], ticker=t, values=aligned[t], extra={"detail": display(t)}) for t in members]
        return self._compute("crypto", "Kryptowährungen", bench_label, weeks, bench, series, skipped, tk)

    # --- Faktoren (Stil-ETFs) ---------------------------------------------------------------

    async def _factors(self, region: str, tk: Takt = WEEKLY) -> RotationResult:
        reg = FACTOR_REGIONS.get("eu" if region == "eu" else "us")
        assert reg is not None
        if self.f is not None:
            found, missing = await self.f.members(reg)  # gleiche Kürzelauflösung wie FCTR
        else:
            found, missing = [(f, f.ticker) for f in (reg.bench, *reg.factors)], []
        tick = {f.key: t for f, t in found}
        if "market" not in tick:
            raise NotFound(f"Für {reg.label} fehlt der Markt-ETF.")
        weekly = await self._histories(list(tick.values()), tk)
        weeks = self._grid(list(weekly.values()), tk)
        aligned = _align(weekly, weeks, self._fill(tk))
        if tick["market"] not in aligned:
            raise NotFound(f"Keine Kurse für den Markt-ETF {reg.bench.name}.")
        skipped = list(missing) + [f"{f.label} (keine Kurse)" for f, t in found if t not in aligned]
        series = [
            Series(key=f.key, label=f.label, ticker=tick[f.key], values=aligned[tick[f.key]],
                   extra={"detail": f"{display(tick[f.key])} · {FACTOR_HELP.get(f.key, '')}"})
            for f in reg.factors if f.key in tick and tick[f.key] in aligned
        ]
        return self._compute("factors", f"Faktoren · {reg.label}", reg.bench.label, weeks, aligned[tick["market"]], series, skipped, tk)
