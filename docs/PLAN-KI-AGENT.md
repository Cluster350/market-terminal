# Plan: KI-Agent im Terminal (LM Studio)

> **Stand November 2026:** Phasen 0 bis 3 sind umgesetzt (Anbindung und Prüfprogramm,
> News-Einordnung, BRIEF, ASK). Bedienung und Einrichtung stehen in der README unter
> „KI-Helfer mit LM Studio“, der Code in `backend/app/ai/`. Offen ist Phase 4.

Stand: Konzept, noch nicht umgesetzt.

**Ziel:** Ein lokales Sprachmodell aus LM Studio ordnet Nachrichten ein, fasst den Tag
zusammen und beantwortet Fragen. Die Zahlen dafür holt es sich über die vorhandenen Daten des
Terminals. Alles läuft auf dem eigenen PC, keine Daten verlassen den Rechner.

## Anbindung

- **LM Studio:** Unter „Developer“ → „Start Server“ läuft ein lokaler, OpenAI-kompatibler Server
  (Standard `http://localhost:1234/v1`). Das Terminal nutzt `/v1/chat/completions` mit
  Tool-Aufrufen (Function Calling) und strukturierter Ausgabe (JSON-Schema).
- **Einstellungen in `.env`:**
  - `LLM_ENABLED=true`
  - `LLM_BASE_URL=http://localhost:1234/v1`
  - `LLM_MODEL=<Modellname aus LM Studio>`
  - `LLM_API_KEY` (optional)
  - `LLM_MAX_CONCURRENCY=1`
- **Anbieterunabhängig:** Derselbe Client funktioniert mit Ollama und anderen
  OpenAI-kompatiblen Servern. Später ginge auch ein Cloud-Modell, mit dem Hinweis, dass Daten
  den PC dann verlassen.
- **Modellwahl:** Es braucht ein Modell mit Tool-Aufrufen und gutem Deutsch, etwa ein aktuelles
  Instruct-Modell mit 7–14 Mrd. Parametern bei 8–16 GB Grafikspeicher. Größere Modelle sind
  besser beim Agenten-Teil. Ein Prüfprogramm testet, ob das gewählte Modell Tool-Aufrufe und
  JSON-Ausgabe beherrscht.
- **Ohne LM Studio:** Ist der Server nicht erreichbar, zeigen die KI-Felder „KI aus“. Das
  Terminal läuft sonst unverändert.

## Funktionen

### 1. News-Einordnung (zuerst)

- **Je Meldung liefert das Modell strukturiert** (JSON-Schema):
  - Zusammenfassung in 1–2 Sätzen auf Deutsch
  - Stimmung von −1 bis +1 mit kurzer Begründung
  - betroffene Wertpapiere und Sektoren, nur aus der Tickerliste des Terminals gewählt
  - Ereignisart: Quartalszahlen, Prognose, Übernahme, Analyst, Rechtsstreit, Management, Makro …
  - Kursrelevanz 0–3 und Zeithorizont (kurzfristig/strukturell)
- **Abarbeitung:**
  - Neue Meldungen werden im Hintergrund eingeordnet, Watchlist- und Depotwerte zuerst.
  - Ergebnisse werden je Meldungs-ID gespeichert und nie doppelt berechnet.
  - Die Statusleiste zeigt „KI: 12 Meldungen in Arbeit“.
- **Anzeige:**
  - In TOP/CN ein Kasten „KI-Einordnung“ in der Leseansicht.
  - In der Liste ein Relevanz-Punkt und die KI-Stimmung.
  - Ein Filter „nur kursrelevant (≥ 2)“.
  - Eilmeldungen können zusätzlich nach KI-Relevanz markiert werden.

### 2. Morgenbriefing (Funktion BRIEF)

- **Auf Knopfdruck** oder automatisch beim ersten Start des Tages fasst das Modell zusammen:
  - die wichtigsten Meldungen seit gestern zu Watchlist bzw. Depot,
  - die Termine des Tages (ECO, EVTS),
  - die größten Bewegungen (MOST),
  - die Lage bei Zinsen und Devisen.
- **Quellen:** Jeder Satz verweist auf seine Quellen, ein Klick öffnet die Meldung oder die
  Funktion.

### 3. Fragen an das Terminal (Funktion ASK, Agent)

- **Fragen in Alltagssprache**, zum Beispiel „Warum fällt NWND heute?“, „Vergleiche ELBT mit
  den Peers“ oder „Was steht diese Woche für den DAX an?“.
