"""Innerer Wert je Aktie (Funktion DCF): Daten aus dem Terminal holen, bereinigen, Startwerte der Story-Hebel
setzen, rechnen. Rechnen tut nur der Code – die KI-Persona bekommt das Ergebnis als Mappe (siehe ai/valuation_coach)."""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import math
import time
import zlib
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional

from ..errors import NotFound, PlanNotIncluded, TerminalError
from ..models import Company, Financials, Quote
from ..services.terminal import Terminal
from . import calc
from .calc import Base, Levers
from .models import (IntrinsicResult, IvBin, IvDistribution, IvLever, IvLifecycle, IvQuality, IvReverse, IvRow,
                     IvYear)
from .params import (CURVE_BY_CURRENCY, DEFAULT_TAX, FALLBACK_RF, Params, country_code, is_financial, load_params)

log = logging.getLogger("terminal.intrinsic")

INPUT_TTL = 600.0  # Sekunden: Fundamentaldaten ändern sich selten

# Hebel: (Schlüssel, Beschriftung, Einheit, min, max, Schritt, Erklärung)
LEVER_SPECS: list[tuple[str, str, str, float, float, float, str]] = [
    ("growth_next", "Umsatzwachstum nächstes Jahr", "pct", -0.5, 1.5, 0.005, "Startwert: Mittel aus letztem Jahr und 3-Jahres-Schnitt"),
    ("growth_2_5", "Umsatzwachstum Jahre 2–5 (p. a.)", "pct", -0.3, 1.0, 0.005, "danach linear bis zum Endwachstum in Jahr 10"),
    ("target_margin", "Ziel-Marge (operativ, vor Steuern)", "pct", -0.5, 0.8, 0.005, "Startwert: halber Weg von der heutigen zur Branchenmarge"),
    ("margin_year", "Ziel-Marge erreicht in Jahr", "year", 1, 10, 1, "bis dahin linearer Übergang von der heutigen Marge"),
    ("sales_to_capital", "Umsatz je eingesetztem Kapital", "x", 0.1, 10, 0.05, "bestimmt die Reinvestition: zusätzlicher Umsatz ÷ zusätzliches Kapital (Branchenwert)"),
    ("wacc", "Kapitalkosten Jahre 1–5", "pct", 0.02, 0.25, 0.0025, "aus dem Kapitalkosten-Aufbau; danach linear zum Endwert"),
    ("wacc_terminal", "Kapitalkosten ab Jahr 11", "pct", 0.02, 0.20, 0.0025, "reife Firma: risikoloser Zins + Risikoprämie (+ Länderrisiko)"),
    ("growth_terminal", "Endwachstum (höchstens risikoloser Zins)", "pct", -0.02, 0.06, 0.0025, "sonst würde die Firma auf Dauer schneller wachsen als die Wirtschaft"),
    ("roic_terminal", "Kapitalrendite im Endwert", "pct", 0.02, 0.60, 0.005, "Startwert = Kapitalkosten (dauerhafte Überrenditen sind selten)"),
    ("failure_prob", "Ausfallwahrscheinlichkeit", "pct", 0.0, 0.9, 0.01, "für junge oder angeschlagene Firmen"),
    ("failure_proceeds", "Erlös bei Ausfall (Anteil am Kapital)", "pct", 0.0, 1.0, 0.05, "Anteil am Buchwert des eingesetzten Kapitals"),
]


def _rows(stmt: list) -> dict[str, list[Optional[float]]]:
    return {r.key: r.values for r in stmt}


def _first(vals: Optional[list[Optional[float]]], i: int = 0) -> Optional[float]:
    if not vals or len(vals) <= i:
        return None
    v = vals[i]
    return float(v) if v is not None and math.isfinite(v) else None


def _sum4(vals: Optional[list[Optional[float]]]) -> Optional[float]:
    if not vals or len(vals) < 4 or any(v is None for v in vals[:4]):
        return None
    return float(sum(vals[:4]))  # type: ignore[arg-type]


