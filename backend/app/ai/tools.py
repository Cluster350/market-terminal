"""Werkzeuge des KI-Agenten: dünne, nur lesende Hüllen um die Terminal-Dienste.

Die Ausgaben sind bewusst knapp (keine Kursreihen), damit sie in das Kontextfenster lokaler
Modelle passen. Jedes Werkzeug liefert ein dict; Fehler kommen als {"fehler": "..."} zurück,
damit das Modell reagieren kann, statt dass die Frage abbricht.
"""

from __future__ import annotations

import datetime as dt
import json
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional

from ..errors import TerminalError
from ..providers.base import ScreenFilter
from ..services import metrics
from ..services.terminal import Terminal
from ..services.tickers import display, normalize


def _r(x: Optional[float], digits: int = 2) -> Optional[float]:
    return None if x is None else round(float(x), digits)


def _pct(share: Optional[float]) -> Optional[float]:
    """Anteil (0.25) als Prozentwert (25.0)."""
    return None if share is None else round(float(share) * 100, 2)


async def resolve_ticker(t: Terminal, raw: Any) -> str:
    """Ticker in jeder Schreibweise (NWND US, SAP.XETRA, „Northwind“) auflösen."""
    text = str(raw or "").strip()
    if not text:
        raise TerminalError("Kein Wertpapier angegeben.", code="bad_request", status=400)
    try:
        ticker = normalize(text)
        return (await t.resolve(ticker)).ticker
    except TerminalError:
        hits = await t.search(text.split()[0], 3)
        if hits:
            return hits[0].ticker
        raise TerminalError(f"Wertpapier „{text}“ nicht gefunden.", code="not_found", status=404)


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict
    run: Callable[[Terminal, dict], Awaitable[dict]]

    def spec(self) -> dict:
        return {"type": "function", "function": {"name": self.name, "description": self.description, "parameters": self.parameters}}


TICKER = {"type": "string", "description": "Wertpapier, z. B. 'NWND US', 'SAP GR', 'DAX Index', 'EURUSD Curncy' oder ein Firmenname"}


async def _kurs(t: Terminal, a: dict) -> dict:
    ticker = await resolve_ticker(t, a.get("ticker"))
    q = (await t.quotes([ticker]))[0]
    return {
        "ticker": ticker, "name": q.name, "kurs": _r(q.last, 4), "waehrung": q.currency,
        "veraenderung": _r(q.change, 4), "veraenderung_prozent": _r(q.change_pct),
        "eroeffnung": _r(q.open, 4), "hoch": _r(q.high, 4), "tief": _r(q.low, 4), "vortag": _r(q.prev_close, 4),
        "volumen": q.volume, "stand": q.timestamp,
    }


async def _wertentwicklung(t: Terminal, a: dict) -> dict:
    ticker = await resolve_ticker(t, a.get("ticker"))
    h = await t.history(ticker)
    yield_like = ticker.endswith(".GBOND")

    def chg(months: int = 0, days: int = 0) -> Optional[float]:
        if yield_like:
            base = None
            cutoff = metrics.shift_date(dt.date.fromisoformat(h.t[-1]), months, days).isoformat()
            for d, c in zip(h.t, h.c):
                if d > cutoff:
                    break
                if c is not None:
                    base = c
            return None if base is None or h.c[-1] is None else round((h.c[-1] - base) * 100, 1)
        return _r(metrics.perf_since(h.t, h.c, months=months, days=days))

    hi, lo = metrics.window_high_low(h.t, h.h, h.l)
    out = {
        "ticker": ticker, "einheit": "Basispunkte" if yield_like else "Prozent", "letzter_schluss": _r(h.c[-1], 4) if h.c else None,
        "datum": h.t[-1] if h.t else None, "1_woche": chg(days=7), "1_monat": chg(months=1), "3_monate": chg(months=3),
        "1_jahr": chg(months=12), "hoch_52w": _r(hi, 4), "tief_52w": _r(lo, 4),
    }
    if not yield_like:
        out["volatilitaet_1j_prozent"] = _r(metrics.annual_vol_dated(h.t, h.c))
    return out


async def _kennzahlen(t: Terminal, a: dict) -> dict:
    ticker = await resolve_ticker(t, a.get("ticker"))
    c = await t.company(ticker)
    v, p, s, an = c.valuation, c.profitability, c.per_share, c.analyst
    return {
        "ticker": ticker, "name": c.name, "sektor": c.sector, "branche": c.industry, "land": c.country, "waehrung": c.currency,
        "marktkapitalisierung": c.market_cap, "kgv": _r(v.pe), "kgv_erwartet": _r(v.forward_pe), "peg": _r(v.peg),
        "kuv": _r(v.price_sales), "kbv": _r(v.price_book), "ev_ebitda": _r(v.ev_ebitda),
        "nettomarge_prozent": _pct(p.profit_margin), "operative_marge_prozent": _pct(p.operating_margin),
        "eigenkapitalrendite_prozent": _pct(p.roe), "umsatz_ttm": p.revenue_ttm,
        "umsatzwachstum_prozent": _pct(p.revenue_growth_yoy), "gewinnwachstum_prozent": _pct(p.earnings_growth_yoy),
        "eps_ttm": _r(s.eps, 3), "eps_schaetzung_lfd_jahr": _r(s.eps_estimate_cy, 3), "dividendenrendite_prozent": _pct(s.dividend_yield),
        "beta": _r(c.technicals.beta), "analysten_rating_1_bis_5": _r(an.rating), "kursziel": _r(an.target_price),
    }


