"""Demo-KI: regelbasierte Einordnung, Briefing und einfache Antworten ohne Sprachmodell.

Sie zeigt, wie die KI-Funktionen aussehen, wenn LM Studio nicht läuft (Demo-Daten). Die
Ergebnisse folgen festen Regeln und Schlüsselwörtern; sie sind deutlich als Demo gekennzeichnet.
"""

from __future__ import annotations

import datetime as dt
import re
import time
from typing import Optional
from zoneinfo import ZoneInfo

from ..models import NewsItem
from ..providers import demo_data as D
from ..services.terminal import Terminal
from ..services.tickers import display
from .agent import suggestions_from, unverified_numbers
from .brief import BriefData
from .models import AskRequest, AskResult, Brief, BriefPoint, BriefSection, NewsInput, NewsInsight, ToolTrace
from .tools import resolve_ticker, run_tool, summarize

DEMO_MODEL = "Demo-KI (regelbasiert, kein Sprachmodell)"
BERLIN = ZoneInfo("Europe/Berlin")

SECTOR_DE = {
    "Technology": "Technologie", "Healthcare": "Gesundheit", "Financial Services": "Finanzen",
    "Consumer Cyclical": "Zyklischer Konsum", "Consumer Defensive": "Basiskonsum", "Energy": "Energie",
    "Utilities": "Versorger", "Industrials": "Industrie", "Communication Services": "Kommunikation",
    "Basic Materials": "Grundstoffe", "Real Estate": "Immobilien",
}
_SECTOR_OF = {f"{c[0]}.{c[2]}": c[3] for c in D.COMPANIES}

EVENT_LABEL = {
    "quartalszahlen": "Quartalszahlen", "prognose": "Prognose", "uebernahme": "Übernahme", "analyst": "Analystenurteil",
    "management": "Personalie", "produkt": "Produkt", "auftrag": "Auftrag", "kapitalmassnahme": "Kapitalmaßnahme",
    "rechtliches": "Rechtliches", "restrukturierung": "Umbau", "makro": "Konjunkturdaten", "markt": "Marktbericht",
    "sonstiges": "Unternehmensmeldung",
}

_POS = ("übertrifft", "hebt", "hochgestuft", "stuft", "kaufen", "rückkauf", "auftrag", "fester", "steigt", "gewinnt", "rekord", "über prognose", "angehoben")
_NEG = ("verfehlt", "senkt", "ausfall", "abbau", "unter druck", "schwächer", "warnung", "fällt", "streicht", "unter prognose", "gesenkt", "verlust")


# --- Zahlen im deutschen Format --------------------------------------------------


def de(x: Optional[float], digits: int = 2, sign: bool = False) -> str:
    if x is None:
        return "–"
    s = f"{x:+,.{digits}f}" if sign else f"{x:,.{digits}f}"
    return s.replace(",", "§").replace(".", ",").replace("§", ".").replace("-", "−")


def pct(x: Optional[float]) -> str:
    return "–" if x is None else f"{de(x, 2, sign=True)} %"


def big(x: Optional[float], cur: Optional[str] = None) -> str:
    if x is None:
        return "–"
    for div, unit in ((1e12, "Bio."), (1e9, "Mrd."), (1e6, "Mio.")):
        if abs(x) >= div:
            return f"{de(x / div, 2)} {unit}{' ' + cur if cur else ''}"
    return f"{de(x, 0)}{' ' + cur if cur else ''}"


def _price_digits(x: Optional[float]) -> int:
    if x is None:
        return 2
    return 4 if abs(x) < 10 else 2


_WEEKDAYS = ("Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag")


def _weekday(day: str) -> str:
    try:
        return _WEEKDAYS[dt.date.fromisoformat(day).weekday()]
    except ValueError:
        return day


def _local_time(iso: str) -> str:
    try:
        when = dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return ""
    if when.tzinfo is None:
        return ""
    return when.astimezone(BERLIN).strftime("%H:%M")


# --- News-Einordnung -------------------------------------------------------------


def to_input(n: NewsItem) -> NewsInput:
    return NewsInput(
        id=n.id[:80], title=n.title[:500], content=n.content or "", date=n.date, source=n.source,
        symbols=n.symbols[:6], topic=n.topic, polarity=n.sentiment.polarity, urgent=n.urgent,
    )


def _event(item: NewsInput, text: str) -> str:
    title = item.title.lower()
    if item.topic == "mna" or re.search(r"übernimmt|übernahme|fusion", text):
        return "uebernahme"
    if re.search(r"jahresprognose|ausblick|margenziel|prognose an|prognose gesenkt", title):
        return "prognose"
    # „im kommenden Quartal“ ist keine Quartalsmeldung (früher als Zahlen „über den Erwartungen“ eingeordnet)
    quarterly = re.search(r"quartalszahl|quartalsergebnis|quartalsbericht|gewinnerwartung|gewinn je aktie|(ersten|zweiten|dritten|vierten|abgelaufenen) quartal", text)
    if item.topic == "earnings" or quarterly:
        return "quartalszahlen"
    if item.topic == "analyst" or re.search(r"stuft|kursziel|einstufung", text):
        return "analyst"
    if item.topic == "macro":
        return "makro"
    if item.topic == "markets":
        return "markt"
    if re.search(r"finanzvorstand|vorstandschef|ernennt|rücktritt", text):
        return "management"
    if re.search(r"rückkauf|kapitalerhöhung|dividende|anleihe", text):
        return "kapitalmassnahme"
    if re.search(r"stellenabbau|stellen .*streichen|restrukturierung|umbau", text):
        return "restrukturierung"
    if re.search(r"klage|gericht|kartell|behörde|strafe", text):
        return "rechtliches"
    if "auftrag" in text:
        return "auftrag"
    if re.search(r"ausfall|defekt|störung", text):
        return "sonstiges"
    if re.search(r"produkt|vorgestellt|marktstart", text):
        return "produkt"
    return "sonstiges"


