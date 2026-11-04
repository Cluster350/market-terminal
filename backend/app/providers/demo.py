"""Demo-Datenquelle: deterministische, synthetische Marktdaten ohne Netzzugang.

- Kurse folgen einem gemeinsamen Marktfaktor (mit Krisenphasen) plus
  titelspezifischem Rauschen, damit Korrelationen und Indizes plausibel wirken.
- Fundamentaldaten werden im EODHD-Rohformat erzeugt und durch dieselben
  Mapping-Funktionen geschickt wie echte Daten.
- Der heutige Handelstag läuft "live": Intraday-Balken erscheinen erst, wenn ihre
  Uhrzeit erreicht ist.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import math
import random
from functools import lru_cache
from typing import Any, Callable, Optional
from zoneinfo import ZoneInfo

from ..eodhd import mapping
from ..errors import NotFound
from ..models import (
    Company,
    EarningsEvent,
    CountryValue,
    Dividends,
    Earnings,
    EconEvent,
    Financials,
    History,
    Intraday,
    NewsItem,
    OptionContract,
    Quote,
    ScreenRow,
    SearchHit,
    Sentiment,
)
from ..services import metrics
from ..services.util import pct
from . import demo_data as D
from .base import (
    COUNTRIES,
    FX,
    INDICES,
    MACRO_INDICATORS,
    Catalog,
    Instrument,
    CURVE_TENORS,
    WORLD,
    ScreenFilter,
    curve_catalog,
)

START = dt.date(2016, 1, 4)
ANCHOR = dt.date(2025, 12, 31)  # Stichtag für die Ziel-Marktkapitalisierung
UTC = dt.timezone.utc
# Frühester Zeitpunkt der Demo-Uhr: zwei abgeschlossene Handelstage. Davor gäbe es keine
# Kurse, und Kennzahlen, Kurven und Screener scheiterten an leeren Reihen.
EARLIEST = dt.datetime(2016, 1, 5, 23, 59, tzinfo=dt.timezone.utc)


def _seed(*parts: Any) -> int:
    h = hashlib.sha256("|".join(str(p) for p in parts).encode()).digest()
    return int.from_bytes(h[:8], "big")


def _rng(*parts: Any) -> random.Random:
    return random.Random(_seed(*parts))


def business_days(start: dt.date, end: dt.date) -> list[dt.date]:
    days: list[dt.date] = []
    d = start
    one = dt.timedelta(days=1)
    while d <= end:
        if d.weekday() < 5:
            days.append(d)
        d += one
    return days


def last_business_day(d: dt.date) -> dt.date:
    while d.weekday() >= 5:
        d -= dt.timedelta(days=1)
    return d


def _easter(year: int) -> dt.date:
    """Ostersonntag (gregorianisch, Gauß/Meeus)."""
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = (h + l - 7 * m + 114) % 31 + 1
    return dt.date(year, month, day)


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> dt.date:
    """n-ter Wochentag im Monat; n = -1 ist der letzte."""
    if n > 0:
        d = dt.date(year, month, 1)
        d += dt.timedelta(days=(weekday - d.weekday()) % 7)
        return d + dt.timedelta(weeks=n - 1)
    nxt = dt.date(year + month // 12, month % 12 + 1, 1)
    d = nxt - dt.timedelta(days=1)
    return d - dt.timedelta(days=(d.weekday() - weekday) % 7)


def _observed(d: dt.date) -> dt.date:
    return d - dt.timedelta(days=1) if d.weekday() == 5 else d + dt.timedelta(days=1) if d.weekday() == 6 else d


@lru_cache(maxsize=512)
def holidays(group: str, year: int) -> frozenset[dt.date]:
    """Börsenfeiertage je Handelsplatz-Gruppe (vereinfachte, aber realistische Kalender)."""
    days = {dt.date(year, 1, 1), dt.date(year, 12, 25)}
    if group == "fx":
        return frozenset(days)
    easter = _easter(year)
    good_friday, easter_monday = easter - dt.timedelta(days=2), easter + dt.timedelta(days=1)
    if group == "us":
        days |= {
            _observed(dt.date(year, 1, 1)), _nth_weekday(year, 1, 0, 3), _nth_weekday(year, 2, 0, 3), good_friday,
            _nth_weekday(year, 5, 0, -1), _observed(dt.date(year, 6, 19)), _observed(dt.date(year, 7, 4)),
            _nth_weekday(year, 9, 0, 1), _nth_weekday(year, 11, 3, 4), _observed(dt.date(year, 12, 25)),
        }
    elif group in ("eu", "sw"):
        days |= {good_friday, easter_monday, dt.date(year, 5, 1), dt.date(year, 12, 24), dt.date(year, 12, 26), dt.date(year, 12, 31)}
    elif group == "lse":
        days |= {good_friday, easter_monday, _nth_weekday(year, 5, 0, 1), _nth_weekday(year, 5, 0, -1),
                 _nth_weekday(year, 8, 0, -1), dt.date(year, 12, 26)}
    elif group == "asia":
        days |= {dt.date(year, 1, 2), dt.date(year, 1, 3), dt.date(year, 12, 31)}
    elif group == "hk":
        days |= {good_friday, easter_monday, dt.date(year, 7, 1), dt.date(year, 10, 1), dt.date(year, 12, 26)}
    return frozenset(days)


def _regime(d: dt.date) -> tuple[float, float]:
    """Drift und Volatilität des Marktfaktors (synthetische Krisen und Erholungen)."""
    iso = d.isoformat()
    if "2018-10-01" <= iso <= "2018-12-24":
        return -0.0018, 0.013
    if "2020-02-20" <= iso <= "2020-03-23":
        return -0.012, 0.035
    if "2020-03-24" <= iso <= "2020-06-08":
        return 0.006, 0.022
    if "2022-01-03" <= iso <= "2022-10-12":
        return -0.0011, 0.015
    if "2025-03-01" <= iso <= "2025-04-08":
        return -0.004, 0.022
    if "2025-04-09" <= iso <= "2025-06-30":
        return 0.0025, 0.014
    return 0.00045, 0.0085


def _interp(knots: list[tuple[str, float, float]], d: dt.date) -> tuple[float, float]:
    iso = d.isoformat()
    if iso <= knots[0][0]:
        return knots[0][1], knots[0][2]
    for (d0, s0, l0), (d1, s1, l1) in zip(knots, knots[1:]):
        if d0 <= iso <= d1:
            a = dt.date.fromisoformat(d0)
            b = dt.date.fromisoformat(d1)
            w = (d - a).days / max((b - a).days, 1)
            return s0 + (s1 - s0) * w, l0 + (l1 - l0) * w
    return knots[-1][1], knots[-1][2]


def _ns_yield(short: float, long: float, years: float, tau: float = 2.0) -> float:
    """Nelson-Siegel-ähnliche Kurve zwischen kurzem und langem Ende."""
    x = years / tau
    load = (1 - math.exp(-x)) / x if x > 0 else 1.0
    return long + (short - long) * load


def _decimals(x: float) -> int:
    """Anzahl der Nachkommastellen eines bereits gerundeten Werts (max. 2)."""
    for d in range(3):
        if abs(round(x, d) - x) < 1e-9:
            return d
    return 2


def _de(x: float, digits: int, sign: bool = False) -> str:
    """Deutsche Zahlendarstellung: 18.123,45"""
    s = f"{x:{'+' if sign else ''},.{digits}f}"
    return s.replace(",", "\u2009").replace(".", ",").replace("\u2009", ".")


COMPANY_TICKERS = [f"{c[0]}.{c[2]}" for c in D.COMPANIES]
_COMPANY = {f"{c[0]}.{c[2]}": c for c in D.COMPANIES}
_INDEX_NAMES = {i.ticker: i for i in INDICES}
# Länderindizes der Weltkarte, die nicht in WEI stehen
_INDEX_NAMES.update({t: Instrument(t, n, "Welt") for _, _, _, t, n in WORLD if t and t not in _INDEX_NAMES})
_FX_NAMES = {i.ticker: i for i in FX}
_COMMODITY = {c[0]: c for c in D.COMMODITIES}
_CURVES = curve_catalog()
_BOND = {t: (cc, tenor, years) for cc, (_, pts) in _CURVES.items() for tenor, years, t in pts}
# Anleihen weiterer Länder: zehnjährige für die Weltkarte, kurze Laufzeiten für Terminkurse (FWD)
_WORLD_BOND_NAMES = {cc: name for _, name, cc, _, _ in WORLD if cc and cc not in _CURVES}
_BOND.update({f"{cc}{tenor}.GBOND": (cc, tenor, years) for cc in _WORLD_BOND_NAMES for tenor, years in CURVE_TENORS})

TIMING_ORDER = {"BeforeMarket": 0, "AfterMarket": 2}  # vorbörslich zuerst

CROSSES = {
    "EURGBP.FOREX": ("EURUSD.FOREX", "GBPUSD.FOREX"),  # EUR/USD ÷ GBP/USD
    "EURCHF.FOREX": ("EURUSD.FOREX", "USDCHF.FOREX"),  # EUR/USD × USD/CHF
    "EURJPY.FOREX": ("EURUSD.FOREX", "USDJPY.FOREX"),  # EUR/USD × USD/JPY
}

CATALOG = Catalog(
    indices=INDICES,
    fx=FX,
    commodities=[Instrument(c[0], c[1]) for c in D.COMMODITIES],
    curves=_CURVES,
    default_watchlist=["NWND.US", "QBIT.US", "VLTA.US", "ORCX.US", "MDRN.US", "ELBT.XETRA",
                       "ALPV.XETRA", "NRDW.XETRA", "LMRE.PA", "DLTA.AS", "GLTS.SW", "GSPC.INDX",
                       "GDAXI.INDX", "EURUSD.FOREX"],
    default_news=COMPANY_TICKERS,
    screener_exchanges=["US", "XETRA", "PA", "AS", "SW", "LSE"],
    heatmap_exchange="ALL",
    countries=COUNTRIES,
)


# Mindestabstand in Tagen je Meldungsart und Unternehmen (größte Unternehmen; kleinere seltener)
_STORY_WINDOWS: dict[str, int] = {
    "up": 21, "down": 28, "buyback": 120, "order": 14, "cfo": 240, "outage": 75, "jobs": 150, "product": 45,
}
# Fiktive Analystenhäuser und Auftraggeber für abwechslungsreiche Meldungen
_BROKERS = ["Bergmann Research", "Nordhafen Capital", "Lindqvist & Co", "Meridian Securities", "Kestrel Partners", "Albrecht Bank"]
_CLIENTS = ["einem US-Großkunden", "einem europäischen Konzern", "einem asiatischen Kunden", "der öffentlichen Hand", "einem Bestandskunden"]


class DemoProvider:
    mode = "demo"
    catalog = CATALOG

    def __init__(self, now_fn: Optional[Callable[[], dt.datetime]] = None):
        self._now_fn = now_fn or (lambda: dt.datetime.now(UTC))
        self._market_cache: dict[int, list[float]] = {}
        self._daily_cache: dict[tuple[str, int], dict[str, list]] = {}
        self._bars_cache: dict[tuple[str, dt.date], list[tuple[int, float, float, float, float, float]]] = {}
        self._fund_cache: dict[tuple, dict] = {}
        self._days_cache: tuple[Optional[dt.date], list[dt.date]] = (None, [])

    async def close(self) -> None:
        return None

    # --- Zeit ------------------------------------------------------------------

    def now(self) -> dt.datetime:
        n = self._now_fn()
        n = n if n.tzinfo else n.replace(tzinfo=UTC)
        return max(n, EARLIEST)

    def today(self) -> dt.date:
        return last_business_day(self.now().date())

    def days(self) -> list[dt.date]:
        # Je Tag nur einmal berechnen: _daily ruft das bei jedem Aufruf (auch Cache-Treffern) auf,
        # das waren bei 60 Anleihen rund 0,8 s der 1,3 s für /macro/curves. Aufrufer kopieren.
        today = self.today()
        if self._days_cache[0] != today:
            self._days_cache = (today, business_days(START, today))
        return self._days_cache[1]

    # --- Instrumente -------------------------------------------------------------

    def known(self, ticker: str) -> bool:
        return (
            ticker in _COMPANY
            or ticker in _INDEX_NAMES
            or ticker in _FX_NAMES
            or ticker in _COMMODITY
            or ticker in _BOND
            or ticker == "VIX.INDX"
        )

    def _require(self, ticker: str) -> None:
        if not self.known(ticker):
            raise NotFound(f"Unbekannter Ticker {ticker}. Der Demo-Datensatz enthält nur die fiktiven Werte der Suche.")

    def name(self, ticker: str) -> str:
        if ticker in _COMPANY:
            return _COMPANY[ticker][1]
        if ticker in _INDEX_NAMES:
            return _INDEX_NAMES[ticker].name
        if ticker in _FX_NAMES:
            return _FX_NAMES[ticker].name
        if ticker in _COMMODITY:
            return _COMMODITY[ticker][1]
        if ticker in _BOND:
            cc, tenor, _ = _BOND[ticker]
            return f"{_CURVES[cc][0] if cc in _CURVES else _WORLD_BOND_NAMES.get(cc, cc)} Staatsanleihe {tenor}"
        return ticker

    def currency(self, ticker: str) -> Optional[str]:
        if ticker in _COMPANY:
            return D.EXCHANGE_INFO[_COMPANY[ticker][2]][0]
        if ticker in _FX_NAMES:
            return ticker[3:6] if ticker.endswith(".FOREX") else "USD"
        if ticker in _COMMODITY:
            return "USD"
        if ticker in _BOND:
            return "%"
        return None

    def session_group(self, ticker: str) -> str:
        if ticker in _COMPANY:
            return D.EXCHANGE_INFO[_COMPANY[ticker][2]][2]
        if ticker in D.INDEX_PARAMS:
            return D.INDEX_PARAMS[ticker][2]
        if ticker == "VIX.INDX" or ticker in _COMMODITY:
            return "us"
        if ticker in _FX_NAMES:
            return "fx"
        if ticker in _BOND:
            return {"US": "us", "JP": "asia", "UK": "lse"}.get(_BOND[ticker][0], "eu")
        return "eu"

    # --- Zeitreihen ----------------------------------------------------------------

    def _market(self, n: int) -> list[float]:
        cached = self._market_cache.get(n)
        if cached is not None:
            return cached
        rng = _rng("market-factor")
        out: list[float] = []
        for d in business_days(START, START + dt.timedelta(days=n * 2 + 10))[:n]:
            mu, sigma = _regime(d)
            out.append(mu + sigma * rng.gauss(0, 1))
        self._market_cache = {n: out}
        return out

    def _daily(self, ticker: str) -> dict[str, list]:
        days = self.days()
        key = (ticker, len(days))
        cached = self._daily_cache.get(key)
        if cached is not None:
            return cached
        n = len(days)
        mkt = self._market(n)
        rng = _rng("series", ticker)
        closes: list[float] = []
        kind = "price"

        if ticker in CROSSES:
            # Kreuzkurse aus den USD-Paaren ableiten, damit keine Arbitrage entsteht
            (a, b), op_ = CROSSES[ticker], None
            sa, sb = self._daily(a), self._daily(b)
            mb = dict(zip(sb["days"], sb["c"]))
            pairs = [(d, ca, mb[d]) for d, ca in zip(sa["days"], sa["c"]) if d in mb]
            days = [d for d, _, _ in pairs]
            closes = [ca / cb if ticker == "EURGBP.FOREX" else ca * cb for _, ca, cb in pairs]
            day_sigma = 0.006
            mkt = []
        elif ticker in _COMPANY:
            _, _, _, sector, _, _ = _COMPANY[ticker]
            sp = D.SECTORS[sector]
            vol, beta = sp[7] * rng.uniform(0.8, 1.3), sp[8] * rng.uniform(0.8, 1.2)
            idio = math.sqrt(max(vol**2 / 252 - (beta * 0.0085) ** 2, 0.006**2))
            alpha = sp[4] / 252 * 0.5 + rng.gauss(0, 0.00025) - beta * 0.00035
            p = rng.uniform(15, 160)
            shocks = self._earnings_shocks(ticker, days[0], days[-1])
            for d, m in zip(days, mkt):
                p *= math.exp(beta * m + alpha + idio * rng.gauss(0, 1) + shocks.get(d, 0.0))
                closes.append(p)
            day_sigma = vol / math.sqrt(252)
        elif ticker in D.INDEX_PARAMS:
            base, drift, _ = D.INDEX_PARAMS[ticker]
            beta = {
                "NDX.INDX": 1.2, "RUT.INDX": 1.15, "N225.INDX": 0.8, "HSI.INDX": 0.7, "AXJO.INDX": 0.7,
                "SSEC.INDX": 0.35, "BVSP.INDX": 0.8, "MERV.INDX": 0.6, "XU100.INDX": 0.5, "NSEI.INDX": 0.6,
                "KS11.INDX": 0.8, "TWII.INDX": 0.95, "JKSE.INDX": 0.5, "NZ50.INDX": 0.6, "MXX.INDX": 0.7,
            }.get(ticker, 1.0)
            p = base
            for m in mkt:
                p *= math.exp(beta * m + drift / 252 - beta * 0.0004 + 0.0035 * rng.gauss(0, 1))
                closes.append(p)
            day_sigma = 0.011
        elif ticker == "VIX.INDX":
            v = 18.0
            for m in mkt:
                v = max(11.0, v + 0.05 * (17.0 - v) - 140 * m + 0.45 * rng.gauss(0, 1))
                closes.append(v)
            day_sigma = 0.06
        elif ticker in D.FX_PARAMS:
            base, vol = D.FX_PARAMS[ticker]
            drift = 0.5 if ticker.startswith("BTC") else 0.0
            phi = 0.995 if ticker.startswith("BTC") else 0.997
            s = vol / math.sqrt(252)
            x = 0.0  # log-Abweichung vom Trend (mean reverting)
            for k, m in enumerate(mkt):
                if ticker in CROSSES:
                    continue
                if ticker.startswith("BTC"):
                    shock = 1.5 * m
                elif ticker in ("USDCAD.FOREX", "USDCNH.FOREX"):
                    shock = -0.2 * m
                else:
                    shock = 0.25 * m
                x = phi * x + shock + s * rng.gauss(0, 1)
                closes.append(base * math.exp(drift * k / 252 + x))
            day_sigma = s
        elif ticker in _COMMODITY:
            _, _, base, drift, vol = _COMMODITY[ticker]
            s = vol / math.sqrt(252)
            x = 0.0
            for k, m in enumerate(mkt):
                x = 0.997 * x + 0.4 * (m - 0.00045) + s * rng.gauss(0, 1)
                closes.append(base * math.exp(drift * k / 252 + x))
            day_sigma = s
        elif ticker in _BOND:
            cc, tenor, years = _BOND[ticker]
            kind = "yield"
            noise_rng = _rng("curve-noise", cc)  # gemeinsames Rauschen je Land
            level = slope = 0.0
            for d in days:
                short, long = _interp(D.CURVE_KNOTS[cc], d)
                level = 0.985 * level + 0.045 * noise_rng.gauss(0, 1)
                slope = 0.99 * slope + 0.02 * noise_rng.gauss(0, 1)
                y = _ns_yield(short + slope, long + level, years) + 0.01 * rng.gauss(0, 1)
                closes.append(y)
            day_sigma = 0.04
        else:
            raise NotFound(ticker)

        if ticker not in CROSSES:
            # Börsenfeiertage des Handelsplatzes entfernen (Kurs läuft über den Feiertag weiter)
            group = self.session_group(ticker)
            keep = [i for i, d in enumerate(days) if d not in holidays(group, d.year)]
            days = [days[i] for i in keep]
            closes = [closes[i] for i in keep]

        o: list[float] = []
        h: list[float] = []
        l: list[float] = []
        vols: list[Optional[float]] = []
        shares = self._shares(ticker, days, closes) if ticker in _COMPANY else None
        if ticker not in _COMPANY:
            shocks = {}
        prev = closes[0]
        # Eigene Zufallsquelle für Eröffnung/Hoch/Tief/Volumen (getrennt vom Kursstrom), damit
        # vergangene Tage gleich bleiben, wenn Handelstage hinzukommen. Eine Quelle je Instrument
        # genügt, weil jeder Tag gleich viele Zahlen zieht und die Tagesfolge nur hinten wächst;
        # eine Quelle je Tag zu seeden kostete ~9 µs × 2 800 Tage × Instrument (Kurven 1,2 -> 3,1 s).
        rng = _rng("ohlv", ticker)
        for i, c in enumerate(closes):
            shock = shocks.get(days[i], 0.0)
            if kind == "yield":
                op = prev + rng.gauss(0, 0.01)
                hi = max(op, c) + abs(rng.gauss(0, 0.015))
                lo = min(op, c) - abs(rng.gauss(0, 0.015))
            elif shock:
                # Earnings: Kurslücke zur Eröffnung, der Rest der Reaktion im Tagesverlauf
                op = prev * math.exp(0.8 * shock + rng.gauss(0, 0.15 * day_sigma))
                hi = max(op, c) * math.exp(abs(rng.gauss(0, 0.5 * day_sigma)))
                lo = min(op, c) * math.exp(-abs(rng.gauss(0, 0.5 * day_sigma)))
            else:
                op = prev * math.exp(rng.gauss(0, 0.15 * day_sigma))
                hi = max(op, c) * math.exp(abs(rng.gauss(0, 0.5 * day_sigma)))
                lo = min(op, c) * math.exp(-abs(rng.gauss(0, 0.5 * day_sigma)))
            o.append(op)
            h.append(hi)
            l.append(lo)
            if shares:
                r = abs(math.log(c / prev)) if prev > 0 and c > 0 else 0.0
                vols.append(round(shares * 0.004 * math.exp(rng.gauss(0, 0.35)) * (1 + 25 * r) * (2.5 if shock else 1.0)))
            elif ticker in D.INDEX_PARAMS:
                vols.append(round(2.5e9 * math.exp(rng.gauss(0, 0.25))))
            else:
                vols.append(None)
            prev = c
        if ticker in CROSSES:
            # Eröffnung aus den USD-Paaren, Hoch/Tief innerhalb der Arbitragegrenzen der Paare
            (a, b) = CROSSES[ticker]
            sa, sb = self._daily(a), self._daily(b)
            ia = {d: k for k, d in enumerate(sa["days"])}
            ib = {d: k for k, d in enumerate(sb["days"])}
            div = ticker == "EURGBP.FOREX"
            for i, d in enumerate(days):
                ka, kb = ia[d], ib[d]
                oa, ha, la = sa["o"][ka], sa["h"][ka], sa["l"][ka]
                ob, hb, lb = sb["o"][kb], sb["h"][kb], sb["l"][kb]
                op = oa / ob if div else oa * ob
                hi_bound, lo_bound = (ha / lb, la / hb) if div else (ha * hb, la * lb)
                c = closes[i]
                o[i] = op
                h[i] = max(min(h[i], hi_bound), op, c)
                l[i] = min(max(l[i], lo_bound), op, c)
        result = {"days": days, "o": o, "h": h, "l": l, "c": closes, "v": vols, "sigma": day_sigma, "kind": kind}
        # Cache klein halten: nur Einträge des aktuellen Tages behalten
        if len(self._daily_cache) > 400:
            self._daily_cache = {k: v for k, v in self._daily_cache.items() if k[1] == n}
        self._daily_cache[key] = result
        return result

    def _shares(self, ticker: str, days: list[dt.date], closes: list[float]) -> float:
        target = _COMPANY[ticker][5] * 1e9
        idx = len(days) - 1
        for i, d in enumerate(days):
            if d >= ANCHOR:
                idx = i
                break
        return target / closes[idx]

    def _session_bounds(self, ticker: str, day: dt.date) -> tuple[dt.datetime, dt.datetime]:
        """Handelszeit in lokaler Börsenzeit -> UTC (berücksichtigt Sommerzeit)."""
        group = self.session_group(ticker)
        tzname, (sh, sm), (eh, em) = D.SESSIONS[group]
        tz = ZoneInfo(tzname)
        start = dt.datetime(day.year, day.month, day.day, sh, sm, tzinfo=tz).astimezone(UTC)
        end = dt.datetime(day.year, day.month, day.day, eh, em, tzinfo=tz).astimezone(UTC)
        if group == "fx" and day.weekday() == 4:
            # Devisen: Wochenschluss freitags 17:00 New York (nicht 23:55 UTC)
            end = dt.datetime(day.year, day.month, day.day, 17, 0, tzinfo=ZoneInfo("America/New_York")).astimezone(UTC)
        return start, end

    def _bars(self, ticker: str, day_index: int) -> list[tuple[int, float, float, float, float, float]]:
        """5-Minuten-Balken eines Handelstages (vollständig, ohne Zeitfilter)."""
        series = self._daily(ticker)
        day = series["days"][day_index]
        key = (ticker, day)
        if key in self._bars_cache:
            return self._bars_cache[key]
        if ticker in CROSSES:
            # Intraday ebenfalls aus den USD-Paaren, damit Live-Kurse arbitragefrei bleiben
            a, b = CROSSES[ticker]
            ba = self._bars(a, self._daily(a)["days"].index(day))
            bb = {x[0]: x for x in self._bars(b, self._daily(b)["days"].index(day))}
            div = ticker == "EURGBP.FOREX"
            combo = (lambda x, y: x / y) if div else (lambda x, y: x * y)
            bars = []
            for ts, ao, _ah, _al, ac, _av in ba:
                if ts not in bb:
                    continue
                _, bo, _bh, _bl, bc, _bv = bb[ts]
                o_, c_ = combo(ao, bo), combo(ac, bc)
                bars.append((ts, o_, max(o_, c_), min(o_, c_), c_, 0.0))
            self._bars_cache[key] = bars
            return bars
        o, c = series["o"][day_index], series["c"][day_index]
        h, l = series["h"][day_index], series["l"][day_index]
        start, end = self._session_bounds(ticker, day)
        n = max(int((end - start).total_seconds() // 300), 1)
        rng = _rng("bars", ticker, day.isoformat())
        walk = [0.0]
        for _ in range(n):
            walk.append(walk[-1] + rng.gauss(0, 1))
        bridge = [w - walk[-1] * k / n for k, w in enumerate(walk)]
        lin = [o + (c - o) * k / n for k in range(n + 1)]
        scale = float("inf")
        for b, base in zip(bridge, lin):
            if b > 1e-12:
                scale = min(scale, (h - base) / b)
            elif b < -1e-12:
                scale = min(scale, (l - base) / b)
        if not math.isfinite(scale) or scale < 0:
            scale = 0.0
        path = [base + b * scale for base, b in zip(lin, bridge)]
        daily_vol = series["v"][day_index] or 0.0
        # Umsatz über den Tag: U-Form (Eröffnung und Schluss lebhaft), mehr Umsatz bei großen Bewegungen
        # und zufällige Schwankung je Balken. Früher hatte jede Kerze dasselbe Volumen – dann gleichen sich
        # Volumenprofil und TPO, und VWAP ist nur ein Zeitmittel. Eigene Zufallsquelle: Kurse bleiben gleich.
        vrng = _rng("bars-vol", ticker, day.isoformat())
        moves = [abs(path[k + 1] - path[k]) for k in range(n)]
        avg_move = (sum(moves) / n) or 1.0
        weights = [
            (0.55 + 1.8 * (2 * (k + 0.5) / n - 1) ** 2) * (0.6 + 0.8 * moves[k] / avg_move) * math.exp(vrng.gauss(0, 0.35))
            for k in range(n)
        ]
        wsum = sum(weights) or 1.0
        bars = []
        wiggle = 0.0004 if series["kind"] == "price" else 0.002
        for k in range(n):
            bo, bc = path[k], path[k + 1]
            if series["kind"] == "price":
                bh = min(max(bo, bc) * (1 + abs(rng.gauss(0, wiggle))), max(h, bo, bc))
                bl = max(min(bo, bc) * (1 - abs(rng.gauss(0, wiggle))), min(l, bo, bc))
            else:
                bh = min(max(bo, bc) + abs(rng.gauss(0, wiggle)), max(h, bo, bc))
                bl = max(min(bo, bc) - abs(rng.gauss(0, wiggle)), min(l, bo, bc))
            ts = int((start + dt.timedelta(minutes=5 * k)).timestamp())
            bars.append((ts, bo, bh, bl, bc, daily_vol * weights[k] / wsum))
        if len(self._bars_cache) > 2000:
            self._bars_cache.clear()
        self._bars_cache[key] = bars
        return bars

    def _visible_bars(self, ticker: str, day_index: int) -> list[tuple[int, float, float, float, float, float]]:
        bars = self._bars(ticker, day_index)
        cutoff = self.now().timestamp()
        return [b for b in bars if b[0] + 300 <= cutoff]

    def _effective(self, ticker: str) -> dict[str, list]:
        """Tagesreihe inkl. Teil-Balken für einen laufenden Handelstag."""
        s = self._daily(ticker)
        days = list(s["days"])
        o, h, l, c, v = (list(s[k]) for k in ("o", "h", "l", "c", "v"))
        last = len(days) - 1
        # Hoch/Tief der letzten Tage an die Intraday-Pfade anpassen
        for i in range(max(0, last - 4), last + 1):
            bars = self._bars(ticker, i)
            o[i] = bars[0][1]  # sonst lag die Eröffnung aus der Tagesreihe teils über dem Intraday-Hoch
            h[i] = max(b[2] for b in bars)
            l[i] = min(b[3] for b in bars)
        if days[last] == self.now().date():
            vis = self._visible_bars(ticker, last)
            if not vis:
                for arr in (days, o, h, l, c, v):
                    arr.pop()
            else:
                o[last] = vis[0][1]
                h[last] = max(b[2] for b in vis)
                l[last] = min(b[3] for b in vis)
                c[last] = vis[-1][4]
                v[last] = sum(b[5] for b in vis) if v[last] is not None else None
        return {"days": days, "o": o, "h": h, "l": l, "c": c, "v": v, "kind": s["kind"]}

    # --- Provider-Schnittstelle: Kurse --------------------------------------------

    async def status(self) -> dict[str, Any]:
        return {"note": "Synthetische Demo-Daten. Unternehmen sind frei erfunden."}

    async def resolve(self, ticker: str) -> Optional[SearchHit]:
        if not self.known(ticker):
            return None
        code, _, exch = ticker.rpartition(".")
        return SearchHit(ticker=ticker, name=self.name(ticker), exchange=exch, currency=self.currency(ticker))

    async def earnings_calendar(self, start: dt.date, end: dt.date) -> list[EarningsEvent]:
        out: list[EarningsEvent] = []
        for t in COMPANY_TICKERS:
            for rec in self._fundamentals_raw(t)["Earnings"]["History"].values():
                rep = dt.date.fromisoformat(rec["reportDate"])
                if not start <= rep <= end:
                    continue
                out.append(
                    EarningsEvent(
                        ticker=t,
                        name=self.name(t),
                        report_date=rec["reportDate"],
                        period_end=rec["date"],
                        timing=rec.get("beforeAfterMarket"),
                        eps_estimate=rec.get("epsEstimate"),
                        eps_actual=rec.get("epsActual"),
                        surprise_pct=rec.get("surprisePercent"),
                        currency=rec.get("currency"),
                    )
                )
        return sorted(out, key=lambda e: (e.report_date, TIMING_ORDER.get(e.timing or "", 1), e.ticker))

    async def search(self, query: str, limit: int) -> list[SearchHit]:
        q = query.strip().lower()
        if not q:
            return []
        hits: list[tuple[int, SearchHit]] = []

        def consider(ticker: str, name: str, typ: str, exch: str, country: Optional[str], cur: Optional[str]) -> None:
            code = ticker.split(".")[0].lower()
            nl = name.lower()
            if code == q:
                score = 0
            elif code.startswith(q):
                score = 1
            elif nl.startswith(q):
                score = 2
            elif q in nl or q in ticker.lower():
                score = 3
            else:
                return
            hits.append((score, SearchHit(ticker=ticker, name=name, exchange=exch, type=typ, country=country, currency=cur)))

        for t, c in _COMPANY.items():
            cur, country, _ = D.EXCHANGE_INFO[c[2]]
            consider(t, c[1], "Common Stock", c[2], country, cur)
        for inst in INDICES:
            consider(inst.ticker, inst.name, "INDEX", "INDX", None, None)
        for inst in FX:
            consider(inst.ticker, inst.name, "Currency", inst.ticker.split(".")[1], None, None)
        for t, c in _COMMODITY.items():
            consider(t, c[1], "Commodity", "COMM", None, "USD")
        for t in _BOND:
            consider(t, self.name(t), "Bond", "GBOND", None, None)
        hits.sort(key=lambda x: (x[0], x[1].ticker))
        return [h for _, h in hits[:limit]]

    async def quotes(self, tickers: list[str]) -> list[Quote]:
        out: list[Quote] = []
        for t in tickers:
            if not self.known(t):
                out.append(Quote(ticker=t))
                continue
            e = self._effective(t)
            if len(e["c"]) < 2:
                out.append(Quote(ticker=t, name=self.name(t)))
                continue
            last, prev = e["c"][-1], e["c"][-2]
            day = e["days"][-1]
            idx = len(self._daily(t)["days"]) - 1
            if day == self.now().date():
                vis = self._visible_bars(t, idx)
                ts = dt.datetime.fromtimestamp(vis[-1][0] + 300, UTC) if vis else self.now()
            else:
                _, end = self._session_bounds(t, day)
                ts = end
            change = last - prev
            out.append(
                Quote(
                    ticker=t,
                    name=self.name(t),
                    last=round(last, 5),
                    change=round(change, 5),
                    change_pct=round(pct(last, prev) or 0.0, 4) if e["kind"] == "price" else None,
                    open=round(e["o"][-1], 5),
                    high=round(e["h"][-1], 5),
                    low=round(e["l"][-1], 5),
                    prev_close=round(prev, 5),
                    volume=round(e["v"][-1]) if e["v"][-1] is not None else None,
                    timestamp=ts.isoformat().replace("+00:00", "Z"),
                    delayed=False,
                    currency=self.currency(t),
                )
            )
        return out

    async def history(self, ticker: str) -> History:
        self._require(ticker)
        e = self._effective(ticker)
        r = lambda xs: [None if x is None else round(x, 5) for x in xs]
        return History(
            ticker=ticker,
            currency=self.currency(ticker),
            t=[d.isoformat() for d in e["days"]],
            o=r(e["o"]),
            h=r(e["h"]),
            l=r(e["l"]),
            c=r(e["c"]),
            v=[None if x is None else round(x) for x in e["v"]],
        )

    async def intraday(self, ticker: str, days: int) -> Intraday:
        self._require(ticker)
        series = self._daily(ticker)
        n = len(series["days"])
        out = Intraday(ticker=ticker, interval="5m", t=[], o=[], h=[], l=[], c=[], v=[])
        # Die letzten `days` Sitzungen mit Daten (vor Handelsbeginn zählt der Vortag)
        sessions: list[int] = []
        i = n - 1
        while i >= 0 and len(sessions) < days:
            if i < n - 1 or self._visible_bars(ticker, i):
                sessions.append(i)
            i -= 1
        for i in reversed(sessions):
            for ts, bo, bh, bl, bc, bv in self._visible_bars(ticker, i):
                out.t.append(ts)
                out.o.append(round(bo, 5))
                out.h.append(round(bh, 5))
                out.l.append(round(bl, 5))
                out.c.append(round(bc, 5))
                out.v.append(round(bv) if series["v"][i] is not None else None)
        return out

    # --- Optionen ---------------------------------------------------------------------

    @staticmethod
    def _option_expirations(today: dt.date) -> list[dt.date]:
        """Wochenverfälle (5), Monatsverfälle (3. Freitag, 8 Monate), Quartale und Januar-LEAPS.

        Fällt ein Verfall auf einen US-Börsenfeiertag (Karfreitag, Juneteenth …), verfällt die
        Serie am Handelstag davor."""
        def third_friday(y: int, m: int) -> dt.date:
            d = dt.date(y, m, 15)
            return d + dt.timedelta(days=(4 - d.weekday()) % 7)

        def trading_day(d: dt.date) -> dt.date:
            while d.weekday() >= 5 or d in holidays("us", d.year):
                d -= dt.timedelta(days=1)
            return d

        out: set[dt.date] = set()
        friday = today + dt.timedelta(days=(4 - today.weekday()) % 7 or 7)
        for k in range(5):
            out.add(trading_day(friday + dt.timedelta(weeks=k)))
        y, m = today.year, today.month
        for k in range(15):
            yy, mm = y + (m - 1 + k) // 12, (m - 1 + k) % 12 + 1
            if k <= 8 or mm in (3, 6, 9, 12):
                out.add(trading_day(third_friday(yy, mm)))
        out.add(trading_day(third_friday(today.year + 1, 1)))
        return sorted(d for d in out if d > today and (d - today).days <= 430)

    async def options(self, ticker: str) -> list[OptionContract]:
        """Synthetische US-Optionskette (amerikanisch bewertet, Barone-Adesi/Whaley).

        Preise und Greeks folgen dem aktuellen Kurs; Strikes, Open Interest und Umsatz hängen am
        letzten Schlusskurs und bleiben über den Tag gleich (Open Interest meldet die Börse nur
        einmal täglich)."""
        self._require(ticker)
        if ticker not in _COMPANY or not ticker.endswith(".US"):
            raise NotFound("Optionsdaten gibt es nur für US-Aktien (im Demo-Datensatz die fiktiven US-Werte).")
        from ..services import options_math as bs
        from ..services.options import is_monthly

        today = self.today()
        eff = self._effective(ticker)
        spot = (await self.quotes([ticker]))[0].last or eff["c"][-1]
        prior = [c for d, c in zip(eff["days"], eff["c"]) if d < today and c]
        ref = prior[-1] if prior else spot
        closes = [c for d, c in zip(eff["days"], eff["c"]) if d < today and c][-61:]
        rets = [math.log(b / a) for a, b in zip(closes, closes[1:]) if a and b]
        mean = sum(rets) / len(rets) if rets else 0.0
        hv = math.sqrt(sum((x - mean) ** 2 for x in rets) / max(len(rets) - 1, 1) * 252) if rets else 0.3
        base_iv = max(0.16, min(1.2, hv * 1.08 + 0.02))
        try:  # derselbe Geldmarktzins wie in der US-Zinskurve (GC, FWD)
            r = self._effective("US3M.GBOND")["c"][-1] / 100
        except (KeyError, IndexError, NotFound):
            r = _interp(D.CURVE_KNOTS["US"], today)[0] / 100
        raw = self._fundamentals_raw(ticker)
        q = float(raw["Highlights"].get("DividendYield") or 0)
        # Nächste Quartalszahlen: auch heute nachbörslich zählt noch als künftiges Ereignis
        events = []
        for rec in raw["Earnings"]["History"].values():
            if not rec.get("reportDate"):
                continue
            rep = dt.date.fromisoformat(rec["reportDate"])
            after = rec.get("beforeAfterMarket") != "BeforeMarket"
            if rep > today or (rep == today and after):
                events.append((rep, after))
        earnings = min(events) if events else None
        step = 1.0 if ref < 25 else 2.5 if ref < 100 else 5.0 if ref < 250 else 10.0 if ref < 500 else 25.0
        fine = {1.0: 0.5, 2.5: 1.0, 5.0: 2.5, 10.0: 5.0, 25.0: 10.0}[step]  # kurze Laufzeiten mit engeren Strikes
        code = ticker.split(".")[0]
        size = _COMPANY[ticker][5]  # Marktkapitalisierung (Mrd.) als Maß für das Interesse
        out: list[OptionContract] = []
        for exp in self._option_expirations(today):
            days = (exp - today).days
            t = days / 365
            monthly = is_monthly(exp.isoformat())
            # Laufzeitstruktur leicht steigend; Quartalszahlen vor dem Verfall erhöhen die IV (Ereignisvarianz).
            # Zahlen am Verfallstag selbst zählen nur, wenn sie vorbörslich kommen.
            iv_t = base_iv * (0.94 + 0.06 * min(t, 1.0) ** 0.5)
            if earnings and (earnings[0] < exp or (earnings[0] == exp and not earnings[1])):
                iv_t = math.sqrt(iv_t**2 + 0.055**2 / max(t, 1 / 365))
            width = min(0.55, 0.12 + 1.1 * iv_t * math.sqrt(t))
            st = fine if days <= 45 else step
            lo, hi = math.floor(ref * (1 - width) / st), math.ceil(ref * (1 + width) / st)
            for i in range(max(1, lo), hi + 1):
                k = round(i * st, 2)
                m = max(-2.5, min(2.5, math.log(k / spot) / max(math.sqrt(t), 0.1)))
                iv = max(0.06, min(3.0, iv_t * (1 - 0.18 * m + 0.12 * m * m)))  # Skew: Puts teurer
                for kind in ("call", "put"):
                    rng = _rng("opt", ticker, today.isoformat(), exp.isoformat(), kind, k)
                    # Calls etwas weniger Skew als Puts (Nachfrage nach Absicherung)
                    iv_k = max(0.06, iv * (1 - 0.015 * m) if kind == "call" else iv)
                    theo = bs.american_price(kind, spot, k, t, r, q, iv_k)
                    g = bs.american_greeks(kind, spot, k, t, r, q, iv_k)
                    spread = max(0.01, 0.02 + 0.035 * theo)
                    bid = max(0.0, round(theo - spread / 2, 2))
                    ask = round(max(theo + spread / 2, bid + 0.01), 2)
                    dist = math.log(k / ref)
                    oi = 9000 * math.sqrt(size / 100) * math.exp(-dist * dist / (2 * (0.10 + 0.25 * t) ** 2))
                    oi *= (1.0 if monthly else 0.45) * (0.35 if days > 200 else 1.0)
                    oi *= 1.6 if abs(k % (step * 4)) < 1e-9 else 1.0
                    oi *= 0.6 if st < step and abs(k % step) > 1e-9 else 1.0
                    oi *= (1.15 if kind == "put" and k < ref else 1.0) * rng.uniform(0.55, 1.45)
                    ref_theo = bs.price(kind, ref, k, t, r, q, iv_t)  # nur Vortageswerte: über den Tag stabil
                    oi = round(oi) if ref_theo >= 0.005 else round(oi * 0.2)
                    vol_ratio = rng.uniform(0.02, 0.3) * (2.2 if days <= 10 else 1.0)
                    if rng.random() < 0.012:
                        vol_ratio = rng.uniform(1.5, 4.0)  # auffälliger Umsatz
                    volume = round(oi * vol_ratio)
                    # letzter Abschluss innerhalb von Geld und Brief
                    last = min(ask, max(bid, round(theo + rng.gauss(0, 0.3) * spread, 2))) if volume else None
                    out.append(OptionContract(
                        contract=f"{code}{exp:%y%m%d}{kind[0].upper()}{int(round(k * 1000)):08d}",
                        type=kind, exp=exp.isoformat(), strike=k, bid=bid, ask=ask,  # type: ignore[arg-type]
                        last=max(0.01, last) if last is not None else None,
                        volume=volume, open_interest=oi, iv=round(iv_k, 4),
                        delta=round(g["delta"], 4), gamma=round(g["gamma"], 5), theta=round(g["theta"], 4), vega=round(g["vega"], 4),
                    ))
        return out

    # --- Fundamentaldaten (im EODHD-Rohformat) --------------------------------------

    @staticmethod
    @lru_cache(maxsize=8192)
    def _report_date(ticker: str, quarter_end: dt.date) -> tuple[dt.date, str]:
        """Berichtstermin (22–38 Tage nach Quartalsende, Werktag) und Zeitpunkt."""
        r = _rng("report", ticker, quarter_end.isoformat())
        d = quarter_end + dt.timedelta(days=r.randint(22, 38))
        while d.weekday() >= 5:
            d += dt.timedelta(days=1)
        return d, r.choice(["BeforeMarket", "AfterMarket"])

    @staticmethod
    def _eps_surprise(ticker: str, quarter_end: dt.date) -> float:
        """EPS-Überraschung in % (unabhängig vom Kursverlauf, damit Kurs und ERN sie teilen)."""
        return _rng("eps", ticker, quarter_end.isoformat()).gauss(4.0, 6.0)

    @staticmethod
    def _guidance(ticker: str, report_day: dt.date, beat: bool) -> Optional[str]:
        """Prognoseänderung mit dem Bericht: "up", "confirm", "down" oder None."""
        r = _rng("guide", ticker, report_day.isoformat())
        if r.random() >= 0.5:
            return None
        return "up" if beat and r.random() < 0.7 else "confirm" if beat else "down"

    @classmethod
    def _consensus(cls, ticker: str, quarter_end: dt.date, actual_eps: float) -> float:
        """Konsensschätzung, aus der das Ist-EPS mit der Überraschung des Quartals hervorgeht."""
        s = cls._eps_surprise(ticker, quarter_end) / 100
        return actual_eps / (1 + s) if actual_eps > 0 else actual_eps * (1 + s)

    def _earnings_shocks(self, ticker: str, first: dt.date, last: dt.date) -> dict[dt.date, float]:
        """Log-Kurssprung am Reaktionstag je Bericht: Überraschung und Prognose bewegen den Kurs.
        Vorbörsliche Berichte wirken am Berichtstag, nachbörsliche am nächsten Handelstag."""
        out: dict[dt.date, float] = {}
        group = self.session_group(ticker)
        y, q = first.year - 1, 1
        while True:
            end = [dt.date(y, 3, 31), dt.date(y, 6, 30), dt.date(y, 9, 30), dt.date(y, 12, 31)][q - 1]
            rep, timing = self._report_date(ticker, end)
            if rep > last:
                break
            day = rep if timing == "BeforeMarket" else rep + dt.timedelta(days=1)
            # Nächster Handelstag des Platzes: An einem Feiertag (z. B. 1. Mai) ginge die
            # Eröffnungslücke verloren, weil der Tag später aus der Reihe entfernt wird
            while day.weekday() >= 5 or day in holidays(group, day.year):
                day += dt.timedelta(days=1)
            surprise = self._eps_surprise(ticker, end)
            guide = self._guidance(ticker, rep, surprise >= 0)
            r = _rng("reaction", ticker, end.isoformat())
            jump = 0.0045 * (surprise - 3.0) + {"up": 0.02, "down": -0.035}.get(guide or "", 0.0) + r.gauss(0, 0.015)
            out[day] = max(-0.25, min(0.25, jump))
            q += 1
            if q == 5:
                q, y = 1, y + 1
        return out

    def _release_time(self, ticker: str, day: dt.date, timing: Optional[str]) -> dt.datetime:
        """Veröffentlichung: vorbörslich 75 Min. vor Handelsbeginn, sonst 10 Min. nach Schluss."""
        start, end = self._session_bounds(ticker, day)
        return start - dt.timedelta(minutes=75) if timing == "BeforeMarket" else end + dt.timedelta(minutes=10)

    def _released(self, ticker: str, quarter_end: dt.date) -> bool:
        """Sind die Zahlen dieses Quartals schon veröffentlicht? Am Berichtstag zählt die Uhrzeit:
        Vor einem Bericht nach Börsenschluss zeigte ERN sonst schon das Ist-EPS, die News noch nicht."""
        rep, timing = self._report_date(ticker, quarter_end)
        now = self.now()
        if abs((rep - now.date()).days) > 1:
            return rep < now.date()
        return self._release_time(ticker, rep, timing) <= now

    def _fiscal(self, ticker: str) -> tuple[list[dt.date], list[dt.date]]:
        """Geschäftsjahre und bereits berichtete Quartale (je Unternehmen verschieden)."""
        today = self.today()
        quarters: list[dt.date] = []
        y, q = today.year, 4
        while len(quarters) < 10:
            end = [dt.date(y, 3, 31), dt.date(y, 6, 30), dt.date(y, 9, 30), dt.date(y, 12, 31)][q - 1]
            if self._released(ticker, end):
                quarters.append(end)
            q -= 1
            if q == 0:
                q, y = 4, y - 1
        # Das Geschäftsjahr erscheint mit dem Bericht zum vierten Quartal (früher pauschal ab
        # 1. März: im Februar fehlte das Jahr, obwohl Q4 schon berichtet war)
        last_fy = next(e.year for e in quarters if e.month == 12)
        years = [dt.date(last_fy - k, 12, 31) for k in range(6)]
        return years, quarters

    _BENCHMARKS = {"US": "GSPC.INDX", "XETRA": "GDAXI.INDX", "PA": "FCHI.INDX", "LSE": "FTSE.INDX",
                   "SW": "SSMI.INDX", "AS": "STOXX50E.INDX"}

    def _realized_beta(self, ticker: str) -> Optional[float]:
        """Beta aus der Kurshistorie (1 Jahr, Tagesrenditen gegen den Heimatindex) – so passt die
        Kennzahl in DES zum Chart, statt aus einem Sektorwert geschätzt zu sein."""
        bench = self._BENCHMARKS.get(ticker.rpartition(".")[2], "GSPC.INDX")
        s, b = self._daily(ticker), self._daily(bench)
        today = self.today()
        cutoff = today - dt.timedelta(days=365)
        mb = dict(zip(b["days"], b["c"]))
        pairs = [(c, mb[d]) for d, c in zip(s["days"], s["c"]) if cutoff <= d < today and d in mb]  # ohne den laufenden Tag
        rs = [math.log(pairs[k][0] / pairs[k - 1][0]) for k in range(1, len(pairs))]
        rb = [math.log(pairs[k][1] / pairs[k - 1][1]) for k in range(1, len(pairs))]
        if len(rs) < 60:
            return None
        mr, mbr = sum(rs) / len(rs), sum(rb) / len(rb)
        cov = sum((x - mr) * (y - mbr) for x, y in zip(rs, rb))
        var = sum((y - mbr) ** 2 for y in rb)
        return round(cov / var, 2) if var else None

    def _fundamentals_raw(self, ticker: str) -> dict:
        self._require(ticker)
        if ticker not in _COMPANY:
            raise NotFound(f"Für {self.name(ticker)} gibt es keine Unternehmensdaten.")
        years, quarters = self._fiscal(ticker)
        # Neuester veröffentlichter Quartalsbericht im Schlüssel: Am Berichtstag ändern sich die
        # Daten zur Veröffentlichungszeit, nicht erst am nächsten Tag
        key = (ticker, self.today(), quarters[0])
        if key in self._fund_cache:
            return self._fund_cache[key]
        code, name, exch, sector, industry, mcap_bn = _COMPANY[ticker]
        cur, country, _ = D.EXCHANGE_INFO[exch]
        sp = D.SECTORS[sector]
        rng = _rng("fund", ticker)
        series = self._effective(ticker)
        price = series["c"][-1]
        shares = self._shares(ticker, self._daily(ticker)["days"], self._daily(ticker)["c"])
        mcap = shares * price

        growth = sp[4] + rng.gauss(0, 0.04)
        rev0 = mcap_bn * 1e9 / sp[0] * rng.uniform(0.8, 1.25)
        gross_m = min(max(sp[2] + rng.gauss(0, 0.04), 0.1), 0.95)
        op_m = min(max(sp[3] + rng.gauss(0, 0.03), 0.02), gross_m - 0.02)
        rd_share = rng.uniform(0.10, 0.18) if sector in ("Technology", "Healthcare") else rng.uniform(0.0, 0.02)
        asset_ratio = {"Financial Services": 8.0, "Utilities": 3.0, "Real Estate": 6.0}.get(sector, rng.uniform(1.0, 1.6))
        eq_ratio = 0.09 if sector == "Financial Services" else rng.uniform(0.3, 0.55)
        payer = rng.random() < sp[5]
        payout = sp[6] * rng.uniform(0.8, 1.2) if payer else 0.0
        capex_share = rng.uniform(0.03, 0.10)

        def income(rev: float, r: random.Random) -> dict[str, float]:
            gm = gross_m + r.gauss(0, 0.01)
            om = op_m + r.gauss(0, 0.012)
            gross = rev * gm
            rd = rev * rd_share
            op = rev * om
            sga = max(gross - op - rd, 0.0)
            da = rev * 0.04
            debt = rev * asset_ratio * 0.2
            interest = debt * 0.04 * (0.25 if sector == "Financial Services" else 1.0)
            pretax = op - interest
            tax = pretax * 0.22 if pretax > 0 else 0.0
            net = pretax - tax
            return {
                "totalRevenue": rev, "costOfRevenue": rev - gross, "grossProfit": gross,
                "researchDevelopment": rd, "sellingGeneralAdministrative": sga, "operatingIncome": op,
                "ebitda": op + da, "interestExpense": interest, "incomeBeforeTax": pretax,
                "incomeTaxExpense": tax, "netIncome": net, "_da": da,
            }

        def fmt(rec: dict[str, float], date: dt.date) -> dict[str, Any]:
            out: dict[str, Any] = {"date": date.isoformat()}
            for k, v in rec.items():
                if not k.startswith("_"):
                    out[k] = f"{v:.2f}"
            return out

        def balance(rev: float, r: random.Random) -> dict[str, float]:
            assets = rev * asset_ratio * r.uniform(0.95, 1.05)
            equity = assets * eq_ratio
            debt = assets * (0.15 if sector == "Financial Services" else 0.2)
            cash = assets * r.uniform(0.08, 0.16)
            goods = sector in ("Consumer Cyclical", "Consumer Defensive", "Industrials", "Basic Materials", "Technology")
            current_assets = assets * (0.55 if sector == "Financial Services" else r.uniform(0.3, 0.45))
            current_liab = (assets - equity) * r.uniform(0.35, 0.55)
            return {
                "cash": cash, "netReceivables": rev * 0.12, "inventory": rev * 0.08 if goods else 0.0,
                "totalCurrentAssets": current_assets, "nonCurrentAssetsTotal": assets - current_assets,
                "totalAssets": assets, "totalCurrentLiabilities": current_liab,
                "nonCurrentLiabilitiesTotal": assets - equity - current_liab, "shortLongTermDebtTotal": debt,
                "totalLiab": assets - equity, "totalStockholderEquity": equity, "netDebt": debt - cash,
            }

        def cashflow(inc: dict[str, float], r: random.Random, divs: float) -> dict[str, float]:
            cfo = inc["netIncome"] + inc["_da"] + inc["totalRevenue"] * r.gauss(0.01, 0.015)
            capex = inc["totalRevenue"] * capex_share
            buyback = -max(inc["netIncome"], 0) * r.uniform(0.0, 0.35)
            return {
                "totalCashFromOperatingActivities": cfo, "capitalExpenditures": capex,
                "freeCashFlow": cfo - capex, "totalCashflowsFromInvestingActivities": -capex * r.uniform(1.0, 1.4),
                "totalCashFromFinancingActivities": -divs + buyback + inc["totalRevenue"] * r.gauss(0, 0.02),
                "dividendsPaid": -divs, "salePurchaseOfStock": buyback,
            }

        # Erst alle Quartale erzeugen, dann das Geschäftsjahr als Summe der vier Quartale
        # (GuV und Cashflow) bzw. als Stichtagswert des vierten Quartals (Bilanz). So passen
        # Jahres- und Quartalsansicht in FA und das TTM-EPS in DES zusammen.
        season = [0.95, 1.0, 1.0, 1.05]

        def level(year: int) -> float:
            # Fest am Stichtagsjahr verankert: Mit dem jeweils neuesten Geschäftsjahr als Anker
            # änderten sich beim Jahreswechsel der Berichte alle historischen Zahlen rückwirkend
            return rev0 * (1 + growth) ** (year - ANCHOR.year)

        all_quarters: list[dt.date] = []
        y, qn = years[-1].year, 1
        newest = max(quarters[0], years[0]) if quarters else years[0]
        while True:
            end = [dt.date(y, 3, 31), dt.date(y, 6, 30), dt.date(y, 9, 30), dt.date(y, 12, 31)][qn - 1]
            if end > newest:
                break
            all_quarters.append(end)
            qn += 1
            if qn == 5:
                qn, y = 1, y + 1

        def quarter_net(end: dt.date) -> float:
            """Nettoergebnis eines Quartals – auch eines noch nicht berichteten (Konsens, Dividende)."""
            r = _rng("fq", ticker, end.isoformat())
            rev = level(end.year) / 4 * season[(end.month - 1) // 3] * r.uniform(0.97, 1.03)
            return income(rev, r)["netIncome"]

        @lru_cache(maxsize=None)
        def dps_of(year: int) -> float:
            """Dividende je Aktie für ``year`` aus dem Gewinn des Vorjahres. Fest je Jahr: früher
            hing sie am aktuellen TTM-EPS, und mit jedem Bericht änderte sich die ganze Historie."""
            prior = sum(quarter_net(dt.date(year - 1, m, d)) for m, d in ((3, 31), (6, 30), (9, 30), (12, 31)))
            return max(prior, 0.0) * payout / shares

        def dividends_paid(end: dt.date) -> float:
            # US: vierteljährlich; Europa: einmal im Jahr nach der Hauptversammlung (Q2)
            if exch == "US":
                return dps_of(end.year) / 4 * shares
            return dps_of(end.year) * shares if end.month == 6 else 0.0

        q_data: dict[dt.date, tuple[dict[str, float], dict[str, float], dict[str, float]]] = {}
        for end in all_quarters:
            r = _rng("fq", ticker, end.isoformat())
            rev = level(end.year) / 4 * season[(end.month - 1) // 3] * r.uniform(0.97, 1.03)
            inc = income(rev, r)
            q_data[end] = (inc, balance(rev * 4, r), cashflow(inc, r, dividends_paid(end)))

        q_inc: dict[str, Any] = {}
        q_bal: dict[str, Any] = {}
        q_cf: dict[str, Any] = {}
        q_net: dict[dt.date, float] = {}
        q_rev: dict[dt.date, float] = {}
        for end in quarters:
            inc, bal, cf = q_data[end]
            q_rev[end] = inc["totalRevenue"]
            q_net[end] = inc["netIncome"]
            q_inc[end.isoformat()] = fmt(inc, end)
            q_bal[end.isoformat()] = fmt(bal, end)
            q_cf[end.isoformat()] = fmt(cf, end)

        yearly_inc: dict[str, Any] = {}
        yearly_bal: dict[str, Any] = {}
        yearly_cf: dict[str, Any] = {}
        for end in years:
            parts = [q_data[q] for q in all_quarters if q.year == end.year]
            if len(parts) != 4:
                continue
            inc_y = {k: sum(p[0][k] for p in parts) for k in parts[0][0]}
            cf_y = {k: sum(p[2][k] for p in parts) for k in parts[0][2]}
            yearly_inc[end.isoformat()] = fmt(inc_y, end)
            yearly_bal[end.isoformat()] = fmt(parts[-1][1], end)
            yearly_cf[end.isoformat()] = fmt(cf_y, end)

        last4 = quarters[:4]
        rev_ttm = sum(q_rev[q] for q in last4)
        net_ttm = sum(q_net[q] for q in last4)
        eps_ttm = net_ttm / shares
        prev4 = quarters[4:8]
        rev_prev = sum(q_rev[q] for q in prev4) if len(prev4) == 4 else None
        latest_q, year_ago_q = quarters[0], quarters[4] if len(quarters) > 4 else None
        ebitda_ttm = sum(float(q_inc[q.isoformat()]["ebitda"]) for q in last4)
        bal_latest = q_bal[quarters[0].isoformat()]
        equity = float(bal_latest["totalStockholderEquity"])
        assets = float(bal_latest["totalAssets"])
        net_debt = float(bal_latest["netDebt"])
        ev = mcap + net_debt
        dps = dps_of(self.today().year)  # indizierte Jahresdividende
        eps_cy = eps_ttm * (1 + growth * 0.5)
        eps_ny = eps_cy * (1 + growth)

        # Technische Kennzahlen bis zum Vortagesschluss wie bei EODHD (die Tagesreihe enthält schon den
        # erst am Abend feststehenden Schlusskurs – das ergab einen Blick in die Zukunft)
        daily = self._daily(ticker)
        hist_closes = [c for d, c in zip(daily["days"], daily["c"]) if d < self.today()]
        tech_hi, tech_lo = metrics.window_high_low([d.isoformat() for d in series["days"]], series["h"], series["l"])
        # Kursziel nach dem letzten Bericht festgelegt, nicht täglich mit dem Kurs mitlaufend
        last_report = self._report_date(ticker, quarters[0])[0]
        ref = next((c for d, c in zip(reversed(series["days"]), reversed(series["c"])) if d <= last_report), price)
        target = ref * rng.uniform(0.95, 1.30)
        n_analysts = rng.randint(6, 38)
        mood = rng.uniform(-0.3, 1.0)
        sb = int(n_analysts * max(0.0, 0.25 + 0.25 * mood))
        b = int(n_analysts * max(0.0, 0.25 + 0.15 * mood))
        s = int(n_analysts * max(0.0, 0.10 - 0.1 * mood))
        ss = int(n_analysts * max(0.0, 0.05 - 0.05 * mood))
        hold = max(n_analysts - sb - b - s - ss, 0)
        total = max(sb + b + hold + s + ss, 1)
        rating = (5 * sb + 4 * b + 3 * hold + 2 * s + 1 * ss) / total

        earnings_hist: dict[str, Any] = {}
        for q in quarters[:8]:
            actual = q_net[q] / shares
            surprise = self._eps_surprise(ticker, q)
            # Konsens vor und nach dem Bericht identisch (früher wurde er beim Bericht ersetzt)
            est = self._consensus(ticker, q, actual)
            rep, timing = self._report_date(ticker, q)
            earnings_hist[q.isoformat()] = {
                "reportDate": rep.isoformat(), "date": q.isoformat(),
                "beforeAfterMarket": timing, "currency": cur,
                "epsActual": round(actual, 4), "epsEstimate": round(est, 4),
                "epsDifference": round(actual - est, 4), "surprisePercent": round(surprise, 2),
            }
        # Nächstes Quartalsende: Letzter Tag des Monats drei Monate nach quarters[0]
        # (früher +92 Tage und Monatsanfang−1, was für Q2/Q3 den 31.08./30.11. ergab)
        y, m = divmod(quarters[0].year * 12 + quarters[0].month - 1 + 3 + 1, 12)
        nq = dt.date(y, m + 1, 1) - dt.timedelta(days=1)
        next_rep, next_timing = self._report_date(ticker, nq)
        earnings_hist[nq.isoformat()] = {
            "reportDate": next_rep.isoformat(), "date": nq.isoformat(), "beforeAfterMarket": next_timing,
            "currency": cur, "epsActual": None, "epsEstimate": round(self._consensus(ticker, nq, quarter_net(nq) / shares), 4),
            "epsDifference": None, "surprisePercent": None,
        }

        q_growth = pct(q_rev[latest_q], q_rev[year_ago_q]) if year_ago_q else None
        e_growth = pct(q_net[latest_q], q_net[year_ago_q]) if year_ago_q and q_net[year_ago_q] > 0 else None
        officers = {}
        for i, title in enumerate(D.OFFICER_TITLES[: rng.randint(3, 5)]):
            officers[str(i)] = {
                "Name": f"{rng.choice(D.FIRST_NAMES)} {rng.choice(D.LAST_NAMES)}",
                "Title": title,
                "YearBorn": str(rng.randint(1958, 1984)),
            }

        raw = {
            "General": {
                "Code": code, "Type": "Common Stock", "Name": name, "Exchange": exch, "CurrencyCode": cur,
                "CountryName": country, "Sector": sector, "Industry": industry,
                "Description": (
                    f"{name} ist ein frei erfundenes Unternehmen aus dem Demo-Datensatz dieses Terminals. "
                    f"Es ist im Bereich {industry} ({sector}) tätig und an der Börse {exch} gelistet. "
                    "Alle Kurse, Kennzahlen, Finanzberichte und Nachrichten sind synthetisch erzeugt und "
                    "dienen nur dazu, die Funktionen des Terminals ohne Datenabonnement zu zeigen."
                ),
                "FullTimeEmployees": int(rev0 / rng.uniform(250_000, 900_000)),
                "WebURL": None, "IPODate": f"{rng.randint(1985, 2019)}-{rng.randint(1, 12):02d}-15",
                "ISIN": None, "Officers": officers, "UpdatedAt": self.today().isoformat(),
            },
            "Highlights": {
                "MarketCapitalization": round(mcap), "EBITDA": round(ebitda_ttm),
                "PERatio": round(price / eps_ttm, 2) if eps_ttm > 0 else None,
                # PEG nur bei echtem Gewinnwachstum aussagekräftig
                "PEGRatio": round(price / eps_ttm / (growth * 100), 2) if eps_ttm > 0 and growth > 0.01 else None,
                "WallStreetTargetPrice": round(target, 2), "BookValue": round(equity / shares, 2),
                "DividendShare": round(dps, 4) if payer else 0, "DividendYield": round(dps / price, 5) if payer else 0,
                "EarningsShare": round(eps_ttm, 4), "EPSEstimateCurrentYear": round(eps_cy, 4),
                "EPSEstimateNextYear": round(eps_ny, 4), "ProfitMargin": round(net_ttm / rev_ttm, 4),
                "OperatingMarginTTM": round(op_m, 4), "ReturnOnAssetsTTM": round(net_ttm / assets, 4),
                "ReturnOnEquityTTM": round(net_ttm / equity, 4), "RevenueTTM": round(rev_ttm),
                "QuarterlyRevenueGrowthYOY": None if q_growth is None else round(q_growth / 100, 4),
                "QuarterlyEarningsGrowthYOY": None if e_growth is None else round(e_growth / 100, 4),
            },
            "Valuation": {
                "TrailingPE": round(price / eps_ttm, 2) if eps_ttm > 0 else None,
                "ForwardPE": round(price / eps_ny, 2) if eps_ny > 0 else None,
                "PriceSalesTTM": round(mcap / rev_ttm, 2), "PriceBookMRQ": round(mcap / equity, 2),
                "EnterpriseValue": round(ev), "EnterpriseValueRevenue": round(ev / rev_ttm, 2),
                "EnterpriseValueEbitda": round(ev / ebitda_ttm, 2) if ebitda_ttm > 0 else None,
            },
            "Technicals": {
                "Beta": self._realized_beta(ticker),
                "52WeekHigh": round(tech_hi, 2) if tech_hi else None, "52WeekLow": round(tech_lo, 2) if tech_lo else None,
                "50DayMA": round(metrics.sma(hist_closes, 50) or 0, 2), "200DayMA": round(metrics.sma(hist_closes, 200) or 0, 2),
            },
            "SharesStats": {
                "SharesOutstanding": round(shares), "SharesFloat": round(shares * rng.uniform(0.75, 0.99)),
                "PercentInsiders": round(rng.uniform(0.1, 12), 2), "PercentInstitutions": round(rng.uniform(35, 85), 2),
            },
            "AnalystRatings": {
                "Rating": round(rating, 2), "TargetPrice": round(target, 2), "StrongBuy": sb, "Buy": b,
                "Hold": hold, "Sell": s, "StrongSell": ss,
            },
            "Earnings": {"History": earnings_hist},
            "Financials": {
                "Income_Statement": {"currency_symbol": cur, "yearly": yearly_inc, "quarterly": q_inc},
                "Balance_Sheet": {"currency_symbol": cur, "yearly": yearly_bal, "quarterly": q_bal},
                "Cash_Flow": {"currency_symbol": cur, "yearly": yearly_cf, "quarterly": q_cf},
            },
            "_meta": {
                "payer": payer, "dps": dps, "growth": growth, "shares": shares,
                "dps_by_year": {y: dps_of(y) for y in range(self.today().year - 10, self.today().year + 1)},
            },
        }
        if len(self._fund_cache) > 200:
            self._fund_cache.clear()
        self._fund_cache[key] = raw
        return raw

    async def company(self, ticker: str) -> Company:
        return mapping.company(self._fundamentals_raw(ticker), ticker)

    async def financials(self, ticker: str, period: str) -> Financials:
        return mapping.financials(self._fundamentals_raw(ticker), ticker, period)

    async def earnings(self, ticker: str) -> Earnings:
        return mapping.earnings(self._fundamentals_raw(ticker), ticker, today=self.today())

    async def dividends(self, ticker: str) -> Dividends:
        raw = self._fundamentals_raw(ticker)
        meta = raw["_meta"]
        code, _, exch, *_ = _COMPANY[ticker]
        cur = D.EXCHANGE_INFO[exch][0]
        divs: list[dict] = []
        if meta["payer"] and meta["dps"] > 0:
            today = self.today()
            for year in range(today.year - 10, today.year + 1):
                annual = meta["dps_by_year"][year]
                if exch == "US":
                    dates = [dt.date(year, m, 10) for m in (2, 5, 8, 11)]
                    per = annual / 4
                else:
                    dates = [dt.date(year, 5, 6)]
                    per = annual
                for d in dates:
                    d = d + dt.timedelta(days=(7 - d.weekday()) % 7 if d.weekday() >= 5 else 0)
                    if d > today:
                        continue
                    divs.append({
                        "date": d.isoformat(), "paymentDate": (d + dt.timedelta(days=21)).isoformat(),
                        "value": round(per, 4), "currency": cur,
                    })
        splits = {
            "NWND.US": [{"date": "2020-08-31", "split": "2.000000/1.000000"}],
            "QBIT.US": [{"date": "2021-07-20", "split": "4.000000/1.000000"}],
            "VLTA.US": [{"date": "2022-08-25", "split": "3.000000/1.000000"}],
        }.get(ticker, [])
        out = mapping.dividends(divs, splits, ticker, today=self.today())
        price = self._effective(ticker)["c"][-1]
        out.yield_ttm = round(out.ttm / price, 5) if out.ttm and price else None
        return out

    # --- News ------------------------------------------------------------------------

    def _report_index(self) -> dict[dt.date, list[tuple[str, dict]]]:
        """Berichtstermine aller Unternehmen (aus den Earnings-Daten), nach Datum."""
        # Wie bei _fundamentals_raw: Schlüssel enthält den Veröffentlichungsstand aller Unternehmen
        key = ("reports", self.today(), tuple(self._fiscal(t)[1][0] for t in COMPANY_TICKERS))
        cached = self._fund_cache.get(key)  # type: ignore[arg-type]
        if cached is not None:
            return cached  # type: ignore[return-value]
        out: dict[dt.date, list[tuple[str, dict]]] = {}
        for t in COMPANY_TICKERS:
            for rec in self._fundamentals_raw(t)["Earnings"]["History"].values():
                if rec.get("epsActual") is None or not rec.get("reportDate"):
                    continue
                out.setdefault(dt.date.fromisoformat(rec["reportDate"]), []).append((t, rec))
        self._fund_cache[key] = out  # type: ignore[index]
        return out

    def _news_day(self, day: dt.date) -> list[NewsItem]:
        items: list[NewsItem] = []
        weekend = day.weekday() >= 5
        # Quartalszahlen erscheinen genau an den Berichtsterminen aus ERN
        if not weekend:
            for i, (t, rec) in enumerate(self._report_index().get(day, [])):
                items.extend(self._earnings_story(_COMPANY[t], rec, day, i))
        # Unternehmensmeldungen: je Unternehmen und Meldungsart höchstens eine pro Zeitfenster,
        # an einem festen Werktag (sonst stufte "ein Analyst" denselben Titel zweimal am Tag hoch)
        if not weekend:
            for c in D.COMPANIES:
                ticker = f"{c[0]}.{c[2]}"
                for kind, window in _STORY_WINDOWS.items():
                    # Banken, Versicherer und Immobilien erhalten keine "Aufträge" und haben keine Produktion
                    if kind in ("order", "outage") and c[3] in ("Financial Services", "Real Estate"):
                        continue
                    hit = self._story_day(ticker, kind, window * self._news_scale(c), day)
                    if hit is not None:
                        r, minute = hit
                        when = dt.datetime(day.year, day.month, day.day, tzinfo=UTC) + dt.timedelta(minutes=minute)
                        items.append(self._company_story(c, when, r, 0, kind=kind))
                # Übernahmen: höchstens eine je Unternehmen und 30-Tage-Fenster
                hit = self._mna_day(ticker, day)
                if hit is not None:
                    r, minute = hit
                    when = dt.datetime(day.year, day.month, day.day, tzinfo=UTC) + dt.timedelta(minutes=minute)
                    items.append(self._company_story(c, when, r, 0, kind="mna"))
        # Markt- und Makromeldungen aus den synthetischen Kursen und dem Kalender
        items.extend(self._market_stories(day))
        return items

    def _earnings_story(self, c: tuple, rec: dict, day: dt.date, i: int) -> list[NewsItem]:
        code, name, exch, sector, industry, _ = c
        ticker = f"{code}.{exch}"
        cur = D.EXCHANGE_INFO[exch][0]
        when = self._release_time(ticker, day, rec.get("beforeAfterMarket"))
        surprise = rec.get("surprisePercent") or 0.0
        q = (dt.date.fromisoformat(rec["date"]).month - 1) // 3 + 1
        # Ungerundete Überraschung wie beim Kurssprung (_earnings_shocks): Gerundet wird −0,002 %
        # zu −0,0 und damit zu "übertrifft" samt anderer Prognose als die Kursreaktion
        beat = self._eps_surprise(ticker, dt.date.fromisoformat(rec["date"])) >= 0
        title = (
            f"{name} übertrifft Gewinnerwartungen im {q}. Quartal" if beat else f"{name} verfehlt Gewinnerwartungen im {q}. Quartal"
        )
        content = (
            f"{name} meldete für das {q}. Quartal einen Gewinn je Aktie von {_de(rec['epsActual'], 2)} {cur}. "
            f"Analysten hatten im Schnitt {_de(rec['epsEstimate'], 2)} {cur} erwartet, die Abweichung beträgt "
            f"{_de(surprise, 1, sign=True)} %."
        )
        ident = hashlib.sha1(f"earn|{ticker}|{day}|{i}".encode()).hexdigest()[:16]
        items = [
            NewsItem(
                id=ident,
                date=when.isoformat().replace("+00:00", "Z"),
                title=title,
                content=content,
                source="DEMO-WIRE",
                symbols=[ticker],
                tags=["EARNINGS", sector.upper()],
                topic="earnings",
                sentiment=Sentiment(polarity=round(max(-1.0, min(1.0, surprise / 10)), 3)),
                urgent=abs(surprise) >= 5,
            )
        ]
        guide = self._guidance(ticker, day, beat)
        if guide is not None:
            up = guide == "up"
            items.append(
                NewsItem(
                    id=ident + "g",
                    date=(when + dt.timedelta(minutes=12)).isoformat().replace("+00:00", "Z"),
                    title=f"{name} {'hebt Jahresprognose an' if up else 'bestätigt Jahresprognose' if beat else 'senkt Jahresprognose'}",
                    content=f"Mit den Quartalszahlen hat {name} den Ausblick für das Gesamtjahr {'angehoben' if up else 'bestätigt' if beat else 'gesenkt'}.",
                    source="DEMO-WIRE",
                    symbols=[ticker],
                    tags=["EARNINGS", "GUIDANCE"],
                    topic="earnings",
                    sentiment=Sentiment(polarity=0.5 if up else 0.1 if beat else -0.5),
                )
            )
        return items

    @staticmethod
    def _news_scale(c: tuple) -> float:
        """Kleinere Unternehmen erscheinen seltener in den Nachrichten (längere Fenster)."""
        biggest = max(x[5] for x in D.COMPANIES)
        return min(3.0, max(1.0, (biggest / c[5]) ** 0.35))

    @staticmethod
    def _story_day(ticker: str, kind: str, window: float, day: dt.date) -> tuple[random.Random, int] | None:
        """Meldung ``kind`` zu ``ticker`` an ``day``? Höchstens eine je Fenster, nur an Werktagen."""
        size = max(1, round(window))
        slot = day.toordinal() // size
        r = _rng("story", ticker, kind, size, slot)
        start = slot * size
        # Termin im ersten Teil des Fensters: zwei Meldungen benachbarter Fenster liegen so
        # mindestens ein Drittel des Fensters auseinander (nicht an zwei Tagen hintereinander)
        weekdays = [o for o in range(start, start + max(1, 2 * size // 3)) if dt.date.fromordinal(o).weekday() < 5]
        if not weekdays or dt.date.fromordinal(weekdays[r.randrange(len(weekdays))]) != day:
            return None
        return r, r.randint(7 * 60, 21 * 60)

    @staticmethod
    def _mna_day(ticker: str, day: dt.date) -> tuple[random.Random, int] | None:
        """Übernahmemeldung für ``ticker`` an ``day``: (Zufallsquelle, Minute) oder None."""
        slot = day.toordinal() // 30
        r = _rng("mna-slot", ticker, slot)
        if r.random() >= 0.2:
            return None
        start = slot * 30
        weekdays = [o for o in range(start, start + 20) if dt.date.fromordinal(o).weekday() < 5]
        if dt.date.fromordinal(weekdays[r.randrange(len(weekdays))]) != day:
            return None
        return r, r.randint(7 * 60, 9 * 60)

    def _company_story(self, c: tuple, when: dt.datetime, rng: random.Random, i: int, kind: str | None = None) -> NewsItem:
        code, name, exch, sector, industry_en, _ = c
        industry = D.INDUSTRY_DE.get(industry_en, industry_en)
        ticker = f"{code}.{exch}"
        cur = D.EXCHANGE_INFO[exch][0]
        if kind is None:
            kind = rng.choices(
                ["up", "down", "buyback", "order", "cfo", "outage", "jobs", "product"],
                weights=[7, 5, 4, 5, 3, 2, 2, 5],
            )[0]
        month = when.date().toordinal() // 30
        pct_num = round(abs(rng.gauss(6, 4)) + 1, 1)
        amount_num = round(rng.uniform(0.5, 12), 1)
        pct_val = _de(pct_num, 1)
        amount = _de(amount_num, 1)
        order_mio = amount_num * 100
        order_amount = f"{_de(order_mio / 1000, 2)} Mrd." if order_mio >= 1000 else f"{round(order_mio)} Mio."
        broker = rng.choice(_BROKERS)
        client = rng.choice(_CLIENTS)
        tr = _rng("target", ticker, month)
        target = f"{tr.choice(D.TARGET_PREFIX)} {tr.choice(D.TARGET_SUFFIX)}"
        templates: dict[str, tuple[str, str, str, float]] = {
            "earn_pos": ("earnings", f"{name} übertrifft Gewinnerwartungen deutlich",
                         f"{name} hat im abgelaufenen Quartal einen Gewinn je Aktie gemeldet, der {pct_val} % über der Konsensschätzung lag. Der Umsatz wuchs vor allem im Kerngeschäft {industry}. Das Management bestätigte den Ausblick.", 0.6),
            "earn_neg": ("earnings", f"{name} verfehlt Umsatzprognose, Aktie unter Druck",
                         f"Der Umsatz von {name} lag {pct_val} % unter den Erwartungen der Analysten. Als Gründe nannte das Unternehmen eine schwächere Nachfrage und höhere Kosten.", -0.6),
            "guide_up": ("earnings", f"{name} hebt Jahresprognose an",
                         f"{name} erwartet für das laufende Geschäftsjahr nun ein Umsatzwachstum von rund {pct_val} %. Bisher war das Unternehmen vorsichtiger.", 0.5),
            "guide_down": ("earnings", f"{name} senkt Margenziel",
                           f"{name} rechnet wegen gestiegener Kosten mit einer um {_de(pct_num / 3, 1)} Prozentpunkte niedrigeren operativen Marge.", -0.5),
            "up": ("analyst", f"{broker} stuft {name} auf ‚Kaufen‘ hoch",
                   f"{broker} hat {name} auf ‚Kaufen‘ hochgestuft und sieht {pct_val} % Kurspotenzial. Begründung: bessere Preissetzungsmacht im Bereich {industry}.", 0.4),
            "down": ("analyst", f"{broker} senkt {name} auf ‚Halten‘",
                     f"Nach dem Kursanstieg der vergangenen Monate sieht {broker} bei {name} kaum noch Aufwärtspotenzial und senkt die Einstufung.", -0.3),
            "mna": ("mna", f"{name} übernimmt {target} für {amount} Mrd. {cur}",
                    f"{name} hat eine Vereinbarung zur Übernahme von {target} unterzeichnet. Der Kaufpreis liegt bei {amount} Mrd. {cur}. Die Transaktion soll in zwölf Monaten abgeschlossen sein.", 0.2),
            "buyback": ("company", f"{name} kündigt Aktienrückkauf über {amount} Mrd. {cur} an",
                        f"Der Vorstand von {name} hat ein neues Rückkaufprogramm über {amount} Mrd. {cur} beschlossen.", 0.4),
            "order": ("company", f"{name} erhält Auftrag über {order_amount} {cur}",
                      f"{name} hat von {client} einen mehrjährigen Auftrag mit einem Volumen von rund {order_amount} {cur} gewonnen.", 0.4),
            "cfo": ("company", f"{name} ernennt neuen Finanzvorstand",
                    f"{name} hat {rng.choice(D.FIRST_NAMES)} {rng.choice(D.LAST_NAMES)} zum neuen Finanzvorstand ernannt. Der Wechsel erfolgt zum Quartalsende.", 0.0),
            "outage": ("company", f"Produktionsausfall bei {name}",
                       f"Ein technischer Defekt hat die Produktion von {name} an einem Standort für mehrere Tage gestoppt. Die Auswirkungen auf das Quartal sind noch unklar.", -0.5),
            "jobs": ("company", f"{name} plant Stellenabbau",
                     f"{name} will rund {round(pct_num)} % der Stellen in der Verwaltung streichen, um die Kosten zu senken.", -0.2),
            "product": ("company", f"{name} stellt neue Produktgeneration vor",
                        f"{name} hat eine neue Produktgeneration im Segment {industry} vorgestellt. Der Marktstart ist für das kommende Quartal geplant.", 0.3),
        }
        topic, title, content, polarity = templates[kind]
        polarity = max(-1.0, min(1.0, polarity + rng.gauss(0, 0.15)))
        urgent = kind == "mna" and rng.random() < 0.5
        ident = hashlib.sha1(f"{ticker}|{when.isoformat()}|{i}|{kind}".encode()).hexdigest()[:16]
        return NewsItem(
            id=ident,
            date=when.isoformat().replace("+00:00", "Z"),
            title=title,
            content=content,
            link=None,
            source="DEMO-WIRE",
            symbols=[ticker],
            tags=[topic.upper(), sector.upper()],
            topic=topic,
            sentiment=Sentiment(polarity=round(polarity, 3)),
            urgent=urgent,
        )

    def _market_stories(self, day: dt.date) -> list[NewsItem]:
        out: list[NewsItem] = []
        if day.weekday() >= 5:
            return out
        for ticker, label in (("GDAXI.INDX", "DAX"), ("GSPC.INDX", "S&P 500")):
            s = self._daily(ticker)
            if day not in s["days"]:
                continue  # Feiertag an diesem Handelsplatz
            i = s["days"].index(day)
            if i < 1:
                continue
            chg = pct(s["c"][i], s["c"][i - 1]) or 0.0
            when = self._session_bounds(ticker, day)[1] + dt.timedelta(minutes=5)
            direction = "fester" if chg > 0.15 else "schwächer" if chg < -0.15 else "kaum verändert"
            title = f"Märkte: {label} schließt {direction} ({_de(chg, 2, sign=True)} %)"
            out.append(
                NewsItem(
                    id=hashlib.sha1(f"mkt|{ticker}|{day}".encode()).hexdigest()[:16],
                    date=when.isoformat().replace("+00:00", "Z"),
                    title=title,
                    content=f"Der {label} beendete den Handel bei {_de(s['c'][i], 2)} Punkten ({_de(chg, 2, sign=True)} %).",
                    source="DEMO-WIRE",
                    symbols=[ticker],
                    tags=["MARKETS"],
                    topic="markets",
                    sentiment=Sentiment(polarity=round(max(-1, min(1, chg / 2)), 3)),
                    urgent=abs(chg) > 2.0,
                )
            )
        for ev in self._calendar_day(day):
            if ev.importance < 3 or ev.actual is None:
                continue
            unit = f" {ev.unit}" if ev.unit else ""
            digits = max(_decimals(v) for v in (ev.actual, ev.estimate, ev.previous) if v is not None)

            def f(x: Optional[float]) -> str:
                return "–" if x is None else f"{_de(x, digits)}{unit}"

            diff = round(ev.actual - (ev.estimate if ev.estimate is not None else ev.actual), digits)
            surprise = "über" if diff > 0 else "unter" if diff < 0 else "wie"
            country = {"US": "USA", "DE": "Deutschland", "EU": "Eurozone", "GB": "Großbritannien", "JP": "Japan", "CN": "China"}.get(ev.country, ev.country)
            out.append(
                NewsItem(
                    id=hashlib.sha1(f"eco|{ev.id}".encode()).hexdigest()[:16],
                    date=ev.date,
                    title=f"{country}: {ev.event} bei {f(ev.actual)} – {surprise} Prognose ({f(ev.estimate)})",
                    content=f"Die Veröffentlichung {ev.event} für {ev.period or 'die Berichtsperiode'} lag bei {f(ev.actual)}. Erwartet worden waren {f(ev.estimate)}, der Vorwert lag bei {f(ev.previous)}.",
                    source="DEMO-WIRE",
                    symbols=[],
                    tags=["MACRO", ev.country],
                    topic="macro",
                    sentiment=Sentiment(polarity=0.0),
                    urgent=True,
                )
            )
        return out

    async def news(self, tickers: Optional[list[str]], limit: int) -> list[NewsItem]:
        now = self.now()
        cutoff = now.strftime("%Y-%m-%dT%H:%M:%SZ")
        items: list[NewsItem] = []
        for k in range(0, 10):
            day = now.date() - dt.timedelta(days=k)
            items.extend(n for n in self._news_day(day) if n.date <= cutoff)
        if tickers:
            wanted = set(tickers)
            items = [n for n in items if wanted.intersection(n.symbols)]
        items.sort(key=lambda n: n.date, reverse=True)
        return items

    # --- Makro -------------------------------------------------------------------------

    _EVENTS: list[tuple[str, str, str, tuple, str, Optional[str], float, float, float]] = [
        # Land, Ereignis, Uhrzeit UTC (Sommerzeit; im Winter folgt die Ortszeit), Regel, Einheit-Kürzel, Einheit, Basis, Streuung, Trend/Jahr
        ("US", "Initial Jobless Claims", "12:30", ("weekday", 3), "K", "K", 225, 12, 0),
        ("US", "Nonfarm Payrolls", "12:30", ("nth", 1, 4), "K", "K", 170, 60, 0),
        ("US", "Unemployment Rate", "12:30", ("nth", 1, 4), "%", "%", 4.0, 0.15, 0.05),
        ("US", "CPI YoY", "12:30", ("dom", 12), "%", "%", 2.9, 0.25, 0),
        ("US", "Core CPI MoM", "12:30", ("dom", 12), "%", "%", 0.25, 0.08, 0),
        ("US", "Retail Sales MoM", "12:30", ("dom", 15), "%", "%", 0.3, 0.45, 0),
        ("US", "ISM Manufacturing PMI", "14:00", ("bd", 1), "", None, 49.5, 1.3, 0),
        ("US", "Consumer Confidence", "14:00", ("last", 1), "", None, 99, 4, 0),
        ("US", "PCE Price Index YoY", "12:30", ("last", 4), "%", "%", 2.6, 0.2, 0),
        ("US", "Fed Interest Rate Decision", "18:00", ("cb", (1, 3, 4, 6, 7, 9, 10, 12), 3), "%", "%", 3.75, 0, 0),
        ("US", "GDP Growth Rate QoQ Adv", "12:30", ("q", 29), "%", "%", 2.0, 1.0, 0),
        ("DE", "Ifo Business Climate", "08:00", ("dom", 24), "", None, 87.5, 1.2, 0),
        ("DE", "ZEW Economic Sentiment", "09:00", ("nth", 3, 1), "", None, 20, 9, 0),
        ("DE", "Inflation Rate YoY Prel", "12:00", ("dom", 29), "%", "%", 2.2, 0.2, 0),
        ("DE", "Unemployment Change", "08:55", ("dom", 30), "K", "K", 10, 9, 0),
        ("DE", "Industrial Production MoM", "06:00", ("dom", 7), "%", "%", 0.0, 0.9, 0),
        ("EU", "ECB Interest Rate Decision", "12:15", ("cb", (1, 3, 4, 6, 7, 9, 10, 12), 4), "%", "%", 2.0, 0, 0),
        ("EU", "HCOB Manufacturing PMI Flash", "08:00", ("dom", 23), "", None, 49.0, 1.1, 0),
        ("EU", "Inflation Rate YoY Flash", "09:00", ("bd", 1), "%", "%", 2.1, 0.2, 0),
        ("GB", "Inflation Rate YoY", "06:00", ("dom", 17), "%", "%", 3.4, 0.25, 0),
        ("GB", "GDP MoM", "06:00", ("dom", 13), "%", "%", 0.1, 0.25, 0),
        ("GB", "BoE Interest Rate Decision", "11:00", ("cb", (2, 3, 5, 6, 8, 9, 11, 12), 4), "%", "%", 3.75, 0, 0),
        ("JP", "BoJ Interest Rate Decision", "03:00", ("cb", (1, 3, 4, 6, 7, 9, 10, 12), 5), "%", "%", 0.75, 0, 0),
        ("JP", "Inflation Rate YoY", "23:30", ("dom", 19), "%", "%", 2.8, 0.3, 0),
        ("CN", "Caixin Manufacturing PMI", "01:45", ("bd", 1), "", None, 50.4, 0.8, 0),
        ("CN", "Inflation Rate YoY", "01:30", ("dom", 10), "%", "%", 0.4, 0.4, 0),
        ("CN", "Retail Sales YoY", "02:00", ("dom", 16), "%", "%", 3.5, 0.8, 0),
        ("CN", "Industrial Production YoY", "02:00", ("dom", 16), "%", "%", 5.6, 0.6, 0),
        ("US", "Crude Oil Inventories", "14:30", ("weekday", 2), "M", "M", -1.0, 3.0, 0),
        ("US", "Durable Goods Orders MoM", "12:30", ("dom", 26), "%", "%", 0.3, 1.8, 0),
        ("US", "Existing Home Sales", "14:00", ("dom", 22), "M", "M", 4.1, 0.15, 0),
        ("US", "Building Permits", "12:30", ("dom", 18), "M", "M", 1.42, 0.06, 0),
        ("US", "Michigan Consumer Sentiment", "14:00", ("nth", 2, 4), "", None, 58, 3, 0),
        ("US", "Trade Balance", "12:30", ("dom", 6), "B", "B", -68, 5, 0),
        ("US", "ISM Services PMI", "14:00", ("dom", 3), "", None, 51.5, 1.4, 0),
        ("DE", "GfK Consumer Confidence", "06:00", ("dom", 27), "", None, -22, 2, 0),
        ("DE", "Factory Orders MoM", "06:00", ("dom", 6), "%", "%", 0.2, 2.0, 0),
        ("DE", "Retail Sales MoM", "06:00", ("dom", 31 - 1), "%", "%", 0.1, 1.0, 0),
        ("EU", "Unemployment Rate", "09:00", ("dom", 2), "%", "%", 6.3, 0.1, 0),
        ("EU", "Retail Sales MoM", "09:00", ("dom", 5), "%", "%", 0.2, 0.5, 0),
        ("EU", "ZEW Economic Sentiment", "09:00", ("nth", 3, 1), "", None, 25, 8, 0),
        ("EU", "Consumer Confidence Flash", "14:00", ("dom", 21), "", None, -14.5, 1.2, 0),
        ("GB", "Retail Sales MoM", "06:00", ("dom", 20), "%", "%", 0.2, 0.8, 0),
        ("GB", "Unemployment Rate", "06:00", ("dom", 14), "%", "%", 4.6, 0.1, 0),
        ("JP", "Unemployment Rate", "23:30", ("dom", 28), "%", "%", 2.5, 0.1, 0),
        ("JP", "Industrial Production MoM", "23:50", ("dom", 29), "%", "%", 0.2, 1.5, 0),
    ]

    @staticmethod
    def _matches(rule: tuple, d: dt.date) -> bool:
        kind = rule[0]
        if d.weekday() >= 5:
            return False
        if kind == "weekday":
            return d.weekday() == rule[1]
        if kind == "nth":  # n-ter Wochentag im Monat
            n, wd = rule[1], rule[2]
            return d.weekday() == wd and (d.day - 1) // 7 == n - 1
        if kind == "dom":  # Kalendertag, am Wochenende auf den nächsten Werktag
            target = dt.date(d.year, d.month, min(rule[1], 28 if d.month == 2 else 30))
            while target.weekday() >= 5:
                target += dt.timedelta(days=1)
            return d == target
        if kind == "bd":  # n-ter Werktag
            first = dt.date(d.year, d.month, 1)
            while first.weekday() >= 5:
                first += dt.timedelta(days=1)
            return d == first
        if kind == "last":  # letzter Wochentag wd im Monat
            wd = rule[1]
            nxt = d + dt.timedelta(days=7)
            return d.weekday() == wd and nxt.month != d.month
        if kind == "cb":  # Notenbank: 3. Woche, Wochentag
            months, wd = rule[1], rule[2] - 1
            return d.month in months and d.weekday() == wd and 15 <= d.day <= 21
        if kind == "q":
            return d.month in (1, 4, 7, 10) and DemoProvider._matches(("dom", rule[1]), d)
        return False

    _LAG: dict[str, int] = {
        "Consumer Confidence": 0, "Michigan Consumer Sentiment": 0, "Ifo Business Climate": 0,
        "ZEW Economic Sentiment": 0, "Inflation Rate YoY Prel": 0, "Unemployment Change": 0,
        "HCOB Manufacturing PMI Flash": 0, "Consumer Confidence Flash": 0, "GfK Consumer Confidence": -1,
        "Industrial Production MoM": 2, "Factory Orders MoM": 2, "Trade Balance": 2, "Retail Sales MoM": 1,
        "GDP MoM": 2,
    }
    # Abweichungen, die vom Land abhängen (gleicher Name, andere Veröffentlichungspraxis)
    _LAG_COUNTRY: dict[tuple[str, str], int] = {
        ("EU", "Retail Sales MoM"): 2, ("EU", "Unemployment Rate"): 2, ("GB", "Unemployment Rate"): 2,
        ("JP", "Industrial Production MoM"): 1,
    }
    _MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"]
    # Umfragen und Schnellschätzungen beziehen sich auf den laufenden Monat
    _CURRENT_MONTH = ("Flash", "Prel", "ZEW", "Ifo", "Confidence", "Sentiment", "GfK")

    def _event_period(self, name: str, rule: tuple, d: dt.date, country: str = "") -> tuple[str, int, Optional[str]]:
        """(Frequenz, Periodenindex, Bezeichnung) einer Veröffentlichung."""
        kind = rule[0]
        if kind == "weekday":  # Wochenwerte: Woche bis zum vorangegangenen Samstag
            ref = d - dt.timedelta(days=(d.weekday() - 5) % 7 or 7)
            return "w", ref.toordinal() // 7, f"Woche bis {ref.day:02d}.{ref.month:02d}."
        if kind == "q":  # Quartalszahl für das abgelaufene Quartal
            q = (d.month - 1) // 3
            y = d.year if q else d.year - 1
            q = q or 4
            return "q", y * 4 + q, f"Q{q} {y}"
        if kind == "cb":
            return "cb", d.toordinal(), None
        # Monatswerte: Verzögerung je Statistik (0 = Umfrage für den laufenden Monat,
        # 1 = Vormonat, 2 = harte Daten wie Produktion oder Handelsbilanz, −1 = Prognose
        # für den Folgemonat wie GfK). Ein Monatswert erscheint nie wenige Tage nach Monatsende.
        lag = self._LAG_COUNTRY.get((country, name), self._LAG.get(name, 1))
        idx = d.year * 12 + (d.month - 1) - lag
        y, m0 = divmod(idx, 12)
        return "m", y * 12 + m0 + 1, f"{self._MONTHS[m0]} {y}"

    def _event_value(
        self, country: str, name: str, base: float, spread: float, freq: str, idx: int, d: dt.date
    ) -> tuple[float, float, float]:
        """(Ist, Prognose, Vorwert). Der Vorwert ist der Ist-Wert der Vorperiode."""

        def rate(day: dt.date) -> float:  # Leitzins aus der Zinskurve
            cc = {"US": "US", "EU": "DE", "GB": "UK", "JP": "JP"}[country]
            short, _ = _interp(D.CURVE_KNOTS[cc], day)
            step = 20 if country == "JP" else 4
            return round(max(short, 0.0) * step) / step

        def level(i: int) -> float:
            r1 = _rng("ev", country, name, freq, i).gauss(0, 1)
            r2 = _rng("ev", country, name, freq, i - 1).gauss(0, 1)
            return base + spread * (0.7 * r1 + 0.5 * r2)

        if freq == "cb":
            actual, previous = rate(d), rate(d - dt.timedelta(days=42))
            estimate = actual
        else:
            actual, previous = level(idx), level(idx - 1)
            estimate = actual - _rng("est", country, name, freq, idx).gauss(0, spread * 0.35)
        digits = 0 if abs(base) >= 50 and spread >= 1 else 1 if abs(base) >= 5 else 2
        return round(actual, digits), round(estimate, digits), round(previous, digits)

    _EVENT_TZ = {"US": "America/New_York", "DE": "Europe/Berlin", "EU": "Europe/Berlin", "GB": "Europe/London",
                 "JP": "Asia/Tokyo", "CN": "Asia/Shanghai"}

    @classmethod
    def _event_time(cls, country: str, d: dt.date, hh: int, mm: int) -> dt.datetime:
        """Termin in UTC. Die Tabelle nennt UTC-Zeiten im Sommer; veröffentlicht wird zur festen
        Ortszeit (NFP 08:30 New York), im Winter also eine Stunde später in UTC."""
        tz = ZoneInfo(cls._EVENT_TZ.get(country, "UTC"))
        summer = dt.datetime(d.year, 7, 1, tzinfo=tz).utcoffset() or dt.timedelta(0)
        local = dt.datetime(d.year, d.month, d.day, hh, mm) + summer
        return local.replace(tzinfo=tz).astimezone(UTC)

    def _calendar_day(self, d: dt.date) -> list[EconEvent]:
        out: list[EconEvent] = []
        now = self.now()
        for country, name, time, rule, unit_suffix, unit, base, spread, _ in self._EVENTS:
            if not self._matches(rule, d):
                continue
            hh, mm = (int(x) for x in time.split(":"))
            when = self._event_time(country, d, hh, mm)
            freq, idx, period = self._event_period(name, rule, d, country)
            actual, estimate, previous = self._event_value(country, name, base, spread, freq, idx, d)
            released = when <= now
            if not released and self._previous_release(rule, d, country, hh, mm) > now:
                # Vorperiode noch nicht veröffentlicht: Vorwert ist noch unbekannt
                previous = None
            ident = hashlib.sha1(f"{country}|{name}|{d}".encode()).hexdigest()[:16]
            out.append(
                EconEvent(
                    id=ident,
                    date=when.isoformat().replace("+00:00", "Z"),
                    country=country,
                    event=name,
                    period=period,
                    actual=actual if released else None,
                    estimate=estimate,
                    previous=previous,
                    surprise=round(actual - estimate, 4) if released else None,
                    importance=mapping.importance(name),
                    unit=unit,
                )
            )
        return out

    def _previous_release(self, rule: tuple, d: dt.date, country: str, hh: int, mm: int) -> dt.datetime:
        """Zeitpunkt der vorherigen Veröffentlichung derselben Statistik (mit deren Ortszeit,
        über eine Zeitumstellung hinweg also nicht einfach eine Woche früher in UTC)."""
        x = d - dt.timedelta(days=1)
        for _ in range(130):
            if self._matches(rule, x):
                return self._event_time(country, x, hh, mm)
            x -= dt.timedelta(days=1)
        return self._event_time(country, d - dt.timedelta(days=365), hh, mm)

    async def calendar(self, start: dt.date, end: dt.date, country: Optional[str]) -> list[EconEvent]:
        out: list[EconEvent] = []
        d = start
        while d <= end:
            out.extend(self._calendar_day(d))
            d += dt.timedelta(days=1)
        if country:
            out = [e for e in out if e.country == country.upper()]
        out.sort(key=lambda e: e.date)
        return out

    async def macro_indicator(self, country: str, indicator: str) -> list[CountryValue]:
        base = D.MACRO_BASE.get(country)
        if base is None:
            raise NotFound(f"Land {country} nicht im Demo-Datensatz.")
        growth, infl, unemp, (debt0, debt1), (pc0, pc1), gdp_last, real = base
        last_year = self.today().year - 1
        out: list[CountryValue] = []
        for year in range(2000, last_year + 1):
            r = _rng("macro", country, indicator, year)
            w = (year - 2000) / max(last_year - 2000, 1)
            shock = {2009: -4.0, 2020: -5.5, 2021: 4.5}.get(year, 0.0)
            if indicator == "gdp_growth_annual":
                g = growth - (3.0 * w if country == "CHN" else 0)
                v = g + shock * (0.6 if country in ("CHN", "IND") else 1.0) + r.gauss(0, 0.8)
            elif indicator == "inflation_consumer_prices_annual":
                spike = {2021: 2.0, 2022: 5.5, 2023: 2.5}.get(year, 0.0) * (0.3 if country in ("CHN", "JPN") else 1.0)
                v = infl + spike + r.gauss(0, 0.5)
            elif indicator == "unemployment_total_percent":
                v = unemp * (1 - 0.3 * w if country in ("DEU", "ESP") else 1) + (1.5 if year in (2009, 2010, 2020) else 0) + r.gauss(0, 0.3)
            elif indicator == "debt_percent_gdp":
                v = debt0 + (debt1 - debt0) * w + (8 if year >= 2020 else 0) * (0.5 if country in ("DEU", "AUS") else 1) + r.gauss(0, 1.5)
                if year == last_year and r.random() < 0.5:
                    continue  # Schuldenquoten erscheinen oft verspätet
            elif indicator == "real_interest_rate":
                v = real + r.gauss(0, 1.2) - (3.0 if year in (2021, 2022) else 0)
            elif indicator == "gdp_per_capita_usd":
                v = pc0 * (pc1 / pc0) ** w * (1 + r.gauss(0, 0.02)) * (0.97 if year in (2009, 2020) else 1)
            elif indicator == "gdp_current_usd":
                v = gdp_last * 1e9 * (pc0 / pc1) ** (1 - w) * (1 + r.gauss(0, 0.02))
            else:
                raise NotFound(f"Indikator {indicator} unbekannt.")
            out.append(CountryValue(year=year, value=round(v, 3)))
        return out

    # --- Screener ------------------------------------------------------------------------

    async def screener(
        self, filters: list[ScreenFilter], sort: str, desc: bool, max_rows: int
    ) -> tuple[list[ScreenRow], list[ScreenFilter], list[str]]:
        rows: list[ScreenRow] = []
        for t, c in _COMPANY.items():
            raw = self._fundamentals_raw(t)
            e = self._effective(t)
            closes = e["c"]
            hl = raw["Highlights"]
            price = closes[-1]
            eps = hl["EarningsShare"]
            avg_vol = [v for v in e["v"][-200:] if v]
            rows.append(
                ScreenRow(
                    ticker=t,
                    name=c[1],
                    exchange=c[2],
                    sector=c[3],
                    industry=c[4],
                    currency=D.EXCHANGE_INFO[c[2]][0],
                    price=round(price, 4),
                    chg_1d=metrics.perf(closes, 1),
                    chg_5d=metrics.perf(closes, 5),
                    market_cap=hl["MarketCapitalization"],
                    eps=eps,
                    pe=round(price / eps, 2) if eps and eps > 0 else None,
                    div_yield=round((hl["DividendShare"] or 0) / price * 100, 3),
                    avg_vol=sum(avg_vol) / len(avg_vol) if avg_vol else None,
                )
            )
        return rows, list(filters), ["Quelle: Demo-Universum mit 44 fiktiven Unternehmen."]