async def _finanzen(t: Terminal, a: dict) -> dict:
    ticker = await resolve_ticker(t, a.get("ticker"))
    period = "quarterly" if str(a.get("zeitraum", "")).lower().startswith("q") else "annual"
    f = await t.financials(ticker, period)
    keys = ("totalRevenue", "grossProfit", "operatingIncome", "netIncome", "freeCashFlow", "netDebt", "operatingIncomeMargin", "netIncomeMargin")
    rows = {r.key: r for r in [*f.income, *f.balance, *f.cashflow]}
    out: dict[str, Any] = {"ticker": ticker, "waehrung": f.currency, "perioden": f.periods[:4]}
    for k in keys:
        r = rows.get(k)
        if r:
            vals = r.values[:4]
            out[r.label] = [_pct(x) if r.kind == "ratio" else (None if x is None else round(x)) for x in vals]
    return out


async def _earnings(t: Terminal, a: dict) -> dict:
    ticker = await resolve_ticker(t, a.get("ticker"))
    e = await t.earnings(ticker)
    hist = [
        {"quartal_ende": h.date, "berichtet_am": h.report_date, "zeitpunkt": h.timing, "eps_ist": _r(h.eps_actual, 3), "eps_schaetzung": _r(h.eps_estimate, 3), "ueberraschung_prozent": _r(h.surprise_pct)}
        for h in e.history[:4]
    ]
    scored = [h for h in e.history[:8] if h.eps_actual is not None and h.eps_estimate is not None]
    nxt = e.next
    return {
        "ticker": ticker, "waehrung": e.currency, "letzte_berichte": hist,
        "schaetzung_uebertroffen": {"quartale": len(scored), "uebertroffen": sum(1 for h in scored if h.eps_actual >= h.eps_estimate)} if scored else None,
        "naechster_bericht": None if nxt is None else {"datum": nxt.report_date, "zeitpunkt": nxt.timing, "quartal_ende": nxt.date, "eps_schaetzung": _r(nxt.eps_estimate, 3)},
    }


async def _news(t: Terminal, a: dict) -> dict:
    tickers = None
    if a.get("ticker"):
        tickers = [await resolve_ticker(t, a.get("ticker"))]
    days = max(1, min(int(a.get("tage") or 7), 30))
    limit = max(1, min(int(a.get("anzahl") or 8), 15))
    since = (t.now() - dt.timedelta(days=days)).isoformat()
    page = await t.news(tickers, query=a.get("suchbegriff") or None, limit=limit, since=since)
    return {
        "ticker": tickers[0] if tickers else None,
        "meldungen": [
            {"id": n.id, "datum": n.date, "titel": n.title, "auszug": (n.content or "")[:220], "wertpapiere": n.symbols[:4], "eil": n.urgent}
            for n in page.items
        ],
    }


async def _kalender(t: Terminal, a: dict) -> dict:
    today = t.now().date()
    start = _date(a.get("von"), today)
    end = _date(a.get("bis"), start + dt.timedelta(days=6))
    if end < start or (end - start).days > 31:
        end = start + dt.timedelta(days=6)
    country = str(a.get("land") or "").upper() or None
    events = await t.calendar(start, end, country, int(a.get("wichtigkeit") or 2))
    return {
        "von": start.isoformat(), "bis": end.isoformat(),
        "termine": [
            {"datum": e.date, "land": e.country, "termin": e.event, "periode": e.period, "ist": e.actual, "prognose": e.estimate, "vorwert": e.previous, "einheit": e.unit, "wichtigkeit": e.importance}
            for e in events[:40]
        ],
    }


async def _earnings_kalender(t: Terminal, a: dict) -> dict:
    today = t.now().date()
    start = _date(a.get("von"), today)
    end = _date(a.get("bis"), start + dt.timedelta(days=6))
    rows = await t.earnings_calendar(start, end)
    return {"termine": [{"ticker": r.ticker, "name": r.name, "datum": r.report_date, "zeitpunkt": r.timing, "eps_schaetzung": _r(r.eps_estimate, 3), "eps_ist": _r(r.eps_actual, 3)} for r in rows[:40]]}


async def _peers(t: Terminal, a: dict) -> dict:
    ticker = await resolve_ticker(t, a.get("ticker"))
    p = await t.peers(ticker, 8)

    def row(r) -> dict:
        return {"ticker": r.ticker, "name": r.name, "kgv": _r(r.pe), "div_rendite_prozent": _r(r.div_yield), "perf_12m_prozent": _r(r.perf_12m), "marktkap_usd": r.market_cap}

    return {"ticker": ticker, "gruppe": p.group, "basis": p.basis, "werte": [row(r) for r in p.rows], "median": row(p.median)}