def _sentiment(item: NewsInput, text: str) -> float:
    if item.polarity is not None:
        return round(max(-1.0, min(1.0, item.polarity)), 2)
    score = sum(w in text for w in _POS) - sum(w in text for w in _NEG)
    return round(max(-1.0, min(1.0, score * 0.35)), 2)


def _relevance(item: NewsInput, event: str, sentiment: float, text: str) -> int:
    if item.urgent or event == "uebernahme":
        return 3
    if event == "quartalszahlen":
        return 3 if abs(sentiment) >= 0.5 else 2
    if event == "prognose":
        return 3 if sentiment <= -0.4 else 2
    if event in ("analyst", "kapitalmassnahme", "makro", "rechtliches"):
        return 2
    if event == "auftrag":
        return 2 if "mrd." in text else 1
    if event == "sonstiges" and re.search(r"ausfall|defekt", text):
        return 2
    return 1


def _reason(event: str, sentiment: float) -> str:
    direction = "positiv" if sentiment > 0.15 else "negativ" if sentiment < -0.15 else "neutral"
    texts = {
        ("quartalszahlen", "positiv"): "Die Zahlen liegen über den Erwartungen.",
        ("quartalszahlen", "negativ"): "Die Zahlen verfehlen die Erwartungen.",
        ("prognose", "positiv"): "Ein höherer Ausblick verbessert die Gewinnerwartung.",
        ("prognose", "negativ"): "Ein gesenkter Ausblick belastet die Gewinnerwartung.",
        ("analyst", "positiv"): "Eine Hochstufung kann kurzfristig Käufer anziehen.",
        ("analyst", "negativ"): "Eine Herabstufung dämpft die Nachfrage nach der Aktie.",
        ("uebernahme", "positiv"): "Die Übernahme verändert das Geschäft dauerhaft.",
        ("uebernahme", "neutral"): "Die Übernahme verändert das Geschäft dauerhaft; der Preis entscheidet über die Wirkung.",
        ("kapitalmassnahme", "positiv"): "Ein Rückkauf stützt den Kurs und den Gewinn je Aktie.",
        ("auftrag", "positiv"): "Der Auftrag sichert künftigen Umsatz.",
        ("restrukturierung", "negativ"): "Der Umbau deutet auf Kostendruck hin.",
        ("makro", "neutral"): "Konjunkturdaten beeinflussen Zinserwartungen und den Gesamtmarkt.",
        ("markt", "positiv"): "Freundlicher Gesamtmarkt.",
        ("markt", "negativ"): "Schwacher Gesamtmarkt.",
    }
    return texts.get((event, direction)) or f"{EVENT_LABEL[event]} mit {direction}er Wirkung (Schlüsselwort-Regel)."


def _summary(item: NewsInput) -> str:
    content = " ".join((item.content or "").split())
    if not content:
        return item.title
    sentences = re.split(r"(?<=[.!?])\s+(?=[A-ZÄÖÜ])", content)
    text = " ".join(sentences[:2])
    return text if len(text) <= 400 else text[:399] + "…"


def analyze_news(item: NewsInput) -> NewsInsight:
    text = f"{item.title} {item.content}".lower()
    event = _event(item, text)
    sentiment = _sentiment(item, text)
    sectors = []
    for s in item.symbols:
        sec = _SECTOR_OF.get(s)
        if sec and SECTOR_DE.get(sec, sec) not in sectors:
            sectors.append(SECTOR_DE.get(sec, sec))
    return NewsInsight(
        id=item.id,
        summary=_summary(item),
        sentiment=sentiment,
        reason=_reason(event, sentiment),
        tickers=[s for s in item.symbols if not s.endswith(".INDX")][:3],
        sectors=sectors[:3],
        event=event,
        relevance=_relevance(item, event, sentiment, text),
        horizon="strukturell" if event in ("uebernahme", "management", "restrukturierung", "produkt", "prognose") else "kurzfristig",
        engine="demo",
        model=DEMO_MODEL,
        created=_now(),
    )


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


# --- Morgenbriefing --------------------------------------------------------------


