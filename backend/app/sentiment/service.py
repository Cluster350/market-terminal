"""Stimmungsterminal (STIM): Wie ängstlich oder sorglos ist der Markt – gemessen an seiner eigenen Geschichte?

Jeder Baustein wird mit allen früheren Tagen seit 2015 verglichen (Rang 0–100, hoch = sorglos); der Gesamtwert ist das
gleich gewichtete Mittel der Bausteine der Region. Keine Ersatzgrößen: Was es nur für die USA gibt (VIX, Put/Call,
Risikoaufschlag), fehlt in Europa sichtbar („nur USA“) statt durch etwas Ähnliches vertreten zu werden.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from ..errors import BadRequest, TerminalError
from ..models import Model
from ..valuation.service import SECTOR_DE, SECTORS
from . import calc as C

log = logging.getLogger("terminal.sentiment")

SINCE = dt.date(2015, 1, 1)
CACHE_SECONDS = 1800
SERIES_DAYS = 504  # Bausteine und Marktbreite im Verlauf: gut zwei Jahre
HEAT_WEEKS = 26
NEWS_FIRMS = 30
PC_TICKERS = ("SPY.US", "QQQ.US")

NOTE = ("Jeder Baustein wird mit allen früheren Tagen seit {since} verglichen (nur Vergangenheit, kein Blick in die Zukunft): "
        "Rang 0 = so ängstlich wie fast nie, 100 = so sorglos wie fast nie. Der Gesamtwert ordnet das Mittel der Bausteine "
        "ebenso gegen seine eigene Geschichte ein.")


@dataclass(frozen=True)
class Region:
    key: str
    label: str
    equity: str  # Aktien-ETF der Region (Index für Kurs und Rückblick)
    equity_label: str
    bond: str  # Staatsanleihen-ETF der Region
    vix: Optional[str] = None
    high_yield: Optional[str] = None


REGIONS = {
    "us": Region("us", "USA", "SPY.US", "S&P 500 (SPY)", "IEF.US", "VIX.INDX", "HYG.US"),
    "eu": Region("eu", "Europa", "EXSA.XETRA", "Stoxx Europe 600 (EXSA)", "EUNH.XETRA"),
}


@dataclass(frozen=True)
class Comp:
    key: str
    label: str
    unit: str  # pct | pp | num | ratio | tone
    invert: bool  # hoher Wert = Angst
    us_only: bool = False
    approx: bool = False
    explain: str = ""


COMPS = [
    Comp("vix", "VIX", "num", True, us_only=True,
         explain="Erwartete Schwankung des S&P 500 für die nächsten 30 Tage aus Optionspreisen. Hoch = Angst."),
    Comp("vola", "ø Volatilität", "pct", True,
         explain="Durchschnittliche Tagesschwankung der Firmen der Region über die letzten 20 Tage. Hoch = Unruhe."),
    Comp("breite", "Marktbreite", "pct", False,
         explain="Anteil der Firmen, deren Kurs über dem eigenen 200-Tage-Schnitt liegt. Viele = breite Zuversicht."),
    Comp("hochtief", "Hochs/Tiefs", "pp", False,
         explain="Firmen auf 52-Wochen-Hoch minus Firmen auf 52-Wochen-Tief, in % aller Firmen, 10-Tage-Schnitt."),
    Comp("trust", "Trust", "pct", False,
         explain="Anteil der Firmen, die am Tag gestiegen sind, als 10-Tage-Schnitt."),
    Comp("haefen", "Sichere Häfen", "pp", False,
         explain="Aktien der Region gegen Staatsanleihen der Region über 20 Tage (Unterschied in Prozentpunkten). "
                 "Laufen Anleihen besser, flüchten Anleger in Sicherheit."),
    Comp("putcall", "Put/Call", "ratio", True, us_only=True, approx=True,
         explain="Umsatz in Puts geteilt durch Umsatz in Calls auf S&P 500 und Nasdaq 100 (SPY, QQQ), 10-Tage-Schnitt. "
                 "Viele Puts = Absicherung, Angst. Näherung, nicht die offizielle Zahl der CBOE."),
    Comp("risiko", "Risikoaufschlag", "pp", False, us_only=True, approx=True,
         explain="Hochzinsanleihen (HYG) gegen Staatsanleihen (IEF) über 20 Tage. Bleiben Hochzinsanleihen zurück, "
                 "verlangen Anleger mehr Aufschlag – Angst. Näherung über ETF-Kurse, nicht der offizielle Spread."),
    Comp("news", "Nachrichtenton", "tone", False,
         explain=f"Ton der Nachrichten über die (bis zu) {NEWS_FIRMS} größten Firmen der Region (−1 negativ … +1 positiv, "
                 "nach Börsenwert gewichtet), 10-Tage-Schnitt."),
]
TREND = Comp("trend", "Trend", "pct", False,
             explain="Abstand des Index zu seinem 125-Tage-Schnitt. Nur zum Vergleich – zählt nicht zum Gesamtwert, "
                     "weil ein starker Trend eher weiterläuft als umkehrt.")
APPROX_NOTE = "Näherung, nicht die offizielle Zahl"


class SentComponent(Model):
    key: str
    label: str
    unit: str
    explain: str
    approx: bool = False
    in_total: bool = True
    available: bool = True
    note: Optional[str] = None  # „nur USA“, „sammelt noch …“
    value: Optional[float] = None
    value_1w: Optional[float] = None
    rank: Optional[float] = None
    rank_1w: Optional[float] = None
    sentence: Optional[str] = None
    ranks: list[Optional[float]] = []  # Verlauf der letzten Tage (dates[-len(ranks):])
    values: list[Optional[float]] = []


class SentTotal(Model):
    value: Optional[float] = None  # Rang des Bausteine-Mittels gegen dessen eigene Geschichte (0–100)
    mean: Optional[float] = None  # Mittel der Bausteine-Ränge (ballt sich um 50, deshalb selbst noch eingeordnet)
    word: str = "keine Einordnung"
    sentence: str = ""
    w1: Optional[float] = None
    m1: Optional[float] = None
    y1: Optional[float] = None
    low12: Optional[float] = None
    high12: Optional[float] = None
    n: int = 0
    n_total: int = 0


class SentimentResult(Model):
    region: str
    label: str
    state: str = "ready"  # ready | building
    as_of: Optional[str] = None
    since: str = ""
    firms: int = 0
    index_label: str = ""
    total: SentTotal = SentTotal()
    lage: str = ""
    components: list[SentComponent] = []
    trend: Optional[SentComponent] = None
    dates: list[str] = []  # ganzer Verlauf (Gesamtwert, Index)
    total_series: list[Optional[float]] = []
    index_series: list[Optional[float]] = []
    breadth: dict[str, list[Optional[float]]] = {}  # letzte SERIES_DAYS Tage: adl, breadthVol, trin, pct200, nhnl, trust
    heatmap: dict[str, Any] = {}  # weeks, rows[{sector,label,values}]
    backtest: dict[str, Any] = {}
    note: str = ""
    message: Optional[str] = None


def _closes(h: Any, since: str) -> dict[str, float]:
    return {d[:10]: c for d, c in zip(h.t, h.c) if c is not None and d[:10] >= since}


def _vols(h: Any, since: str) -> dict[str, float]:
    return {d[:10]: float(v) for d, v in zip(h.t, h.v) if v is not None and d[:10] >= since}


def _round(xs: Optional[list], digits: int) -> list[Optional[float]]:
    return [None if x is None else round(x, digits) for x in (xs or [])]


def _last(xs: list[Optional[float]], back: int = 0) -> Optional[float]:
    """Letzter Wert (back Tage davor); fehlt der heutige Wert, zählt der jüngste der letzten 5 Tage."""
    n = len(xs) - 1 - back
    for i in range(n, max(-1, n - 5), -1):
        if 0 <= i < len(xs) and xs[i] is not None:
            return xs[i]
    return None


INVERTED = {c.key for c in COMPS if c.invert}


def raw_pct(rank: Optional[float], invert: bool) -> Optional[float]:
    """Rang zurück in „Wert höher als an x % der Tage“ (bei Angst-Bausteinen ist der Rang umgedreht)."""
    return None if rank is None else (100 - rank if invert else rank)


def describe(key: str, v: float) -> str:
    """Ein Baustein in Worten (für die Lage-Zeile)."""
    pct = lambda x: f"{x:.0f}".replace(".", ",")  # noqa: E731
    one = lambda x: f"{x:+.1f}".replace(".", ",").replace("-", "−")  # noqa: E731
    return {
        "vix": f"der VIX steht bei {v:.1f}".replace(".", ","),
        "vola": f"die Firmen schwanken im Schnitt um {v:.1f} % am Tag".replace(".", ","),
        "breite": f"{pct(v)} % der Firmen liegen über ihrem 200-Tage-Schnitt",
        "hochtief": f"Hochs minus Tiefs: {one(v)} % der Firmen",
        "trust": f"zuletzt stiegen im Schnitt {pct(v)} % der Firmen am Tag",
        "haefen": f"Aktien gegen Staatsanleihen über 20 Tage: {one(v)} Prozentpunkte",
        "putcall": f"Put/Call ≈ {v:.2f}".replace(".", ","),
        "risiko": f"Hochzins- gegen Staatsanleihen über 20 Tage: {one(v)} Prozentpunkte",
        "news": f"der Nachrichtenton liegt bei {v:+.2f}".replace(".", ",").replace("-", "−"),
    }.get(key, "")


def lage(word: str, comps: list[SentComponent]) -> str:
    ranked = [c for c in comps if c.in_total and c.rank is not None and c.value is not None]
    if not ranked:
        return "Noch zu wenig Verlauf für eine Einordnung."
    extreme = max(ranked, key=lambda c: abs(c.rank - 50))  # type: ignore[operator]
    fear = sum(1 for c in ranked if c.rank < 40)  # type: ignore[operator]
    greed = sum(1 for c in ranked if c.rank > 60)  # type: ignore[operator]
    calm = len(ranked) - fear - greed
    parts = [f"Die Stimmung ist {word}." if word != "gewöhnlich" else "Die Stimmung liegt im gewöhnlichen Bereich."]
    where = C.rank_sentence(raw_pct(extreme.rank, extreme.key in INVERTED), "").rsplit(" seit", 1)[0]
    parts.append(f"Am deutlichsten: {describe(extreme.key, extreme.value)} ({where}).")  # type: ignore[arg-type]
    counts = []
    verb = lambda k, one, many: one if k == 1 else many  # noqa: E731
    if fear:
        counts.append(f"{fear} von {len(ranked)} Bausteinen {verb(fear, 'zeigt', 'zeigen')} Vorsicht")
    if greed:
        counts.append(f"{greed}{'' if fear else f' von {len(ranked)} Bausteinen'} {verb(greed, 'zeigt', 'zeigen')} Zuversicht")
    if calm:
        counts.append(f"{calm} {verb(calm, 'liegt', 'liegen')} im gewöhnlichen Bereich")
    parts.append(", ".join(counts) + ".")
    return " ".join(parts)


class SentimentService:
    def __init__(self, terminal: Any, valuation: Any, data_dir: Optional[Path] = None, mode: str = "demo"):
        self.t = terminal
        self.v = valuation
        self.mode = mode
        self.dir = Path(data_dir) / "stimmung" if data_dir else None
        self._cache: dict[tuple, tuple[float, SentimentResult]] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    # --- Put/Call: tägliche Aufzeichnung (EODHD liefert nur die Kette von heute) -------------

    def _pc_path(self) -> Optional[Path]:
        return self.dir / "putcall.json" if self.dir else None

    def _pc_load(self) -> dict[str, float]:
        p = self._pc_path()
        if not p or not p.is_file():
            return {}
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            return {str(k)[:10]: float(v) for k, v in data.items() if isinstance(v, (int, float)) and 0 < v < 10}
        except (OSError, ValueError, AttributeError):
            return {}

    def _pc_save(self, hist: dict[str, float]) -> None:
        p = self._pc_path()
        if not p:
            return
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_suffix(".tmp")
            tmp.write_text(json.dumps(dict(sorted(hist.items())), indent=0), encoding="utf-8")
            tmp.replace(p)
        except OSError as e:
            log.warning("Put/Call: Aufzeichnung nicht gespeichert (%s)", e)

    async def _putcall_today(self) -> Optional[float]:
        puts = calls = 0.0
        for t in PC_TICKERS:
            try:
                chain = await self.t.options(t)
            except TerminalError:
                continue
            for o in chain:
                vol = float(o.volume or 0)
                if o.type == "put":
                    puts += vol
                elif o.type == "call":
                    calls += vol
        return puts / calls if calls > 0 and puts > 0 else None

    def _pc_demo(self, dates: list[str], vix: list[Optional[float]]) -> dict[str, float]:
        """Demo: fiktiver Put/Call-Verlauf, der mit dem VIX steigt (fest je Tag)."""
        import random

        rng = random.Random("putcall-demo")
        out: dict[str, float] = {}
        x = 0.0
        for d, v in zip(dates, vix):
            x = 0.7 * x + 0.08 * rng.gauss(0, 1)
            if v is not None:
                out[d] = max(0.4, 0.62 + 0.018 * (v - 15) + x)
        return out

    async def _putcall(self, dates: list[str], vix: list[Optional[float]]) -> tuple[dict[str, float], Optional[str]]:
        if self.mode == "demo":
            return self._pc_demo(dates, vix), None
        hist = self._pc_load()
        # Aufzeichnen erst nach US-Börsenschluss (16 Uhr New York, spätestens 21 Uhr UTC) und nur an einem
        # Handelstag mit Kurs: Schlüssel ist dieser Handelstag – nicht das Datum des Abrufs (morgens in Europa
        # stammte das Volumen sonst vom Vortag), und Feiertage zählen nicht mit
        now = self.t.now().astimezone(dt.timezone.utc)
        today = now.date().isoformat()
        if dates and dates[-1] == today and now.hour >= 21:
            pc = await self._putcall_today()
            if pc is not None:
                hist[today] = round(pc, 4)
                self._pc_save(hist)
        n = len(hist)
        note = None if n >= C.MIN_HISTORY else f"sammelt noch: {n} von {C.MIN_HISTORY} Tagen aufgezeichnet"
        return hist, note

    # --- Abruf --------------------------------------------------------------------------

    async def stimmung(self, region: str = "us") -> SentimentResult:
        reg = REGIONS.get(region)
        if reg is None:
            raise BadRequest(f"Unbekannte Region „{region}“ – USA (us) oder Europa (eu).")
        r = self.v.result if self.v is not None else None
        if not r:
            if self.v is not None:
                self.v.ensure()
            return SentimentResult(region=reg.key, label=reg.label, state="building",
                                   message="Die Firmenliste (aus BWT) wird noch aufgebaut – das dauert beim ersten Start einige Minuten.")
        key = (reg.key, self.t.now().date().isoformat(), r.get("built_at"))
        hit = self._cache.get(key)
        if hit and time.time() - hit[0] < CACHE_SECONDS:
            return hit[1]
        lock = self._locks.setdefault(reg.key, asyncio.Lock())
        async with lock:
            hit = self._cache.get(key)
            if hit and time.time() - hit[0] < CACHE_SECONDS:
                return hit[1]
            res = await self._build(reg, r)
            if len(self._cache) > 20:
                self._cache.clear()
            self._cache[key] = (time.time(), res)
            return res

    def _members(self, r: dict, region: str) -> list[dict]:
        out: list[dict] = []
        seen: set[str] = set()
        for sector in SECTORS:
            det = r.get("details", {}).get(f"sector:{region}:{sector}")
            for m in (det or {}).get("members", []):
                if m.get("ticker") and m["ticker"] not in seen:
                    seen.add(m["ticker"])
                    out.append({"ticker": m["ticker"], "name": m.get("name") or m["ticker"], "mcap": float(m.get("mcap") or 0), "sector": sector})
        return out

    async def _build(self, reg: Region, r: dict) -> SentimentResult:
        members = self._members(r, reg.key)
        since = SINCE.isoformat()
        sem = asyncio.Semaphore(8)

        async def hist(t: str) -> tuple[str, Any]:
            async with sem:
                try:
                    return t, await self.t.history(t)
                except TerminalError:
                    return t, None

        extra = [x for x in (reg.equity, reg.bond, reg.vix, reg.high_yield) if x]
        got = dict(await asyncio.gather(*(hist(t) for t in extra + [m["ticker"] for m in members])))
        eq = got.get(reg.equity)
        if eq is None:
            raise TerminalError(f"Keine Kurse für {reg.equity_label}.")
        eq_c = _closes(eq, since)
        dates = sorted(d for d in eq_c if dt.date.fromisoformat(d).weekday() < 5)
        if len(dates) < 30:
            raise TerminalError(f"Zu wenig Kursverlauf für {reg.equity_label}.")
        top = sorted(members, key=lambda m: -m["mcap"])[:NEWS_FIRMS]
        try:
            tone = await self.t.sentiments([m["ticker"] for m in top], dt.date.fromisoformat(dates[0]))
        except TerminalError as e:
            log.info("Nachrichtenton nicht verfügbar: %s", e)
            tone = {}
        vix_c = C.align(dates, _closes(got[reg.vix], since)) if reg.vix and got.get(reg.vix) else None
        pc_hist, pc_note = (await self._putcall(dates, vix_c or [None] * len(dates))) if reg.key == "us" else ({}, None)
        return await asyncio.to_thread(self._compute, reg, dates, got, members, top, tone, vix_c, pc_hist, pc_note)

    # --- Rechnung (im Hintergrund-Thread) -------------------------------------------------

    def _compute(self, reg: Region, dates: list[str], got: dict, members: list[dict], top: list[dict],
                 tone: dict, vix_c: Optional[list], pc_hist: dict[str, float], pc_note: Optional[str]) -> SentimentResult:
        since = SINCE.isoformat()
        n = len(dates)
        idx = C.align(dates, _closes(got[reg.equity], since))
        firms = []
        for m in members:
            h = got.get(m["ticker"])
            if h is None:
                continue
            c = C.align(dates, _closes(h, since))
            if sum(1 for x in c if x is not None) < 60:
                continue
            firms.append((m["sector"], c, C.align(dates, _vols(h, since), ffill=0)))
        b = C.breadth(n, [(s, c, [x or 0.0 for x in v]) for s, c, v in firms])

        raw: dict[str, Optional[list]] = {}
        raw["vix"] = vix_c
        raw["vola"] = C.ratio(b.vol_sum, b.n_vol, 1.0, min_den=10)
        pct200 = C.ratio(b.above200, b.n200, min_den=10)
        raw["breite"] = pct200
        nhnl_day = [((hi - lo) / k * 100 if k >= 10 else None) for hi, lo, k in zip(b.highs, b.lows, b.n252)]
        raw["hochtief"] = C.sma(nhnl_day, 10, 7)
        adv_share = [(a / (a + d) * 100 if a + d >= 10 else None) for a, d in zip(b.adv, b.dec)]
        raw["trust"] = C.sma(adv_share, 10, 7)
        bond = C.align(dates, _closes(got[reg.bond], since)) if got.get(reg.bond) else None
        raw["haefen"] = [(a - c_ if a is not None and c_ is not None else None) for a, c_ in zip(C.change(idx, 20), C.change(bond, 20))] if bond else None
        if reg.key == "us":
            pc = C.align(dates, pc_hist, ffill=3) if pc_hist else None
            raw["putcall"] = C.sma(pc, 10, 5) if pc else None
            hy = C.align(dates, _closes(got[reg.high_yield], since)) if reg.high_yield and got.get(reg.high_yield) else None
            ief = C.align(dates, _closes(got["IEF.US"], since)) if got.get("IEF.US") else None
            raw["risiko"] = [(a - c_ if a is not None and c_ is not None else None) for a, c_ in zip(C.change(hy, 20), C.change(ief, 20))] if hy and ief else None
        raw["news"] = self._tone(dates, top, tone)

        comps: list[SentComponent] = []
        ranks: dict[str, list] = {}
        start_year = dates[0][:4]
        for comp in COMPS:
            if comp.us_only and reg.key != "us":
                comps.append(SentComponent(key=comp.key, label=comp.label, unit=comp.unit, explain=comp.explain, approx=comp.approx,
                                           in_total=False, available=False, note="nur USA"))
                continue
            series = raw.get(comp.key)
            if not series or not any(x is not None for x in series):
                comps.append(SentComponent(key=comp.key, label=comp.label, unit=comp.unit, explain=comp.explain, approx=comp.approx,
                                           in_total=False, available=False, note="keine Daten"))
                continue
            rk = C.expanding_rank(series, invert=comp.invert)
            ranks[comp.key] = rk
            note = APPROX_NOTE if comp.approx else None
            if comp.key == "putcall" and pc_note:
                note = pc_note
            cur = _last(rk)
            comps.append(SentComponent(
                key=comp.key, label=comp.label, unit=comp.unit, explain=comp.explain, approx=comp.approx, note=note,
                value=_last(series), value_1w=_last(series, 5), rank=cur, rank_1w=_last(rk, 5),
                sentence=C.rank_sentence(raw_pct(cur, comp.invert), start_year),
                ranks=_round(rk[-SERIES_DAYS:], 1), values=_round(series[-SERIES_DAYS:], 4),
            ))
        keys = [c.key for c in comps if c.available and c.in_total]
        # Das Mittel mehrerer Ränge ballt sich um 50 (Extreme heben sich auf). Damit „an X von 100 Tagen“, die
        # Wortstufen und die Fünftel im Rückblick stimmen, wird das Mittel selbst gegen seine Geschichte eingeordnet.
        mean, count = C.combine(ranks, keys)
        total = C.expanding_rank(mean)
        tv = _last(total)

        trend_raw = [(x / s - 1) * 100 if x is not None and s else None for x, s in zip(idx, C.sma(idx, 125))]
        trend_rank = C.expanding_rank(trend_raw)
        trend = SentComponent(key=TREND.key, label=TREND.label, unit=TREND.unit, explain=TREND.explain, in_total=False,
                              value=_last(trend_raw), value_1w=_last(trend_raw, 5), rank=_last(trend_rank), rank_1w=_last(trend_rank, 5),
                              ranks=_round(trend_rank[-SERIES_DAYS:], 1), values=_round(trend_raw[-SERIES_DAYS:], 3))

        last12 = [x for x in total[-252:] if x is not None]
        word = C.word(tv)
        tot = SentTotal(value=tv, mean=_last(mean), word=word,
                        sentence=(f"Sorgloser als an {round(tv)} von 100 Tagen seit {start_year}" if tv is not None else "Noch zu wenig Verlauf für einen Gesamtwert."),
                        w1=_last(total, 5), m1=_last(total, 21), y1=_last(total, 252),
                        low12=min(last12) if last12 else None, high12=max(last12) if last12 else None,
                        n=count[-1] if count else 0, n_total=len(keys))

        # Marktbreite im Detail (nicht im Gesamtwert)
        adl, acc = [], 0.0
        for a, d in zip(b.adv, b.dec):
            acc += a - d
            adl.append(acc)
        bvol = [(u / (u + dn) * 100 if u + dn > 0 else None) for u, dn in zip(b.upvol, b.downvol)]
        k = SERIES_DAYS
        breadth = {"adl": _round(adl[-k:], 0), "breadthVol": _round(C.sma(bvol, 10, 7)[-k:], 2),
                   "trin": _round(C.sma(C.trin(b), 10, 7)[-k:], 3), "pct200": _round(pct200[-k:], 2),
                   "nhnl": _round(raw["hochtief"][-k:], 2), "trust": _round(raw["trust"][-k:], 2)}  # type: ignore[index]

        res = SentimentResult(
            region=reg.key, label=reg.label, as_of=dates[-1], since=start_year, firms=len(firms), index_label=reg.equity_label,
            total=tot, lage=lage(word, comps), components=comps, trend=trend, dates=dates, total_series=_round(total, 1),
            index_series=_round(idx, 4), breadth=breadth, heatmap=self._heat(dates, b), backtest=C.backtest(total, idx, tv),
            note=NOTE.format(since=start_year),
        )
        return res

    @staticmethod
    def _tone(dates: list[str], top: list[dict], tone: dict) -> Optional[list]:
        """Nachrichtenton je Tag: nach Börsenwert gewichtetes Mittel über die Firmen mit Artikeln (mind. 3 Firmen),
        dann 10-Tage-Schnitt."""
        if not tone:
            return None
        w = {m["ticker"]: max(m["mcap"], 1.0) for m in top}
        day: list[Optional[float]] = []
        for d in dates:
            acc = wsum = 0.0
            k = 0
            for t, rows in tone.items():
                hit = rows.get(d)
                if hit:
                    acc += w.get(t, 1.0) * hit[0]
                    wsum += w.get(t, 1.0)
                    k += 1
            day.append(acc / wsum if k >= 3 and wsum else None)
        out = C.sma(day, 10, 5)
        return out if any(x is not None for x in out) else None

    @staticmethod
    def _heat(dates: list[str], b: C.Breadth) -> dict[str, Any]:
        """Wärmebild: Anteil über dem 200-Tage-Schnitt je Sektor, letzter Handelstag jeder Woche."""
        ends: list[int] = []
        for i, d in enumerate(dates):
            if i == len(dates) - 1 or dt.date.fromisoformat(dates[i + 1]).isocalendar()[:2] != dt.date.fromisoformat(d).isocalendar()[:2]:
                ends.append(i)
        ends = ends[-HEAT_WEEKS:]
        rows = []
        for sector in SECTORS:
            if sector not in b.sectors:
                continue
            above, total = b.sectors[sector]
            vals = [(round(above[i] / total[i] * 100, 1) if total[i] >= 3 else None) for i in ends]
            if any(v is not None for v in vals):
                rows.append({"sector": sector, "label": SECTOR_DE.get(sector, sector), "n": max(total[i] for i in ends), "values": vals})
        return {"weeks": [dates[i] for i in ends], "rows": rows}

    # Für ASK/Notebook: kurze Zusammenfassung
    async def summary(self, region: str = "us") -> dict[str, Any]:
        res = await self.stimmung(region)
        return {"region": res.label, "state": res.state, "asOf": res.as_of, "total": res.total.value, "word": res.total.word,
                "lage": res.lage, "components": [{"label": c.label + (" ≈" if c.approx else ""), "value": c.value, "rank": c.rank,
                                                   "inTotal": c.in_total, "note": c.note} for c in res.components]}