async def _maerkte(t: Terminal, a: dict) -> dict:
    idx, fx, curves = await t.indices(), await t.fx(), await t.curves(["US", "DE"])

    def mrow(r) -> dict:
        return {"name": r.name, "ticker": r.ticker, "kurs": _r(r.last, 4), "tag_prozent": _r(r.change_pct), "ytd_prozent": _r(r.chg_ytd)}

    ten = []
    for c in curves:
        p = next((p for p in c.points if p.tenor == "10Y"), None)
        if p and p.y is not None:
            ten.append({"land": c.country, "rendite_10j": _r(p.y, 3), "veraenderung_1m_bp": None if p.y_1m is None else round((p.y - p.y_1m) * 100)})
    return {"indizes": [mrow(r) for r in idx], "devisen": [mrow(r) for r in fx[:8]], "staatsanleihen": ten}


async def _screener(t: Terminal, a: dict) -> dict:
    flt: list[ScreenFilter] = []
    if a.get("sektor"):
        flt.append(ScreenFilter("sector", "eq", str(a["sektor"])))
    if a.get("kgv_max") is not None:
        flt += [ScreenFilter("pe", "gt", 0), ScreenFilter("pe", "lt", float(a["kgv_max"]))]
    if a.get("dividende_min") is not None:
        flt.append(ScreenFilter("div_yield", "gt", float(a["dividende_min"])))
    if a.get("marktkap_min_mrd") is not None:
        flt.append(ScreenFilter("market_cap", "gt", float(a["marktkap_min_mrd"]) * 1e9))
    sort = {"dividende": "div_yield", "kgv": "pe", "momentum": "perf_12m"}.get(str(a.get("sortierung") or ""), "market_cap")
    res = await t.screen(flt, sort, sort != "pe", 10, enrich=True)
    return {
        "treffer_gesamt": res.total,
        "werte": [{"ticker": r.ticker, "name": r.name, "sektor": r.sector, "kgv": _r(r.pe), "div_rendite_prozent": _r(r.div_yield), "perf_12m_prozent": _r(r.perf_12m), "marktkap_usd": r.market_cap} for r in res.rows],
        "hinweis": res.notes,
    }


async def _depot(t: Terminal, a: dict) -> dict:
    from ..portfolio.analytics import analyze

    if t.portfolio_source is None:
        return {"fehler": "Kein Depot verfügbar."}
    p = await t.portfolio_source()
    if not p.positions:
        return {"hinweis": "Das Depot ist leer. Positionen lassen sich in der Funktion PORT eintragen."}
    an = await analyze(t, p)
    s, r = an.summary, an.risk
    rows = sorted((x for x in an.rows if x.value is not None), key=lambda x: -abs(x.value or 0))
    return {
        "waehrung": an.base, "depotwert": _r(s.value), "kasse": _r(s.cash), "anzahl_positionen": s.count,
        "ergebnis_heute": _r(s.day_pnl), "ergebnis_heute_prozent": _r(s.day_pnl_pct),
        "ergebnis_seit_kauf": _r(s.pnl), "ergebnis_seit_kauf_prozent": _r(s.pnl_pct),
        "vergleichsindex": an.benchmark_name,
        "risiko": {
            "volatilitaet_prozent_pa": _r(r.vol), "beta": _r(r.beta), "rendite_1j_prozent": _r(r.return_1y),
            "index_rendite_1j_prozent": _r(r.bench_return_1y), "max_drawdown_prozent": _r(r.max_drawdown),
            "value_at_risk_95_1tag": _r(r.var95), "expected_shortfall_95_1tag": _r(r.es95), "konfidenzniveau_prozent": 95, "haltedauer_tage": 1,
            "effektive_anzahl_positionen": _r(r.effective_n, 1), "anteil_top5_prozent": _r(r.top5_weight),
        },
        "positionen": [
            {"ticker": x.ticker, "name": x.name, "gewicht_prozent": _r(x.weight), "tag_prozent": _r(x.change_pct),
             "ergebnis_seit_kauf_prozent": _r(x.pnl_pct_base), "risikoanteil_prozent": _r(x.risk_share), "sektor": x.sector}
            for x in rows[:15]
        ],
        "sektoren": [{"sektor": sl.key, "gewicht_prozent": _r(sl.weight)} for sl in an.allocation.get("sector", [])[:6]],
        "hinweise": an.notes[:5],
    }


