# Briefing: Stimmungsterminal (neue Funktion im Market Terminal)

## Nutzer
Deutschsprachiger Privatanleger, kein IT-Profi, mag aber Tiefe (nutzt Trend-Scanning, Ehlers, DCF nach Damodaran, Prognosen).
Wunsch wörtlich: „genau baue ein tolles Stimmungsterminal“. Vorher gefragt: typische, halbwegs hochfrequente
Stimmungsindikatoren der Börse (täglich/wöchentlich). Er will den Chart-Bereich nicht mit Knöpfen überladen;
Erklärtexte in einfachem Deutsch sind ihm wichtig; er mag fließende Farbskalen statt hartem Rot/Grün.

## Was mit den Daten (EODHD) machbar ist
1. Direkt: VIX (VIX.INDX, schon im Terminal). VIX-Laufzeitkurve VIX9D/VIX3M: Verfügbarkeit bei EODHD offen
   (im Demo-Modus können wir sie simulieren; im Design als „falls verfügbar“ vorsehen).
   Nachrichten-Stimmung je Ticker täglich (−1…+1, Anzahl Artikel) – auch für SPY/QQQ/DAX-ETF als Marktstimmung.
2. Selbst gerechnet aus Kursen (täglich):
   - Marktbreite aus den ~600 Firmen, die das Terminal für BWT ohnehin lädt: Anteil über 200-/50-Tage-Linie,
     steigende vs. fallende Aktien, neue 52-Wochen-Hochs vs. -Tiefs, je Region (USA/Europa) und Sektor.
   - Sichere Häfen: Aktien (SPY) vs. Staatsanleihen-ETF (TLT/IEF) und Gold über 20 Tage.
   - Kreditrisiko: Hochzins-ETF (HYG) vs. Staatsanleihen-ETF (IEF) als Näherung für den Risikoaufschlag.
   - Schwung: S&P 500 vs. 125-Tage-Schnitt.
   - Eigener „Angst-und-Gier“-Wert (0–100) aus diesen Bausteinen (Muster CNN Fear & Greed, 5 von 7 Bausteinen).
3. Näherung: Put/Call aus Optionsdaten von SPY/QQQ (nicht die offizielle CBOE-Quote; kostet Optionsabrufe).
4. Nicht über EODHD (höchstens später, andere Quelle): AAII, NAAIM, Investors Intelligence, Börse Frankfurt
   Sentiment, CNN-Original, COT-Bericht (CFTC, kostenlos – mögliche zweite Stufe).
Fachlich: Stimmung ist meist ein GEGENindikator (extreme Angst = oft Chance, extreme Gier = Warnung), wirkt eher
über Monate; keine Kauf-/Verkaufsempfehlung. Ehrlichkeit wie im Rest des Terminals (Rückblick-Tests, Einordnung
„wie selten ist dieser Wert historisch“ = Perzentil/Rang).

## Terminal (zum Ansehen)
Bloomberg-ähnlich: schwarz, Amber-Beschriftungen (#ffa028), Zahlen hellgrau, IBM Plex Mono/Sans Condensed,
Panels mit Funktionskürzel (z. B. GP, DES, WEI, GC, WMAP, CRYP, FCTR, RRG, BWT, DCF, ECO, ECST, NB), Seiten
1 AKTIE / 2 MAKRO / 3 SCREENER / 4 NEWS / 5 DEPOT, Panels maximierbar (Alt+m), CSV-Export je Panel, Diagramme mit
ECharts, Kurse mit lightweight-charts. Code: frontend/src/screens/*.tsx, Farben in frontend/src/theme/terminal.css.

Demo-Server starten (eigener Port je Agent!):
  cd /home/user/market-terminal/backend && DATA_MODE=demo LLM_MODE=demo FORECAST_MODE=simple \
    PORTFOLIO_DIR=<eigener Ordner im scratchpad/design> .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port <PORT>
Browser: Playwright per Node (require('playwright'), chromium.launch()), Fenster 1500x950 und 1280x800.
Befehlsfeld: input[aria-label*="Befehl"] → Befehl tippen + Enter, 3 s warten; Alt+m maximiert das aktive Panel.
Seiten wechseln: Alt+1…5. Sehenswert: WEI, GC, WMAP, CRYP, FCTR, RRG, BWT, DCF, ECO, ECST, „QBIT US GP“, HELP.
Screenshots ansehen mit dem Read-Werkzeug.
