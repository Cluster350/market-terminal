# Market Terminal – Projektplan

Ein Finanzterminal im Stil von Bloomberg Terminal und Reuters/LSEG Workspace, gespeist aus der EODHD-API (EOD Historical Data).
Drei Module: **Aktien-Dashboard**, **Makro-Dashboard**, **Aktien-Screener**.

Stand: 29.10.2026 · Status: Planung

---

## 1. Ziele und Abgrenzung

**Ziele**

- Ein Werkzeug, das sich wie ein Terminal bedient: dunkle, dichte Oberfläche, Tastatursteuerung über eine Befehlszeile, mehrere Panels nebeneinander.
- Für jede Aktie alle wichtigen Informationen auf einem Bildschirm: Kurs, Chart, Profil, Kennzahlen, Finanzberichte, Earnings, News.
- Makro-Überblick: Weltindizes, Zinskurven, Währungen, Wirtschaftskalender, Länderkennzahlen.
- Screener mit frei kombinierbaren Filtern und einer Ergebnistabelle, die sich sortieren und exportieren lässt.

**Nicht im Umfang (vorerst)**

- Echtzeit-Trading, Orderausführung, Broker-Anbindung.
- Echtzeitkurse auf Tick-Ebene. EODHD liefert Schlusskurse, verzögerte Kurse (ca. 15–20 Min.) und je nach Plan einen WebSocket-Feed für US-Werte.
- Mehrbenutzerbetrieb mit Login. Erst einmal eine lokale bzw. private Anwendung.

**Rechtliches**

- Nur die *Optik* orientiert sich an Bloomberg/Reuters. Keine Namen, Logos oder Markenfarben-Kombinationen, die als Original durchgehen könnten. Arbeitstitel: „Market Terminal“.
- EODHD-Daten sind für die eigene Nutzung lizenziert. Eine öffentliche Weitergabe (z. B. eine gehostete Website für Dritte) braucht eine Klärung der Lizenzbedingungen.

---

## 2. Datenquelle: EODHD

### 2.1 Relevante Endpunkte

| Zweck | Endpunkt | Genutzt in |
|---|---|---|
| Tägliche OHLCV-Kurse | `/api/eod/{TICKER}` | Chart, Kurshistorie, Kennzahlen |
| Alle Schlusskurse einer Börse (ein Tag) | `/api/eod-bulk-last-day/{EXCHANGE}` | nächtlicher Import für den Screener |
| Verzögerte Kurse (auch mehrere Ticker) | `/api/real-time/{TICKER}?s=…` | Kurszeile, Watchlist, Laufband |
| Intraday-Kurse | `/api/intraday/{TICKER}?interval=5m` | 1T-/5T-Chart |
| Fundamentaldaten (Profil, Bilanzen, Kennzahlen, Analysten) | `/api/fundamentals/{TICKER}` | DES, FA, Earnings |
| Screener | `/api/screener` | Screener (MVP) |
| Technische Indikatoren | `/api/technical/{TICKER}?function=…` | Chart-Overlays (optional, alternativ selbst berechnen) |
| News und Sentiment | `/api/news?s=…`, `/api/sentiments?s=…` | News-Panel |
| Earnings-, IPO- und Split-Kalender | `/api/calendar/earnings` usw. | Earnings, Kalender |
| Dividenden und Splits | `/api/div/{TICKER}`, `/api/splits/{TICKER}` | Aktien-Dashboard |
| Wirtschaftskalender | `/api/economic-events` | Makro: Kalender |
| Makro-Indikatoren pro Land | `/api/macro-indicator/{ISO3}?indicator=…` | Makro: Ländervergleich |
| Symbollisten und Suche | `/api/exchange-symbol-list/{EXCHANGE}`, `/api/search/{query}` | Befehlszeile, Autovervollständigung |

**Ticker-Format:** `AAPL.US`, `SAP.XETRA`, `GSPC.INDX` (S&P 500), `GDAXI.INDX` (DAX), `EURUSD.FOREX`, `US10Y.GBOND`, `BTC-USD.CC`.

### 2.2 Wichtige Einschränkungen (vor dem Bau prüfen)