def brief(d: BriefData, relevance: dict[str, int]) -> Brief:
    sections: list[BriefSection] = []
    idx = [r for r in d.indices if r.change_pct is not None and not r.ticker.startswith("VIX.")]  # VIX ist kein Kursindex

    markets: list[BriefPoint] = []
    by_name = {r.name: r for r in idx}
    lead = [by_name[n] for n in ("DAX", "Euro Stoxx 50", "S&P 500", "Nasdaq 100", "Nikkei 225") if n in by_name] or idx[:4]
    if lead:
        markets.append(BriefPoint(text=", ".join(f"{r.name} {pct(r.change_pct)}" for r in lead[:4]) + ".", sources=["WEI"]))
    if len(idx) >= 3:
        best = max(idx, key=lambda r: r.change_pct or 0)
        worst = min(idx, key=lambda r: r.change_pct or 0)
        if best is not worst:
            markets.append(BriefPoint(text=f"Stärkster Index: {best.name} ({pct(best.change_pct)}), schwächster: {worst.name} ({pct(worst.change_pct)}).", sources=["WEI"]))
    if d.gainers:
        g = d.gainers[0]
        loser = f"; größter Verlierer {g2.name} ({pct(g2.chg_1d)})" if (g2 := (d.losers[0] if d.losers else None)) else ""
        markets.append(BriefPoint(text=f"Größter Gewinner {g.name} ({pct(g.chg_1d)}){loser}.", sources=["MOST"]))
    if markets:
        sections.append(BriefSection(title="Märkte", points=markets))

    mine: list[BriefPoint] = []
    depot = set(d.depot)
    tag = lambda t: f"{display(t)} (Depot)" if t in depot else display(t)  # noqa: E731
    # Depotwerte zuerst, innerhalb nach Stärke der Bewegung
    moved = sorted((q for q in d.watch if q.change_pct is not None), key=lambda q: (q.ticker not in depot, -abs(q.change_pct or 0)))
    if moved:
        mine.append(BriefPoint(text="Größte Bewegungen: " + ", ".join(f"{tag(q.ticker)} {pct(q.change_pct)}" for q in moved[:3]) + ".", sources=["PORT" if moved[0].ticker in depot else "W"]))
    watch = {q.ticker for q in d.watch}
    important = [n for n in sorted(d.news, key=lambda n: n.date, reverse=True) if relevance.get(n.id, 0) >= 2 and set(n.symbols) & watch]
    important.sort(key=lambda n: not (set(n.symbols) & depot))  # Meldungen zu Depotwerten zuerst (stabil)
    for n in important[:3]:
        first = next((x for x in n.symbols if x in depot), n.symbols[0])
        mine.append(BriefPoint(text=f"{tag(first)}: {n.title}", sources=[n.id]))
    if mine:
        sections.append(BriefSection(title="Ihre Werte", points=mine))

    dates: list[tuple[str, BriefPoint]] = []  # (Zeitpunkt, Punkt) – am Ende zeitlich sortiert
    today = d.today
    # die drei wichtigsten Termine, dann zeitlich sortiert
    events = sorted(sorted(d.events, key=lambda e: (-e.importance, e.date))[:3], key=lambda e: e.date)
    for e in events:
        est = f" (Prognose {de(e.estimate, 1)}{' ' + e.unit if e.unit else ''})" if e.estimate is not None else ""
        clock = _local_time(e.date)
        day = "" if e.date[:10] == today else f"{_weekday(e.date[:10])}, "
        dates.append((e.date, BriefPoint(text=f"{day}{clock + ' Uhr: ' if clock else ''}{e.country} {e.event}{est}.", sources=["ECO"])))
    mine_set = depot | watch
    for day_ in sorted({r.report_date[:10] for r in d.earnings}):
        # Depot- und Watchlist-Werte zuerst
        rows = sorted((r for r in d.earnings if r.report_date[:10] == day_), key=lambda r: (r.ticker not in depot, r.ticker not in mine_set))
        names = ", ".join((r.name or display(r.ticker)) + (" (Depot)" if r.ticker in depot else " (Watchlist)" if r.ticker in watch else "") for r in rows[:4])
        more = f" und {len(rows) - 4} weitere" if len(rows) > 4 else ""
        only_pre = all(r.timing == "BeforeMarket" for r in rows)
        when = "heute" if day_ == today else f"{_weekday(day_)}{' vor Eröffnung' if only_pre else ''}"
        dates.append((day_ + ("T00" if only_pre else "T99"), BriefPoint(text=f"Quartalszahlen {when}: {names}{more}.", sources=["EVTS"])))
    if dates:
        # Überschrift nach den tatsächlich genannten Terminen (früher „Termine heute“ über Donnerstagsterminen)
        days = {e.date[:10] for e in events} | {r.report_date[:10] for r in d.earnings}
        title = "Termine heute" if days == {today} else "Nächste Termine" if today not in days else "Termine"
        sections.append(BriefSection(title=title, points=[p for _, p in sorted(dates, key=lambda x: x[0])]))

    rates: list[BriefPoint] = []
    if d.yields:
        parts = []
        for y in d.yields:
            move = f", {de(y['veraenderung_1m_bp'], 0, sign=True)} bp in 1 Monat" if y.get("veraenderung_1m_bp") is not None else ""
            parts.append(f"{y['land']} {de(y['rendite_10j'], 2)} %{move}")
        rates.append(BriefPoint(text="Zehnjährige Staatsanleihen: " + "; ".join(parts) + ".", sources=["GC"]))
    fx = [r for r in d.fx if r.last is not None][:2]
    if fx:
        rates.append(BriefPoint(text=", ".join(f"{r.name} {de(r.last, 4)} ({pct(r.change_pct)})" for r in fx) + ".", sources=["FX"]))
    if rates:
        sections.append(BriefSection(title="Zinsen und Devisen", points=rates))

    up = sum(1 for r in idx if (r.change_pct or 0) > 0.1)
    down = sum(1 for r in idx if (r.change_pct or 0) < -0.1)
    mood = "überwiegend fester" if up > 2 * max(down, 1) else "überwiegend schwächer" if down > 2 * max(up, 1) else "uneinheitlich"
    top2 = sorted(lead[:4], key=lambda r: -abs(r.change_pct or 0))[:2]
    headline = f"Märkte {mood}" + (": " + ", ".join(f"{r.name} {pct(r.change_pct)}" for r in top2) if top2 else "")
    if events and events[0].date[:10] == today:
        headline += f", im Blick: {events[0].event}"
    return Brief(
        headline=headline + ".",
        sections=sections,
        news={n.id: n.title for n in d.news},
        engine="demo",
        model=DEMO_MODEL,
        created=_now(),
    )


