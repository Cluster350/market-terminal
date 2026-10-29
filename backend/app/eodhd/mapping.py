"""Übersetzung der EODHD-Rohantworten in die Terminal-Modelle.

Alle Funktionen sind rein (ohne Netz) und tolerant gegenüber fehlenden Feldern,
Strings statt Zahlen und leeren Antworten. Formate laut EODHD-Dokumentation;
scripts/verify_eodhd.py prüft sie gegen die Live-API.
"""

from __future__ import annotations

import datetime as dt
import hashlib
from typing import Any, Iterable, Optional

from ..models import (
    Analyst,
    Company,
    CountryValue,
    Dividends,
    DividendItem,
    Earnings,
    EarningsItem,
    EconEvent,
    Financials,
    History,
    Intraday,
    NewsItem,
    Officer,
    PerShare,
    Profitability,
    Quote,
    ScreenRow,
    SearchHit,
    Sentiment,
    SharesInfo,
    SplitItem,
    StatementRow,
    Technicals,
    Valuation,
)
from ..services.util import integer, num, pct, safe_div, text


def _as_list(data: Any) -> list[dict]:
    if isinstance(data, list):
        return [d for d in data if isinstance(d, dict)]
    if isinstance(data, dict):
        return [data]
    return []


def _ts_to_iso(ts: Any) -> Optional[str]:
    t = num(ts)
    if t is None or t <= 0:
        return None
    return dt.datetime.fromtimestamp(t, tz=dt.timezone.utc).isoformat().replace("+00:00", "Z")


# --- Kurse -------------------------------------------------------------------


def quote(raw: dict, ticker: str) -> Quote:
    last = num(raw.get("close"))
    prev = num(raw.get("previousClose"))
    change = num(raw.get("change"))
    change_pct = num(raw.get("change_p"))
    if change is None and last is not None and prev is not None:
        change = last - prev
    if change_pct is None:
        change_pct = pct(last, prev)
    return Quote(
        ticker=ticker,
        last=last,
        change=change,
        change_pct=change_pct,
        open=num(raw.get("open")),
        high=num(raw.get("high")),
        low=num(raw.get("low")),
        prev_close=prev,
        volume=num(raw.get("volume")),
        timestamp=_ts_to_iso(raw.get("timestamp")),
        delayed=True,
    )


def quotes(data: Any, tickers: list[str]) -> list[Quote]:
    """Ordnet die Antwort von /real-time (ein oder mehrere Ticker) den Anfragen zu."""
    by_code: dict[str, dict] = {}
    for item in _as_list(data):
        code = text(item.get("code"))
        if code:
            by_code[code.upper()] = item
    out: list[Quote] = []
    for t in tickers:
        item = by_code.get(t.upper()) or by_code.get(t.split(".")[0].upper())
        if item is None and len(tickers) == 1 and len(by_code) == 1:
            item = next(iter(by_code.values()))
        if item is None or num(item.get("close")) is None:
            out.append(Quote(ticker=t))
        else:
            out.append(quote(item, t))
    return out


def history(data: Any, ticker: str) -> History:
    rows = sorted(_as_list(data), key=lambda r: str(r.get("date", "")))
    t: list[str] = []
    o: list[Optional[float]] = []
    h: list[Optional[float]] = []
    l: list[Optional[float]] = []
    c: list[Optional[float]] = []
    v: list[Optional[float]] = []
    for r in rows:
        date = text(r.get("date"))
        close = num(r.get("close"))
        adj = num(r.get("adjusted_close"))
        if not date or (close is None and adj is None):
            continue
        # OHLC mit demselben Faktor bereinigen wie den Schlusskurs (Splits, Dividenden)
        factor = adj / close if adj is not None and close not in (None, 0) else 1.0
        if adj is None:
            adj = close

        def scaled(key: str) -> Optional[float]:
            val = num(r.get(key))
            return None if val is None else round(val * factor, 6)

        t.append(date[:10])
        o.append(scaled("open"))
        h.append(scaled("high"))
        l.append(scaled("low"))
        c.append(round(adj, 6) if adj is not None else None)
        v.append(num(r.get("volume")))
    return History(ticker=ticker, t=t, o=o, h=h, l=l, c=c, v=v)