- **Makro-Indikatoren sind überwiegend Jahreswerte** (Weltbank-Basis, ca. 39 Reihen pro Land). Für ein Makro-Dashboard mit monatlichen Daten reicht das nicht allein. Monatliche bzw. tägliche Daten kommen aus:
  - Staatsanleihen-Renditen (`.GBOND`, täglich, u. a. US, DE, UK, JP mit 2Y/5Y/10Y/30Y),
  - Wirtschaftskalender (Ist-, Prognose- und Vorwert pro Veröffentlichung),
  - Indizes und Devisen (täglich).
  - **Optional:** FRED (US-Notenbank St. Louis, kostenlos) als Ergänzung für monatliche US-Reihen wie CPI, Arbeitslosenquote oder Leitzins. Entscheidung siehe Abschnitt 8.
- **Rohstoffe:** Die Abdeckung bei EODHD ist ungeklärt. Fallback sind Rohstoff-ETFs als Stellvertreter (z. B. GLD, USO).
- **API-Kosten:** Ein Screener-Aufruf kostet 5 API-Calls, Fundamentaldaten und Bulk-Abrufe kosten laut Doku mehr als ein normaler Kursabruf. Das Tageslimit liegt je nach Plan bei ca. 100.000 Calls. Deshalb wird alles serverseitig gecacht.
- **Planabhängigkeit:**

  | Plan | Preis/Monat (Stand laut Suche, prüfen) | Reicht für |
  |---|---|---|
  | Free | 0 $ (20 Calls/Tag) | nur Prototyp mit Demo-Tickern |
  | EOD Historical Data – All World | ca. 20 $ | Kurse, keine Fundamentaldaten |
  | EOD+Intraday – All World Extended | ca. 30 $ | Kurse, Intraday, laut Doku Screener |
  | Fundamentals Data Feed | ca. 60 $ | Fundamentaldaten, Kalender, Anleihen |
  | **All-In-One** | ca. 100 $ | **alles, was dieser Plan braucht** |

  **Empfehlung:** Mit dem Free-Key bzw. dem `demo`-Key entwickeln. Der `demo`-Key funktioniert z. B. für AAPL.US, TSLA.US, AMZN.US, VTI.US, EURUSD.FOREX und BTC-USD.CC. Vor Phase 3 auf All-In-One wechseln, ein Monat reicht für den Bau.

---

## 3. Architektur

```
┌──────────────────────────────── Browser ────────────────────────────────┐
│  React + TypeScript (Vite)                                              │
│  Shell: Befehlszeile · Panel-Layout · Tastaturkürzel                    │
│  Screens: WEI · DES · GP · HP · FA · ERN · CN · ECO · GC · FX · EQS …   │
│  Charts: TradingView Lightweight Charts · ECharts (Heatmap, Kurven)     │
│  Tabellen: TanStack Table (virtualisiert)                               │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ REST/JSON (+ später WebSocket für Kurse)
┌──────────────────────────────┴──────────────────────────────────────────┐
│  Backend: Python 3.12 · FastAPI                                         │
│  ├─ eodhd/      API-Client: Ratelimit, Retry, Call-Budget-Zähler        │
│  ├─ cache/      Antwort-Cache mit TTL pro Endpunkt                      │
│  ├─ db/         DuckDB: Kurse, Fundamentaldaten, Screener-Universum     │
│  ├─ jobs/       Scheduler: nächtlicher Import, Fundamentaldaten weekly  │
│  └─ api/        eigene, schlanke Endpunkte für das Frontend             │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ HTTPS, API-Key nur hier
                         EODHD API (+ optional FRED)
```

### Technologieentscheidungen