async def _optionen(t: Terminal, a: dict) -> dict:
    from ..services import options as opt

    ticker = await resolve_ticker(t, a.get("ticker"))
    contracts = await t.options(ticker)
    spot = (await t.quotes([ticker]))[0].last
    h = await t.history(ticker)
    o = opt.overview(ticker, contracts, spot, [c for c in h.c if c], t.now().date())
    f = o.focus
    pct = lambda x: None if x is None else round(x * 100, 1)  # noqa: E731
    nxt_earn = None
    try:
        e = await t.earnings(ticker)
        if e.next and e.next.report_date:
            day, timing = e.next.report_date[:10], e.next.timing
            # erster Verfall, der den Bericht enthält (nachbörslich am Verfallstag zählt erst der nächste)
            after = next((s for s in o.expirations if s.exp > day or (s.exp == day and timing == "BeforeMarket")), None)
            before = [s for s in o.expirations if s.exp < (after.exp if after else "9999")]
            nxt_earn = {"datum": day, "zeitpunkt": timing, "erster_verfall_danach": after.exp if after else None,
                        "erwartete_bewegung_bis_dahin_prozent": _r(after.move_pct) if after else None,
                        "atm_iv_davor_prozent": pct(before[-1].atm_iv) if before else None, "atm_iv_danach_prozent": pct(after.atm_iv) if after else None}
    except TerminalError:
        pass
    return {
        "ticker": ticker, "kurs": _r(spot, 2), "implizite_vola_30t_prozent": pct(o.iv30), "historische_vola_30t_prozent": pct(o.hv30),
        "put_call_volumen": _r(o.pc_volume), "put_call_open_interest": _r(o.pc_oi),
        "naechster_monatsverfall": None if f is None else {
            "datum": f.exp, "tage": f.dte, "atm_iv_prozent": pct(f.atm_iv), "erwartete_bewegung_prozent": _r(f.move_pct),
            "straddle_preis": _r(f.straddle), "max_pain": f.max_pain, "skew_25_delta_punkte": _r(f.skew25, 1),
        },
        "verfaelle": [
            {"datum": s.exp, "tage": s.dte, "monatlich": s.monthly, "atm_iv_prozent": pct(s.atm_iv), "erwartete_bewegung_prozent": _r(s.move_pct), "skew_25_delta_punkte": _r(s.skew25, 1)}
            for s in o.expirations[:10]
        ],
        "naechste_quartalszahlen": nxt_earn,
        "call_strikes_hoechstes_oi": [w.strike for w in o.call_walls], "put_strikes_hoechstes_oi": [w.strike for w in o.put_walls],
        "auffaellige_umsaetze": [{"kontrakt": u.contract, "volumen": u.volume, "volumen_zu_oi": _r(u.vol_oi)} for u in o.unusual[:5]],
    }


async def _alarme(t: Terminal, a: dict) -> dict:
    from ..alerts.service import condition_text

    if t.alerts_source is None:
        return {"fehler": "Keine Alarme verfügbar."}
    res = await t.alerts_source()
    status = lambda x: "Marke ohne Alarm" if not x.alarm else "scharf" if x.active else f"ausgelöst {x.triggered_at}"  # noqa: E731
    return {
        "alarme": [
            {"ticker": x.ticker, "bedingung": condition_text(x), "status": status(x), "kurs": _r(x.price, 4), "abstand_prozent": _r(x.distance_pct), "notiz": x.note or None}
            for x in res.alerts[:40]
        ],
        "zuletzt_ausgeloest": [{"zeit": e.at, "meldung": e.message} for e in res.events[:10]],
    }


async def _suche(t: Terminal, a: dict) -> dict:
    hits = await t.search(str(a.get("text") or ""), 6)
    return {"treffer": [{"ticker": h.ticker, "name": h.name, "art": h.type, "land": h.country} for h in hits]}


def _date(raw: Any, default: dt.date) -> dt.date:
    try:
        return dt.date.fromisoformat(str(raw)[:10]) if raw else default
    except ValueError:
        return default


async def _bewegungen(t: Terminal, a: dict) -> dict:
    """Größte Gewinner und Verlierer des Tages, wahlweise nur eine Börse (US, XETRA, LSE …)."""
    ex = str(a.get("boerse") or "").strip().upper() or None
    m = await t.movers(ex)
    row = lambda r: {"ticker": r.ticker, "name": r.name, "kurs": _r(r.price), "tag_prozent": _r(r.chg_1d), "boerse": r.exchange}  # noqa: E731
    return {"boerse": ex or "alle", "gewinner": [row(r) for r in m.gainers[:8]], "verlierer": [row(r) for r in m.losers[:8]]}


async def _zinsen(t: Terminal, a: dict) -> dict:
    """Zinskurve eines Landes mit Veränderung zum Vormonat, Steilheit und eingepreisten künftigen Zinsen."""
    from ..services.forwards import Forwards

    land = str(a.get("land") or "US").strip().upper()
    land = {"DEUTSCHLAND": "DE", "USA": "US", "GB": "UK", "ITALIEN": "IT", "JAPAN": "JP", "FRANKREICH": "FR"}.get(land, land)
    curves = await t.curves([land])
    if not curves:
        return {"fehler": f"Keine Zinskurve für {land}."}
    c = curves[0]
    pts = {p.tenor: p for p in c.points}
    out: dict = {
        "land": c.country, "name": c.name, "stand": c.as_of,
        "renditen": [{"laufzeit": p.tenor, "rendite_prozent": _r(p.y, 3), "veraenderung_1m_bp": None if p.y is None or p.y_1m is None else round((p.y - p.y_1m) * 100)} for p in c.points],
    }
    if pts.get("2Y") and pts.get("10Y") and pts["2Y"].y is not None and pts["10Y"].y is not None:
        out["steilheit_2j_10j_bp"] = round((pts["10Y"].y - pts["2Y"].y) * 100)
    try:
        fw = await Forwards(t).rates(land)
        out["eingepreiste_zinsen"] = [{"kennzahl": k.label, "zins_prozent": _r(k.rate, 3), "veraenderung_1m_bp": _r(k.change_1m_bp, 0)} for k in fw.keys]
    except TerminalError:
        pass
    return out


