"""Prüft die Anbindung an die echte EODHD-API mit dem eigenen Key.

Aufruf (aus backend/, mit gesetztem EODHD_API_KEY in .env oder Umgebung):
    python -m scripts.verify_eodhd            # Standard-Ticker
    python -m scripts.verify_eodhd SAP.XETRA  # eigener Ticker

Für jeden Endpunkt wird gemeldet, ob der Abruf klappt, ob das Mapping Werte
liefert und welche Annahmen (z. B. Dividendenrendite als Anteil) zutreffen.
Verbraucht je nach Plan ca. 60–120 API-Calls.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import sys

from app.config import Settings
from app.errors import TerminalError
from app.providers.base import WORLD, ScreenFilter
from app.services.forwards import CCY_COUNTRY, MONEY_TENORS
from app.providers.eodhd import EODHDProvider
from app.realtime.eodhd_ws import WS_BASE, parse

OK = "\033[32mOK\033[0m"
FAIL = "\033[31mFEHLER\033[0m"
WARN = "\033[33mHINWEIS\033[0m"


async def check(name: str, coro, describe) -> None:
    try:
        result = await coro
    except TerminalError as exc:
        print(f"[{FAIL}] {name}: {exc.code} – {exc.message}")
        return
    except Exception as exc:  # noqa: BLE001 – Prüfskript soll alles melden
        print(f"[{FAIL}] {name}: {type(exc).__name__}: {exc}")
        return
    try:
        text, warn = describe(result)
    except Exception as exc:  # noqa: BLE001
        print(f"[{FAIL}] {name}: Mapping-Prüfung fehlgeschlagen: {exc}")
        return
    print(f"[{WARN if warn else OK}] {name}: {text}")


async def ws_probe(key: str, endpoint: str, symbol: str, wait: float = 8.0):
    """Echtzeit-WebSocket: verbinden, abonnieren, auf Status und ersten Kurs warten."""
    import json

    import websockets

    loop = asyncio.get_running_loop()
    status, tick = None, None
    async with websockets.connect(f"{WS_BASE}{endpoint}?api_token={key}", open_timeout=15) as ws:
        await ws.send(json.dumps({"action": "subscribe", "symbols": symbol}))
        end = loop.time() + wait
        while loop.time() < end:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, end - loop.time()))
            except asyncio.TimeoutError:
                break
            msg = json.loads(raw)
            if isinstance(msg, dict) and "status_code" in msg:
                status = msg
                if int(msg.get("status_code") or 0) != 200:
                    break
                continue
            tick = parse(endpoint, msg)
            if tick:
                break
    return status, tick


def describe_ws(res) -> tuple[str, bool]:
    status, tick = res
    code = int((status or {}).get("status_code") or 0)
    if status and code != 200:
        return f"nicht freigeschaltet ({code}: {status.get('message')}) – Echtzeit braucht das Paket All-In-One", True
    if tick:
        return f"freigeschaltet, erster Kurs {tick.ticker} {tick.price}", False
    return "verbunden, aber noch kein Kurs (außerhalb der Handelszeit normal)", status is None


async def main(ticker: str) -> None:
    cfg = Settings()
    if not cfg.eodhd_api_key:
        print("EODHD_API_KEY ist nicht gesetzt (.env im Projekt- oder backend-Ordner).")
        sys.exit(1)
    p = EODHDProvider(cfg)
    try:
        await check("Konto (/user)", p.status(), lambda s: (str(s.get("account") or s.get("accountError")), "accountError" in s))
        await check("Suche", p.search("apple", 5), lambda r: (", ".join(h.ticker for h in r) or "keine Treffer", not r))
        await check(
            "Echtzeit-Kurse (2 Ticker)",
            p.quotes([ticker, "MSFT.US"]),
            lambda r: (", ".join(f"{q.ticker}={q.last}" for q in r), any(q.last is None for q in r)),
        )
        await check(
            "Tageskurse",
            p.history(ticker),
            lambda h: (f"{len(h.t)} Tage, {h.t[0]} … {h.t[-1]}, letzter Schluss {h.c[-1]}", len(h.t) < 200),
        )
        await check("Intraday 5m", p.intraday(ticker, 1), lambda i: (f"{len(i.t)} Balken", not i.t))

        def comp(c):
            missing = [k for k, v in {"Name": c.name, "Sektor": c.sector, "Marktkap.": c.market_cap, "KGV": c.valuation.pe, "EPS": c.per_share.eps}.items() if v in (None, "")]
            return f"{c.name}, {c.sector}, Marktkap. {c.market_cap}, fehlend: {missing or '–'}", bool(missing)

        await check("Fundamentaldaten (Profil)", p.company(ticker), comp)
        await check(
            "Finanzberichte jährlich",
            p.financials(ticker, "annual"),
            lambda f: (f"{len(f.periods)} Perioden, {len(f.income)} GuV-Zeilen, {len(f.balance)} Bilanz-, {len(f.cashflow)} CF-Zeilen", len(f.periods) < 3),
        )
        await check(
            "Earnings",
            p.earnings(ticker),
            lambda e: (f"{len(e.history)} Quartale, nächster Termin {e.next.report_date if e.next else '–'}", not e.history),
        )
        await check("Dividenden/Splits", p.dividends(ticker), lambda d: (f"{len(d.dividends)} Zahlungen, {len(d.splits)} Splits, TTM {d.ttm}", False))
        await check(
            "News",
            p.news([ticker], 10),
            lambda n: (f"{len(n)} Meldungen, neueste {n[0].date if n else '–'}", not n),
        )
        today = dt.date.today()
        await check(
            "Wirtschaftskalender",
            p.calendar(today - dt.timedelta(days=3), today + dt.timedelta(days=3), None),
            lambda ev: (f"{len(ev)} Termine, Länder {sorted({e.country for e in ev})[:10]}", not ev),
        )
        await check(
            "Makro-Indikator USA Inflation",
            p.macro_indicator("USA", "inflation_consumer_prices_annual"),
            lambda s: (f"{len(s)} Jahre, letztes {s[-1].year}={s[-1].value}" if s else "leer", not s),
        )
        await check(
            "Staatsanleihe US10Y",
            p.history("US10Y.GBOND"),
            lambda h: (f"{len(h.t)} Tage, Rendite {h.c[-1]} am {h.t[-1]}", False),
        )
        await check("Index S&P 500", p.history("GSPC.INDX"), lambda h: (f"Schluss {h.c[-1]} am {h.t[-1]}", False))
        await check("Devisen EUR/USD", p.history("EURUSD.FOREX"), lambda h: (f"Kurs {h.c[-1]} am {h.t[-1]}", False))

        def screen(res):
            rows, local, notes = res
            if not rows:
                return "keine Treffer", True
            dy = [r.div_yield for r in rows if r.div_yield]
            warn = bool(dy) and max(dy) > 30
            return (
                f"{len(rows)} Treffer, größter {rows[0].ticker} ({rows[0].market_cap}), "
                f"Div.-Rendite-Spanne {min(dy) if dy else '–'}–{max(dy) if dy else '–'} %"
                + (" – Rendite wirkt nicht wie Prozent, Umrechnung in mapping.screen_rows prüfen" if warn else ""),
                warn,
            )

        await check(
            "Screener (US, > 10 Mrd.)",
            p.screener([ScreenFilter("exchange", "eq", "US"), ScreenFilter("market_cap", "gt", 1e10)], "market_cap", True, 100),
            screen,
        )
        # Minutenkerzen und Echtzeit (Paket All-In-One bzw. EOD+Intraday All World Extended)
        await check(
            f"Intraday 1 Minute {ticker}",
            p.intraday(ticker, 1, "1m"),
            lambda d: (
                f"{len(d.t)} Kerzen, letzte {dt.datetime.fromtimestamp(d.t[-1], tz=dt.timezone.utc):%d.%m. %H:%M} UTC" if d.t else "keine Kerzen",
                not d.t,
            ),
        )
        await check("Echtzeit-WebSocket US-Aktien (AAPL)", ws_probe(cfg.eodhd_api_key, "us", "AAPL"), describe_ws)
        await check("Echtzeit-WebSocket Europa (SAP.XETRA)", ws_probe(cfg.eodhd_api_key, "eu", "SAP.XETRA"), describe_ws)
        await check("Echtzeit-WebSocket Devisen (EURUSD)", ws_probe(cfg.eodhd_api_key, "forex", "EURUSD"), describe_ws)

        # Optionen (OMON): Zusatzprodukt im EODHD-Marketplace; ein Abruf kostet 10 Calls je Seite
        await check(
            "Optionen AAPL (Marketplace)",
            p.options("AAPL.US"),
            lambda cs: (
                f"{len(cs)} Kontrakte, {len({c.exp for c in cs})} Verfälle, IV z. B. {next((c.iv for c in cs if c.iv), None)}",
                not cs or all(c.iv is None for c in cs),
            ),
        )

        # Weltkarte (WMAP): Länderindizes und zehnjährige Anleihen – fehlende bleiben auf der Karte grau
        missing: list[str] = []
        for _, name, cc, idx, _ in WORLD:
            for ticker in [t for t in (idx, f"{cc}10Y.GBOND" if cc else None) if t]:
                try:
                    h = await p.history(ticker)
                    if not h.c:
                        missing.append(f"{ticker} ({name})")
                except TerminalError:
                    missing.append(f"{ticker} ({name})")
        # Terminkurse (FWD): kurze Zinsen 3M–2J je Währung
        fwd_missing: list[str] = []
        for ccy, cc in sorted({k: v for k, v in CCY_COUNTRY.items() if k != "CNY"}.items()):
            have = []
            for tenor, _ in MONEY_TENORS:
                try:
                    if (await p.history(f"{cc}{tenor}.GBOND")).c:
                        have.append(tenor)
                except TerminalError:
                    pass
            if not have:
                fwd_missing.append(ccy)
        if fwd_missing:
            print(f"[{WARN}] Terminkurse (FWD): keine kurzen Zinsen (3M–2J) für {', '.join(fwd_missing)} – diese Währungen fehlen in FWD")
        else:
            print(f"[{OK}] Terminkurse (FWD): kurze Zinsen für alle Währungen vorhanden")
        total = sum(1 for _, _, cc, idx, _ in WORLD for t in (idx, cc) if t)
        if missing:
            print(f"[{WARN}] Weltkarte: {total - len(missing)} von {total} Reihen da, fehlen: {', '.join(missing)}")
        else:
            print(f"[{OK}] Weltkarte: alle {total} Länderindizes und Anleihen vorhanden")
        print("\nVerbrauch laut lokalem Zähler:", p.client.budget.snapshot())
    finally:
        await p.close()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "AAPL.US"))