| Entscheidung | Gewählt | Warum | Verworfen |
|---|---|---|---|
| Backend | Python + FastAPI | Python ist aus den Kaggle-Projekten bekannt, pandas/DuckDB für Kennzahlen | Node-Backend |
| Datenhaltung | DuckDB (eine Datei) | spaltenorientiert, schnelle Filter über tausende Aktien, kein Server nötig | Postgres (später möglich) |
| Frontend | React + TypeScript + Vite | volle Kontrolle über den Terminal-Look und die Tastatursteuerung | Streamlit/Dash: schnell, aber Terminal-Optik und Tastatur-UX kaum umsetzbar |
| Finanzcharts | TradingView Lightweight Charts (Apache 2.0) | Candlesticks, Volumen, Overlays, sehr performant, Standard-Look in Trading-Tools | Plotly (schwerer, weniger „Terminal“) |
| Sonstige Charts | ECharts | Treemap-Heatmap, Zinskurven, Balken | D3 von Hand (zu aufwendig) |
| Tabellen | TanStack Table + Virtualisierung | tausende Zeilen im Screener, Sortierung, eigene Zellformate | AG Grid (Community-Version reicht auch) |
| Panel-Layout | dockview oder react-grid-layout | verschiebbare, andockbare Panels wie im Terminal | festes CSS-Grid (für MVP ok) |
| Betrieb | Docker Compose, lokal | ein Befehl startet alles | Cloud-Hosting (erst nach Lizenzklärung) |

**API-Key-Regel:** Der EODHD-Key liegt nur im Backend (`.env`, nie committen). Das Frontend spricht ausschließlich mit dem eigenen Backend.

### Datenaktualisierung

| Daten | Quelle | Aktualisierung | Cache-TTL |
|---|---|---|---|
| Schlusskurse Universum | Bulk-EOD pro Börse | täglich nach Börsenschluss | bis zum nächsten Import |
| Verzögerte Kurse (Watchlist, Laufband) | Real-time | alle 60 s, nur sichtbare Ticker | 60 s |
| Intraday | Intraday | bei Bedarf | 5 min |
| Fundamentaldaten | Fundamentals | wöchentlich + bei Aufruf, wenn älter als 7 Tage | 7 Tage |
| News | News | bei Aufruf | 10 min |
| Anleihen, FX, Indizes | EOD | täglich | 1 Tag |
| Wirtschaftskalender | Economic Events | stündlich in Handelszeiten | 1 h |
| Makro-Indikatoren | Macro | monatlich | 30 Tage |

---

## 4. Design-System

### 4.1 Vorbilder und was wir übernehmen

| Vorbild | Was wir übernehmen |
|---|---|
| **Bloomberg Terminal** | schwarzer Hintergrund, Amber als Primärfarbe für Beschriftungen, Monospace-Schrift, sehr hohe Informationsdichte, **Befehlszeile mit Funktionskürzeln** (`AAPL US DES <GO>`), Panels mit Kürzel im Titel |
| **Reuters / LSEG Workspace** | ruhigere Panel-Rahmen, Orange als Akzent für aktive Tabs, eine globale Suche für alles, News-Liste mit Zeitstempel und Eilmeldungs-Markierung |
| **Finviz** | Screener-Bedienung: Filter als Raster von Dropdowns nach Kategorie (Deskriptiv / Fundamental / Technisch), Markt-Heatmap als Treemap |
| **Koyfin** | Aufbau der Makro-Dashboards: Zinskurve heute vs. vor 1 M / 1 J, Spread-Charts, Ländervergleichstabellen |
| **TradingView** | Chart-Interaktion: Zeitraum-Buttons, Fadenkreuz, Vergleich mit Index |

### 4.2 Design-Tokens

```
Farben
  --bg            #000000   Hintergrund
  --panel         #0B0B0B   Panel-Fläche
  --panel-head    #1A1A1A   Panel-Titelleiste
  --rule          #2A2A2A   Trennlinien
  --label         #FFA028   Beschriftungen, Kürzel (Amber)
  --value         #F2F2F2   Zahlenwerte
  --muted         #8C8C8C   Sekundärtext
  --accent        #FF8000   aktiver Tab, Fokus, Auswahl
  --up            #2ECC71   Kursgewinne
  --down          #FF4D4D   Kursverluste
  --flash-up/-down          kurzes Aufblinken bei Kursänderung
  --link          #4FA3FF   anklickbare Ticker
  --cmd-bg        #FFD60A   Funktionskürzel-Chip (gelber Hintergrund, schwarze Schrift)

Schrift
  Monospace: IBM Plex Mono oder JetBrains Mono
  Basis 12–13 px, Zeilenhöhe Tabellen 20 px
  Immer tabular-nums, Zahlen rechtsbündig

Form
  keine Rundungen, keine Schatten, 1-px-Linien
  Panel-Abstand 2 px (Fugen wie im Terminal)
```