def intraday(data: Any, ticker: str, interval: str) -> Intraday:
    rows = sorted(_as_list(data), key=lambda r: num(r.get("timestamp")) or 0)
    out = Intraday(ticker=ticker, interval=interval, t=[], o=[], h=[], l=[], c=[], v=[])
    for r in rows:
        ts = num(r.get("timestamp"))
        close = num(r.get("close"))
        if ts is None or close is None:
            continue
        out.t.append(int(ts))
        out.o.append(num(r.get("open")))
        out.h.append(num(r.get("high")))
        out.l.append(num(r.get("low")))
        out.c.append(close)
        out.v.append(num(r.get("volume")))
    return out


# --- Fundamentaldaten ----------------------------------------------------------


def company(data: Any, ticker: str) -> Company:
    if not isinstance(data, dict):
        data = {}
    g = data.get("General") or {}
    hl = data.get("Highlights") or {}
    val = data.get("Valuation") or {}
    tech = data.get("Technicals") or {}
    sh = data.get("SharesStats") or {}
    ar = data.get("AnalystRatings") or {}

    officers: list[Officer] = []
    raw_officers = g.get("Officers") or {}
    if isinstance(raw_officers, dict):
        raw_officers = list(raw_officers.values())
    for off in raw_officers if isinstance(raw_officers, list) else []:
        if isinstance(off, dict) and text(off.get("Name")):
            officers.append(Officer(name=text(off.get("Name")) or "", title=text(off.get("Title"))))

    return Company(
        ticker=ticker,
        name=text(g.get("Name")) or ticker,
        exchange=text(g.get("Exchange")),
        currency=text(g.get("CurrencyCode")),
        country=text(g.get("CountryName")),
        sector=text(g.get("Sector")) or text(g.get("GicSector")),
        industry=text(g.get("Industry")) or text(g.get("GicIndustry")),
        description=text(g.get("Description")),
        employees=integer(g.get("FullTimeEmployees")),
        website=text(g.get("WebURL")),
        ipo_date=text(g.get("IPODate")),
        isin=text(g.get("ISIN")),
        market_cap=num(hl.get("MarketCapitalization")),
        officers=officers[:8],
        valuation=Valuation(
            pe=num(val.get("TrailingPE")) or num(hl.get("PERatio")),
            forward_pe=num(val.get("ForwardPE")),
            peg=num(hl.get("PEGRatio")),
            price_sales=num(val.get("PriceSalesTTM")),
            price_book=num(val.get("PriceBookMRQ")),
            ev=num(val.get("EnterpriseValue")),
            ev_revenue=num(val.get("EnterpriseValueRevenue")),
            ev_ebitda=num(val.get("EnterpriseValueEbitda")),
        ),
        profitability=Profitability(
            profit_margin=num(hl.get("ProfitMargin")),
            operating_margin=num(hl.get("OperatingMarginTTM")),
            roe=num(hl.get("ReturnOnEquityTTM")),
            roa=num(hl.get("ReturnOnAssetsTTM")),
            revenue_ttm=num(hl.get("RevenueTTM")),
            ebitda=num(hl.get("EBITDA")),
            revenue_growth_yoy=num(hl.get("QuarterlyRevenueGrowthYOY")),
            earnings_growth_yoy=num(hl.get("QuarterlyEarningsGrowthYOY")),
        ),
        per_share=PerShare(
            eps=num(hl.get("EarningsShare")) or num(hl.get("DilutedEpsTTM")),
            eps_estimate_cy=num(hl.get("EPSEstimateCurrentYear")),
            eps_estimate_ny=num(hl.get("EPSEstimateNextYear")),
            book_value=num(hl.get("BookValue")),
            dividend_share=num(hl.get("DividendShare")),
            dividend_yield=num(hl.get("DividendYield")),
        ),
        technicals=Technicals(
            beta=num(tech.get("Beta")),
            high52=num(tech.get("52WeekHigh")),
            low52=num(tech.get("52WeekLow")),
            ma50=num(tech.get("50DayMA")),
            ma200=num(tech.get("200DayMA")),
        ),
        shares=SharesInfo(
            outstanding=num(sh.get("SharesOutstanding")),
            float_shares=num(sh.get("SharesFloat")),
            pct_insiders=num(sh.get("PercentInsiders")),
            pct_institutions=num(sh.get("PercentInstitutions")),
        ),
        analyst=Analyst(
            rating=num(ar.get("Rating")),
            target_price=num(ar.get("TargetPrice")) or num(hl.get("WallStreetTargetPrice")),
            strong_buy=integer(ar.get("StrongBuy")),
            buy=integer(ar.get("Buy")),
            hold=integer(ar.get("Hold")),
            sell=integer(ar.get("Sell")),
            strong_sell=integer(ar.get("StrongSell")),
        ),
        updated_at=text(g.get("UpdatedAt")),
    )