def _fin(x: Optional[float]) -> Optional[float]:
    return x if x is not None and math.isfinite(x) else None


def _dmy(iso: str) -> str:
    try:
        d = dt.date.fromisoformat(iso[:10])
        return d.strftime("%d.%m.%Y")
    except ValueError:
        return iso


@dataclass
class Inputs:
    ticker: str
    company: Company
    annual: Financials
    quarterly: Optional[Financials]
    quote: Optional[Quote]
    riskfree: float
    riskfree_source: str
    fx: Optional[float]  # Kurs in Handelswährung × fx = Kurs in Berichtswährung
    fx_note: str = ""
    warnings: list[str] = field(default_factory=list)


class IntrinsicService:
    def __init__(self, terminal: Terminal, data_dir: Optional[Path] = None):
        self.t = terminal
        self.data_dir = Path(data_dir) if data_dir else None
        self.params: Params = load_params(self.data_dir)
        self._cache: dict[str, tuple[float, Inputs]] = {}
        self._task: Optional[asyncio.Task] = None

    def reload_params(self) -> None:
        self.params = load_params(self.data_dir)

    async def refresh_params(self, transport=None) -> tuple[bool, str]:
        """Damodarans Tabellen neu laden (falls erreichbar) und übernehmen."""
        from . import damodaran_data

        if self.data_dir is None:
            return False, "Kein Datenordner (PORTFOLIO_DIR) – Aktualisierung nicht möglich."
        ok, msg = await damodaran_data.update(self.data_dir, transport)
        if ok:
            self.reload_params()
        return ok, msg

    def start(self, data_mode: str) -> None:
        """Im Echtbetrieb einmal im Hintergrund aktualisieren, wenn die Daten fehlen oder älter als ein halbes Jahr sind."""
        from . import damodaran_data

        if data_mode == "demo" or self.data_dir is None or not damodaran_data.needs_update(self.data_dir):
            return

        async def run() -> None:
            try:
                ok, msg = await self.refresh_params()
                log.info(msg)
            except Exception as exc:  # noqa: BLE001 – Hintergrundaufgabe darf den Start nie stören
                log.info("Damodaran-Daten: Aktualisierung fehlgeschlagen (%s)", exc)

        self._task = asyncio.create_task(run(), name="damodaran-daten")

    def params_status(self) -> dict:
        p = self.params
        return {"erp": p.erp, "erp_source": p.erp_source, "country_source": p.country_source, "loaded_at": p.loaded_at}

    # --- Daten ----------------------------------------------------------------

    async def _bond_10y(self, cc: str) -> Optional[tuple[float, str]]:
        """Letzte Rendite der zehnjährigen Staatsanleihe (in %) und Name der Zinskurve aus GC. Geholt wird nur diese
        eine Kursreihe, nicht die ganze Kurve mit zehn Laufzeiten (spart neun Abrufe je Währung)."""
        entry = self.t.p.catalog.curves.get(cc)
        ticker = next((t for tenor, _, t in entry[1] if tenor == "10Y"), None) if entry else None
        if ticker is None:
            return None
        try:
            h = await self.t.history(ticker)
        except TerminalError:
            return None
        closes = [x for _, x in zip(h.t, h.c) if x is not None]
        return (closes[-1], entry[0]) if closes else None

    async def _riskfree(self, currency: Optional[str]) -> tuple[float, str, list[str]]:
        warn: list[str] = []
        cc = CURVE_BY_CURRENCY.get(currency or "")
        if cc:
            hit = await self._bond_10y(cc)
            if hit is not None:
                return hit[0] / 100, f"Staatsanleihe {hit[1]} 10 Jahre (GC)", warn
        if currency in FALLBACK_RF:
            return FALLBACK_RF[currency], f"Richtwert 10-jährige Staatsanleihe ({currency}), keine Zinskurve im Terminal", warn
        warn.append(f"Kein risikoloser Zins für {currency or 'die Berichtswährung'} – US-Staatsanleihe als Ersatz.")
        hit = await self._bond_10y("US")
        if hit is not None:
            return hit[0] / 100, "Staatsanleihe USA 10 Jahre (Ersatz)", warn
        return 0.04, "Richtwert 4 % (keine Zinsdaten)", warn

    async def _fx(self, from_cur: str, to_cur: str) -> Optional[float]:
        """Umrechnungskurs Handelswährung → Berichtswährung über die Devisenkurse des Terminals."""
        if from_cur == to_cur:
            return 1.0
        for tk, invert in ((f"{from_cur}{to_cur}.FOREX", False), (f"{to_cur}{from_cur}.FOREX", True)):
            try:
                q = (await self.t.quotes([tk]))[0]
            except (TerminalError, IndexError):
                continue
            if q.last and q.last > 0:
                return 1 / q.last if invert else q.last
        return None

    async def inputs(self, ticker: str) -> Inputs:
        hit = self._cache.get(ticker)
        if hit and time.monotonic() - hit[0] < INPUT_TTL:
            return hit[1]
        company = await self.t.company(ticker)
        annual = await self.t.financials(ticker, "annual")
        try:
            quarterly: Optional[Financials] = await self.t.financials(ticker, "quarterly")
        except TerminalError:
            quarterly = None
        try:
            quote: Optional[Quote] = (await self.t.quotes([ticker]))[0]
        except (TerminalError, IndexError):
            quote = None
        fin_cur = annual.currency or company.currency
        rf, rf_src, warn = await self._riskfree(fin_cur)
        fx = None
        fx_note = ""
        if quote and quote.last:
            q_cur = quote.currency or company.currency
            if q_cur in ("GBX", "GBp", "GBXp"):
                fx_base = 0.01
                q_cur = "GBP"
            else:
                fx_base = 1.0
            if q_cur and fin_cur and q_cur != fin_cur:
                rate = await self._fx(q_cur, fin_cur)
                if rate is None:
                    warn.append(f"Kurs in {q_cur}, Bilanz in {fin_cur}: kein Devisenkurs – Vergleich mit dem Kurs nicht möglich.")
                else:
                    fx = rate * fx_base
                    fx_note = f"Kurs von {q_cur} in {fin_cur} umgerechnet (1 {q_cur} = {rate:.4f} {fin_cur})"
            else:
                fx = fx_base
                if fx_base != 1.0:
                    fx_note = "Kurs in Pence, in Pfund umgerechnet"
        inp = Inputs(ticker, company, annual, quarterly, quote, rf, rf_src, fx, fx_note, warn)
        self._cache[ticker] = (time.monotonic(), inp)
        if len(self._cache) > 200:
            self._cache.clear()
        return inp

    # --- Bewertung ------------------------------------------------------------

    async def value(self, ticker: str, overrides: Optional[dict[str, Any]] = None, *, simulate: bool = True) -> IntrinsicResult:
        try:
            inp = await self.inputs(ticker)
        except (NotFound, PlanNotIncluded) as exc:
            return IntrinsicResult(ticker=ticker, state="no_data", message=exc.message if hasattr(exc, "message") else str(exc))
        return build(inp, self.params, overrides or {}, simulate=simulate)