- **Werkzeuge (nur lesend):**
  - `kurs(ticker)`
  - `kennzahlen(ticker)`
  - `wertentwicklung(ticker, zeitraum)`: wird im Backend berechnet, keine Rohreihen an das Modell
  - `finanzen(ticker)`
  - `earnings(ticker)`
  - `news(ticker, tage)`
  - `kalender(von, bis, land)`
  - `peers(ticker)`
  - `screener(filter)`
  - `watchlist()`
  - später `depot()` aus IBKR
- **Agenten-Schleife:** höchstens 6 Werkzeugaufrufe je Frage. Die Antwort zeigt darunter,
  welche Daten abgefragt wurden.
- **Zahlen nur aus den Werkzeugen:** Das Modell soll Zahlen nur aus den Werkzeug-Ergebnissen
  nennen. Ein Prüfschritt markiert Zahlen in der Antwort, die in keinem Ergebnis vorkommen
  („nicht belegt“).
- **Vorschläge statt Aktionen:** etwa „Screener mit diesen Filtern öffnen“ oder „Zur Watchlist
  hinzufügen“. Erst ein Klick des Nutzers führt sie aus.

### 4. Später

- **Screener in Alltagssprache:** „dividendenstarke Versorger mit KGV unter 15“ wird zu
  EQS-Filtern, die vor dem Ausführen angezeigt werden.
- **Backtest-Assistent:** „RSI-Strategie mit 8 % Stop“ wird zu einer BTST-Spezifikation
  (siehe PLAN-BACKTEST.md).
- **Quartalsbericht-Zusammenfassung:** Ist gegen Schätzung, Prognose, auffällige Veränderungen
  in FA.

## Sicherheit und Ehrlichkeit

- **Keine Handelsfunktionen für die KI.** Sie hat nur lesende Werkzeuge. Selbst wenn eine
  Meldung manipulierte Anweisungen enthält („Prompt Injection“), kann das Modell nichts
  auslösen. Meldungstexte werden ausdrücklich als Daten übergeben.
- **Kennzeichnung:** Jede KI-Ausgabe ist als „KI-Einschätzung, kann irren“ markiert und nennt
  ihre Quellen. Für wichtige Zahlen gelten die Werte im Terminal, nicht der KI-Text.
- **Lizenzen:** Die lokale Verarbeitung ist datenschutzfreundlich. Bei dpa-AFX und anderen
  lizenzierten Feeds ist zu prüfen, ob automatische KI-Auswertung im Vertrag erlaubt ist.
- **Last:** höchstens eine Anfrage gleichzeitig an LM Studio (einstellbar) und eine
  Warteschlange mit Priorität (ASK vor Hintergrund-Einordnung), damit der PC bedienbar bleibt.

## Technik

- **Backend:** `backend/app/ai/`
  - `client.py`: OpenAI-kompatibler HTTP-Client mit httpx, Streaming, Zeitlimits und
    Wiederholung.
  - `schemas.py`: JSON-Schemata für Einordnung und Briefing.
  - `tools.py`: Werkzeuge als dünne Hüllen um die vorhandenen Services, Ausgaben gekürzt und
    in deutscher Darstellung.
  - `agent.py`: Schleife Modell → Werkzeuge → Modell mit Schrittbegrenzung und Prüfung der
    Zahlen.
  - `queue.py`: Hintergrund-Einordnung mit Prioritäten und Cache (SQLite oder Datei).
- **API:**
  - `GET /api/ai/status`
  - `POST /api/ai/news/{id}`
  - `GET /api/ai/brief`
  - `POST /api/ai/ask` mit Antwort als Stream (Server-Sent Events)
- **Frontend:**
  - Funktionen ASK und BRIEF, auf Seite 4 NEWS oder als eigene Seite.
  - KI-Kasten in der Leseansicht, Relevanz-Filter.
  - Glossar-Eintrag „KI-Einschätzung“.
- **Tests:** Ein nachgebautes Modell (Stub) liefert feste Antworten und Tool-Aufrufe. Getestet
  werden Agenten-Schleife, Schrittgrenze, Schema-Prüfung, Prompt-Injection-Text in einer
  Meldung und Verhalten ohne Server.
- **Prüfprogramm `LLM-pruefen-Windows.bat`:** prüft Erreichbarkeit, geladenes Modell,
  Tool-Aufruf, JSON-Ausgabe und Antwortzeit.

## Phasen

| Phase | Inhalt | Aufwand |
|---|---|---|
| 0 | Anbindung und Prüfprogramm | klein |
| 1 | News-Einordnung mit Hintergrund-Warteschlange und Anzeige in TOP/CN | mittel |
| 2 | Morgenbriefing BRIEF | klein–mittel |
| 3 | ASK-Agent mit lesenden Werkzeugen, Quellen und Zahlenprüfung | mittel–groß |
| 4 | Screener und Backtests in Alltagssprache, Bericht-Zusammenfassungen | mittel |