# (Schlüssel, deutsche Bezeichnung, Hervorhebung, Ersatzschlüssel)
INCOME_ROWS = [
    ("totalRevenue", "Umsatz", True, ()),
    ("costOfRevenue", "Herstellungskosten", False, ()),
    ("grossProfit", "Bruttoergebnis", True, ()),
    ("researchDevelopment", "Forschung & Entwicklung", False, ()),
    ("sellingGeneralAdministrative", "Vertrieb & Verwaltung", False, ()),
    ("operatingIncome", "Operatives Ergebnis", True, ()),
    ("ebitda", "EBITDA", False, ()),
    ("interestExpense", "Zinsaufwand", False, ()),
    ("incomeBeforeTax", "Ergebnis vor Steuern", False, ()),
    ("incomeTaxExpense", "Steuern", False, ()),
    ("netIncome", "Nettoergebnis", True, ("netIncomeApplicableToCommonShares",)),
]
BALANCE_ROWS = [
    ("cash", "Liquide Mittel", False, ("cashAndShortTermInvestments", "cashAndEquivalents")),
    ("netReceivables", "Forderungen", False, ()),
    ("inventory", "Vorräte", False, ()),
    ("totalCurrentAssets", "Umlaufvermögen", False, ()),
    ("totalAssets", "Bilanzsumme", True, ()),
    ("totalCurrentLiabilities", "Kurzfristige Verbindlichkeiten", False, ()),
    ("shortLongTermDebtTotal", "Finanzschulden gesamt", False, ("longTermDebtTotal", "longTermDebt")),
    ("totalLiab", "Verbindlichkeiten gesamt", False, ()),
    ("totalStockholderEquity", "Eigenkapital", True, ()),
    ("netDebt", "Nettoverschuldung", False, ()),
]
CASHFLOW_ROWS = [
    ("totalCashFromOperatingActivities", "Operativer Cashflow", True, ()),
    ("capitalExpenditures", "Investitionen (Capex)", False, ()),
    ("freeCashFlow", "Free Cashflow", True, ()),
    ("totalCashflowsFromInvestingActivities", "Cashflow aus Investitionen", False, ()),
    ("totalCashFromFinancingActivities", "Cashflow aus Finanzierung", False, ()),
    ("dividendsPaid", "Gezahlte Dividenden", False, ()),
    ("salePurchaseOfStock", "Aktienrückkäufe/-ausgaben", False, ()),
]


def _statement(block: Any, period: str) -> dict[str, dict]:
    if not isinstance(block, dict):
        return {}
    key = "yearly" if period == "annual" else "quarterly"
    rows = block.get(key) or {}
    return rows if isinstance(rows, dict) else {}


def _rows(spec, statement: dict[str, dict], periods: list[str]) -> list[StatementRow]:
    out: list[StatementRow] = []
    for key, label, emphasis, fallbacks in spec:
        values: list[Optional[float]] = []
        for p in periods:
            rec = statement.get(p) or {}
            v = num(rec.get(key))
            for fb in fallbacks:
                if v is None:
                    v = num(rec.get(fb))
            values.append(v)
        if any(v is not None for v in values):
            out.append(StatementRow(key=key, label=label, values=values, emphasis=emphasis))
    return out


