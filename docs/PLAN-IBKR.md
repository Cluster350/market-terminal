# Plan: Interactive Brokers im Market Terminal

Stand: Konzept, noch nicht umgesetzt. Ziel ist, IBKR als zweite Datenquelle neben EODHD
anzubinden. EODHD bleibt für Fundamentaldaten, Screener, Makro und Historie zuständig.
IBKR liefert das eigene Depot, Echtzeitkurse direkt von der Börse, das Orderbuch und
später Orders.

## Grundsätze

- **Lokal:** Das Terminal spricht mit der TWS bzw. dem IB Gateway auf demselben Rechner
  (127.0.0.1). Es wird kein Port nach außen geöffnet, und das IBKR-Passwort wird nie im
  Terminal gespeichert.
- **Standardmäßig nur lesend:** Orders sind ausgeschaltet, bis sie in der `.env` ausdrücklich
  erlaubt werden. Zusätzlich bleibt in der TWS „Read-Only API“ aktiv, bis Phase 3 fertig ist.
- **Papierhandel zuerst:** Jede Phase wird mit dem IBKR-Papierhandelskonto abgenommen
  (TWS-Port 7497, Gateway 4002), bevor das echte Konto (7496/4001) angeschlossen wird.
- **Ohne IBKR läuft alles wie bisher:** Ist die TWS nicht erreichbar, zeigt die Statusleiste
  „IBKR getrennt“. Kurse kommen dann von EODHD, die Broker-Panels zeigen einen Hinweis.
- **Testbar ohne Konto:** Ein `DemoBroker` liefert fiktive Positionen, Orderbücher und Orders,
  wie der Demo-Provider heute. So laufen Vorschau, Tests und Entwicklung ohne TWS.

## Aufbau

```
Browser ── REST /api/broker/*  +  WebSocket /ws/stream ── FastAPI
                                                           │
                         ┌─────────────────────────────────┼──────────────────────┐
                    Broker-Schicht                   Streaming-Schicht        Provider (EODHD/Demo)
              backend/app/broker/                 backend/app/stream/
              ├─ base.py   (Protocol)             Abo-Verwaltung mit Zählern,
              ├─ ibkr.py   (ib_async)             Quellenrangfolge:
              └─ demo.py   (DemoBroker)           IBKR > EODHD-Echtzeit > EODHD verzögert
                     │
              TWS / IB Gateway (lokal)
```

- **Bibliothek:** `ib_async` (gepflegter Nachfolger von ib_insync), asynchron wie FastAPI. Sie
  läuft im selben Prozess und verbindet sich beim Start neu, wenn die TWS später kommt.
- **Ticker-Abgleich:** `SAP.XETRA` → Contract(SAP, SMART, EUR, primaryExchange=IBIS),
  `AAPL.US` → (AAPL, SMART, USD), `EURUSD.FOREX` → Forex(EURUSD, IDEALPRO). Die conId wird über
  `reqContractDetails` ermittelt und zwischengespeichert. Mehrdeutige Treffer werden
  abgelehnt, nicht geraten.
- **Echtzeit an den Browser:** Ein WebSocket `/ws/stream` ersetzt für sichtbare Werte das
  Abfragen alle 15 Sekunden. Der Browser meldet, welche Ticker gerade zu sehen sind
  (Watchlist, Panelköpfe, Laufband). Das Backend abonniert jeden Wert nur einmal und verteilt
  ihn an alle Fenster. Dieselbe Schicht nimmt später den EODHD-WebSocket auf.
- **Marktdatenlinien:** IBKR begrenzt die Zahl gleichzeitig abonnierter Werte, bei
  Privatkonten typischerweise um 100. Die Abo-Verwaltung bevorzugt sichtbare Panels und gibt
  den am längsten nicht genutzten Wert frei. Die Herkunft zeigt der Tag „IBKR“ im Panelkopf.
- **Einstellungen in `.env`:**
  - `IBKR_ENABLED`, `IBKR_HOST`, `IBKR_PORT`, `IBKR_CLIENT_ID`, `IBKR_ACCOUNT` (optional)
  - `IBKR_TRADING=false`, `IBKR_ORDER_MAX_VALUE`, `IBKR_ORDER_MAX_QTY`

## Phase 0 – Prüfprogramm (klein)

`backend/scripts/verify_ibkr.py` und `IBKR-pruefen-Windows.bat`, analog zu `verify_eodhd`.
Das Programm gibt auf Deutsch aus:

- ob die Verbindung klappt, welche Konten verbunden sind und ob es ein Papierkonto ist,
- ob das Konto Echtzeit- oder verzögerte Kurse bekommt (Test mit SAP, AAPL, EUR/USD),
- für welche Börsen Orderbuch-Daten verfügbar sind (`reqMktDepthExchanges`),
- welche Nachrichtenquellen über die Schnittstelle kommen (`reqNewsProviders`), also auch,
  ob dpa-AFX dabei ist,
- ob die API nur lesend eingestellt ist.

Erst danach steht fest, welche der folgenden Phasen beim Nutzer sinnvoll sind.

## Phase 1 – Depot, nur lesend (mittel)

- **API:**
  - `/api/broker/status`
  - `/api/broker/account`: Nettowert, Cash, Kaufkraft, Margin, Tages-G/V
  - `/api/broker/positions`
  - `/api/broker/executions`: Ausführungen des Tages

  Quellen: `ib.portfolio()`, `reqPnL`/`reqPnLSingle`, `accountSummary`.