**Barrierefreiheit:** Rot/Grün nie allein. Immer zusätzlich ▲/▼ und ein Vorzeichen. Kontrast der Amber-Beschriftung auf Schwarz ist ausreichend (> 7:1).

### 4.3 Bedienkonzept

- **Befehlszeile** oben, Fokus mit `/` oder `Esc`. Syntax: `TICKER FUNKTION`, z. B. `AAPL DES`, `SAP GR GP`, `ECO`, `EQS`.
- Autovervollständigung für Ticker (Search-API + lokale Symbolliste) und Funktionen.
- **Panel-Layout:** 1, 2 oder 4 Panels. Jedes Panel hat ein eigenes Kürzel und einen eigenen Ticker. Mit `Strg+1…4` wechselt man zwischen Panels.
- **Ticker-Verlinkung:** Ein Klick auf einen Ticker irgendwo öffnet ihn im aktiven Panel. Panels lassen sich gruppieren, sodass ein Tickerwechsel alle verlinkten Panels mitzieht (wie die Farbgruppen bei Bloomberg).
- **Zahlenformat:** `1,23 Mrd.`, `+1,24 %`, Renditen in `%` mit 3 Nachkommastellen, Spreads in Basispunkten (`bp`).
- **Datenstand sichtbar:** Jeder Wert hat einen Zeitstempel. Verzögerte Kurse tragen ein `D` (delayed), Schlusskurse ein `C`.

### 4.4 Funktionskürzel

| Kürzel | Vorbild | Screen | Modul |
|---|---|---|---|
| `WEI` | World Equity Indices | Weltindizes: Kurs, Veränderung 1T/1W/YTD | Makro |
| `DES` | Description | Firmenprofil, Branche, Management, Kennzahlen-Überblick | Aktie |
| `GP` | Graph Price | Candlestick-Chart mit Volumen, Overlays, Index-Vergleich | Aktie |
| `HP` | Historical Prices | Kurshistorie als Tabelle | Aktie |
| `FA` | Financial Analysis | GuV, Bilanz, Cashflow; jährlich/quartalsweise; Sparkline pro Zeile | Aktie |
| `ERN` | Earnings | EPS Ist vs. Schätzung, Überraschung, nächster Termin | Aktie |
| `DVD` | Dividends | Dividendenhistorie, Rendite, Splits | Aktie |
| `ANR` | Analyst Recommendations | Ratings, Kursziel | Aktie |
| `CN` | Company News | News mit Sentiment | Aktie |
| `ECO` | Economic Calendar | Wirtschaftskalender mit Überraschung (Ist − Prognose) | Makro |
| `GC` | Graph Curves | Zinskurven je Land, heute vs. −1M / −1J | Makro |
| `SPRD` | – | Spreads: 2s10s, US–DE 10Y | Makro |
| `FX` | WCRS | Devisenübersicht, Stärke-Ranking | Makro |
| `ECST` | Economic Statistics | Ländervergleich: BIP-Wachstum, Inflation, Arbeitslosigkeit, Schulden/BIP | Makro |
| `EQS` | Equity Screening | Screener | Screener |
| `IMAP` | Intraday Market Map | Heatmap nach Sektoren (Treemap, Größe = Market Cap) | Screener |
| `MOST` | Most Active | Top-Gewinner/-Verlierer, Volumen | Screener |
| `W` | Watchlist / Monitor | eigene Watchlists mit Live-Kursen | Shell |

---

## 5. Module im Detail

### 5.1 Aktien-Dashboard (Standardlayout bei Eingabe eines Tickers)

```
┌ Kurszeile: AAPL US  Apple Inc  227,48 ▲ +2,31 (+1,03 %)  Vol 48,2 Mio  52W 164,1–237,2  D 15:42 ┐
├──────────────────────────────────────┬──────────────────────────────┤
│ GP  Chart (Candles + Volumen)        │ DES  Profil + Kennzahlen     │
│ 1T 5T 1M 6M YTD 1J 5J MAX  SMA50/200 │ KGV, EV/EBITDA, KBV, Marge…  │
├──────────────────────────────────────┼──────────────────────────────┤
│ FA  Finanzen (Tabelle + Sparklines)  │ CN  News · ERN Earnings      │
└──────────────────────────────────────┴──────────────────────────────┘
```