def financials(data: Any, ticker: str, period: str, max_periods: int = 0) -> Financials:
    fin = (data or {}).get("Financials") if isinstance(data, dict) else None
    fin = fin if isinstance(fin, dict) else {}
    inc = _statement(fin.get("Income_Statement"), period)
    bal = _statement(fin.get("Balance_Sheet"), period)
    cfs = _statement(fin.get("Cash_Flow"), period)
    limit = max_periods or (6 if period == "annual" else 8)
    periods = sorted(set(inc) | set(bal) | set(cfs), reverse=True)[:limit]

    income = _rows(INCOME_ROWS, inc, periods)
    by_key = {r.key: r for r in income}
    rev = by_key.get("totalRevenue")
    if rev:
        for key, label in (("grossProfit", "Bruttomarge"), ("operatingIncome", "Operative Marge"), ("netIncome", "Nettomarge")):
            row = by_key.get(key)
            if row:
                income.append(
                    StatementRow(
                        key=f"{key}Margin",
                        label=label,
                        values=[safe_div(a, b) for a, b in zip(row.values, rev.values)],
                        kind="ratio",
                    )
                )
    cash = _rows(CASHFLOW_ROWS, cfs, periods)
    cash_keys = {r.key for r in cash}
    if "freeCashFlow" not in cash_keys:
        cfo = next((r for r in cash if r.key == "totalCashFromOperatingActivities"), None)
        capex = next((r for r in cash if r.key == "capitalExpenditures"), None)
        if cfo and capex:
            fcf = [
                None if a is None or b is None else a - abs(b) for a, b in zip(cfo.values, capex.values)
            ]
            cash.insert(2, StatementRow(key="freeCashFlow", label="Free Cashflow", values=fcf, emphasis=True))

    currency = None
    for stmt in (fin.get("Income_Statement"), fin.get("Balance_Sheet")):
        if isinstance(stmt, dict) and text(stmt.get("currency_symbol")):
            currency = text(stmt.get("currency_symbol"))
            break
    if currency is None and isinstance(data, dict):
        currency = text((data.get("General") or {}).get("CurrencyCode"))

    return Financials(
        ticker=ticker,
        period="annual" if period == "annual" else "quarterly",
        currency=currency,
        periods=periods,
        income=income,
        balance=_rows(BALANCE_ROWS, bal, periods),
        cashflow=cash,
    )


def earnings(data: Any, ticker: str, today: Optional[dt.date] = None) -> Earnings:
    today = today or dt.date.today()
    block = ((data or {}).get("Earnings") or {}) if isinstance(data, dict) else {}
    hist = block.get("History") or {}
    items: list[EarningsItem] = []
    for rec in (hist.values() if isinstance(hist, dict) else hist if isinstance(hist, list) else []):
        if not isinstance(rec, dict):
            continue
        date = text(rec.get("date"))
        if not date:
            continue
        actual = num(rec.get("epsActual"))
        est = num(rec.get("epsEstimate"))
        surprise = num(rec.get("surprisePercent"))
        if surprise is None and actual is not None and est not in (None, 0):
            surprise = (actual - est) / abs(est) * 100.0
        items.append(
            EarningsItem(
                date=date[:10],
                report_date=(text(rec.get("reportDate")) or "")[:10] or None,
                eps_actual=actual,
                eps_estimate=est,
                surprise_pct=surprise,
                timing=text(rec.get("beforeAfterMarket")),
            )
        )
    items.sort(key=lambda e: e.report_date or e.date, reverse=True)

    upcoming = [
        e for e in items if e.eps_actual is None and (e.report_date or e.date) >= today.isoformat()
    ]
    nxt = min(upcoming, key=lambda e: e.report_date or e.date) if upcoming else None
    reported = [e for e in items if e.eps_actual is not None][:12]
    currency = text(((data or {}).get("General") or {}).get("CurrencyCode")) if isinstance(data, dict) else None
    return Earnings(ticker=ticker, currency=currency, history=reported, next=nxt)