async def _devisentermin(t: Terminal, a: dict) -> dict:
    """Devisen-Terminkurse eines Paars und die Kosten der Absicherung aus Sicht einer Heimatwährung."""
    from ..services.forwards import Forwards

    pair = str(a.get("paar") or "EURUSD").replace("/", "").replace(" ", "").upper()[:6]
    f = Forwards(t)
    fx = await f.fx(pair)
    out: dict = {
        "paar": f"{fx.base}/{fx.quote}", "kassa": _r(fx.spot, 5),
        "termine": [{"laufzeit": r.tenor, "terminkurs": _r(r.outright, 5), "swap_punkte": _r(r.points, 1), "aufschlag_basis_prozent_pa": _r(r.premium_pa, 2)} for r in fx.rows],
        "hinweis": "berechnet aus Kassakurs und Zinsen beider Währungen (gedeckte Zinsparität), keine Börsenkurse",
    }
    home = str(a.get("heimatwaehrung") or "").strip().upper()
    if home:
        h = await f.hedge(home, [c for c in (fx.base, fx.quote) if c != home])
        out["absicherung"] = {"heimatwaehrung": h.home, "kosten_pa": [{"waehrung": r.currency, "ertrag_kosten_1j_prozent_pa": _r(r.hedge_1y_pa, 2)} for r in h.rows]}
    return out


_KENNZAHLEN = {
    "inflation": "inflation_consumer_prices_annual", "bip": "gdp_growth_annual", "wachstum": "gdp_growth_annual",
    "arbeitslosigkeit": "unemployment_total_percent", "arbeitslosenquote": "unemployment_total_percent",
    "schulden": "debt_percent_gdp", "realzins": "real_interest_rate", "bip_pro_kopf": "gdp_per_capita_usd",
}
_ISO3 = {"DE": "DEU", "US": "USA", "UK": "GBR", "GB": "GBR", "FR": "FRA", "IT": "ITA", "JP": "JPN", "ES": "ESP", "CH": "CHE", "CN": "CHN"}


async def _prognose(t: Terminal, a: dict) -> dict:
    """Modellprognose (Chronos-2 bzw. Statistik) mit Bändern und Rückblick-Test – keine Empfehlung."""
    from ..forecast import sources

    fs = t.forecast
    if fs is None:
        return {"fehler": "Prognose ist nicht verfügbar."}
    art = str(a.get("art") or "").strip().lower()
    land = str(a.get("land") or "").strip().upper()
    if art == "schwankung":
        res = await sources.vol(fs, t, await resolve_ticker(t, a.get("ticker")), 3)
    elif art == "termin":
        name = str(a.get("termin") or "").strip()
        if not name or len(land) != 2:
            return {"fehler": "Für einen Konjunkturtermin Land (z. B. US, DE, EU) und Termin (wie im Kalender, z. B. 'CPI YoY') angeben."}
        res = await sources.event(fs, t, "GB" if land == "UK" else land, name, 3)
    else:
        key = str(a.get("kennzahl") or "inflation").strip().lower().replace(" ", "_")
        res = await sources.macro(fs, t, _ISO3.get(land, land or "USA"), _KENNZAHLEN.get(key, key), 3)
    q = res.quality
    return {
        "reihe": res.label, "einheit": res.unit, "methode": res.engine_label,
        "letzte_werte": [{"zeit": tt, "wert": _r(v, 3)} for tt, v in list(zip(res.history.t, res.history.v))[-5:]],
        "prognose": [
            {"zeit": tt, "median": _r(m, 3), "band_50_prozent": [_r(a1, 3), _r(b1, 3)], "band_80_prozent": [_r(a2, 3), _r(b2, 3)]}
            for tt, m, a1, b1, a2, b2 in zip(res.forecast.t, res.forecast.median, res.forecast.lo50, res.forecast.hi50, res.forecast.lo80, res.forecast.hi80)
        ],
        "rueckblick_test": {
            "startpunkte": q.origins, "fehler_modell": _r(q.mae, 3), "fehler_bleibt_wie_zuletzt": _r(q.mae_naive, 3),
            "guete_prozent": None if q.skill is None else round(q.skill * 100), "treffer_80_prozent_band": None if q.cover80 is None else round(q.cover80 * 100),
            "konsens_fehler": _r(q.consensus_mae, 3), "modell_fehler_naechster_termin": _r(q.model_mae1, 3),
        },
        "konsens_naechster_termin": _r(res.next_consensus, 3),
        "urteil": res.verdict_text,
        "hinweis": "Modellprognose aus dem bisherigen Verlauf, keine Empfehlung. " + (res.note or ""),
    }