- **Neue Funktion PORT** (wie Bloomberg PORT):
  - Kopfzeile mit Nettowert, Tages-G/V absolut und in %, Cash und Kaufkraft.
  - Tabelle mit Ticker, Stück, Einstand, Kurs, Wert in Kontowährung, Gewicht, G/V heute und
    G/V gesamt, sortierbar.
  - Verteilung nach Sektor (aus EODHD-Fundamentaldaten), Währung und Land.
  - Wertentwicklung und Volatilität gegen einen wählbaren Index.
  - Ein Klick auf eine Position öffnet den Wert. „Depot → Watchlist“ übernimmt alle Positionen.
- Die Statusleiste zeigt „IBKR verbunden (Papier/Live, nur lesend)“.
- Tests laufen mit dem `DemoBroker` und einem nachgebauten IB-Client, wie heute die
  EODHD-Tests mit MockTransport.

## Phase 2 – Orderbuch und Umsätze (mittel)

- `reqMktDepth` (für US-Werte mit `isSmartDepth`) und `reqTickByTickData("AllLast")`
  werden über den WebSocket gestreamt.
- **Neue Funktion DEPTH:**
  - Leiter mit 10 Stufen je Seite und Mengenbalken, Spread, kumulierte Menge und Herkunftsbörse.
  - Daneben Time & Sales mit Uhrzeit, Kurs, Menge und Farbe nach Kauf- bzw. Verkaufsseite.
- **Grenzen:** IBKR erlaubt nur wenige Orderbücher gleichzeitig. Darum gilt das Abo nur für
  sichtbare DEPTH-Panels und endet beim Schließen bzw. Wechseln.
- Ohne passendes Abo erscheint der Hinweis „Für XETRA ist bei IBKR kein Markttiefe-Abo aktiv“
  statt eines leeren Fensters.

## Phase 3 – Handel (groß, nur auf ausdrücklichen Wunsch)

- **Voraussetzungen:** `IBKR_TRADING=true` und in der TWS „Read-Only API“ aus. Die
  Statusleiste zeigt dann dauerhaft „HANDEL AKTIV“ (rot bei Live-Konto).
- **Neue Funktion ORD** (Orderticket):
  - Kauf/Verkauf, Stück, Ordertyp (Limit als Standard, Stop, Stop-Limit; Market nur mit
    zusätzlicher Bestätigung), Limit, Gültigkeit (Tag/GTC) und Konto.
  - Vor dem Senden kommt eine **Vorschau** über `whatIfOrder` mit Gebühren, Margin-Wirkung und
    neuer Position.
  - Senden erfordert eine **zweite Bestätigung** mit der Zusammenfassung. Über die
    Befehlszeile wird nie direkt eine Order ausgelöst.
- **Schutz im Backend, nicht nur in der Oberfläche:**
  - Höchstwert je Order und Höchststückzahl prüfen.
  - Preisabweichung zum letzten Kurs prüfen (Tippfehler-Schutz).
  - Ein Idempotenzschlüssel je Order verhindert Doppelversand bei Doppelklick oder erneutem
    Verbinden.
- **Orderverwaltung:**
  - Offene Orders mit Status Gesendet/Teilausgeführt/Ausgeführt/Storniert, Ändern und
    Stornieren.
  - Ein Not-Aus „Alle Orders stornieren“ (`reqGlobalCancel`).
- **Protokoll:** Jede Order-Aktion wird mit Zeit, Inhalt und Antwort von IBKR in eine nur
  anfügbare Datei geschrieben.
- **Abnahme:** vollständig im Papierkonto mit einer Checkliste (Teilausführung, Storno,
  Verbindungsabbruch während einer Order, Doppelklick, ungültiger Ticker, Markt geschlossen).

## Phase 4 – Nachrichten (klein bis mittel)

- **Liefert IBKR dpa-AFX über die Schnittstelle** (Ergebnis aus Phase 0):
  - Schlagzeilen per `reqMktData` mit dem News-Tick (Provider-Code laut `reqNewsProviders`),
    Volltext über `reqNewsArticle`, Rückblick über `reqHistoricalNews`.
  - Die Meldungen erscheinen als `NewsItem` mit Quelle „dpa-AFX“ in TOP, CN und bei den
    Eilmeldungen, zusammengeführt mit den EODHD-News.
- **Sonst:** eigener `NewsSource`-Adapter für den direkt bei dpa-AFX gebuchten Feed. Das
  Format legt der Vertrag fest, z. B. NewsML/XML per HTTP-Push. Die Schnittstelle im Terminal
  bleibt gleich.
- **Lizenz:** Die Anzeige ist nur für den Kontoinhaber erlaubt, die Meldungen dürfen nicht
  weitergegeben werden.

## Betrieb beim Nutzer

- **IB Gateway statt TWS,** weil es schlanker ist.
- **Optional IBC** (Open Source) für automatischen Login und Neustart. Die wöchentliche
  Zwei-Faktor-Bestätigung am Handy bleibt trotzdem nötig.
- **Einrichtung in der TWS/im Gateway:** API → Settings → „Enable ActiveX and Socket Clients“,
  Port eintragen, „Allow connections from localhost only“, zunächst „Read-Only API“ an.
- **Kursdaten-Abos** in der IBKR-Kontoverwaltung buchen. Als Privatkunde
  („non-professional“) sind sie günstiger.

## Offene Entscheidungen

- Ob und ab wann gehandelt werden soll (Phase 3).
- Welche Börsen-Abos und ob Markttiefe für Xetra gebraucht wird.
- dpa-AFX über IBKR oder direkt, je nach Ergebnis aus Phase 0 und Preis.