- Peers: aus dem lokalen Universum (gleiche Branche, ähnliche Market Cap), weil EODHD keine Peer-Liste liefert.
- Kennzahlen, die EODHD nicht direkt liefert (z. B. Momentum, Volatilität, Abstand zum 52W-Hoch), berechnet das Backend aus den Kursen.

### 5.2 Makro-Dashboard

```
┌ WEI  Weltindizes (Tabelle)          ┬ GC  Zinskurve US / DE (heute, −1M, −1J) ┐
├ FX  Devisen + Stärke-Ranking        ┼ SPRD  2s10s US · US10Y−DE10Y (Chart)     ┤
├ ECO  Wirtschaftskalender (heute/Woche, Überraschung farbig)                    ┤
└ ECST  Ländervergleich (Jahreswerte, Quelle sichtbar)                            ┘
```

### 5.3 Screener

- **Stufe 1 (MVP):** EODHD-Screener-API. Schnell gebaut, aber begrenzt: feste Filterfelder, max. 1.000 Ergebnisse über Offset, 5 Calls pro Abfrage.
- **Stufe 2 (Ziel):** eigener Screener auf DuckDB über ein definiertes Universum (z. B. S&P 500 + STOXX 600 + DAX/MDAX). Beliebige Filter, kombinierte Kennzahlen, Antwort in Millisekunden, keine API-Kosten pro Abfrage.
- Filter-UI nach Finviz-Vorbild: Kategorien *Deskriptiv* (Börse, Land, Sektor, Market Cap), *Fundamental* (KGV, EV/EBITDA, Dividendenrendite, Umsatzwachstum, Marge, Verschuldung), *Technisch* (Performance 1M/3M/12M, RSI, Abstand zu SMA200 / 52W-Hoch, Volatilität).
- Ergebnisse: virtualisierte Tabelle, Spalten wählbar, CSV-Export, Klick auf eine Zeile öffnet `DES` im Nachbarpanel.
- Gespeicherte Screens (lokal in der DB).
- `IMAP`-Heatmap und `MOST` nutzen dasselbe Universum.

---

## 6. Phasen, Arbeitspakete und Aufgabenverteilung

### Rollen

| Rolle | Wer | Aufgaben |
|---|---|---|
| **Product Owner** | **Du** | Entscheidungen (Abschnitt 8), EODHD-Account und Plan, API-Key, Abnahme jeder Phase, Design-Feedback |
| **Daten & Backend** | Claude (Stream B) | EODHD-Client, Cache, DuckDB, Jobs, API-Endpunkte |
| **Frontend & Design** | Claude (Stream F) | Design-System, Shell, Komponenten, Screens |
| **Qualität** | Claude (Stream Q) | Tests, Datenvalidierung, Performance |

Streams B und F können ab Phase 1 **parallel** laufen, z. B. in getrennten Claude-Sessions, solange die API-Verträge (Abschnitt 7) feststehen.

Aufwand: S ≈ ½ Tag · M ≈ 1–2 Tage · L ≈ 3–5 Tage.

### Phase 0 – Vorbereitung

| ID | Aufgabe | Wer | Aufwand | Abhängig von |
|---|---|---|---|---|
| P0.1 | EODHD-Account anlegen, Free-Key holen | Du | S | – |
| P0.2 | Entscheidungen aus Abschnitt 8 treffen | Du | S | – |
| P0.3 | `eodhd.com` in den Netzwerkeinstellungen der Cloud-Umgebung freigeben, API-Key als Secret hinterlegen | Du | S | P0.1 |
| P0.4 | Endpunkte mit `demo`-Key testen, echte Antwortformate als Fixtures speichern | Claude | S | P0.3 |
| P0.5 | Repo-Struktur, Docker Compose, Lint/Format, CI | Claude | M | P0.2 |

### Phase 1 – Fundament

