"""Exportiert die Demo-Daten als JSON-Dateien für den statischen Frontend-Build.

Aufruf (aus backend/):
    python -m scripts.export_static ../frontend/dist-static/data

Der statische Build (npm run build:static) liest diese Dateien statt der API.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import json
import sys
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import settings
from app.main import create_app
from app.providers import demo_data as D
from app.providers.base import FX, INDICES, MACRO_INDICATORS, curve_catalog
from app.providers.demo import DemoProvider

HISTORY_FROM = "2020-01-01"


def compact(values: list, kind: str) -> list:
    """Nachkommastellen nach Größenordnung kürzen, um die Dateigröße zu senken."""
    out = []
    for v in values:
        if v is None:
            out.append(None)
            continue
        a = abs(v)
        digits = 3 if kind == "yield" else 2 if a >= 100 else 3 if a >= 1 else 5
        out.append(round(v, digits))
    return out


def safe(t: str) -> str:
    return "".join(ch if ch.isalnum() or ch in ".-_" else "_" for ch in t)


def main(target: str) -> None:
    out = Path(target)
    out.mkdir(parents=True, exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc)
    provider = DemoProvider(now_fn=lambda: now)
    sizes: dict[str, int] = {}

    def write(name: str, data) -> None:
        path = out / name
        path.parent.mkdir(parents=True, exist_ok=True)
        text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        path.write_text(text, encoding="utf-8")
        sizes[name.split("/")[0]] = sizes.get(name.split("/")[0], 0) + len(text)

    # KI-Teile mit der regelbasierten Demo-KI vorab berechnen (kein LM Studio nötig)
    # Eigener leerer Depot-Ordner: exportiert wird nur das Muster-Depot, nie ein echtes
    cfg = dataclasses.replace(settings, llm_mode="demo", portfolio_dir=tempfile.mkdtemp(prefix="mt-export-"))
    with TestClient(create_app(provider, cfg)) as c:
        def get(url: str):
            r = c.get(url)
            r.raise_for_status()
            return r.json()

        companies = [f"{x[0]}.{x[2]}" for x in D.COMPANIES]
        others = [i.ticker for i in INDICES] + [i.ticker for i in FX] + [x[0] for x in D.COMMODITIES]
        bonds = [t for _, (_, pts) in curve_catalog().items() for _, _, t in pts]
        everything = companies + others + bonds

        status = get("/api/status")
        status["mode"] = "static"
        write("status.json", status)

        search = []
        for q in ["a", "e", "i", "o", "u", "y", "x", "s", "n", "r", "t", "l", "c", "m", "d", "g"]:
            search.extend(get(f"/api/search?q={q}&limit=50"))
        uniq = {h["ticker"]: h for h in search}
        missing = [t for t in everything if t not in uniq]
        for t in missing:
            uniq[t] = {"ticker": t, "name": provider.name(t), "exchange": t.split(".")[1], "type": None, "country": None, "currency": None}
        write("search.json", list(uniq.values()))

        quotes = {}
        for i in range(0, len(everything), 40):
            for q in get("/api/quotes?tickers=" + ",".join(everything[i : i + 40])):
                quotes[q["ticker"]] = q
        write("quotes.json", quotes)

        # Eine Datei je Instrument (Tages- + Intraday-Kurse) und je Unternehmen
        # (Profil, Finanzen, Earnings, Dividenden), damit die Dateianzahl klein bleibt.
        for t in everything:
            kind = "yield" if t.endswith(".GBOND") else "price"
            h = get(f"/api/history/{t}")
            start = next((i for i, d in enumerate(h["t"]) if d >= HISTORY_FROM), 0)
            for k in ("t", "o", "h", "l", "c", "v"):
                h[k] = h[k][start:]
            for k in ("o", "h", "l", "c"):
                h[k] = compact(h[k], kind)
            intra = get(f"/api/intraday/{t}?days=5")
            for k in ("o", "h", "l", "c"):
                intra[k] = compact(intra[k], kind)
            write(f"series/{safe(t)}.json", {"history": h, "intraday": intra})

        for t in companies:
            write(
                f"fundamentals/{safe(t)}.json",
                {
                    "company": get(f"/api/company/{t}"),
                    "annual": get(f"/api/financials/{t}?period=annual"),
                    "quarterly": get(f"/api/financials/{t}?period=quarterly"),
                    "earnings": get(f"/api/earnings/{t}"),
                    "dividends": get(f"/api/dividends/{t}"),
                },
            )

        write("news.json", get("/api/news?limit=300"))
        write("macro/indices.json", get("/api/macro/indices"))
        write("macro/fx.json", get("/api/macro/fx"))
        write("macro/commodities.json", get("/api/macro/commodities"))
        write("macro/curves.json", get("/api/macro/curves?countries=" + ",".join(curve_catalog().keys())))
        write("macro/spreads.json", get("/api/macro/spreads"))
        today = now.date()
        cal = []
        for k in range(-21, 28, 14):
            frm = today + dt.timedelta(days=k)
            to = frm + dt.timedelta(days=13)
            cal.extend(get(f"/api/macro/calendar?from={frm}&to={to}"))
        write("macro/calendar.json", sorted({e["id"]: e for e in cal}.values(), key=lambda e: e["date"]))
        write("macro/countries.json", get("/api/macro/countries?indicators=" + ",".join(k for k, _, _ in MACRO_INDICATORS)))

        evts = []
        for k in range(-21, 35, 28):
            frm = today + dt.timedelta(days=k)
            evts.extend(get(f"/api/calendar/earnings?from={frm}&to={frm + dt.timedelta(days=27)}"))
        write("calendar/earnings.json", sorted({(e["ticker"], e["reportDate"]): e for e in evts}.values(), key=lambda e: (e["reportDate"], e["ticker"])))

        write("screener/fields.json", get("/api/screener/fields"))
        universe = c.post("/api/screener", json={"filters": [], "sort": "market_cap", "desc": True, "limit": 500, "enrich": True})
        universe.raise_for_status()
        write("screener/universe.json", universe.json()["rows"])
        write("market/movers.json", get("/api/market/movers"))
        write("market/heatmap.json", get("/api/market/heatmap"))

        # KI-Helfer: Einordnungen aller Meldungen, ein Briefing und die Beispielfragen
        def post(url: str, body: dict):
            r = c.post(url, json=body)
            r.raise_for_status()
            return r.json()

        ai_status = get("/api/ai/status")
        ai_status["message"] = "Statische Demo: vorab berechnete Demo-KI (regelbasiert). Lokal mit LM Studio ordnet ein Sprachmodell ein und beantwortet freie Fragen."
        write("ai/status.json", ai_status)
        news_items = get("/api/news?limit=300")["items"]
        insights: dict = {}
        for i in range(0, len(news_items), 40):
            chunk = [
                {"id": n["id"], "title": n["title"], "content": n["content"], "date": n["date"], "source": n["source"], "symbols": n["symbols"],
                 "topic": n["topic"], "polarity": n["sentiment"]["polarity"], "urgent": n["urgent"]}
                for n in news_items[i : i + 40]
            ]
            insights.update(post("/api/ai/news", {"items": chunk})["insights"])
        write("ai/news.json", insights)
        watchlist = status.get("defaults", {}).get("watchlist", [])
        write("ai/brief.json", post("/api/ai/brief", {"tickers": watchlist}))
        example = "NWND US"
        questions = [
            f"Wie steht {example}?", f"Ist {example} teuer im Vergleich zur Branche?", f"Wie waren die letzten Quartalszahlen von {example}?",
            "Wie riskant ist mein Depot?", "Wie laufen die Märkte?", "Welche Termine stehen heute an?", "Wer berichtet diese Woche Quartalszahlen?",
        ]
        write("ai/ask.json", {q: post("/api/ai/ask", {"question": q, "ticker": "NWND.US", "watchlist": watchlist}) for q in questions})

        # Weltkarte: alle drei Bereiche
        for group in ("equity", "rates", "macro"):
            write(f"macro/worldmap-{group}.json", get(f"/api/macro/worldmap?group={group}"))

        # Depot: Muster-Depot und seine Kennzahlen (im statischen Build nur lesbar)
        write("portfolio/portfolio.json", get("/api/portfolio"))
        write("portfolio/analytics.json", get("/api/portfolio/analytics"))

    total = sum(sizes.values())
    print(f"Export nach {out}: {total / 1e6:.1f} MB")
    for k, v in sorted(sizes.items(), key=lambda kv: -kv[1]):
        print(f"  {k:<14} {v / 1e6:6.2f} MB")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "../frontend/dist-static/data")
