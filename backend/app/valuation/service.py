"""Bewertungstrend-Dienst: wählt je Sektor (USA, Europa) und Land die größten Firmen, lädt deren
Gewinne, Schätzungen und Kurse im Hintergrund, rechnet die Gruppen-KGVs und zeichnet sie täglich auf.

Abrufe (EODHD): je Firma einmal Fundamentaldaten, Kursverlauf und Dividenden – etwa 600 Firmen, einmal
täglich; das Ergebnis wird im Benutzerordner gespeichert, damit ein Neustart nicht neu rechnet.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Any, Optional

from ..errors import NotFound, TerminalError
from ..models import ScreenRow
from ..providers.base import ScreenFilter
from .bands import Bands
from .calc import LAGS, CompanyVal, GroupVal, aggregate, chain_index, company_bands, company_val, sector_relative
from .models import ValBands, ValDetail, ValMember, ValOverview, ValRow, ValSectorRel, ValSeries

log = logging.getLogger("terminal.valuation")

SECTORS = [
    "Technology", "Communication Services", "Consumer Cyclical", "Consumer Defensive", "Energy", "Financial Services",
    "Healthcare", "Industrials", "Basic Materials", "Real Estate", "Utilities",
]
SECTOR_DE = {
    "Technology": "Technologie", "Healthcare": "Gesundheit", "Financial Services": "Finanzen",
    "Consumer Cyclical": "Zyklischer Konsum", "Consumer Defensive": "Basiskonsum", "Energy": "Energie",
    "Utilities": "Versorger", "Industrials": "Industrie", "Communication Services": "Kommunikation",
    "Basic Materials": "Grundstoffe", "Real Estate": "Immobilien",
}
# Börse -> (Land, Region)
EXCHANGE_COUNTRY = {
    "US": ("USA", "Nordamerika"), "XETRA": ("Deutschland", "Europa"), "LSE": ("Großbritannien", "Europa"),
    "PA": ("Frankreich", "Europa"), "AS": ("Niederlande", "Europa"), "SW": ("Schweiz", "Europa"),
    "MI": ("Italien", "Europa"), "MC": ("Spanien", "Europa"),
}
REGIONS = ("all", "us", "eu")
YEARS_BACK = 5
NOTE = (
    "KGV einer Gruppe = Börsenwert aller Firmen ÷ ihr Gesamtgewinn (Verluste mindern den Gewinn). Frühere Jahre: "
    "Kurs am Jahresende ÷ tatsächlicher Gewinn; laufendes und nächstes Jahr: heutiger Kurs ÷ Analystenkonsens. "
    "Geschäftsjahre auf Kalenderjahre umgerechnet. Heutige Zusammensetzung und Aktienzahl – die Vergangenheit "
    "ist daher leicht geschönt (heutige Gewinner sind stärker vertreten)."
)


# Länderkürzel am Anfang der ISIN je Börse (Heimatbörse einer Aktie)
HOME_ISIN = {"US": "US", "XETRA": "DE", "LSE": "GB", "PA": "FR", "AS": "NL", "SW": "CH", "MI": "IT", "MC": "ES"}
US_NAMES = ("USA", "United States", "United States of America")


def listing_exclusions(listings: dict[str, tuple[Optional[str], Optional[str], float]]) -> set[str]:
    """Doppelt erfasste Aktien aussortieren. ``listings``: Ticker -> (ISIN, Sitzland, Ø Handelsvolumen).

    - ADRs an US-Börsen (US-ISIN, aber Sitz im Ausland, z. B. TSMC, Novo Nordisk): gehören nicht zu „USA“
      und würden die Firma sonst doppelt zählen. Firmen mit Sitz z. B. in Irland, die ihre eigentlichen Aktien
      in New York handeln (Accenture, Medtronic, Linde), haben eine irische ISIN und bleiben.
    - Dieselbe Aktie an mehreren Börsen (gleiche ISIN, z. B. Airbus in Paris und auf Xetra): nur die
      Heimatbörse laut ISIN zählt, sonst die Börse mit dem größten Handelsvolumen.
    """
    out: set[str] = set()
    by_isin: dict[str, list[str]] = {}
    for ticker, (isin, domicile, _) in listings.items():
        exchange = ticker.rpartition(".")[2].upper()
        if exchange == "US" and isin and isin.startswith("US") and domicile and domicile not in US_NAMES:
            out.add(ticker)
            continue
        if isin:
            by_isin.setdefault(isin, []).append(ticker)
    for isin, tickers in by_isin.items():
        if len(tickers) < 2:
            continue
        home = [t for t in tickers if HOME_ISIN.get(t.rpartition(".")[2].upper()) == isin[:2]]
        keep = home[0] if home else max(tickers, key=lambda t: listings[t][2] or 0)
        out.update(t for t in tickers if t != keep)
    return out


def _state(dist52: Optional[float]) -> str:
    if dist52 is None:
        return "nahe"
    return "baer" if dist52 <= -0.2 else "korrektur" if dist52 <= -0.1 else "nahe"


def _member(c: CompanyVal, today: dt.date, years: list[int]) -> ValMember:
    y0 = today.year
    pe: dict[str, Optional[float]] = {}
    for y in years:
        e = c.eps_cy.get(y)
        p = c.year_end(y) if y < y0 else c.price_now
        pe[str(y)] = p / (c.k * e) if e and p and e > 0 else None
    ttm = c.ttm(today)
    est = c.est_cy.get(y0 + 1, {})
    rev90 = est[0] / est[90] - 1 if 0 in est and est.get(90) and est[90] > 0 and est[0] > 0 else None
    start = (today - dt.timedelta(days=365)).isoformat()
    year = [p for d, p in zip(c.dates, c.closes) if d >= start]
    dist = c.price_now / max(year) - 1 if year and max(year) > 0 else None
    b = company_bands(c, today)
    return ValMember(ticker=c.ticker, name=c.name, mcap=c.mcap, pe_years=pe,
                     pe_ttm=c.price_now / (c.k * ttm) if ttm and ttm > 0 else None, rev90=rev90, dist52=dist,
                     median=b.pct["p50"] if b else None, fair_gap=b.fair_gap if b else None, notes=c.notes)


def bands_model(b: Optional[Bands], **extra: Any) -> Optional[ValBands]:
    if b is None:
        return None
    return ValBands(t=b.t, pe=b.pe, level=b.level, lines=b.lines, future_t=b.future_t, future=b.future, pct=b.pct,
                    pe_now=b.pe_now, position=b.position, fair_now=b.fair_now, fair_next=b.fair_next, fair_year=b.fair_year,
                    fair_gap=b.fair_gap, test=b.test, **extra)


def _dump(m: Optional[ValBands]) -> Optional[dict]:
    return m.model_dump() if m is not None else None


BANDS_NOTE = (
    "Bänder aus dem eigenen KGV-Verlauf (Monatswerte, Gewinn der letzten zwölf Monate): Median und die Bereiche "
    "25–75 % und 10–90 %. Rechts: Kurs beim jeweiligen KGV auf den geschätzten Gewinn (Analystenkonsens). "
    "Fair Value = übliches KGV (Median) × Gewinnschätzung – keine Empfehlung; ein dauerhaft geändertes Geschäft "
    "oder Zinsumfeld macht die Geschichte zum schlechten Maßstab."
)


class ValuationService:
    def __init__(self, terminal: Any, data_dir: str, mode: str, per_group: int = 25, per_country: int = 30,
                 refresh_hours: Optional[float] = None, prices_adjusted: Optional[bool] = None):
        self.t = terminal
        self.mode = mode
        self.per_group = per_group
        self.per_country = per_country
        self.refresh = (refresh_hours or (24.0 if mode == "eodhd" else 6.0)) * 3600
        self.prices_adjusted = prices_adjusted if prices_adjusted is not None else getattr(terminal.p, "prices_dividend_adjusted", mode == "eodhd")
        self.path = Path(data_dir) / f"bewertung-{mode}.json"
        self.hist_path = Path(data_dir) / f"bewertung-verlauf-{mode}.json"
        self.state = "idle"
        self.done = 0
        self.total = 0
        self.message: Optional[str] = None
        self.result: Optional[dict] = None
        self._task: Optional[asyncio.Task] = None
        self._building: Optional[asyncio.Task] = None
        self._bands_cache: dict[tuple[str, str], ValBands] = {}
        self._load()  # gespeichertes Ergebnis sofort verfügbar (Neustart ohne Neuberechnung)

    # --- Lebenszyklus ---------------------------------------------------------------------

    def start(self) -> None:
        self._task = asyncio.create_task(self._loop())

    async def close(self) -> None:
        for task in (self._task, self._building):
            if task:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):  # noqa: BLE001
                    pass

    async def _loop(self) -> None:
        await asyncio.sleep(2 if self.mode == "demo" else 20)  # Start des Terminals nicht ausbremsen
        while True:
            if not self._fresh():
                await self.build()
            await asyncio.sleep(min(self.refresh, 3600))

    def _fresh(self) -> bool:
        if not self.result:
            return False
        try:
            built = dt.datetime.fromisoformat(self.result["built_at"])
        except (KeyError, ValueError):
            return False
        same_day = self.result.get("today") == self.t.now().date().isoformat()
        return same_day and (dt.datetime.now(dt.timezone.utc) - built).total_seconds() < self.refresh

    def ensure(self) -> None:
        """Ohne Ergebnis eine Berechnung anstoßen (z. B. beim ersten Aufruf)."""
        if not self.result and self.state != "building" and (self._building is None or self._building.done()):
            self._building = asyncio.create_task(self.build())

    def ensure_part(self, part: str) -> None:
        """Fehlt einem gespeicherten Ergebnis ein Teil (z. B. Tagesindizes aus einer älteren Version), neu rechnen."""
        if self.result and part not in self.result and self.state != "building" and (self._building is None or self._building.done()):
            self._building = asyncio.create_task(self.build())

    # --- Berechnung -------------------------------------------------------------------------

    async def _screen(self, exchange: str, sector: Optional[str], n: int) -> list[ScreenRow]:
        filters = [ScreenFilter("exchange", "eq", exchange)]
        if sector:
            filters.append(ScreenFilter("sector", "eq", sector))
        key = f"valscreen:{exchange}:{sector or '*'}:{n}"
        try:
            rows, _, _ = await self.t._cached(key, "screen", lambda: self.t.p.screener(filters, "market_cap", True, max(n * 2, n + 10)))
        except TerminalError as exc:
            log.debug("Screener %s/%s: %s", exchange, sector, exc.message)
            return []
        ex = exchange.upper()
        out = [r for r in rows if (r.exchange or "").upper() == ex and (sector is None or r.sector == sector) and r.market_cap]
        out.sort(key=lambda r: -(r.market_cap or 0))
        return out[:n]

    async def _company(self, ticker: str, mcap: float, sem: asyncio.Semaphore, today: dt.date) -> Optional[CompanyVal]:
        async with sem:
            try:
                inp = await self.t._cached(f"valin:{ticker}", "fund", lambda: self.t.p.valuation_inputs(ticker))
                hist = await self.t.history(ticker)
                divs: list[tuple[str, float]] = []
                splits: list[tuple[str, str]] = []
                if self.prices_adjusted:
                    try:
                        d = await self.t.dividends(ticker)
                        divs = [(x.ex_date, x.value) for x in d.dividends if x.value]
                        splits = [(x.date, x.ratio) for x in d.splits]
                    except TerminalError:
                        pass  # ohne Dividendendaten: bereinigte Kurse (frühere KGVs etwas zu niedrig)
                return company_val(inp, mcap, hist.t, hist.c, today, divs, splits, self.prices_adjusted, YEARS_BACK + 1)
            except TerminalError as exc:
                log.debug("Bewertung %s übersprungen: %s", ticker, exc.message)
                return None
            except Exception as exc:  # noqa: BLE001 – eine kaputte Firma darf die Tafel nicht verhindern
                log.warning("Bewertung %s fehlerhaft: %s", ticker, exc)
                return None
            finally:
                self.done += 1

    async def build(self) -> None:
        if self.state == "building":
            return
        self.state, self.done, self.total, self.message = "building", 0, 0, None
        try:
            today = self.t.now().date()
            exchanges = [e for e in self.t.p.catalog.screener_exchanges if e.upper() in EXCHANGE_COUNTRY]
            eu = [e for e in exchanges if e.upper() != "US"]
            groups: dict[str, dict[str, Any]] = {}  # id -> {kind, key, label, region, members}
            jobs = []
            for region, exs in (("us", ["US"] if "US" in exchanges else []), ("eu", eu)):
                for sector in SECTORS:
                    jobs.append((f"sector:{region}:{sector}", "sector", sector, SECTOR_DE.get(sector, sector), region, exs, sector, self.per_group))
            for ex in exchanges:
                country, region = EXCHANGE_COUNTRY[ex.upper()]
                jobs.append((f"country:{ex.upper()}", "country", ex.upper(), country, region, [ex], None, self.per_country))

            async def members(job: tuple) -> None:
                gid, kind, key, label, region, exs, sector, n = job
                rows: list[ScreenRow] = []
                for chunk in await asyncio.gather(*(self._screen(ex, sector, n) for ex in exs)):
                    rows.extend(chunk)
                rows.sort(key=lambda r: -(r.market_cap or 0))
                # einige Reserve: ADRs und Zweitnotierungen fallen später heraus
                groups[gid] = {"kind": kind, "key": key, "label": label, "region": region, "members": rows[: n + 5], "n": n}

            await asyncio.gather(*(members(j) for j in jobs))
            tickers: dict[str, ScreenRow] = {}
            for g in groups.values():
                for r in g["members"]:
                    tickers[r.ticker] = r
            self.total = len(tickers)
            sem = asyncio.Semaphore(6)
            vals = dict(zip(tickers, await asyncio.gather(*(self._company(t, r.market_cap or 0, sem, today) for t, r in tickers.items()))))
            excluded = listing_exclusions({t: (v.isin, v.domicile, tickers[t].avg_vol or 0) for t, v in vals.items() if v})

            chosen: dict[str, list[CompanyVal]] = {}
            for gid, g in groups.items():
                chosen[gid] = [vals[r.ticker] for r in g["members"] if vals.get(r.ticker) and r.ticker not in excluded][: g["n"]]
            for sector in SECTORS:  # Sektoren weltweit: USA und Europa zusammen
                gid = f"sector:all:{sector}"
                groups[gid] = {"kind": "sector", "key": sector, "label": SECTOR_DE.get(sector, sector), "region": "all"}
                chosen[gid] = chosen.get(f"sector:us:{sector}", []) + chosen.get(f"sector:eu:{sector}", [])

            weekly = await asyncio.to_thread(self._weekly, chosen, groups, today)
            daily = await asyncio.to_thread(self._daily, chosen, today)
            years = list(range(today.year - YEARS_BACK, today.year + 2))
            rows_out: dict[str, dict] = {}
            details: dict[str, dict] = {}
            for gid, g in groups.items():
                cs = chosen.get(gid) or []
                if not cs:
                    continue
                agg = await asyncio.to_thread(aggregate, cs, today, YEARS_BACK)
                row = self._row(g, agg, years)
                rows_out[gid] = row.model_dump()
                details[gid] = {
                    "monthly": [[d, v] for d, v in agg.monthly],
                    "forward": [[d, v] for d, v in agg.forward_path],
                    "decomposition": agg.decomposition,
                    "coverage": {str(y): n for y, n in agg.coverage.items()},
                    "members": [_member(c, today, years).model_dump() for c in sorted(cs, key=lambda c: -c.mcap)],
                    "sums": agg.sums,
                    "bands": _dump(bands_model(agg.bands, note=BANDS_NOTE + " Gruppen: Kursindex der Gruppe, heute = 100.")),
                }
            self.result = {
                "built_at": dt.datetime.now(dt.timezone.utc).isoformat(), "today": today.isoformat(),
                "years": years, "est_years": [today.year, today.year + 1], "rows": rows_out, "details": details,
                "weekly": weekly,
                "daily": daily,
            }
            self._record(today, rows_out)
            self._save()
            self.state = "ready"
            log.info("Bewertungstrend: %d Gruppen aus %d Firmen berechnet", len(rows_out), sum(1 for v in vals.values() if v))
        except asyncio.CancelledError:
            self.state = "idle"
            raise
        except Exception as exc:  # noqa: BLE001
            log.exception("Bewertungstrend fehlgeschlagen")
            self.state, self.message = "error", f"Berechnung fehlgeschlagen: {exc}"

    @staticmethod
    def _weekly(chosen: dict[str, list[CompanyVal]], groups: dict[str, dict], today: dt.date) -> dict:
        """Wochenindizes (Börsenwert, verkettet) je Gruppe und je Region für den Gesamtmarkt – Grundlage der
        relativen Rotation (RRG) der Sektoren. Fünf Jahre, letzter Wert = aktuelle Woche."""
        start = today - dt.timedelta(days=5 * 365)
        first = start + dt.timedelta(days=(4 - start.weekday()) % 7)
        days = [first + dt.timedelta(days=7 * k) for k in range((today - first).days // 7 + 1)]
        if today.weekday() < 4:  # laufende Woche (Mo–Do): heutiger Stand
            days.append(today)
        keys = [(d + dt.timedelta(days=4 - d.weekday())).isoformat() for d in days]
        out: dict[str, list[Optional[float]]] = {}
        for gid, cs in chosen.items():
            if cs and (gid.startswith("sector:") or gid.startswith("country:")):
                out[gid] = chain_index(cs, days)
        for region in ("us", "eu", "all"):
            members: dict[str, CompanyVal] = {}
            for gid, cs in chosen.items():
                if gid.startswith(f"sector:{region}:"):
                    for c in cs:
                        members[c.ticker] = c
            if members:
                out[f"market:{region}"] = chain_index(list(members.values()), days)
        return {"t": keys, "groups": out}

    @staticmethod
    def _daily(chosen: dict[str, list[CompanyVal]], today: dt.date, days_back: int = 730) -> dict:
        """Tagesindizes (Börsenwert, verkettet) je Sektor und Region für die Rotation auf Tagesbasis:
        Handelstage Mo–Fr der letzten zwei Jahre, Feiertage übernehmen den Vortag."""
        start = today - dt.timedelta(days=days_back)
        days = [start + dt.timedelta(days=k) for k in range((today - start).days + 1)]
        days = [d for d in days if d.weekday() < 5]
        out: dict[str, list[Optional[float]]] = {}
        for gid, cs in chosen.items():
            if cs and gid.startswith("sector:"):
                out[gid] = chain_index(cs, days)
        for region in ("us", "eu", "all"):
            members: dict[str, CompanyVal] = {}
            for gid, cs in chosen.items():
                if gid.startswith(f"sector:{region}:"):
                    for c in cs:
                        members[c.ticker] = c
            if members:
                out[f"market:{region}"] = chain_index(list(members.values()), days)
        return {"t": [d.isoformat() for d in days], "groups": out}

    @staticmethod
    def _row(g: dict, agg: GroupVal, years: list[int]) -> ValRow:
        return ValRow(
            key=g["key"], label=g["label"], kind=g["kind"], region=g["region"], n=agg.n,
            pe_years={str(y): agg.pe_years.get(y) for y in years}, coverage={str(y): agg.coverage.get(y, 0) for y in years},
            negative_years=agg.negative_years,
            pe_ttm=agg.pe_ttm, avg=agg.avg, low=agg.low, high=agg.high, position=agg.position, chg12m=agg.chg12m,
            growth_next=agg.growth_next, rev30=agg.revisions.get(30), rev90=agg.revisions.get(90),
            up30=agg.up30, down30=agg.down30, dist52=agg.dist52, state=_state(agg.dist52),
            median=agg.bands.pct["p50"] if agg.bands else None, fair_gap=agg.bands.fair_gap if agg.bands else None,
        )

    # --- Speicher ---------------------------------------------------------------------------

    def _write(self, path: Path, data: Any) -> None:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix=".tmp")
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
            os.replace(tmp, path)
        except OSError as exc:
            log.warning("Bewertungstrend nicht gespeichert (%s): %s", path, exc)

    def _save(self) -> None:
        if self.result:
            self._write(self.path, self.result)

    def _load(self) -> None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("rows"), dict):
                self.result, self.state = data, "ready"
        except (OSError, ValueError):
            pass

    def history(self) -> dict[str, dict[str, Any]]:
        try:
            data = json.loads(self.hist_path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def _record(self, today: dt.date, rows: dict[str, dict]) -> None:
        """Tägliche Aufzeichnung: KGV heute und aufs nächste Jahr je Gruppe (wächst zu einer eigenen Historie)."""
        hist = self.history()
        y1 = str(today.year + 1)
        for gid, r in rows.items():
            day = hist.setdefault(gid, {})
            day[today.isoformat()] = {"peTtm": r.get("pe_ttm"), "peNext": (r.get("pe_years") or {}).get(y1), "rev90": r.get("rev90")}
            if len(day) > 2000:
                for k in sorted(day)[: len(day) - 2000]:
                    del day[k]
        self._write(self.hist_path, hist)

    # --- Abfragen ---------------------------------------------------------------------------

    def overview(self, kind: str, region: str) -> ValOverview:
        if not self.result:
            self.ensure()
            return ValOverview(kind=kind, region=region, years=[], est_years=[], rows=[], state=self.state if self.state != "idle" else "building",
                               done=self.done, total=self.total, message=self.message, note=NOTE)
        prefix = f"sector:{region}:" if kind == "sector" else "country:"
        rows = [ValRow(**r) for gid, r in self.result["rows"].items() if gid.startswith(prefix)]
        if kind == "sector":
            order = {s: i for i, s in enumerate(SECTORS)}
            rows.sort(key=lambda r: order.get(r.key, 99))
        return ValOverview(kind=kind, region=region, years=self.result["years"], est_years=self.result["est_years"], rows=rows,
                           state="building" if self.state == "building" else "ready", done=self.done, total=self.total,
                           built_at=self.result.get("built_at"), message=self.message, note=NOTE)

    async def stock_bands(self, ticker: str) -> ValBands:
        """KGV-Bänder einer Aktie für den Kurschart (Kurslinien in der Skala des Charts)."""
        today = self.t.now().date()
        key = (ticker, today.isoformat())
        hit = self._bands_cache.get(key)
        if hit is not None:
            return hit
        inp = await self.t._cached(f"valin:{ticker}", "fund", lambda: self.t.p.valuation_inputs(ticker))
        hist = await self.t.history(ticker)
        divs: list[tuple[str, float]] = []
        splits: list[tuple[str, str]] = []
        if self.prices_adjusted:
            try:
                d = await self.t.dividends(ticker)
                divs = [(x.ex_date, x.value) for x in d.dividends if x.value]
                splits = [(x.date, x.ratio) for x in d.splits]
            except TerminalError:
                pass
        c = company_val(inp, 1.0, hist.t, hist.c, today, divs, splits, self.prices_adjusted, YEARS_BACK + 1)
        if c is None:
            raise NotFound(f"Keine Kursdaten für {ticker}.")
        pairs = [(d[:10], x) for d, x in zip(hist.t, hist.c) if x]
        b = await asyncio.to_thread(company_bands, c, today, [d for d, _ in pairs], [x for _, x in pairs])
        if b is None:
            raise NotFound(f"Zu wenig Gewinnhistorie für KGV-Bänder von {inp.name} (mindestens zwei Jahre mit Gewinn).")
        ttm = c.ttm(today)
        out = bands_model(b, ticker=ticker, name=inp.name, loss=bool(ttm is not None and ttm <= 0), note=BANDS_NOTE)
        assert out is not None
        out.sector = await asyncio.to_thread(self._sector_rel, c, inp.sector, ticker, today, [d for d, _ in pairs], [x for _, x in pairs])
        if out.sector is None and not self.result:
            return out  # Sektordaten noch nicht berechnet: nicht zwischenspeichern
        if len(self._bands_cache) > 200:
            self._bands_cache.clear()
        self._bands_cache[key] = out
        return out

    def _sector_rel(self, c: CompanyVal, sector: Optional[str], ticker: str, today: dt.date,
                    chart_dates: list[str], chart_closes: list[float]) -> Optional[ValSectorRel]:
        """Bewertung relativ zum eigenen Sektor (Region nach Börse; sonst USA + Europa)."""
        if not self.result or not sector:
            return None
        exchange = ticker.rpartition(".")[2].upper()
        region = "us" if exchange == "US" else "eu" if exchange in HOME_ISIN else "all"
        for reg in (region, "all"):
            gid = f"sector:{reg}:{sector}"
            det, row = self.result["details"].get(gid), self.result["rows"].get(gid)
            if not det or not row or not det.get("sums"):
                continue
            member = next((m for m in det["members"] if m["ticker"] == ticker), None)
            if row["n"] - (1 if member else 0) < 2:
                continue  # zu wenige andere Firmen: größerer Sektor als Maßstab
            rel = sector_relative(c, today, det["sums"], member["mcap"] if member else None, chart_dates, chart_closes)
            if rel is None or (rel.pe_now is None and rel.pe_next is None):
                continue
            b = rel.bands
            return ValSectorRel(
                key=sector, label=SECTOR_DE.get(sector, sector), region=reg, n=row["n"] - (1 if member else 0),
                pe_now=rel.pe_now, pe_next=rel.pe_next, rel_now=rel.rel_now, rel_median=b.pct["p50"] if b else None,
                fair_sector=rel.fair_sector, fair_sector_gap=rel.fair_sector_gap,
                fair_relative=b.fair_next if b else None, fair_relative_gap=b.fair_gap if b else None,
                bands=bands_model(b, note="Bänder auf das Verhältnis KGV der Aktie ÷ KGV des Sektors (ohne die Aktie)."),
            )
        return None

    def detail(self, kind: str, key: str, region: str) -> ValDetail:
        if not self.result:
            raise NotFound("Der Bewertungstrend wird noch berechnet.")
        gid = f"sector:{region}:{key}" if kind == "sector" else f"country:{key.upper()}"
        row, det = self.result["rows"].get(gid), self.result["details"].get(gid)
        if not row or not det:
            raise NotFound(f"Keine Daten für {key}.")
        rec = sorted((self.history().get(gid) or {}).items())
        return ValDetail(
            row=ValRow(**row), years=self.result["years"], est_years=self.result["est_years"],
            monthly=ValSeries(t=[d for d, _ in det["monthly"]], v=[v for _, v in det["monthly"]]),
            forward_path=ValSeries(t=[d for d, _ in det["forward"]], v=[v for _, v in det["forward"]]),
            recorded=ValSeries(t=[d for d, _ in rec], v=[x.get("peNext") for _, x in rec]),
            decomposition=det["decomposition"], coverage=det["coverage"], members=[ValMember(**m) for m in det["members"]],
            bands=ValBands(**det["bands"]) if det.get("bands") else None,
        )


__all__ = ["ValuationService", "LAGS", "REGIONS"]