async def _bewertung(t: Terminal, a: dict) -> dict:
    """KGVs der Sektoren bzw. Länder über die Jahre, Analystenkonsens und Schätzungsänderungen."""
    vs = t.valuation
    if vs is None:
        return {"fehler": "Bewertungstrend ist nicht verfügbar."}
    art = "country" if str(a.get("art") or "").lower().startswith(("land", "länder", "laender", "country")) else "sector"
    region = {"usa": "us", "us": "us", "europa": "eu", "eu": "eu"}.get(str(a.get("region") or "").strip().lower(), "all")
    o = vs.overview(art, region)
    if not o.rows:
        return {"hinweis": "Der Bewertungstrend wird gerade berechnet – bitte gleich noch einmal fragen."}
    name = str(a.get("name") or "").strip().lower()
    rows = [r for r in o.rows if name and (name in r.label.lower() or name in r.key.lower())] or o.rows
    est = o.est_years
    return {
        "art": "Sektoren" if art == "sector" else "Länder", "region": region, "stand": o.built_at,
        "gruppen": [
            {
                "name": r.label, "firmen": r.n,
                "kgv_je_jahr": {y: _r(v, 1) for y, v in r.pe_years.items()},
                "kgv_heute": _r(r.pe_ttm, 1), "kgv_durchschnitt_10j": _r(r.avg, 1),
                "lage_in_10j_spanne_prozent": None if r.position is None else round(r.position * 100),
                "veraenderung_kgv_12m_punkte": _r(r.chg12m, 1),
                "gewinnwachstum_naechstes_jahr_prozent": None if r.growth_next is None else round(r.growth_next * 100, 1),
                "konsens_naechstes_jahr_aenderung_90t_prozent": None if r.rev90 is None else round(r.rev90 * 100, 1),
                "anhebungen_30t": r.up30, "senkungen_30t": r.down30,
                "abstand_52w_hoch_prozent": None if r.dist52 is None else round(r.dist52 * 100, 1),
            }
            for r in rows[:12]
        ],
        "hinweis": f"Jahre {est[0]} und {est[1]} sind Analystenschätzungen (heutiger Kurs ÷ Konsens). " + o.note,
    }


async def _krypto(t: Terminal, a: dict) -> dict:
    """Kryptoübersicht: größte Coins mit Entwicklung, Schwankung, Abstand zum Hoch, Marktanteil, Gleichlauf mit Aktien."""
    cs = getattr(t, "crypto", None)
    if cs is None:
        return {"fehler": "Kryptoübersicht ist nicht verfügbar."}
    ccy = "eur" if str(a.get("waehrung") or "").strip().lower() == "eur" else "usd"
    o = await cs.overview(ccy)
    name = str(a.get("name") or "").strip().lower()
    # genauer Treffer zuerst („Ethereum“ ohne „Ethereum Classic“), sonst Teiltreffer, sonst die zehn größten
    exact = [r for r in o.rows if name and name in (r.name.lower(), r.symbol.lower())]
    rows = exact or [r for r in o.rows if name and name in r.name.lower()] or o.rows[:10]
    return {
        "waehrung": ccy.upper(), "marktkap_gezeigt": _r(o.total_cap, 0), "anteil_bitcoin_prozent": _r(o.btc_share, 1),
        "anteil_bezug": "gesamter Kryptomarkt" if o.share_basis == "market" else "gezeigte Coins ohne Stablecoins",
        "coins_ueber_200_tage_linie": f"{o.breadth_up} von {o.breadth_n}",
        "coins": [
            {"name": r.name, "kuerzel": r.symbol, "kurs": _r(r.last, 6), "tag_prozent": _r(r.chg_1d, 2), "7_tage_prozent": _r(r.chg_7d, 1),
             "30_tage_prozent": _r(r.chg_30d, 1), "1_jahr_prozent": _r(r.chg_1y, 1), "schwankung_30t_prozent": _r(r.vol_30d, 0),
             "abstand_hoch_prozent": _r(r.from_high, 1), "korrelation_bitcoin_90t": _r(r.corr_btc, 2), "ueber_200_tage_linie": r.above_200d,
             "marktkap": _r(r.market_cap, 0), "anteil_prozent": _r(r.share, 2)}
            for r in rows
        ],
        "korrelation_bitcoin_90_boersentage": {c.label: _r(c.v[-1], 2) for c in o.corr if c.v},
        "hinweis": " ".join(o.notes),
    }


async def _faktoren(t: Terminal, a: dict) -> dict:
    """Stil-Faktoren (Value, Wachstum, Momentum, Qualität, kleine Firmen, niedrige Schwankung …) gegenüber dem Markt,
    optional die Faktorlast des eigenen Depots."""
    fs = getattr(t, "factors", None)
    if fs is None:
        return {"fehler": "Faktoren sind nicht verfügbar."}
    region = "eu" if str(a.get("region") or "").strip().lower() in ("eu", "europa") else "us"
    o = await fs.overview(region)
    out: dict = {
        "region": o.label, "markt": f"{o.bench.label} ({display(o.bench.ticker)})",
        "markt_entwicklung_prozent": {k: _r(v, 1) for k, v in o.bench.abs.items()},
        "faktoren_gegenueber_markt_prozent": [
            {"faktor": r.label, "etf": display(r.ticker), **{k: _r(v, 1) for k, v in r.rel.items()},
             "trend_gegenueber_200_tage_schnitt_prozent": _r(r.rel_vs_avg, 1)}
            for r in o.rows
        ],
        "hinweis": " ".join(o.notes),
    }
    if a.get("depot") and t.portfolio_source is not None:
        try:
            e = await fs.exposure(await t.portfolio_source(), "auto")
            out["depot_faktorlast"] = {
                "region": e.label, "wochen": e.weeks, "erklaert_prozent": None if e.r2 is None else round(e.r2 * 100),
                "markt_beta": _r(e.market.beta if e.market else None, 2),
                "stile": [{"faktor": f.label, "last": _r(f.beta, 2), "t_wert": _r(f.t, 1)} for f in e.factors],
                "lesart": "Last 0,3 = wie zusätzlich 30 % in diesem Stil; |t| ab 2 deutlich, unter 1 Zufall möglich.",
            }
        except TerminalError as exc:
            out["depot_faktorlast"] = {"fehler": exc.message}
    return out