def build(inp: Inputs, params: Params, overrides: dict[str, Any], *, simulate: bool = True) -> IntrinsicResult:
    c = inp.company
    res = IntrinsicResult(
        ticker=inp.ticker, name=c.name, sector=c.sector, industry=c.industry, currency=inp.annual.currency or c.currency,
        params_source=params.erp_source, params_loaded_at=params.loaded_at, warnings=list(inp.warnings), fx_note=inp.fx_note,
    )
    if is_financial(c.sector, c.industry):
        res.state = "not_applicable"
        res.message = (
            "Banken, Versicherungen und andere Finanzfirmen werden hier nicht bewertet: Bei ihnen ist Fremdkapital Rohstoff "
            "des Geschäfts, nicht Finanzierung – ein DCF auf den freien Cashflow der Firma passt nicht. Damodaran bewertet "
            "sie über das Eigenkapital (Dividenden bzw. Übergewinne auf das Eigenkapital); das ist hier noch nicht eingebaut."
        )
        return res

    inc = _rows(inp.annual.income)
    bal = _rows(inp.annual.balance)
    cf = _rows(inp.annual.cashflow)
    q_inc = _rows(inp.quarterly.income) if inp.quarterly else {}
    q_bal = _rows(inp.quarterly.balance) if inp.quarterly else {}
    periods = inp.annual.periods
    q_periods = inp.quarterly.periods if inp.quarterly else []

    # Basis: letzte 12 Monate, wenn die Quartale neuer sind als das Geschäftsjahr; sonst das Geschäftsjahr
    # (beide Summen nötig: fehlte das operative Ergebnis eines Quartals, gab es sonst gar keine Bewertung, obwohl das
    # Geschäftsjahr vollständig ist)
    use_ttm = (bool(q_periods) and bool(periods) and q_periods[0] > periods[0] and _sum4(q_inc.get("totalRevenue")) is not None
               and _sum4(q_inc.get("operatingIncome")) is not None)
    if use_ttm:
        revenue = _sum4(q_inc.get("totalRevenue"))
        ebit = _sum4(q_inc.get("operatingIncome"))
        rd_now = _sum4(q_inc.get("researchDevelopment"))
        interest = _sum4(q_inc.get("interestExpense"))
        res.base_period = f"letzte 12 Monate bis {_dmy(q_periods[0])}"
    else:
        revenue = _first(inc.get("totalRevenue"))
        ebit = _first(inc.get("operatingIncome"))
        rd_now = _first(inc.get("researchDevelopment"))
        interest = _first(inc.get("interestExpense"))
        res.base_period = f"Geschäftsjahr bis {_dmy(periods[0])}" if periods else ""
    balance_src = q_bal if use_ttm and q_bal.get("totalStockholderEquity") else bal
    cash = _first(balance_src.get("cash")) or 0.0
    debt = _first(balance_src.get("shortLongTermDebtTotal")) or 0.0
    equity = _first(balance_src.get("totalStockholderEquity"))
    if revenue is None or revenue <= 0 or ebit is None:
        res.state = "no_data"
        res.message = "Zu wenige Finanzdaten (Umsatz oder operatives Ergebnis fehlen) für eine Bewertung."
        return res

    # Historie: Wachstum und Margen
    # je Geschäftsjahr an seiner Stelle: Lücken nicht herausfiltern, sonst rückt ein älteres Jahr nach und zwei Jahre
    # Wachstum gelten als eines (ein negativer Umsatz gäbe bei der Kubikwurzel eine komplexe Zahl)
    r0, r1, r3 = (_first(inc.get("totalRevenue"), i) for i in (0, 1, 3))
    ops = inc.get("operatingIncome") or []
    growth_last = r0 / r1 - 1 if r0 is not None and r1 and r1 > 0 else None
    growth_3y = (r0 / r3) ** (1 / 3) - 1 if r0 is not None and r0 >= 0 and r3 and r3 > 0 else growth_last
    for i, p in enumerate(periods[:5]):
        r = _first(inc.get("totalRevenue"), i)
        o = _first(ops, i)
        r_prev = _first(inc.get("totalRevenue"), i + 1)
        res.history.append(IvRow(
            label=f"GJ {p[:4]}", value=r, unit="money",
            text=(f"Wachstum {((r / r_prev - 1) * 100):+.1f} %".replace(".", ",") if r and r_prev else "")
            + (f" · operative Marge {(o / r * 100):.1f} %".replace(".", ",") if r and o is not None else ""),
        ))

    # Branche, Land, Steuern
    ind = params.industry_for(c.sector, c.industry)
    res.industry_used, res.industry_source = ind.name, ind.source
    cc = country_code(c.country, c.exchange)
    country = params.country(cc)
    res.country = country.name if country else c.country
    tax_marginal = country.tax if country else DEFAULT_TAX
    crp = country.crp if country else 0.0
    if not country:
        res.warnings.append(f"Land „{c.country or '?'}“ ohne Länderrisiko-Wert – 0 % angesetzt, Steuersatz {DEFAULT_TAX * 100:.0f} %.")
    pretax = _first(inc.get("incomeBeforeTax"))
    taxes = _first(inc.get("incomeTaxExpense"))
    tax_eff = min(max(taxes / pretax, 0.0), 0.5) if pretax and pretax > 0 and taxes is not None else tax_marginal

    # Bereinigung: F&E aktivieren
    rd_hist: list[float] = []
    if rd_now is not None:
        rd_hist = [rd_now] + [v for v in (inc.get("researchDevelopment") or [])[(0 if use_ttm else 1):] if v is not None]
    rd = calc.capitalize_rd(rd_hist, ind.rd_life) if rd_hist else None
    ebit_adj = ebit + (rd.adjustment if rd else 0.0)
    ic_book = (equity or 0.0) + debt - cash
    ic_adj = ic_book + (rd.asset if rd else 0.0)
    margin_rep = ebit / revenue
    margin_adj = ebit_adj / revenue
    sbc = _first(cf.get("stockBasedCompensation"))
    adj = res.adjustments
    adj.append(IvRow(label="Operatives Ergebnis (berichtet)", value=ebit, note=f"Marge {margin_rep * 100:.1f} %".replace(".", ",")))
    if rd:
        adj.append(IvRow(label="+ F&E des laufenden Jahres", value=rd.current, note="als Investition statt als Aufwand"))
        adj.append(IvRow(label="− Abschreibung des Forschungsvermögens", value=-rd.amortization,
                         note=f"Abschreibungsdauer {rd.life} Jahre ({ind.name})"
                         + (f"; {rd.estimated} frühere Jahre fortgeschrieben" if rd.estimated else "")))
        adj.append(IvRow(label="= Operatives Ergebnis (bereinigt)", value=ebit_adj, note=f"Marge {margin_adj * 100:.1f} %".replace(".", ",")))
        adj.append(IvRow(label="Forschungsvermögen (zum eingesetzten Kapital)", value=rd.asset,
                         note="nicht abgeschriebener Teil der F&E-Ausgaben"))
    else:
        adj.append(IvRow(label="F&E", unit="text", text="keine F&E-Ausgaben berichtet – keine Bereinigung"))
    if sbc is not None:
        adj.append(IvRow(label="Aktienbasierte Vergütung", value=sbc,
                         note=f"{sbc / revenue * 100:.1f} % vom Umsatz – echter Aufwand, bleibt abgezogen (nicht zurückgerechnet)".replace(".", ",")))
    adj.append(IvRow(label="Leasing", unit="text",
                     text="nicht gesondert bereinigt: unter IFRS 16 / US-GAAP ASC 842 bilanziert; bei US-Firmen steckt die "
                          "Operating-Lease-Miete weiter im operativen Ergebnis"))
    adj.append(IvRow(label="Eingesetztes Kapital (Buchwert, bereinigt)", value=ic_adj,
                     note="Eigenkapital + Finanzschulden − Barmittel + Forschungsvermögen"))

    # Kurs, Marktwert
    q = inp.quote
    shares = c.shares.outstanding or (c.market_cap / q.last if c.market_cap and q and q.last else None)
    if not shares or shares <= 0:
        res.state = "no_data"
        res.message = "Aktienzahl unbekannt – kein Wert je Aktie möglich."
        return res
    if q and q.last:
        res.price_quote = q.last
        res.price_currency = q.currency or c.currency
        if inp.fx is not None:
            res.price = q.last * inp.fx
    market_cap = (res.price or 0.0) * shares if res.price else (c.market_cap or 0.0)

    # Kapitalkosten
    coc = calc.cost_of_capital(
        riskfree=inp.riskfree, erp=params.erp, crp=crp, beta_u=ind.beta_u, market_cap=market_cap, debt=debt,
        ebit=ebit, interest=abs(interest) if interest is not None else None, tax_marginal=tax_marginal,
        rating_for=params.rating_for,
    )
    k = res.cost_of_capital
    k.append(IvRow(label="Risikoloser Zins", value=coc.riskfree, unit="pct", note=inp.riskfree_source))
    k.append(IvRow(label="Beta ohne Verschuldung (Branche)", value=coc.beta_u, unit="num", note=f"{ind.name} – {ind.source}"))
    if c.technicals.beta is not None:
        k.append(IvRow(label="Beta aus Kursen (nur zum Vergleich)", value=c.technicals.beta, unit="num",
                       note="Regressionsbeta ist verrauscht – Damodaran nimmt das Branchenbeta"))
    k.append(IvRow(label="Verschuldung (Finanzschulden ÷ Marktwert Eigenkapital)", value=coc.debt_to_equity, unit="pct"))
    k.append(IvRow(label="Beta mit Verschuldung", value=coc.beta_l, unit="num", note="Branchenbeta × (1 + (1 − Steuersatz) × Verschuldung)"))
    k.append(IvRow(label="Aktien-Risikoprämie", value=coc.erp, unit="pct", note=params.erp_source))
    k.append(IvRow(label="Länderrisikoprämie", value=coc.crp, unit="pct", note=f"{res.country or '?'} – {params.country_source}"))
    k.append(IvRow(label="= Eigenkapitalkosten", value=coc.cost_equity, unit="pct", note="risikoloser Zins + Beta × Risikoprämie + Länderrisiko"))
    k.append(IvRow(label="Zinsdeckung (EBIT ÷ Zinsaufwand)", value=coc.coverage, unit="x",
                   note=f"synthetisches Rating {coc.rating}, Aufschlag {coc.spread * 100:.2f} %".replace(".", ",")))
    k.append(IvRow(label="Fremdkapitalkosten nach Steuern", value=coc.cost_debt_after, unit="pct",
                   note=f"(risikoloser Zins + Aufschlag) × (1 − {tax_marginal * 100:.1f} %)".replace(".", ",")))
    k.append(IvRow(label="Gewicht Fremdkapital", value=coc.weight_debt, unit="pct"))
    k.append(IvRow(label="= Kapitalkosten (Jahre 1–5)", value=coc.wacc, unit="pct"))
    k.append(IvRow(label="Kapitalkosten reife Firma (ab Jahr 11)", value=coc.wacc_terminal, unit="pct",
                   note="Beta 1: risikoloser Zins + Risikoprämie + Länderrisiko"))

    # Lebenszyklus
    lc = calc.lifecycle(growth_3y, margin_adj)
    res.lifecycle = IvLifecycle(key=lc, label=calc.LIFECYCLE[lc][0], text=calc.LIFECYCLE[lc][1])

    # Startwerte der Hebel
    g_term = inp.riskfree
    g1 = growth_last if growth_last is not None else 0.03
    if growth_3y is not None:
        # fehlt das Vorjahr, nur der 3-Jahres-Schnitt (nicht mit dem Platzhalter 3 % mitteln)
        g1 = (g1 + growth_3y) / 2 if growth_last is not None else growth_3y
    g1 = min(max(g1, -0.10), 0.40)
    g25 = (g1 + g_term) / 2 if g1 > g_term else g1
    target = ind.margin if margin_adj <= 0 else margin_adj + (ind.margin - margin_adj) * 0.5
    defaults = Levers(
        growth_next=g1, growth_2_5=g25, target_margin=target, margin_year=5, sales_to_capital=ind.sales_to_capital,
        wacc=coc.wacc, wacc_terminal=coc.wacc_terminal, growth_terminal=g_term, roic_terminal=coc.wacc_terminal,
        failure_prob=0.0, failure_proceeds=0.5,
    )
    lev = Levers(**asdict(defaults))
    for key, label, unit, lo, hi, *_ in LEVER_SPECS:
        v = overrides.get(key)
        if isinstance(v, (int, float)) and math.isfinite(v):
            # auf den erlaubten Bereich begrenzen (wie die Vorschläge der Persona); ein Startwert außerhalb bleibt
            # erreichbar. Sonst z. B. Kapitalkosten −100 % → Division durch null im Abzinsen (Fehler 500)
            d = float(getattr(defaults, key))
            lo, hi = min(lo, d), max(hi, d)
            if not lo <= v <= hi:
                def f(x: float) -> str:
                    return f"{round(x * 100, 2):g} %".replace(".", ",") if unit == "pct" else f"{round(x, 2):g}".replace(".", ",")

                res.warnings.append(f"„{label}“ auf den erlaubten Bereich {f(lo)} bis {f(hi)} begrenzt.")
                v = min(max(float(v), lo), hi)
            setattr(lev, key, int(round(v)) if key == "margin_year" else float(v))
    nol = 0.0
    if ebit < 0:
        nol = -sum(v for v in ops if v is not None and v < 0)
    base = Base(revenue=revenue, margin=margin_adj, tax_effective=tax_eff, tax_marginal=tax_marginal,
                invested_capital=ic_adj, cash=cash, debt=debt, shares=shares, riskfree=inp.riskfree, nol=nol)

    try:
        out = calc.dcf(base, lev)
    except calc.DcfError as exc:
        res.state = "invalid"
        res.message = str(exc)
        res.levers = _lever_infos(lev, defaults)
        return res
    lev, _ = calc.check_levers(lev, base)
    res.levers = _lever_infos(lev, defaults)
    res.warnings += out.warnings
    res.years = [IvYear(**asdict(r)) for r in out.rows]
    res.terminal = [
        IvRow(label="Umsatz Jahr 11", value=out.terminal_revenue),
        IvRow(label="Operatives Ergebnis nach Steuern Jahr 11", value=out.terminal_ebit_after_tax,
              note=f"Zielmarge, Grenzsteuersatz {tax_marginal * 100:.1f} %".replace(".", ",")),
        IvRow(label="Reinvestitionsquote", value=out.terminal_reinvestment_rate, unit="pct", note="Endwachstum ÷ Kapitalrendite im Endwert"),
        IvRow(label="Freier Cashflow Jahr 11", value=out.terminal_fcff),
        IvRow(label="Endwert (Jahr 10)", value=out.terminal_value, note="Cashflow Jahr 11 ÷ (Kapitalkosten − Endwachstum)"),
        IvRow(label="Barwert des Endwerts", value=out.pv_terminal),
    ]
    b = res.bridge
    b.append(IvRow(label="Barwert der Cashflows Jahre 1–10", value=out.pv_years))
    b.append(IvRow(label="+ Barwert des Endwerts", value=out.pv_terminal,
                   note=f"{out.terminal_share * 100:.0f} % des operativen Werts".replace(".", ",") if math.isfinite(out.terminal_share) else ""))
    b.append(IvRow(label="= Wert des operativen Geschäfts", value=out.operating_value))
    if lev.failure_prob > 0:
        b.append(IvRow(label="nach Ausfallwahrscheinlichkeit", value=out.operating_value_adj,
                       note=f"{lev.failure_prob * 100:.0f} % Ausfall, Erlös {lev.failure_proceeds * 100:.0f} % des Kapitals"))
    b.append(IvRow(label="− Finanzschulden", value=-debt))
    b.append(IvRow(label="+ Barmittel", value=cash))
    b.append(IvRow(label="= Wert des Eigenkapitals", value=out.equity_value,
                   note="ohne Minderheiten und Mitarbeiteroptionen (nicht in den Daten)"))
    b.append(IvRow(label="÷ Aktien", value=shares, unit="num"))
    b.append(IvRow(label="= Wert je Aktie", value=out.value_per_share, unit="num", note=res.currency or ""))
    res.value_per_share = _fin(out.value_per_share)
    res.terminal_share = _fin(out.terminal_share)
    if res.price and res.value_per_share is not None:
        res.value_gap = res.value_per_share / res.price - 1

    # Wachstumsqualität: Rendite auf neues Kapital laut Hebeln gegen die Kapitalkosten
    roic_now = ebit_adj * (1 - tax_eff) / ic_adj if ic_adj > 0 else None
    roic_marg = lev.sales_to_capital * lev.target_margin * (1 - tax_marginal)
    if roic_marg > lev.wacc + 0.005:
        verdict = "Wachstum schafft Wert: Die Rendite auf neues Kapital liegt über den Kapitalkosten."
    elif roic_marg < lev.wacc - 0.005:
        verdict = "Wachstum vernichtet Wert: Die Rendite auf neues Kapital liegt unter den Kapitalkosten – mehr Wachstum senkt den Wert."
    else:
        verdict = "Wachstum ist etwa wertneutral: Rendite auf neues Kapital ≈ Kapitalkosten."
    if ic_adj <= 0:
        res.warnings.append("Eingesetztes Kapital (Buchwert) ist nicht positiv – heutige Kapitalrendite nicht aussagekräftig.")
    res.quality = IvQuality(roic_now=_fin(roic_now), wacc=lev.wacc, roic_marginal=roic_marg, verdict=verdict)

    # Gegenprobe Pricing
    v = c.valuation
    for label, val in (("KGV", v.pe), ("KGV erwartet", v.forward_pe), ("EV/Umsatz", v.ev_revenue), ("EV/EBITDA", v.ev_ebitda)):
        if val is not None:
            res.multiples.append(IvRow(label=label, value=val, unit="x"))

    # Rückwärts-DCF und Bandbreite
    if res.price:
        g_impl = calc.implied_growth(base, lev, res.price)
        m_impl = calc.implied_margin(base, lev, res.price)
        mult = None
        if g_impl is not None:
            rows = calc.dcf(base, calc.Levers(**{**asdict(lev), "growth_next": g_impl, "growth_2_5": g_impl})).rows
            mult = rows[-1].revenue / revenue
        res.reverse = IvReverse(growth=g_impl, revenue_multiple_10y=mult, margin=m_impl)
    if simulate:
        seed = zlib.crc32(inp.ticker.encode())
        d = calc.simulate(base, lev, res.price, seed=seed)
        res.distribution = IvDistribution(
            runs=d.runs, p10=_fin(d.p10), p25=_fin(d.p25), p50=_fin(d.p50), p75=_fin(d.p75), p90=_fin(d.p90),
            share_above_price=d.share_above_price, bins=[IvBin(lo=lo, hi=hi, n=n) for lo, hi, n in d.bins],
        )
    if out.terminal_share > 0.85 and math.isfinite(out.terminal_share):
        res.warnings.append("Über 85 % des Werts stecken im Endwert – die Story nach Jahr 10 trägt fast alles.")
    return res


def _lever_infos(lev: Levers, defaults: Levers) -> list[IvLever]:
    out: list[IvLever] = []
    for key, label, unit, lo, hi, step, hint in LEVER_SPECS:
        out.append(IvLever(key=key, label=label, value=float(getattr(lev, key)), default=float(getattr(defaults, key)),
                           unit=unit, min=lo, max=hi, step=step, hint=hint))  # type: ignore[arg-type]
    return out