# --- Fragen ----------------------------------------------------------------------

_STOP = {
    "wie", "was", "wer", "wann", "warum", "steht", "stehen", "läuft", "laufen", "die", "der", "das", "den", "dem", "ein", "eine",
    "und", "oder", "mit", "von", "für", "aktie", "aktien", "heute", "gerade", "aktuell", "zahlen", "news", "gibt", "es", "neues",
    "bei", "zu", "zum", "zur", "ist", "sind", "hat", "haben", "mir", "mich", "bitte", "zeig", "zeige", "sag", "sage", "kurs",
    "bewertung", "teuer", "günstig", "billig", "vergleich", "woche", "diese", "dieser", "nächste", "termine", "kennzahlen",
    "nachrichten", "quartalszahlen", "earnings", "markt", "märkte", "im", "in", "an", "auf", "über", "unter", "man", "sie",
}
_ABOUT_SECURITY = re.compile(r"aktie|\bwert\b|papier|titel|kurs|bewert|kgv|news|nachricht|meldung|quartal|zahlen|dividende|peers|vergleich|entwicklung|analyst")
_CAL = re.compile(r"termin|kalender|konjunktur|notenbank|\bfed\b|\bezb\b|zinsentscheid|inflation|arbeitsmarkt")
_MARKETS = re.compile(r"märkte|marktüberblick|indizes|wie läuft der markt|wie laufen die märkte|börse heute")
_ALERTS = re.compile(r"alarm|kursmarke|marken\b|benachrichtig")
_DEPOT = re.compile(r"depot|portfolio|meine positionen|meine werte|mein risiko|klumpenrisiko")
_EARN_CAL = re.compile(r"(wer|welche).*(quartalszahlen|berichtet|earnings)|earnings.?kalender|berichtssaison")
_MOVERS = re.compile(r"bewegen sich|am stärksten|größten? (gewinner|verlierer|bewegung)|top.?(gewinner|verlierer)|tagesgewinner|tagesverlierer|movers")
_OPTIONS = re.compile(r"option|implizit|straddle|erwartete bewegung|put.?call|max pain|einpreisen.*(zahlen|bewegung)")
_FWD = re.compile(r"absicher|hedg|terminkurs|devisentermin|forward|swap.?punkt")
_FORECAST = re.compile(r"prognos|vorhersag|wie (geht|entwickelt) (es )?(sich )?.*(inflation|arbeitslos|wachstum|\bbip\b|schulden|realzins)|erwartete schwankung|künftige schwankung|volatilität.*(erwart|prognos|nächst)")
_FC_COUNTRY = (("deutsch", "DE"), ("frankreich", "FR"), ("ital", "IT"), ("japan", "JP"), ("brit", "UK"), ("spanien", "ES"),
               ("schweiz", "CH"), ("china", "CN"), ("usa", "US"), ("amerika", "US"), ("vereinigte staaten", "US"))
_FC_IND = (("inflation", "inflation"), ("teuerung", "inflation"), ("arbeitslos", "arbeitslosigkeit"), ("wachstum", "bip"), ("bip", "bip"),
           ("schulden", "schulden"), ("realzins", "realzins"))
_RATES = re.compile(r"zinskurve|\bkurve|\brendite|staatsanleihe|anleihen|\bbund|treasur|1y1y|5y5y|eingepreist|preist .*(fed|ezb|notenbank|zins)|steilheit|zinsen")

DEMO_HINT = (
    "Die Demo-KI versteht nur einfache Fragen: zu einem Wertpapier („Wie steht NWND?“, „Kennzahlen von NRDW GR“, "
    "„Was preisen die Optionen für NWND ein?“), zu Terminen („Welche Termine stehen heute an?“), zu den größten Bewegungen, "
    "Zinskurven („Wie steil ist die US-Kurve?“), Devisenterminen („Was kostet die USD-Absicherung?“), Depot und Alarmen. Freie Fragen beantwortet ein Sprachmodell: "
    "In LM Studio ein Modell laden und unter „Developer“ den Server starten."
)