| ID | Aufgabe | Wer | Aufwand | Abhängig von |
|---|---|---|---|---|
| B1.1 | EODHD-Client: Ratelimit, Retry, Call-Budget-Zähler, Fehlerbehandlung (403 = Plan reicht nicht) | Claude B | M | P0.4 |
| B1.2 | Cache-Schicht mit TTL pro Endpunkt | Claude B | S | B1.1 |
| B1.3 | DuckDB-Schema: `prices`, `fundamentals`, `symbols`, `metrics`, `macro`, `events` | Claude B | M | P0.5 |
| B1.4 | API-Endpunkte für Quote, Chart, Suche | Claude B | M | B1.2 |
| F1.1 | Design-Tokens, Schriften, Grundkomponenten: Panel, Kurszeile, Zahlenzelle, Chip, Tabelle | Claude F | M | P0.5 |
| F1.2 | Shell: Befehlszeile mit Parser, Autovervollständigung, Panel-Layout, Tastaturkürzel | Claude F | L | F1.1 |
| F1.3 | Mock-Daten aus den Fixtures, damit das Frontend ohne Backend läuft | Claude F | S | P0.4 |
| Q1.1 | Tests für Client und Formatierung (Zahlen, Prozent, bp) | Claude Q | S | B1.1, F1.1 |
| **M1** | **Meilenstein:** `AAPL GP` in der Befehlszeile zeigt einen echten Chart | Abnahme: Du | | |

### Phase 2 – Aktien-Dashboard

| ID | Aufgabe | Wer | Aufwand |
|---|---|---|---|
| S2.1 | `GP`: Candlesticks, Volumen, Zeiträume, SMA, Index-Vergleich | Claude F | M |
| S2.2 | `DES` + Kennzahlen-Block | Claude F+B | M |
| S2.3 | `FA`: Finanztabellen jährlich/quartalsweise, Sparklines | Claude F+B | L |
| S2.4 | `ERN`, `DVD`, `ANR` | Claude F+B | M |
| S2.5 | `CN`: News mit Sentiment | Claude F+B | S |
| S2.6 | `HP` + `W` (Watchlist mit verzögerten Kursen, Aufblinken) | Claude F+B | M |
| S2.7 | Berechnete Kennzahlen (Momentum, Volatilität, 52W) | Claude B | S |
| **M2** | **Meilenstein:** vollständiges 4-Panel-Layout für eine Aktie | Abnahme: Du | |

### Phase 3 – Makro-Dashboard

| ID | Aufgabe | Wer | Aufwand |
|---|---|---|---|
| M3.1 | Import Indizes, FX, GBOND (täglicher Job) | Claude B | M |
| M3.2 | `WEI` Weltindizes | Claude F | S |
| M3.3 | `GC` Zinskurven + `SPRD` Spreads | Claude F | M |
| M3.4 | `FX` Devisenübersicht | Claude F | S |
| M3.5 | `ECO` Wirtschaftskalender mit Überraschungsfarbe, Länderfilter | Claude F+B | M |
| M3.6 | `ECST` Ländervergleich (Jahreswerte, klar als solche gekennzeichnet) | Claude F+B | M |
| M3.7 | Optional: FRED-Anbindung für monatliche US-Reihen | Claude B | M |
| **M3** | **Meilenstein:** Makro-Layout komplett mit echten Daten | Abnahme: Du | |

### Phase 4 – Screener

| ID | Aufgabe | Wer | Aufwand |
|---|---|---|---|
| Q4.1 | Stufe 1: EODHD-Screener-API anbinden, Filter-UI, Ergebnistabelle | Claude F+B | M |
| Q4.2 | Universum festlegen, nächtlicher Bulk-Import, wöchentlich Fundamentaldaten | Claude B | M |
| Q4.3 | Kennzahlen-Tabelle `metrics` in DuckDB berechnen | Claude B | M |
| Q4.4 | Stufe 2: eigener Screener-Endpunkt mit beliebigen Filtern | Claude B | M |
| Q4.5 | Filter-UI nach Finviz-Vorbild, gespeicherte Screens, CSV-Export | Claude F | M |
| Q4.6 | `IMAP` Heatmap + `MOST` | Claude F | M |
| **M4** | **Meilenstein:** Screen „Value + Momentum in Europa“ liefert in < 1 s Ergebnisse | Abnahme: Du | |

### Phase 5 – Feinschliff

