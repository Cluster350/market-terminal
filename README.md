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
Fenstern verknüpft (über localStorage), „LINK“ löst ein Fenster davon; beim Wiederverknüpfen
übernimmt es das Wertpapier der anderen Fenster.

**Panels fixieren:** „◇ FIX“ im Panelkopf hält ein Panel auf seinem Wertpapier – etwa den Index
neben der Aktie oder BTP neben Bund. Befehle für das aktive, fixierte Panel ändern nur dieses.

**Start:** Beim ersten Öffnen einer Sitzung zeigt ein kurzes Startprotokoll die echten Ladeschritte
(Datenquelle, Indizes, Watchlist, Kalender, News); eine Taste überspringt es, bei „Bewegung
reduzieren“ entfällt es.

## Schnellstart unter Windows (ohne Vorkenntnisse)

Einmalig vorbereiten:
1. **Python** installieren: https://www.python.org/downloads/ – im Installer unten
   **„Add python.exe to PATH“** anhaken.
2. **Node.js** (LTS-Version) installieren: https://nodejs.org/ – einfach durchklicken.
3. Dieses Projekt herunterladen: auf GitHub grüner Knopf **„Code“ → „Download ZIP“**,
   ZIP-Datei entpacken (Rechtsklick → „Alle extrahieren“).

Starten:
4. Im entpackten Ordner **`Start-Windows.bat`** doppelklicken. Der erste Start richtet alles
   ein und dauert einige Minuten; danach öffnet sich das Terminal im Browser
   (http://127.0.0.1:8000). Warnt Windows („Der Computer wurde durch Windows geschützt“),
   auf „Weitere Informationen“ → „Trotzdem ausführen“ klicken.
5. Zum Beenden das schwarze Fenster schließen.

Echte Daten statt Demo:
6. Die Datei **`.env`** im Ordner mit dem Editor öffnen (Rechtsklick → „Öffnen mit“ → Editor),
   hinter `EODHD_API_KEY=` den Schlüssel von eodhd.com eintragen, speichern.
7. **`EODHD-pruefen-Windows.bat`** doppelklicken: prüft, ob alle Datenarten ankommen.
8. Terminal neu starten (Schritt 4).

Mac/Linux: im Terminal in den Projektordner wechseln und `./start.sh` ausführen.

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

- **Befehlszeile**: `/` drücken oder einfach lostippen (auch nach einem Klick in ein Auswahlfeld).
  Erst Ticker, dann Funktion, dann Enter. Beispiele: `AAPL US GP`, `SAP GR DES`, `DAX Index GP`,
  `EURUSD Curncy`, `CL1 Comdty`, `US10Y Govt`, `ECO`, `TOP`, `HELP`. Ticker im EODHD-Format
  (`SAP.XETRA`) oder im Bloomberg-Stil mit Börsenkürzel bzw. gelber Taste; ohne Börse gilt US.
  Firmennamen („northwind“) und deutsche Wörter („watchlist“, „kurschart“, „dividende“) gehen
  ebenfalls. Unbekannte Ticker werden mit Vorschlägen abgewiesen, Tippfehler bei Funktionen
  erkannt (`HLEP` → HELP), ↑ holt frühere Befehle zurück.
- **Gespeichert wird automatisch** (im Browser): Watchlist, Layouts, Panels, Chart- und
  Filtereinstellungen bleiben nach dem Schließen erhalten. **⟲ STANDARD** oben setzt wahlweise
  die aktuelle Seite, die ganze Ansicht (Watchlist bleibt) oder alles auf den Auslieferungszustand
  zurück.
- **Alt+1–4** Seiten · **Alt+←/→** aktives Panel · **Alt+M** Panel maximieren · **Alt+L** Layout ·
  **Esc** Maximieren beenden bzw. im Panel zurück (z. B. nach HELP).
- **Chart (GP):** Zeiträume 1T–MAX (Rendite gegen den Schluss vor Periodenbeginn), SMA 20/50/200,
  Bollinger 20, RSI 14 als eigener Bereich, Earnings-Marker (E, grün/rot), intraday VWAP und
  Vortagesschluss, Vergleich mit Index oder bis zu vier Werten (Renditen in bp). Die Einstellungen
  bleiben über Seitenwechsel und Neuladen erhalten.
- **Watchlist (W):** sortierbar, mit 1T/1M/YTD, Volumen und Stand.
- Ein Klick auf einen Ticker (Tabellen, News, Heatmap, Laufband) macht ihn zum aktiven
  Wertpapier; alle Aktien-Panels folgen. In WEI/FX/CMDT öffnet der Klick den Chart auf der
  Makroseite. HELP enthält ein Glossar; Kennzahlen in DES erklären sich per Tooltip.

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

Der Demo-Datensatz ist synthetisch, aber in sich konsistent:
- Börsenfeiertage je Handelsplatz, Handelszeiten mit Sommerzeit, Devisen bis Freitag 17:00 New York
- arbitragefreie Devisen-Kreuzkurse (auch Eröffnung/Hoch/Tief)
- Quartalszahlen = Geschäftsjahr, Konsens vor und nach dem Bericht gleich, Ist-Werte erst nach der
  Veröffentlichung; der Kurs reagiert auf Überraschung und Prognose (Lücke, Volumenspitze)
- vergangene Kurse, Dividenden und Finanzzahlen ändern sich nicht, wenn neue Tage hinzukommen
- Wirtschaftsdaten mit Bezugsperiode nach Veröffentlichungsverzug, Termine zur Ortszeit der Quelle,
  Vorwert = letzter Ist-Wert
- Beta aus der Kurshistorie, Kennzahlen wie 1M/12M oder 52W überall über Kalenderfenster,
  Marktkapitalisierungen im Screener in USD.

## Tests

```bash
cd backend && .venv/bin/python -m pytest -q
cd frontend && npx tsc -b && npx vitest run
```

## Statische Demo

Die REST-API ist unter `/docs` dokumentiert (OpenAPI); `/api/history/{ticker}?from=…&to=…`
liefert einen Zeitraum.

`npm run build:static` (im Ordner frontend) plus
`python -m scripts.export_static ../frontend/dist-static/data` (im Ordner backend) erzeugt
eine Version ohne Backend, die alle Demo-Daten als JSON mitbringt.

## Grenzen

- EODHD-Kurse sind verzögert (ca. 15–20 Min.); Echtzeit-WebSocket ist nicht angebunden.
- Charts: [TradingView Lightweight Charts](https://www.tradingview.com/) (Apache 2.0), Verweis im Chart-Panel.
- EODHD-Makroindikatoren sind überwiegend Jahreswerte (Weltbank-Basis).
- Rohstoffe werden im EODHD-Modus über ETFs als Stellvertreter abgebildet (`CL1 Comdty` → USO).
- Noch nicht enthalten (Wunschliste der Trader-Tests): Portfolio-/Risiko-Panel, Zeichenwerkzeuge
  und Alarme, MACD/ATR, weitere Länder und Devisenpaare, freie Spreads als Ticker, benannte
  Arbeitsbereiche, Bulk-Export.
- News liefert EODHD je Ticker; der allgemeine Feed setzt sich aus den Standard-Tickern zusammen.
- Die EODHD-Anbindung ist gegen nachgebaute Antworten getestet. Vor dem produktiven Einsatz
  `scripts/verify_eodhd.py` mit dem eigenen Key laufen lassen.
- Nur private Nutzung: eine öffentliche Bereitstellung der Daten erfordert die Klärung der
  EODHD-Lizenzbedingungen.
