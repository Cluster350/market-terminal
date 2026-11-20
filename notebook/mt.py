"""mt – das Market Terminal im Jupyter-Notebook (nur lesend).

Holt Daten aus dem laufenden Terminal (http://127.0.0.1:8000) und gibt sie als pandas-Tabellen zurück.
Ticker schreibt man wie in der Befehlszeile des Terminals: "SAP GR", "SPY US", "GOLD Comdty", "DAX Index".

    import mt
    mt.history("SAP GR")                        # Tageskurse
    mt.closes(["SPY US", "GOLD Comdty"])         # Schlusskurse nebeneinander
    mt.forecast("USA", "Inflation", x=["WTI", "Gold"])   # Prognose mit Einflussgrößen
    mt.hilfe()                                  # alle Funktionen

Das Modul verändert nichts im Terminal (keine Alarme, kein Depot, keine Einstellungen). Daten, die das
Terminal schon geladen hat, kommen aus seinem Zwischenspeicher; neue Abfragen verbrauchen EODHD-Abrufe
wie in der Oberfläche.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
import sys
import warnings
from typing import Any, Iterable, Optional, Sequence, Union

try:  # pandas ist im Notebook vorhanden; ohne pandas liefert das Modul die Rohdaten (Listen und dicts)
    import pandas as pd
except ImportError:  # pragma: no cover
    pd = None  # type: ignore[assignment]

URL = os.environ.get("MT_URL", "http://127.0.0.1:8000").rstrip("/")
TIMEOUT = float(os.environ.get("MT_TIMEOUT", "180"))

Tickers = Union[str, Sequence[str]]
# Das Terminal läuft auf dem eigenen Rechner: nie über einen eingestellten Proxy (HTTP_PROXY, Windows-Systemproxy)
_DIRECT = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class MTError(RuntimeError):
    """Fehler des Terminals in Worten (z. B. „Unbekannter Ticker …“)."""


def _kurze_fehler() -> None:
    """Im Notebook: Fehler des Terminals als ein Satz statt langer roter Fehlerliste."""
    try:
        ip = get_ipython()  # type: ignore[name-defined]  # noqa: F821
    except NameError:
        return

    def show(shell, etype, value, tb, tb_offset=None):  # noqa: ANN001
        print(f"⚠ {value}", file=sys.stderr)

    ip.set_custom_exc((MTError,), show)


# --- Verbindung --------------------------------------------------------------------------------


def _url(path: str, params: Optional[dict[str, Any]] = None) -> str:
    q: list[tuple[str, str]] = []
    for k, v in (params or {}).items():
        if v is None:
            continue
        for item in (v if isinstance(v, (list, tuple)) else [v]):
            q.append((k, str(item).lower() if isinstance(item, bool) else str(item)))
    return f"{URL}/api{path}" + (f"?{urllib.parse.urlencode(q)}" if q else "")


def _send(req: urllib.request.Request) -> Any:
    try:
        with _DIRECT.open(req, timeout=TIMEOUT) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            msg = json.loads(exc.read().decode("utf-8")).get("error", {}).get("message")
        except Exception:  # noqa: BLE001
            msg = None
        raise MTError(msg or f"Terminal antwortet mit Fehler {exc.code}.") from None
    except urllib.error.URLError as exc:
        raise MTError(f"Terminal nicht erreichbar unter {URL} – läuft es? ({exc.reason})") from None


def get(path: str, **params: Any) -> Any:
    """Beliebige Abfrage (nur lesen), z. B. ``mt.get("/macro/spreads", years=5)``. Liefert die Rohdaten."""
    if not path.startswith("/"):
        path = "/" + path
    return _send(urllib.request.Request(_url(path, params), headers={"Accept": "application/json"}))


def _calc(path: str, body: dict[str, Any]) -> Any:
    """Rechnung mit eigenen Annahmen (DCF-Hebel) – ändert nichts im Terminal, deshalb erlaubt."""
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(_url(path), data=data, method="POST",
                                 headers={"Accept": "application/json", "Content-Type": "application/json"})
    return _send(req)


def _tickers(t: Tickers) -> list[str]:
    return [t] if isinstance(t, str) else [str(x) for x in t]


def _path_ticker(t: str) -> str:
    return urllib.parse.quote(t.strip(), safe="")


# --- Tabellen ----------------------------------------------------------------------------------


def _frame(rows: Iterable[dict], index: Optional[str] = None) -> Any:
    rows = list(rows)
    if pd is None:
        return rows
    df = pd.DataFrame(rows)
    if index and index in df.columns:
        df = df.set_index(index)
    return df


def _dates(df: Any, *cols: str, utc: Sequence[str] = ("date", "timestamp", "asOf")) -> Any:
    """Datumsspalten umwandeln; Zeitpunkte (``utc``) mit Zeitzone UTC, reine Tagesangaben ohne Zeitzone
    (wie der Index von ``history``, sonst ließen sie sich nicht vergleichen)."""
    if pd is None:
        return df
    for c in cols:
        if c in df.columns:
            df[c] = pd.to_datetime(df[c], errors="coerce", utc=c in utc)
    return df


# --- Länder ------------------------------------------------------------------------------------

# (ISO3, deutscher Name, ISO2 wie im Wirtschaftskalender, Kürzel der Zinskurve, weitere Schreibweisen)
_LAENDER = [
    ("USA", "USA", "US", "US", "vereinigte staaten|united states|amerika"), ("CAN", "Kanada", "CA", "CA", "canada"),
    ("MEX", "Mexiko", "MX", "MX", "mexico"), ("BRA", "Brasilien", "BR", "BR", "brazil"), ("ARG", "Argentinien", "AR", None, "argentina"),
    ("CHL", "Chile", "CL", "CL", ""), ("DEU", "Deutschland", "DE", "DE", "germany|ger"), ("FRA", "Frankreich", "FR", "FR", "france"),
    ("GBR", "Großbritannien", "GB", "UK", "grossbritannien|uk|england|vereinigtes königreich|united kingdom|britain"),
    ("ITA", "Italien", "IT", "IT", "italy"), ("ESP", "Spanien", "ES", "ES", "spain"), ("NLD", "Niederlande", "NL", "NL", "netherlands|holland"),
    ("BEL", "Belgien", "BE", "BE", "belgium"), ("AUT", "Österreich", "AT", "AT", "oesterreich|austria"), ("CHE", "Schweiz", "CH", "CH", "switzerland"),
    ("SWE", "Schweden", "SE", "SE", "sweden"), ("NOR", "Norwegen", "NO", "NO", "norway"), ("DNK", "Dänemark", "DK", "DK", "daenemark|denmark"),
    ("FIN", "Finnland", "FI", "FI", "finland"), ("POL", "Polen", "PL", "PL", "poland"), ("PRT", "Portugal", "PT", "PT", ""),
    ("GRC", "Griechenland", "GR", "GR", "greece"), ("IRL", "Irland", "IE", "IE", "ireland"), ("TUR", "Türkei", "TR", "TR", "tuerkei|turkey"),
    ("ISR", "Israel", "IL", "IL", ""), ("SAU", "Saudi-Arabien", "SA", None, "saudi arabia"), ("ZAF", "Südafrika", "ZA", "ZA", "suedafrika|south africa"),
    ("JPN", "Japan", "JP", "JP", ""), ("CHN", "China", "CN", "CN", ""), ("IND", "Indien", "IN", "IN", "india"),
    ("KOR", "Südkorea", "KR", "KR", "suedkorea|korea|south korea"), ("TWN", "Taiwan", "TW", None, ""),
    ("IDN", "Indonesien", "ID", "ID", "indonesia"), ("AUS", "Australien", "AU", "AU", "australia"), ("NZL", "Neuseeland", "NZ", "NZ", "new zealand"),
    ("EMU", "Eurozone", "EU", None, "euroraum|euro|eurozone|ez"),
]


def land(name: str, form: str = "iso3") -> str:
    """Land in der gewünschten Schreibweise: ``iso3`` (DEU, für Kennzahlen), ``iso2`` (DE, für Termine) oder
    ``kurve`` (UK, für Zinskurven). Akzeptiert "Deutschland", "Germany", "DE", "DEU" usw."""
    n = name.strip().lower()
    for iso3, de, iso2, curve, alt in _LAENDER:
        names = {iso3.lower(), de.lower(), iso2.lower(), (curve or "").lower(), *[a for a in alt.split("|") if a]}
        if n in names:
            out = {"iso3": iso3, "iso2": iso2, "kurve": curve}[form]
            if out is None:
                raise MTError(f"Für {de} gibt es keine Zinskurve im Terminal.")
            return out
    raise MTError(f"Land „{name}“ unbekannt. Beispiele: Deutschland, USA, Japan (oder DE, DEU).")


# --- Allgemein ---------------------------------------------------------------------------------


def status() -> dict:
    """Datenquelle (demo oder eodhd), Zwischenspeicher, Voreinstellungen."""
    return get("/status")


def search(text: str) -> Any:
    """Wertpapier suchen (Name, Ticker oder ISIN)."""
    return _frame(get("/search", q=text))


def quotes(tickers: Tickers) -> Any:
    """Aktuelle Kurse. Ticker ohne Kurs (z. B. Tippfehler) stehen mit leeren Werten in der Tabelle – mit Hinweis."""
    rows = get("/quotes", tickers=",".join(_tickers(tickers)))
    missing = [r["ticker"] for r in rows if r.get("last") is None]
    if missing:
        warnings.warn("Kein Kurs für: " + ", ".join(missing) + " – Ticker prüfen (z. B. mt.search(\"…\")).", stacklevel=2)
    return _dates(_frame(rows, "ticker"), "timestamp")


def history(ticker: str, start: Optional[str] = None, end: Optional[str] = None) -> Any:
    """Tageskurse (Eröffnung, Hoch, Tief, Schluss, Volumen). ``start``/``end`` als JJJJ-MM-TT."""
    h = get(f"/history/{_path_ticker(ticker)}", **{"from": start, "to": end})
    rows = [{"date": t[:10], "open": o, "high": hi, "low": lo, "close": c, "volume": v}
            for t, o, hi, lo, c, v in zip(h["t"], h["o"], h["h"], h["l"], h["c"], h["v"])]
    if pd is None:
        return rows
    df = pd.DataFrame(rows, columns=["date", "open", "high", "low", "close", "volume"])  # Spalten auch ohne Kurse
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date")
    df.attrs.update(ticker=h["ticker"], currency=h.get("currency"))
    return df


def closes(tickers: Tickers, start: Optional[str] = None, end: Optional[str] = None) -> Any:
    """Schlusskurse mehrerer Werte nebeneinander (Spalten = Ticker), gut für Vergleiche und Korrelationen."""
    cols = {t: history(t, start, end)["close"] for t in _tickers(tickers)}
    return pd.DataFrame(cols) if pd is not None else cols


def intraday(ticker: str, days: int = 1, interval: str = "5m") -> Any:
    """Intraday-Kerzen der letzten ``days`` Handelstage (1m, 5m, 15m oder 1h)."""
    d = get(f"/intraday/{_path_ticker(ticker)}", days=days, interval=interval)
    rows = [{"time": t, "open": o, "high": hi, "low": lo, "close": c, "volume": v}
            for t, o, hi, lo, c, v in zip(d["t"], d["o"], d["h"], d["l"], d["c"], d["v"])]
    df = _frame(rows)
    if pd is not None and len(df):
        df["time"] = pd.to_datetime(df["time"], unit="s", utc=True)
        df = df.set_index("time")
    return df


# --- Aktie -------------------------------------------------------------------------------------


def company(ticker: str) -> dict:
    """Firmenprofil und Kennzahlen (wie DES)."""
    return get(f"/company/{_path_ticker(ticker)}")


def financials(ticker: str, period: str = "annual", part: str = "income") -> Any:
    """GuV (``income``), Bilanz (``balance``) oder Cashflow (``cashflow``); ``period`` annual oder quarterly.
    Zeilen = Positionen, Spalten = Perioden."""
    if part not in ("income", "balance", "cashflow"):
        raise MTError(f"Teil „{part}“ unbekannt. Möglich: income (GuV), balance (Bilanz), cashflow.")
    f = get(f"/financials/{_path_ticker(ticker)}", period=period)
    rows = {r["label"]: r["values"] for r in f.get(part, [])}
    if pd is None:
        return rows
    df = pd.DataFrame(rows, index=f["periods"]).T
    df.attrs.update(ticker=f["ticker"], currency=f.get("currency"), period=f["period"])
    return df


def earnings(ticker: str) -> Any:
    """Gewinn je Aktie: Ist gegen Schätzung."""
    return _dates(_frame(get(f"/earnings/{_path_ticker(ticker)}")["history"]), "date", "reportDate", utc=())  # Tagesangaben


def dividends(ticker: str) -> Any:
    """Dividendenhistorie."""
    return _frame(get(f"/dividends/{_path_ticker(ticker)}")["dividends"])


def peers(ticker: str, limit: int = 12) -> Any:
    """Vergleichsfirmen (wie RV)."""
    return _frame(get(f"/peers/{_path_ticker(ticker)}", limit=limit)["rows"], "ticker")


def dcf(ticker: str, levers: Optional[dict[str, float]] = None, simulate: bool = True) -> dict:
    """Innerer Wert nach Damodaran (wie DCF). ``levers`` z. B. {"growth_next": 0.12, "target_margin": 0.3}
    (Anteile, nicht Prozent). Rechnet nur – im Terminal ändert sich nichts."""
    path = f"/intrinsic/{_path_ticker(ticker)}"
    r = _calc(path, {"levers": levers, "simulate": simulate}) if levers else get(path)
    if r.get("state") != "ok":
        raise MTError(r.get("message") or f"Kein innerer Wert für {ticker}.")
    return r


def news(tickers: Optional[Tickers] = None, limit: int = 50, topic: Optional[str] = None) -> Any:
    """Nachrichten, neueste zuerst."""
    t = ",".join(_tickers(tickers)) if tickers else None
    return _dates(_frame(get("/news", tickers=t, limit=limit, topic=topic)["items"]), "date")


def options(ticker: str, exp: Optional[str] = None) -> Any:
    """Optionskette (wie OMON); ``exp`` = Verfall JJJJ-MM-TT, sonst der nächste Monatsverfall."""
    d = get(f"/options/{_path_ticker(ticker)}/chain", exp=exp)
    rows = []
    for r in d.get("rows", []):
        row = {"strike": r["strike"]}
        for side in ("call", "put"):
            row.update({f"{side}_{k}": v for k, v in (r.get(side) or {}).items() if k != "contract"})
        rows.append(row)
    df = _frame(rows, "strike")
    if pd is not None:
        df.attrs.update(ticker=d["ticker"], spot=d.get("spot"), exp=d.get("exp"), expirations=d.get("expirations"))
    return df


# --- Märkte und Makro --------------------------------------------------------------------------


def indices() -> Any:
    """Aktienindizes weltweit mit Tages-, Wochen-, Monats- und Jahresveränderung."""
    return _frame(get("/macro/indices"), "ticker")


def fx() -> Any:
    """Devisenpaare."""
    return _frame(get("/macro/fx"), "ticker")


def commodities() -> Any:
    """Rohstoffe (Öl, Gold, Kupfer …)."""
    return _frame(get("/macro/commodities"), "ticker")


def crypto(ccy: str = "usd") -> Any:
    """Kryptowährungen (wie CRYP)."""
    return _frame(get("/crypto", ccy=ccy)["rows"], "ticker")


def curves(countries: Tickers = ("US", "DE")) -> Any:
    """Zinskurven: Zeilen = Laufzeit, Spalten = Land (Rendite in %)."""
    data = get("/macro/curves", countries=",".join(land(c, "kurve") for c in _tickers(countries)))
    if pd is None:
        return data
    return pd.DataFrame({c["country"]: {p["tenor"]: p["y"] for p in c["points"]} for c in data})


def calendar(country: Optional[str] = None, start: Optional[str] = None, end: Optional[str] = None, importance: int = 1) -> Any:
    """Wirtschaftskalender (wie ECO)."""
    return _dates(_frame(get("/macro/calendar", country=land(country, "iso2") if country else None, importance=importance, **{"from": start, "to": end})), "date")


def countries(indicator: Optional[str] = None) -> Any:
    """Länderkennzahlen (wie ECST). Ohne ``indicator``: letzter Wert je Land und Kennzahl.
    Mit ``indicator`` (z. B. "Inflation"): Jahresverlauf, Zeilen = Jahr, Spalten = Land."""
    data = get("/macro/countries")
    if indicator is None:
        rows = [{"country": r["country"], "name": r["name"], **{k: (v or {}).get("value") for k, v in r["values"].items()}} for r in data["rows"]]
        return _frame(rows, "country")
    key = _indicator(indicator, data["indicators"])
    series = {r["country"]: {p["year"]: p["value"] for p in r["history"].get(key, [])} for r in data["rows"]}
    return pd.DataFrame(series).sort_index() if pd is not None else series


def _indicator(name: str, known: list[dict]) -> str:
    n = name.strip().lower()
    for i in known:
        if n in (i["key"].lower(), i["label"].lower()):
            return i["key"]
    hits = [i["key"] for i in known if n in i["label"].lower() or n in i["key"].lower()]
    if hits:
        return hits[0]
    raise MTError(f"Kennzahl „{name}“ unbekannt. Möglich: " + ", ".join(i["label"] for i in known))


def worldmap(group: str = "equity") -> Any:
    """Weltkarte als Tabelle: ``equity`` (Aktienindizes), ``rates`` (10-jährige Renditen) oder ``macro``."""
    data = get("/macro/worldmap", group=group)
    rows = []
    for c in data["countries"]:
        row = {"iso3": c["iso3"], "name": c["name"]}
        if c.get("index"):
            row.update({f"index_{k}": v for k, v in c["index"].items()})
        if c.get("bond"):
            row.update({f"bond_{k}": v for k, v in c["bond"].items()})
        row.update({k: (v or {}).get("value") for k, v in (c.get("macro") or {}).items()})
        rows.append(row)
    return _frame(rows, "iso3")


def rotation(universe: str = "sectors", **kw: Any) -> dict:
    """Relative Rotation (wie RRG), Rohdaten."""
    return get("/rotation", universe=universe, **kw)


def valuation(kind: str = "sector", region: str = "all") -> Any:
    """Bewertungstrend (wie BWT): KGV-Lage und Schätzungen je Sektor bzw. Land."""
    return _frame(get("/valuation/overview", kind=kind, region=region).get("rows", []), "key")


def stimmung(region: str = "us", verlauf: bool = False) -> Any:
    """Stimmung (wie STIM): Bausteine mit Wert und Rang 0–100 (hoch = sorglos); verlauf=True: Gesamtwert und Index je Tag."""
    d = get("/sentiment", region=region)
    if d.get("state") != "ready":
        raise MTError(d.get("message") or "Das Stimmungsterminal rechnet noch – bitte gleich erneut versuchen.")
    if verlauf:
        df = _frame([{"date": t, "gesamt": g, "index": i} for t, g, i in zip(d["dates"], d["totalSeries"], d["indexSeries"])])
        if pd is not None and len(df):
            df["date"] = pd.to_datetime(df["date"])
            df = df.set_index("date")
        return df
    rows = [{"baustein": c["label"] + (" ≈" if c.get("approx") else ""), "wert": c.get("value"), "rang": c.get("rank"),
             "rang_vorwoche": c.get("rank1w"), "im_gesamtwert": c.get("inTotal"), "hinweis": c.get("note")}
            for c in d["components"]]
    rows.append({"baustein": "Gesamtwert", "wert": None, "rang": d["total"].get("value"), "rang_vorwoche": d["total"].get("w1"),
                 "im_gesamtwert": None, "hinweis": d["total"].get("word")})
    return _frame(rows, "baustein")


# --- Prognose ----------------------------------------------------------------------------------


def _features(kind: str, country: str, x: Optional[Sequence[str]]) -> list[str]:
    """Einflussgrößen: Schlüssel wie in ECST/ECO, Ticker oder ein Teil des Namens aus den Vorschlägen ("Gold", "Öl")."""
    if not x:
        return []
    opts = get("/forecast/features", kind=kind, country=country)
    out: list[str] = []
    for raw in x:
        s = raw.strip()
        low = s.lower()
        hit = next((o["key"] for o in opts if low in (o["key"].lower(), o["label"].lower())), None)
        hit = hit or next((o["key"] for o in opts if low in o["label"].lower()), None)
        out.append(hit or s)  # sonst als Ticker
    return out


def _forecast_frame(r: dict) -> Any:
    if pd is None:
        return r
    hist = pd.DataFrame({"time": r["history"]["t"], "value": r["history"]["v"], "kind": "Ist"})
    f = r["forecast"]
    fc = pd.DataFrame({"time": f["t"], "value": f["median"], "kind": "Prognose", "lo80": f["lo80"], "lo50": f["lo50"],
                       "hi50": f["hi50"], "hi80": f["hi80"]})
    fx_ = r.get("features") or {}
    if fx_.get("baseline") and fx_.get("features"):
        fc["ohne_einflussgroessen"] = fx_["baseline"]["median"]
    df = pd.concat([hist, fc], ignore_index=True)
    # Zeitachse als Zahl (Jahre) bzw. Datum – als Text zeichnete matplotlib die Prognose an den Anfang der Achse
    df["time"] = df["time"].astype(int) if r.get("freq") == "year" else pd.to_datetime(df["time"].str[:10])
    df = df.set_index("time")
    notes = fx_.get("notes") or []
    df.attrs.update(label=r["label"], engine=r["engineLabel"], verdict=r["verdictText"],
                    features=fx_.get("text"), notes=notes, unit=r.get("unit"))
    if notes:
        warnings.warn(" ".join(notes), stacklevel=3)
    return df


def forecast(country: str, indicator: str, h: int = 3, x: Optional[Sequence[str]] = None, raw: bool = False) -> Any:
    """Prognose einer Länderkennzahl (wie ECST) für ``h`` Jahre, optional mit Einflussgrößen ``x``
    (bis zu fünf, z. B. ["WTI", "Gold", "US10Y.GBOND", "SPY US"]). Urteil des Rückblick-Tests in ``df.attrs``."""
    known = get("/macro/countries")["indicators"]
    key = _indicator(indicator, known)
    cc = land(country, "iso3")
    r = get("/forecast/macro", country=cc, indicator=key, h=h, x=_features("macro", cc, x))
    return r if raw else _forecast_frame(r)


def forecast_event(country: str, event: str, h: int = 3, x: Optional[Sequence[str]] = None, raw: bool = False) -> Any:
    """Prognose eines Konjunkturtermins (wie ECO), z. B. ``mt.forecast_event("US", "CPI YoY")``."""
    cc = land(country, "iso2")
    r = get("/forecast/event", country=cc, event=event, h=h, x=_features("event", cc, x))
    return r if raw else _forecast_frame(r)


def forecast_features(country: str, kind: str = "macro") -> Any:
    """Vorschläge für Einflussgrößen (wie die Auswahl im Terminal)."""
    cc = land(country, "iso3" if kind == "macro" else "iso2")
    return _frame(get("/forecast/features", kind=kind, country=cc), "key")


# --- Depot (nur lesen) -------------------------------------------------------------------------


def portfolio() -> Any:
    """Depot mit Kurs, Wert, Gewicht und Ergebnis je Position (wie PORT)."""
    a = get("/portfolio/analytics")
    df = _frame(a["rows"], "ticker")
    if pd is not None:
        df.attrs.update(base=a["base"], summary=a["summary"], risk=a.get("risk"))
    return df


# --- Hilfe -------------------------------------------------------------------------------------


def hilfe() -> None:
    """Alle Funktionen mit Kurzbeschreibung."""
    names = ["status", "search", "quotes", "history", "closes", "intraday", "company", "financials", "earnings",
             "dividends", "peers", "dcf", "news", "options", "indices", "fx", "commodities", "crypto", "curves",
             "calendar", "countries", "worldmap", "rotation", "valuation", "stimmung", "forecast", "forecast_event",
             "forecast_features", "portfolio", "get"]
    g = globals()
    print(f"Terminal: {URL}\n")
    for n in names:
        doc = (g[n].__doc__ or "").strip().splitlines()
        print(f"mt.{n:<18} {doc[0] if doc else ''}")


_kurze_fehler()