def dividends(div_data: Any, split_data: Any, ticker: str, today: Optional[dt.date] = None) -> Dividends:
    today = today or dt.date.today()
    divs: list[DividendItem] = []
    for r in _as_list(div_data):
        date = text(r.get("date"))
        if not date:
            continue
        divs.append(
            DividendItem(
                ex_date=date[:10],
                pay_date=(text(r.get("paymentDate")) or "")[:10] or None,
                value=num(r.get("value")),
                currency=text(r.get("currency")),
            )
        )
    divs.sort(key=lambda d: d.ex_date, reverse=True)
    splits = [
        SplitItem(date=(text(r.get("date")) or "")[:10], ratio=_split_ratio(text(r.get("split")) or ""))
        for r in _as_list(split_data)
        if text(r.get("date"))
    ]
    splits.sort(key=lambda s: s.date, reverse=True)
    cutoff = (today - dt.timedelta(days=365)).isoformat()
    ttm_vals = [d.value for d in divs if d.ex_date > cutoff and d.value is not None]
    return Dividends(
        ticker=ticker,
        dividends=divs[:40],
        splits=splits,
        ttm=round(sum(ttm_vals), 6) if ttm_vals else None,
    )


def _split_ratio(raw: str) -> str:
    """'4.000000/1.000000' -> '4:1'"""
    try:
        a, b = raw.split("/")
        fa, fb = float(a), float(b)
        fmt = lambda x: str(int(x)) if x == int(x) else f"{x:g}"
        return f"{fmt(fa)}:{fmt(fb)}"
    except (ValueError, ZeroDivisionError):
        return raw or "?"


# --- News ------------------------------------------------------------------------

TOPIC_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("earnings", ("earnings", "quarter", "results", "eps", "revenue", "guidance", "quartal")),
    ("mna", ("acquire", "acquisition", "merger", "takeover", "buyout", "übernahme", "fusion")),
    ("analyst", ("upgrade", "downgrade", "price target", "rating", "analyst", "kursziel")),
    ("macro", ("fed ", "ecb", "inflation", "cpi", "gdp", "jobs report", "payroll", "central bank", "rates", "notenbank", "zins")),
]


def classify_topic(title: str, tags: Iterable[str]) -> str:
    hay = (title + " " + " ".join(tags)).lower()
    for topic, words in TOPIC_RULES:
        if any(w in hay for w in words):
            return topic
    return "company"


def _source_from_link(link: Optional[str]) -> Optional[str]:
    if not link:
        return None
    host = link.split("//", 1)[-1].split("/", 1)[0].lower()
    return host[4:] if host.startswith("www.") else host or None


def news(data: Any) -> list[NewsItem]:
    out: list[NewsItem] = []
    for r in _as_list(data):
        title = text(r.get("title"))
        date = text(r.get("date"))
        if not title or not date:
            continue
        link = text(r.get("link"))
        tags = [str(t) for t in (r.get("tags") or []) if t][:8]
        symbols = [str(s).upper() for s in (r.get("symbols") or []) if s][:12]
        s = r.get("sentiment") or {}
        iso = _normalize_news_date(date)
        ident = hashlib.sha1((link or title + iso).encode("utf-8")).hexdigest()[:16]
        polarity = num(s.get("polarity")) if isinstance(s, dict) else None
        out.append(
            NewsItem(
                id=ident,
                date=iso,
                title=title,
                content=text(r.get("content")) or "",
                link=link,
                source=_source_from_link(link),
                symbols=symbols,
                tags=tags,
                topic=classify_topic(title, tags),
                sentiment=Sentiment(
                    polarity=polarity,
                    pos=num(s.get("pos")) if isinstance(s, dict) else None,
                    neu=num(s.get("neu")) if isinstance(s, dict) else None,
                    neg=num(s.get("neg")) if isinstance(s, dict) else None,
                ),
            )
        )
    return out