def _dmy(iso: Optional[str]) -> str:
    """2026-07-23 -> 23.07.2026"""
    if not iso or len(iso) < 10:
        return iso or "–"
    return f"{iso[8:10]}.{iso[5:7]}.{iso[0:4]}"


_TIMING = {"BeforeMarket": "vor Eröffnung", "AfterMarket": "nach Börsenschluss"}


async def _find_ticker(t: Terminal, question: str, active: Optional[str]) -> Optional[str]:
    # 1. Terminal-Schreibweise (NWND US, SAP GR, DAX Index) oder EODHD-Format
    m = re.search(r"\b([A-Z0-9]{1,8}(?:[.\s](?:US|GR|GY|LN|FP|NA|SW|IM|SM|JT|HK|XETRA|LSE|PA|AS|INDX|Index|Curncy|Govt|Comdty)))\b", question)
    if m:
        try:
            return await resolve_ticker(t, m.group(1))
        except Exception:  # noqa: BLE001 – dann weiter mit der Namenssuche
            pass
    # 2. Wörter als Kürzel oder Firmenname suchen (höchstens vier Versuche)
    words = [w for w in re.findall(r"[A-Za-zÄÖÜäöüß0-9&\-]{3,}", question) if w.lower() not in _STOP]
    words.sort(key=lambda w: (not w.isupper(), not w[:1].isupper()))
    for w in words[:4]:
        hits = await t.search(w, 1)
        if hits:
            return hits[0].ticker
    # 3. Frage bezieht sich auf das aktive Wertpapier („Wie ist die Aktie bewertet?“)
    if active and _ABOUT_SECURITY.search(question.lower()):
        return active
    return None