def _obj(props: dict, required: tuple[str, ...] = ()) -> dict:
    return {"type": "object", "properties": props, "required": list(required)}


TOOLS: list[Tool] = [
    Tool("kurs", "Aktueller Kurs, Tagesveränderung, Hoch/Tief und Volumen eines Wertpapiers.", _obj({"ticker": TICKER}, ("ticker",)), _kurs),
    Tool("wertentwicklung", "Wertentwicklung über 1 Woche, 1 Monat, 3 Monate und 1 Jahr, 52-Wochen-Hoch/Tief und Volatilität.", _obj({"ticker": TICKER}, ("ticker",)), _wertentwicklung),
    Tool("kennzahlen", "Bewertung und Profil einer Aktie: Sektor, Marktkapitalisierung, KGV, KUV, KBV, Margen, Wachstum, Dividende, Beta, Analysten.", _obj({"ticker": TICKER}, ("ticker",)), _kennzahlen),
    Tool("finanzen", "Umsatz, Ergebnis, Margen, Free Cashflow und Nettoverschuldung der letzten Jahre oder Quartale.",
         _obj({"ticker": TICKER, "zeitraum": {"type": "string", "enum": ["jahre", "quartale"]}}, ("ticker",)), _finanzen),
    Tool("earnings", "Letzte Quartalsberichte (Gewinn je Aktie Ist gegen Schätzung) und nächster Berichtstermin.", _obj({"ticker": TICKER}, ("ticker",)), _earnings),
    Tool("news", "Aktuelle Nachrichten, optional zu einem Wertpapier oder Suchbegriff.",
         _obj({"ticker": TICKER, "tage": {"type": "integer", "description": "Zeitraum in Tagen (1–30)"}, "anzahl": {"type": "integer"}, "suchbegriff": {"type": "string"}}), _news),
    Tool("kalender", "Wirtschaftstermine (Konjunkturdaten, Notenbanken) mit Ist, Prognose und Vorwert.",
         _obj({"von": {"type": "string", "description": "JJJJ-MM-TT"}, "bis": {"type": "string"}, "land": {"type": "string", "description": "US, DE, EU, GB, JP, CN"}, "wichtigkeit": {"type": "integer", "description": "1–3"}}), _kalender),
    Tool("earnings_kalender", "Termine von Quartalsberichten aller Unternehmen in einem Zeitraum.", _obj({"von": {"type": "string"}, "bis": {"type": "string"}}), _earnings_kalender),
    Tool("peers", "Vergleich einer Aktie mit ihrer Branche (KGV, Dividende, Wertentwicklung, Median).", _obj({"ticker": TICKER}, ("ticker",)), _peers),
    Tool("maerkte", "Überblick über Weltindizes, Devisen und 10-jährige Staatsanleihen.", _obj({}), _maerkte),
    Tool("screener", "Aktien filtern nach Sektor (englischer Name, z. B. 'Utilities'), maximalem KGV, Mindest-Dividendenrendite in % und Mindest-Marktkapitalisierung in Mrd.",
         _obj({"sektor": {"type": "string"}, "kgv_max": {"type": "number"}, "dividende_min": {"type": "number"}, "marktkap_min_mrd": {"type": "number"}, "sortierung": {"type": "string", "enum": ["marktkap", "dividende", "kgv", "momentum"]}}), _screener),
    Tool("suche", "Wertpapiere über Namen oder Kürzel finden.", _obj({"text": {"type": "string"}}, ("text",)), _suche),
    Tool("optionen", "Optionsmarkt einer US-Aktie: implizite und historische Volatilität, erwartete Kursbewegung je Verfall, "
         "nächste Quartalszahlen mit dem ersten Verfall danach, Put/Call-Verhältnis, Max Pain, Skew, Strikes mit dem höchsten Open Interest, auffällige Umsätze.",
         _obj({"ticker": TICKER}, ("ticker",)), _optionen),
    Tool("bewegungen", "Größte Gewinner und Verlierer des Tages, optional nur einer Börse (US, XETRA, LSE, PA, AS, SW).",
         _obj({"boerse": {"type": "string"}}), _bewegungen),
    Tool("zinsen", "Zinskurve eines Landes (US, DE, UK, FR, IT, JP): Renditen je Laufzeit, Veränderung 1 Monat, Steilheit 2J/10J und eingepreiste künftige Zinsen (1Y1Y, 5Y5Y …).",
         _obj({"land": {"type": "string"}}), _zinsen),
    Tool("devisentermin", "Devisen-Terminkurse (1 Woche bis 2 Jahre) eines Paars wie EURUSD und optional die Absicherungskosten für eine Heimatwährung (EUR, CHF …).",
         _obj({"paar": {"type": "string"}, "heimatwaehrung": {"type": "string"}}), _devisentermin),
    Tool("prognose", "Modellprognose mit Unsicherheitsbändern und Rückblick-Test (wie genau die Methode früher war): "
         "art='kennzahl' für Jahreswerte eines Landes (kennzahl: inflation, bip, arbeitslosigkeit, schulden, realzins; land: DE, US, FR …), "
         "art='termin' für einen Konjunkturtermin aus dem Kalender (land: US, DE, EU, GB, JP; termin: Name wie im Kalender, z. B. 'CPI YoY'), "
         "art='schwankung' für die erwartete Schwankung (Volatilität) eines Wertpapiers. Keine Kursprognose.",
         _obj({"art": {"type": "string", "enum": ["kennzahl", "termin", "schwankung"]}, "land": {"type": "string"}, "kennzahl": {"type": "string"},
               "termin": {"type": "string"}, "ticker": TICKER}, ("art",)), _prognose),
    Tool("bewertung", "KGVs von Sektoren oder Ländern über die letzten Jahre (tatsächlich), dieses und nächstes Jahr (Analystenkonsens), "
         "Lage gegenüber dem 10-Jahres-Durchschnitt und wie sich die Gewinnschätzungen der Analysten in 90 Tagen verändert haben. "
         "art: 'sektor' oder 'land'; region (nur Sektoren): 'usa', 'europa' oder leer für beide; name optional, z. B. 'Technologie' oder 'Deutschland'.",
         _obj({"art": {"type": "string", "enum": ["sektor", "land"]}, "region": {"type": "string"}, "name": {"type": "string"}}), _bewertung),
    Tool("krypto", "Kryptowährungen (Bitcoin, Ethereum und weitere Coins ohne Stablecoins): Kurs, Entwicklung 1 Tag bis 1 Jahr, Schwankung, "
         "Abstand zum Hoch, Korrelation zu Bitcoin, Marktanteil, Gleichlauf von Bitcoin mit Nasdaq, S&P 500 und Gold. name optional (z. B. 'Ethereum'), waehrung 'usd' oder 'eur'.",
         _obj({"name": {"type": "string"}, "waehrung": {"type": "string", "enum": ["usd", "eur"]}}), _krypto),
    Tool("faktoren", "Anlagestile (Faktoren) gegenüber dem Markt, gemessen mit Stil-ETFs: Value, Wachstum, Momentum, Qualität, kleine Firmen, "
         "niedrige Schwankung, Dividende, Gleichgewichtet – Entwicklung 1 Tag bis 5 Jahre relativ zum Markt und Trend. region 'usa' oder 'europa'; "
         "depot=true ergänzt die Faktorlast des eigenen Depots (welchem Stil es folgt).",
         _obj({"region": {"type": "string", "enum": ["usa", "europa"]}, "depot": {"type": "boolean"}}), _faktoren),
    Tool("alarme", "Kursalarme und Kursmarken des Nutzers mit Status, Abstand zum Kurs und zuletzt ausgelöste Alarme.", _obj({}), _alarme),
    Tool("depot", "Das eigene Depot des Nutzers: Wert, Ergebnis heute und seit Kauf, Positionen mit Gewicht und Risikoanteil, "
         "Volatilität, Beta, Drawdown, Value at Risk, Sektoren.", _obj({}), _depot),
]
TOOL_BY_NAME = {tool.name: tool for tool in TOOLS}