def _normalize_news_date(raw: str) -> str:
    try:
        d = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        try:
            d = dt.datetime.strptime(raw[:19], "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return raw
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return d.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


# --- Makro ------------------------------------------------------------------------

HIGH_IMPACT = (
    "interest rate decision", "nonfarm payrolls", "non farm payrolls", "cpi", "inflation rate",
    "gdp growth", "unemployment rate", "fomc", "pce price", "ism manufacturing", "retail sales",
)
MEDIUM_IMPACT = ("pmi", "ifo", "zew", "industrial production", "jobless claims", "trade balance", "consumer confidence", "ppi")


def importance(event: str) -> int:
    e = event.lower()
    if any(k in e for k in HIGH_IMPACT):
        return 3
    if any(k in e for k in MEDIUM_IMPACT):
        return 2
    return 1


def econ_events(data: Any) -> list[EconEvent]:
    out: list[EconEvent] = []
    for r in _as_list(data):
        name = text(r.get("type")) or text(r.get("event"))
        date = text(r.get("date"))
        country = text(r.get("country"))
        if not name or not date or not country:
            continue
        iso = _normalize_news_date(date)
        actual, est = num(r.get("actual")), num(r.get("estimate"))
        comparison = text(r.get("comparison"))
        label = f"{name} {comparison.upper()}" if comparison and comparison.lower() in ("mom", "yoy", "qoq") else name
        ident = hashlib.sha1(f"{country}|{label}|{iso}".encode()).hexdigest()[:16]
        out.append(
            EconEvent(
                id=ident,
                date=iso,
                country=country.upper(),
                event=label,
                period=text(r.get("period")),
                actual=actual,
                estimate=est,
                previous=num(r.get("previous")),
                surprise=None if actual is None or est is None else round(actual - est, 6),
                importance=importance(label),
            )
        )
    out.sort(key=lambda e: e.date)
    return out


def macro_series(data: Any) -> list[CountryValue]:
    out: list[CountryValue] = []
    for r in _as_list(data):
        date = text(r.get("Date")) or text(r.get("date"))
        value = num(r.get("Value") if "Value" in r else r.get("value"))
        if not date:
            continue
        try:
            year = int(date[:4])
        except ValueError:
            continue
        out.append(CountryValue(year=year, value=value))
    out.sort(key=lambda cv: cv.year or 0)
    return out


# --- Screener & Suche ------------------------------------------------------------


def screen_rows(data: Any) -> list[ScreenRow]:
    rows = data.get("data") if isinstance(data, dict) else data
    out: list[ScreenRow] = []
    for r in _as_list(rows):
        code = text(r.get("code"))
        exch = text(r.get("exchange"))
        if not code:
            continue
        exch_code = (exch or "US").upper()
        ticker = f"{code.upper()}.{exch_code}" if "." not in code else code.upper()
        price = num(r.get("adjusted_close"))
        eps = num(r.get("earnings_share"))
        dy = num(r.get("dividend_yield"))
        out.append(
            ScreenRow(
                ticker=ticker,
                name=text(r.get("name")),
                exchange=exch_code,
                sector=text(r.get("sector")),
                industry=text(r.get("industry")),
                currency=text(r.get("currency_symbol")),
                price=price,
                chg_1d=num(r.get("refund_1d_p")),
                chg_5d=num(r.get("refund_5d_p")),
                market_cap=num(r.get("market_capitalization")),
                eps=eps,
                pe=price / eps if price is not None and eps not in (None, 0) and eps > 0 else None,
                # EODHD liefert die Rendite als Anteil (0.012); im Terminal in Prozent
                div_yield=dy * 100.0 if dy is not None and dy < 1 else dy,
                avg_vol=num(r.get("avgvol_200d")) or num(r.get("avgvol_1d")),
            )
        )
    return out


def search_hits(data: Any) -> list[SearchHit]:
    out: list[SearchHit] = []
    for r in _as_list(data):
        code, exch = text(r.get("Code")), text(r.get("Exchange"))
        if not code or not exch:
            continue
        out.append(
            SearchHit(
                ticker=f"{code.upper()}.{exch.upper()}",
                name=text(r.get("Name")) or code,
                exchange=exch.upper(),
                type=text(r.get("Type")),
                country=text(r.get("Country")),
                currency=text(r.get("Currency")),
            )
        )
    return out