| ID | Aufgabe | Wer | Aufwand |
|---|---|---|---|
| P5.1 | Panel-Gruppen mit Ticker-Verlinkung, Layouts speichern | Claude F | M |
| P5.2 | WebSocket für US-Kurse (falls Plan es erlaubt) | Claude B | M |
| P5.3 | Performance: Virtualisierung, Bundle-Größe, Ladezeiten | Claude Q | S |
| P5.4 | Datenvalidierung: Lücken, Splits, Ausreißer | Claude Q | M |
| P5.5 | Dokumentation: Start, Konfiguration, Kürzel-Übersicht | Claude | S |

**Grobe Gesamtschätzung:** ca. 25–35 Arbeitstage. Mit parallelen Streams B und F entsprechend weniger Kalenderzeit.

---

## 7. Repo-Struktur und API-Verträge

```
market-terminal/
├─ backend/
│  ├─ app/
│  │  ├─ api/          routes: quote, chart, fundamentals, macro, screener, search
│  │  ├─ eodhd/        client.py, models.py (pydantic), fixtures/
│  │  ├─ db/           duckdb schema + queries
│  │  ├─ jobs/         nightly_eod.py, weekly_fundamentals.py, macro.py
│  │  └─ services/     metrics.py (Kennzahlen), screener.py
│  └─ tests/
├─ frontend/
│  └─ src/
│     ├─ shell/        CommandLine, PanelLayout, Hotkeys
│     ├─ theme/        tokens.css, format.ts
│     ├─ components/   Panel, QuoteLine, NumberCell, DataGrid, Sparkline, Chart
│     └─ screens/      WEI, DES, GP, HP, FA, ERN, CN, ECO, GC, FX, ECST, EQS, IMAP …
├─ docker-compose.yml
├─ .env.example        EODHD_API_KEY=
└─ PLAN.md
```

**Eigene Backend-Endpunkte (Vertrag zwischen Stream B und F):**

```
GET /api/quote?tickers=AAPL.US,SAP.XETRA
GET /api/chart/{ticker}?range=1Y&interval=1d
GET /api/company/{ticker}            Profil + Kennzahlen
GET /api/financials/{ticker}?period=annual|quarterly
GET /api/earnings/{ticker}
GET /api/news/{ticker}
GET /api/macro/indices | /fx | /curves?country=US | /calendar?from=&to=&country= | /countries
POST /api/screener                   { filters: [...], sort, columns, limit }
GET /api/search?q=
```

---

## 8. Offene Entscheidungen

| # | Frage | Vorschlag |
|---|---|---|
| E1 | Welcher EODHD-Plan? | Entwicklung mit Free/`demo`, ab Phase 2 einen Monat All-In-One |
| E2 | Welche Märkte? | US (S&P 500) + Deutschland (DAX, MDAX) + Europa (STOXX 600) |
| E3 | FRED als Ergänzung für monatliche Makrodaten? | Ja, kostenlos und deutlich bessere Makro-Abdeckung |
| E4 | Eigenes Repo oder Ordner in diesem Kaggle-Repo? | Eigenes Repo, weil das Projekt mit Kaggle nichts zu tun hat |
| E5 | Nur lokal oder gehostet? | Erst lokal (Docker Compose), Hosting erst nach Lizenzklärung |
| E6 | Sprache der Oberfläche? | Englische Kürzel (wie im Original), deutsche Zahlenformate einstellbar |

---

## 9. Risiken

| Risiko | Auswirkung | Gegenmaßnahme |
|---|---|---|
| Makrodaten bei EODHD meist nur jährlich | Makro-Dashboard wirkt dünn | GBOND, Kalender, FX nutzen; FRED ergänzen (E3) |
| API-Call-Budget überschritten | Ausfälle, Mehrkosten | Bulk-Import, Cache, Budget-Zähler mit Warnung |
| Plan deckt Endpunkt nicht ab (403) | Funktion fehlt | P0.4 testet alle Endpunkte vorab; klare Fehlermeldung im UI |
| Datenqualität (Splits, Lücken, Währungen) | falsche Kennzahlen | adjustierte Kurse nutzen, Validierungsjob (P5.4) |
| Umfang wächst ständig | Projekt wird nie fertig | Meilensteine M1–M4 strikt, alles Weitere in Phase 5 |
| Lizenz bei öffentlicher Nutzung | rechtliches Risiko | nur private Nutzung, bis Lizenz geklärt ist |