async def run_tool(t: Terminal, name: str, args: Any) -> dict:
    tool = TOOL_BY_NAME.get(name)
    if tool is None:
        return {"fehler": f"Unbekanntes Werkzeug „{name}“. Verfügbar: {', '.join(TOOL_BY_NAME)}."}
    if isinstance(args, str):
        try:
            args = json.loads(args or "{}")
        except ValueError:
            return {"fehler": "Argumente sind kein gültiges JSON."}
    if not isinstance(args, dict):
        args = {}
    try:
        return await tool.run(t, args)
    except TerminalError as exc:
        return {"fehler": exc.message}
    except (ValueError, TypeError) as exc:
        return {"fehler": f"Ungültige Argumente: {exc}"}


def summarize(name: str, args: dict, result: dict) -> str:
    """Kurzbeschreibung eines Werkzeugaufrufs für die Anzeige unter der Antwort."""
    if "fehler" in result:
        return f"Fehler: {result['fehler']}"
    what = {
        "kurs": "Kurs", "wertentwicklung": "Wertentwicklung", "kennzahlen": "Kennzahlen", "finanzen": "Finanzdaten",
        "earnings": "Quartalszahlen", "news": "Nachrichten", "kalender": "Wirtschaftskalender", "earnings_kalender": "Earnings-Kalender",
        "peers": "Peer-Vergleich", "maerkte": "Marktüberblick", "screener": "Screener", "suche": "Suche", "depot": "Depot", "alarme": "Alarme", "optionen": "Optionen",
        "bewegungen": "Größte Bewegungen", "zinsen": "Zinskurve", "devisentermin": "Devisentermine", "prognose": "Prognose", "bewertung": "Bewertungstrend",
        "krypto": "Kryptowährungen", "faktoren": "Faktoren",
    }.get(name, name)
    subject = result.get("ticker") or args.get("ticker") or args.get("text") or ""
    if isinstance(subject, str) and "." in subject:
        subject = display(subject)
    count = ""
    if name == "zinsen" and result.get("land"):
        subject = str(result["land"])
    if name == "devisentermin" and result.get("paar"):
        subject = str(result["paar"])
    if name == "prognose" and result.get("reihe"):
        subject = str(result["reihe"])
    for key in ("meldungen", "termine", "werte", "treffer", "positionen", "alarme"):
        if isinstance(result.get(key), list):
            count = f" ({len(result[key])})"
            break
    return " ".join(p for p in (what, str(subject)) if p) + count
