# Market Terminal

Finanzterminal im Stil von Bloomberg Terminal und Reuters/LSEG Workspace auf Basis der
[EODHD-API](https://eodhd.com). Vier Arbeitsbereiche:

| Seite | Panels | Inhalt |
|---|---|---|
| **1 AKTIE** | GP · DES · FA · CN | Kurschart, Firmenprofil mit Kennzahlen, Finanzberichte, Firmen-News |
| **2 MAKRO** | WEI · GC · ECO · FX | Weltindizes, Zinskurven, Wirtschaftskalender, Devisen |
| **3 SCREENER** | EQS · IMAP · MOST | Aktien-Screener, Markt-Heatmap, Top-Bewegungen |
| **4 NEWS** | TOP · W | News-Terminal mit Leseansicht, Watchlist |

Jedes Panel kann über sein Auswahlfeld oder die Befehlszeile jede Funktion zeigen; das Layout
jeder Seite ist umschaltbar (1, 2, 3 oder 4 Panels). Weitere Funktionen: HP (Kurshistorie),
ERN (Earnings), DVD (Dividenden), ANR (Analysten), RV (Peer-Vergleich), EVTS (Earnings-Kalender),
CMDT (Rohstoffe), SPRD (Zinsspreads), ECST (Länderdaten), HELP.

**Mehrere Monitore:** „⧉ FENSTER“ öffnet die aktuelle Seite, „⧉“ im Panelkopf eine einzelne
Funktion in einem eigenen Browserfenster. Wertpapier, Watchlist und Verlauf sind zwischen den
Fenstern verknüpft (über localStorage), „LINK“ löst ein Fenster davon.

**Start:** Beim ersten Öffnen einer Sitzung zeigt ein kurzes Startprotokoll die echten Ladeschritte
(Datenquelle, Indizes, Watchlist, Kalender, News); eine Taste überspringt es, bei „Bewegung
reduzieren“ entfällt es.

## Starten

```bash
./start.sh                 # baut beim ersten Mal das Frontend, dann http://127.0.0.1:8000
```

Ohne API-Key läuft das Terminal im **Demo-Modus**: 44 frei erfundene Unternehmen, echte
Index-, Devisen- und Anleihenamen mit synthetischen Werten, ein "live" laufender Handelstag,
generierte News und Wirtschaftstermine. Alles ist deterministisch und ohne Netz nutzbar.

Für echte Daten:

```bash
cp .env.example .env       # EODHD_API_KEY=... eintragen
./start.sh
cd backend && .venv/bin/python -m scripts.verify_eodhd   # prüft alle Endpunkte mit dem eigenen Key
```

Benötigter EODHD-Plan: für alle Funktionen **All-In-One** (Kurse, Fundamentaldaten,
Screener, News, Kalender, Makro, Anleihen). Mit kleineren Plänen funktionieren die
Kursfunktionen; Panels ohne Planabdeckung zeigen eine klare Meldung.

## Bedienung

- **Befehlszeile**: `/` drücken oder einfach lostippen. Erst Ticker, dann Funktion, dann Enter.
  Beispiele: `AAPL US GP`, `SAP GR DES`, `DAX Index GP`, `EURUSD Curncy`, `ECO`, `TOP`, `HELP`.
  Ticker im EODHD-Format (`SAP.XETRA`) oder im Bloomberg-Stil mit Börsenkürzel bzw. gelber Taste;
  ohne Börse gilt US. Unbekannte Ticker werden abgewiesen, ↑ holt frühere Befehle zurück.
- **Alt+1–4** Seiten · **Alt+←/→** aktives Panel · **Alt+M** Panel maximieren · **Alt+L** Layout ·
  **Esc** zurück.
- **Chart (GP):** Zeiträume 1T–MAX (Rendite gegen den Schluss vor Periodenbeginn), SMA 20/50/200,
  Bollinger 20, RSI 14 als eigener Bereich, Vergleich mit Index oder bis zu vier Werten.
- Ein Klick auf einen Ticker (Tabellen, News, Heatmap, Laufband) macht ihn zum aktiven
  Wertpapier; alle Aktien-Panels folgen.

## Architektur

```
frontend/  React 18 + TypeScript + Vite · lightweight-charts · ECharts
   │  REST /api/*
backend/   FastAPI · Provider-Schicht (EODHD oder Demo) · TTL-Cache mit Single-Flight
   │       und Stale-Fallback · Call-Budget-Zähler · Kennzahlen (Performance, RSI, Volatilität)
   │  HTTPS (Key nur im Backend)
EODHD API
```

- `backend/app/eodhd/client.py` – Retry mit Backoff (429/5xx/Timeout), Fehlerübersetzung
  (401 Key, 402/403 Plan, 404 Ticker), Tagesbudget.
- `backend/app/eodhd/mapping.py` – tolerante Übersetzung der EODHD-Antworten (Strings als
  Zahlen, fehlende Felder, Split-bereinigte OHLC).
- `backend/app/providers/demo.py` – synthetische Daten im EODHD-Rohformat, laufen durch
  dasselbe Mapping wie echte Daten.
- `backend/app/services/terminal.py` – Caching, Makro-Aggregation, Screener (serverseitige
  EODHD-Filter + lokale Filter für KGV und technische Kennzahlen).

## Datenqualität im Demo-Modus

Der Demo-Datensatz ist synthetisch, aber in sich konsistent: Börsenfeiertage je Handelsplatz,
Handelszeiten mit Sommerzeit, arbitragefreie Devisen-Kreuzkurse, Quartalszahlen und News zu
denselben Berichtsterminen, Wirtschaftsdaten mit korrekten Bezugsperioden (Vorwert = letzter
Ist-Wert). Kennzahlen wie 1M/12M oder 52W werden überall über Kalenderfenster berechnet;
Marktkapitalisierungen im Screener sind in USD umgerechnet.

## Tests

```bash
cd backend && .venv/bin/python -m pytest -q
cd frontend && npx tsc -b && npx vitest run
```

## Statische Demo

`npm run build:static` (im Ordner frontend) plus
`python -m scripts.export_static ../frontend/dist-static/data` (im Ordner backend) erzeugt
eine Version ohne Backend, die alle Demo-Daten als JSON mitbringt.

## Grenzen

- EODHD-Kurse sind verzögert (ca. 15–20 Min.); Echtzeit-WebSocket ist nicht angebunden.
- Charts: [TradingView Lightweight Charts](https://www.tradingview.com/) (Apache 2.0), Verweis im Chart-Panel.
- EODHD-Makroindikatoren sind überwiegend Jahreswerte (Weltbank-Basis).
- Rohstoffe werden im EODHD-Modus über ETFs als Stellvertreter abgebildet.
- News liefert EODHD je Ticker; der allgemeine Feed setzt sich aus den Standard-Tickern zusammen.
- Die EODHD-Anbindung ist gegen nachgebaute Antworten getestet. Vor dem produktiven Einsatz
  `scripts/verify_eodhd.py` mit dem eigenen Key laufen lassen.
- Nur private Nutzung: eine öffentliche Bereitstellung der Daten erfordert die Klärung der
  EODHD-Lizenzbedingungen.
