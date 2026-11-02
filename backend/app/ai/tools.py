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
        {"quartal": h.date, "bericht": h.report_date, "eps_ist": _r(h.eps_actual, 3), "eps_schaetzung": _r(h.eps_estimate, 3), "ueberraschung_prozent": _r(h.surprise_pct)}
        for h in e.history[:4]
    ]
    nxt = e.next
    return {
        "ticker": ticker, "waehrung": e.currency, "letzte_berichte": hist,
        "naechster_bericht": None if nxt is None else {"datum": nxt.report_date, "zeitpunkt": nxt.timing, "eps_schaetzung": _r(nxt.eps_estimate, 3)},
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


async def _suche(t: Terminal, a: dict) -> dict:
    hits = await t.search(str(a.get("text") or ""), 6)
    return {"treffer": [{"ticker": h.ticker, "name": h.name, "art": h.type, "land": h.country} for h in hits]}


def _date(raw: Any, default: dt.date) -> dt.date:
    try:
        return dt.date.fromisoformat(str(raw)[:10]) if raw else default
    except ValueError:
        return default


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
        "peers": "Peer-Vergleich", "maerkte": "Marktüberblick", "screener": "Screener", "suche": "Suche", "depot": "Depot",
    }.get(name, name)
    subject = result.get("ticker") or args.get("ticker") or args.get("text") or ""
    if isinstance(subject, str) and "." in subject:
        subject = display(subject)
    count = ""
    for key in ("meldungen", "termine", "werte", "treffer", "positionen"):
        if isinstance(result.get(key), list):
            count = f" ({len(result[key])})"
            break
    return " ".join(p for p in (what, str(subject)) if p) + count