async def ask(t: Terminal, req: AskRequest) -> AskResult:
    started = time.monotonic()
    q = req.question.lower()
    trace: list[ToolTrace] = []
    results: list[dict] = []

    async def call(name: str, args: dict) -> dict:
        res = await run_tool(t, name, args)
        if isinstance(res.get("ticker"), str):
            args = {**args, "ticker": res["ticker"]}
        trace.append(ToolTrace(tool=name, args=args, summary=summarize(name, args, res), ok="fehler" not in res))
        results.append(res)
        return res

    lines: list[str] = []
    if _FORECAST.search(q) and not _OPTIONS.search(q):
        if re.search(r"schwankung|volatil", q):
            ticker = await _find_ticker(t, req.question, req.ticker) or req.ticker  # sonst das aktive Wertpapier
            res = await call("prognose", {"art": "schwankung", "ticker": ticker}) if ticker else {"fehler": "Für welches Wertpapier? Bitte Kürzel nennen, z. B. NWND US."}
        else:
            land = next((cc for word, cc in _FC_COUNTRY if word in q), "DE" if "deutschland" in q else "US")
            kennzahl = next((k for word, k in _FC_IND if word in q), "inflation")
            res = await call("prognose", {"art": "kennzahl", "land": land, "kennzahl": kennzahl})
        if "fehler" in res:
            lines.append(res["fehler"])
        else:
            unit = f" {res['einheit']}" if res.get("einheit") and res["einheit"] != "USD" else ""
            lines.append(f"Modellprognose {res['reihe']} ({res['methode']}):")
            for p in res["prognose"]:
                lo, hi = p["band_80_prozent"]
                lines.append(f"- {p['zeit'][:10]}: {de(p['median'], 1)}{unit} (80-%-Band {de(lo, 1)} bis {de(hi, 1)})")
            lines.append(f"- {res['urteil']}")
            lines.append("- Nur aus dem bisherigen Verlauf gerechnet, ohne Wissen über Politik oder Ereignisse – keine Empfehlung.")
    elif _ALERTS.search(q):
        res = await call("alarme", {})
        rows = res.get("alarme") or []
        armed = [r for r in rows if r["status"] == "scharf"]
        lines.append(f"Sie haben {len(rows)} Alarme und Marken, davon {len(armed)} scharf." if rows else "Es sind keine Alarme eingerichtet. Anlegen in ALRT oder im Chart (GP) mit „＋ Marke“.")
        for r in armed[:6]:
            dist = f" (Abstand {pct(r['abstand_prozent'])})" if r.get("abstand_prozent") is not None else ""
            lines.append(f"- {display(r['ticker'])} {r['bedingung']}{dist}")
        for e in (res.get("zuletzt_ausgeloest") or [])[:3]:
            lines.append(f"- Ausgelöst: {e['meldung']}")
    elif _DEPOT.search(q):
        res = await call("depot", {})
        if "fehler" in res or "hinweis" in res:
            lines.append(res.get("fehler") or res.get("hinweis"))
        else:
            cur = res["waehrung"]
            r = res["risiko"]
            lines.append(f"Ihr Depot ist {de(res['depotwert'], 0)} {cur} wert ({res['anzahl_positionen']} Positionen), heute {de(res['ergebnis_heute'], 0, sign=True)} {cur} ({pct(res['ergebnis_heute_prozent'])}).")
            if res.get("ergebnis_seit_kauf") is not None:
                lines.append(f"- Seit Kauf: {de(res['ergebnis_seit_kauf'], 0, sign=True)} {cur} ({pct(res['ergebnis_seit_kauf_prozent'])}).")
            if r.get("volatilitaet_prozent_pa") is not None:
                lines.append(f"- Risiko: Schwankung {de(r['volatilitaet_prozent_pa'], 1)} % pro Jahr, Beta {de(r['beta'], 2)} zum {res['vergleichsindex']}, "
                             f"größter Rückgang im letzten Jahr {de(r['max_drawdown_prozent'], 1)} %, Value at Risk (95 %, 1 Tag) {de(r['value_at_risk_95_1tag'], 0)} {cur}.")
            top = res["positionen"][:3]
            if top:
                lines.append("- Größte Positionen: " + ", ".join(f"{display(x['ticker'])} {de(x['gewicht_prozent'], 1)} %" for x in top) + ".")
            drivers = sorted((x for x in res["positionen"] if x.get("risikoanteil_prozent") is not None), key=lambda x: -x["risikoanteil_prozent"])[:3]
            if drivers:
                lines.append("- Größte Risikotreiber: " + ", ".join(f"{display(x['ticker'])} {de(x['risikoanteil_prozent'], 1)} % des Risikos" for x in drivers) + ".")
            if res["sektoren"]:
                s0 = res["sektoren"][0]
                lines.append(f"- Schwerpunkt: {SECTOR_DE.get(s0['sektor'], s0['sektor'])} mit {de(s0['gewicht_prozent'], 1)} %.")
    elif _FWD.search(q):
        pair = re.search(r"\b(eur|usd|gbp|chf|jpy|cnh|cny|cad|aud|nok|sek|dkk)\s*/?\s*(eur|usd|gbp|chf|jpy|cnh|cny|cad|aud|nok|sek|dkk)\b", q)
        ccys = re.findall(r"\b(eur|usd|gbp|chf|jpy|cnh|cad|aud)\b", q)
        home = "CHF" if "chf-anleger" in q or "schweizer" in q else "EUR"
        if pair:
            p = (pair.group(1) + pair.group(2)).upper()
        else:
            other = next((c.upper() for c in ccys if c.upper() != home), "USD")
            p = f"{home}{other}"
        res = await call("devisentermin", {"paar": p, "heimatwaehrung": home})
        if "fehler" in res:
            lines.append(res["fehler"])
        else:
            rows = {r["laufzeit"]: r for r in res["termine"]}
            lines.append(f"{res['paar']}: Kassa {de(res['kassa'], 5)}." + (f" Terminkurs 3 Monate {de(rows['3M']['terminkurs'], 5)}, 1 Jahr {de(rows['1Y']['terminkurs'], 5)} ({de(rows['1Y']['swap_punkte'], 1, sign=True)} Pips)." if "3M" in rows and "1Y" in rows else ""))
            for h in (res.get("absicherung") or {}).get("kosten_pa", []):
                v = h["ertrag_kosten_1j_prozent_pa"]
                if v is not None:
                    lines.append(f"- Absicherung von {h['waehrung']} für einen {home}-Anleger: {'Ertrag' if v >= 0 else 'Kosten'} {de(abs(v), 2)} % pro Jahr (≈ Zinsdifferenz).")
            lines.append(f"- {res['hinweis']}.")
    elif _MOVERS.search(q):
        ex = "US" if re.search(r"\bus\b|us-|amerika|wall street", q) else "XETRA" if re.search(r"deutsch|xetra|dax", q) else "LSE" if re.search(r"london|brit", q) else None
        res = await call("bewegungen", {"boerse": ex} if ex else {})
        where = {"US": "an US-Börsen", "XETRA": "auf Xetra", "LSE": "in London"}.get(ex or "", "über alle Börsen")
        g, lo = res.get("gewinner") or [], res.get("verlierer") or []
        lines.append(f"Größte Bewegungen heute {where}:")
        if g:
            lines.append("- Gewinner: " + ", ".join(f"{r['name'] or display(r['ticker'])} ({display(r['ticker'])}) {pct(r['tag_prozent'])}" for r in g[:4]) + ".")
        if lo:
            lines.append("- Verlierer: " + ", ".join(f"{r['name'] or display(r['ticker'])} ({display(r['ticker'])}) {pct(r['tag_prozent'])}" for r in lo[:4]) + ".")
    elif _EARN_CAL.search(q):
        res = await call("earnings_kalender", {})
        rows = res.get("termine") or []
        lines.append(f"Quartalsberichte in den nächsten 7 Tagen: {len(rows)}." if rows else "In den nächsten 7 Tagen stehen keine Quartalsberichte an.")
        rows = sorted(rows, key=lambda r: r["datum"])
        for r in rows[:8]:
            when = f"{_weekday(r['datum'][:10])} {_dmy(r['datum'])}"
            timing = f", {_TIMING[r['zeitpunkt']]}" if r.get("zeitpunkt") in _TIMING else ""
            lines.append(f"- {when}{timing}: {r['name'] or display(r['ticker'])} ({display(r['ticker'])}), EPS-Schätzung {de(r['eps_schaetzung'], 2)}")
        if len(rows) > 8:
            lines.append(f"- … und {len(rows) - 8} weitere (alle in EVTS).")
    elif _RATES.search(q):
        land = "DE" if re.search(r"deutsch|bund\b|\bde\b", q) else "IT" if "ital" in q else "UK" if re.search(r"brit|gilt|\buk\b", q) else "JP" if "japan" in q else "FR" if "frankreich" in q else "US"
        res = await call("zinsen", {"land": land})
        if "fehler" in res:
            lines.append(res["fehler"])
        else:
            r = {x["laufzeit"]: x for x in res["renditen"]}
            parts = [f"{k} {de(r[k]['rendite_prozent'], 2)} %" for k in ("2Y", "10Y", "30Y") if k in r and r[k]["rendite_prozent"] is not None]
            lines.append(f"Zinskurve {res['name']}: " + ", ".join(parts) + ".")
            if res.get("steilheit_2j_10j_bp") is not None:
                st = res["steilheit_2j_10j_bp"]
                lines.append(f"- Steilheit 2J/10J: {de(st, 0, sign=True)} bp ({'normal steigend' if st > 0 else 'invers'}).")
            if "10Y" in r and r["10Y"].get("veraenderung_1m_bp") is not None:
                lines.append(f"- 10 Jahre zum Vormonat: {de(r['10Y']['veraenderung_1m_bp'], 0, sign=True)} bp.")
            keys = {k["kennzahl"]: k for k in res.get("eingepreiste_zinsen") or []}
            shown = [f"{k} {de(keys[k]['zins_prozent'], 2)} %" for k in ("1Y1Y", "2Y1Y", "5Y5Y") if k in keys and keys[k]["zins_prozent"] is not None]
            if shown and "3M" in r:
                lines.append(f"- Eingepreist (aus der Kurve berechnet): {', '.join(shown)}; heute 3 Monate {de(r['3M']['rendite_prozent'], 2)} %.")
    elif _CAL.search(q):
        today = t.now().date()
        days = 0 if "heute" in q else 1 if "morgen" in q else 6
        start = today + dt.timedelta(days=1) if "morgen" in q else today
        res = await call("kalender", {"von": start.isoformat(), "bis": (start + dt.timedelta(days=days if days != 1 else 0)).isoformat(), "wichtigkeit": 2})
        rows = res.get("termine") or []
        lines.append(f"Wichtige Wirtschaftstermine {_dmy(res.get('von'))} bis {_dmy(res.get('bis'))}: {len(rows)}." if rows else "Im Zeitraum stehen keine wichtigen Wirtschaftstermine an.")
        for r in sorted(rows, key=lambda r: r["datum"])[:8]:
            est = f", Prognose {de(r['prognose'], 1)}{' ' + r['einheit'] if r.get('einheit') else ''}" if r.get("prognose") is not None else ""
            lines.append(f"- {_weekday(r['datum'][:10])} {_dmy(r['datum'])} {_local_time(r['datum'])} {r['land']} {r['termin']}{est}")
        if len(rows) > 8:
            lines.append(f"- … und {len(rows) - 8} weitere (alle in ECO).")
    elif _MARKETS.search(q):
        res = await call("maerkte", {})
        lines.append("Marktüberblick:")
        order = ("DAX", "Euro Stoxx 50", "S&P 500", "Nasdaq 100", "Nikkei 225")
        rows = sorted(res.get("indizes") or [], key=lambda r: order.index(r["name"]) if r["name"] in order else 99)
        for r in rows[:6]:
            lines.append(f"- {r['name']}: {de(r['kurs'], 2)} ({pct(r['tag_prozent'])})")
        for y in res.get("staatsanleihen") or []:
            lines.append(f"- {y['land']} 10 J: {de(y['rendite_10j'], 2)} %")
    else:
        ticker = await _find_ticker(t, req.question, req.ticker)
        if ticker is None:
            return AskResult(answer=DEMO_HINT, engine="demo", model=DEMO_MODEL, steps=0, seconds=round(time.monotonic() - started, 1))
        k = await call("kurs", {"ticker": ticker})
        if "fehler" in k:
            return AskResult(answer=f"{k['fehler']}\n\n{DEMO_HINT}", trace=trace, engine="demo", model=DEMO_MODEL, steps=len(trace),
                             seconds=round(time.monotonic() - started, 1))
        name = k.get("name") or display(ticker)
        digits = _price_digits(k.get("kurs"))
        lines.append(f"{name} ({display(ticker)}) steht bei {de(k.get('kurs'), digits)} {k.get('waehrung') or ''}".rstrip() + f", {pct(k.get('veraenderung_prozent'))} zum Vortag.")
        equity = not re.search(r"\.(INDX|FOREX|CC|GBOND|COMM)$", ticker)
        wants_options = bool(_OPTIONS.search(q))
        if equity and wants_options:
            o = await call("optionen", {"ticker": ticker})
            if "fehler" in o:
                lines.append(f"- Optionen: {o['fehler']}")
            else:
                lines.append(f"- Optionen: implizite Volatilität 30 Tage {de(o['implizite_vola_30t_prozent'], 1)} %, tatsächliche Schwankung 30 Tage {de(o['historische_vola_30t_prozent'], 1)} %.")
                f = o.get("naechster_monatsverfall")
                if f and f.get("erwartete_bewegung_prozent") is not None:
                    lines.append(f"- Erwartete Bewegung bis {_dmy(f['datum'])} (Monatsverfall): ±{de(f['erwartete_bewegung_prozent'], 1)} %.")
                e = o.get("naechste_quartalszahlen")
                if e and e.get("erster_verfall_danach"):
                    move = f", erwartete Bewegung bis dahin ±{de(e['erwartete_bewegung_bis_dahin_prozent'], 1)} %" if e.get("erwartete_bewegung_bis_dahin_prozent") is not None else ""
                    iv = f" (ATM-IV {de(e['atm_iv_davor_prozent'], 0)} % → {de(e['atm_iv_danach_prozent'], 0)} %)" if e.get("atm_iv_davor_prozent") is not None and e.get("atm_iv_danach_prozent") is not None else ""
                    lines.append(f"- Quartalszahlen {_dmy(e['datum'])} {_TIMING.get(e.get('zeitpunkt') or '', '')}: erster Verfall danach {_dmy(e['erster_verfall_danach'])}{move}{iv}.".replace("  ", " "))
                lines.append(f"- Put/Call (Umsatz) {de(o.get('put_call_volumen'), 2)}; meistes Call-Open-Interest bei {', '.join(de(x, 0 if float(x).is_integer() else 1) for x in o['call_strikes_hoechstes_oi'][:2])}, Put-Open-Interest bei {', '.join(de(x, 0 if float(x).is_integer() else 1) for x in o['put_strikes_hoechstes_oi'][:2])}.")
        if equity and not wants_options and (re.search(r"bewert|kgv|teuer|günstig|billig|kennzahl|dividende|marge|analyst", q) or len(q) < 40):
            f = await call("kennzahlen", {"ticker": ticker})
            if "fehler" not in f:
                parts = [f"KGV {de(f.get('kgv'), 1)}"]
                if f.get("kgv_erwartet") is not None:
                    parts.append(f"erwartetes KGV {de(f['kgv_erwartet'], 1)}")
                if f.get("dividendenrendite_prozent") is not None:
                    parts.append(f"Dividendenrendite {de(f['dividendenrendite_prozent'], 2)} %")
                if f.get("marktkapitalisierung") is not None:
                    parts.append(f"Börsenwert {big(f['marktkapitalisierung'], f.get('waehrung'))}")
                lines.append("- Bewertung: " + ", ".join(parts) + ".")
        if re.search(r"vergleich|peers|konkurren|wettbewerb|branche", q) and equity:
            p = await call("peers", {"ticker": ticker})
            if "fehler" not in p:
                lines.append(f"- Branchenmedian ({SECTOR_DE.get(p.get('gruppe') or '', p.get('gruppe'))}): KGV {de(p['median'].get('kgv'), 1)}, 12 Monate {pct(p['median'].get('perf_12m_prozent'))}.")
        if re.search(r"quartal|earnings|zahlen|bericht|eps", q) and equity:
            e = await call("earnings", {"ticker": ticker})
            if "fehler" not in e and e.get("letzte_berichte"):
                last = e["letzte_berichte"][0]
                lines.append(f"- Letzter Bericht am {_dmy(last['berichtet_am'])} (Quartal bis {_dmy(last['quartal_ende'])}): EPS {de(last['eps_ist'], 2)} gegen Schätzung {de(last['eps_schaetzung'], 2)} ({pct(last['ueberraschung_prozent'])}).")
            hit = e.get("schaetzung_uebertroffen") if "fehler" not in e else None
            if hit:
                lines.append(f"- Schätzung übertroffen in {hit['uebertroffen']} von {hit['quartale']} Quartalen.")
            if "fehler" not in e and e.get("naechster_bericht"):
                n = e["naechster_bericht"]
                est = f", EPS-Schätzung {de(n['eps_schaetzung'], 2)}" if n.get("eps_schaetzung") is not None else ""
                lines.append(f"- Nächster Bericht: {_weekday(n['datum'][:10])}, {_dmy(n['datum'])} {_TIMING.get(n.get('zeitpunkt') or '', '')}{est}.".replace(" ,", ",").replace("  ", " "))
        if re.search(r"entwicklung|performance|jahr|monat|woche|trend|seit", q):
            w = await call("wertentwicklung", {"ticker": ticker})
            if "fehler" not in w:
                unit = " bp" if w.get("einheit") == "Basispunkte" else " %"
                lines.append(f"- Entwicklung: 1 Monat {de(w.get('1_monat'), 1, sign=True)}{unit}, 1 Jahr {de(w.get('1_jahr'), 1, sign=True)}{unit}.")
        n = await call("news", {"ticker": ticker, "tage": 14, "anzahl": 3})
        news = n.get("meldungen") or []
        if news:
            lines.append("- Letzte Meldungen: " + " · ".join(f"„{m['titel']}“" for m in news[:3]))
    answer = "\n".join(lines).strip()
    return AskResult(
        answer=answer,
        trace=trace,
        unverified=unverified_numbers(answer, results, req.question),
        suggestions=suggestions_from(trace),
        engine="demo",
        model=DEMO_MODEL,
        steps=len(trace),
        seconds=round(time.monotonic() - started, 1),
    )
