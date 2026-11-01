# Plan: Strategie-Backtester (Funktion BTST) mit vectorbt

Stand: Konzept, noch nicht umgesetzt. Der Backtester wird eine Funktion des Terminals:
gleiche Optik, gleiche Befehlszeile, gleiche Datenquellen. Der Name lehnt sich an Bloombergs
Backtest-Funktion an.

## Bedienung

- **Aufruf:**
  - `NWND US BTST` öffnet den Backtester für einen Wert.
  - `BTST` allein startet mit der Watchlist als Universum.
  - Im Screener (EQS) übergibt „Als Universum testen“ die Trefferliste.
- **Eigene Seite „5 BACKTEST“ (Alt+5).** Links steht die Strategie als Formular, rechts die
  Ergebnisse. Mit Alt+M lässt sich jede Hälfte maximieren.
- **Strategie ohne Programmieren:**
  - Vorlagen:
    - SMA-Kreuzung
    - RSI-Umkehr
    - Bollinger-Rückkehr und Bollinger-Ausbruch
    - Donchian-Ausbruch (Turtle)
    - MACD
    - Momentum-Rotation (Top N der Watchlist nach 3M/12M, monatlich umschichten)
    - Buy & Hold als Vergleich
  - Regel-Baukasten: „Einstieg, wenn [Indikator] [kreuzt über / unter / ist größer als]
    [Wert oder Indikator]“, mehrere Bedingungen mit UND/ODER, Ausstieg genauso.
  - Risiko: Stop-Loss %, Take-Profit %, Trailing-Stop, maximale Haltedauer.
- **Einstellungen:**
  - Zeitraum, Startkapital, Long/Short.
  - Positionsgröße: fester Anteil, gleichgewichtet oder nach Volatilität.
  - Gebühren und Slippage mit Profilen „IBKR Tiered“, „Neobroker 1 €“ und „Ohne Kosten“.
  - Ausführung zum nächsten Eröffnungskurs (Standard, verhindert den Blick in die Zukunft)
    oder zum Schlusskurs.
- **Starten:** mit Enter bzw. „Backtest starten“. Läuft er länger, zeigt eine Fortschrittszeile
  den Stand. Ergebnisse werden je Einstellung zwischengespeichert, und ein unveränderter
  Lauf erscheint sofort.
- **Merken und vergleichen:** Strategien speichern wie Screens (★). Bis zu vier Läufe lassen
  sich nebeneinander vergleichen, mit Kennzahlen-Tabelle und überlagerten Equity-Kurven.
- **Optimierung:**
  - Parameterbereiche angeben, z. B. SMA kurz 10–50 in 5er-Schritten, lang 50–200 in
    10er-Schritten. Ergebnis ist eine Heatmap nach Sharpe, CAGR oder Max Drawdown.
  - Die Zahl der Kombinationen ist begrenzt (Richtwert 2.000).
  - Pflichtaufteilung In-Sample/Out-of-Sample (Standard 70/30). Optional gibt es
    Walk-Forward, damit Überoptimierung sichtbar wird.

## Was angezeigt wird

### Kennzahlen-Kopf

| Gruppe | Kennzahlen |
|---|---|
| Rendite | Gesamtrendite, CAGR, Benchmark-Rendite, Überrendite (Alpha), Beta |
| Risiko | Volatilität p. a., Max Drawdown mit Dauer und Erholungszeit, längste Verlustserie |
| Risikoadjustiert | Sharpe, Sortino, Calmar |
| Trades | Anzahl, Trefferquote, Profit-Faktor, Ø Gewinn und Ø Verlust, Erwartungswert je Trade, Ø Haltedauer, Zeit im Markt |
| Kosten | Gebühren und Slippage gesamt sowie in % der Rendite |

Jede Kennzahl hat einen Glossar-Tooltip wie in DES. Kennzahlen aus der Out-of-Sample-Phase
werden getrennt ausgewiesen.

### Grafiken (Reiter)

1. **Übersicht:**
   - Equity-Kurve gegen Benchmark (wahlweise logarithmisch), darunter der Drawdown als
     „Unterwasser“-Fläche.
   - Out-of-Sample-Bereich farbig hinterlegt.
2. **Chart:** Kurschart im GP-Stil mit den Indikatoren der Strategie und Markern ▲ Kauf /
   ▼ Verkauf / ✕ Stop. Ein Klick auf einen Trade springt dorthin.
3. **Trades:** Liste mit Einstieg, Ausstieg, Kursen, Rendite, Dauer und Grund (Signal, Stop,
   Ziel, Zeit), sortierbar und als CSV exportierbar.
4. **Renditen:**
   - Monatsrenditen-Heatmap (Jahr × Monat) und Jahresbalken.
   - Verteilung der Trade-Renditen.
   - MAE/MFE-Streudiagramm: Wie weit lief ein Trade gegen bzw. für einen, bevor er endete?
5. **Stabilität:** rollierender Sharpe und rollierende Volatilität (12 Monate).
6. **Optimierung:** Parameter-Heatmap. Ein Klick auf ein Feld übernimmt die Parameter.

### Ehrliche Hinweise auf der Ergebnisseite

- **Demo-Modus:** synthetische Kurse. Ergebnisse sagen nichts über echte Märkte.
- **Survivorship Bias:** Das Universum besteht aus heutigen Werten. Unternehmen, die
  verschwunden sind, fehlen.
- **Nicht modelliert:** Dividenden-Steuern, Leihgebühren bei Short-Positionen und
  Marktwirkung großer Orders.

## Technik

- **Backend:** `backend/app/backtest/`
  - `strategies.py`: Vorlagen und Regel-Baukasten erzeugen Einstiegs- und Ausstiegssignale
    aus einem Kurs-DataFrame. Signale werden um einen Balken verschoben, damit nichts in die
    Zukunft schaut.
  - `engine.py`:
    - Einzelwerte über `vbt.Portfolio.from_signals` (fees, slippage, sl_stop, tp_stop,
      sl_trail).
    - Rotation über `from_orders` mit Zielgewichten.
  - `metrics.py`: `pf.stats()`/`pf.trades` auf deutsche Kennzahlen abbilden, dazu
    Monatsrenditen, Drawdown-Reihe und rollierende Kennzahlen.
  - `optimize.py`: Parameterraster über das Broadcasting von vectorbt, mit Obergrenze und
    In-/Out-of-Sample-Schnitt.
- **API:**
  - `POST /api/backtest` mit einer JSON-Spezifikation, Ergebnis als JSON (Reihen, Trades,
    Kennzahlen).
  - Rechnet in einem Thread-Pool mit Zeitlimit und Cache je Spezifikation (Hash).
  - `GET /api/backtest/templates` liefert die Vorlagen mit ihren Parametern.
- **Daten:** dieselbe Kurshistorie wie GP (EODHD, split- und dividendenbereinigt; Demo
  synthetisch). Benchmark ist der Heimatindex wie beim Knopf „Index“ in GP.
- **Sicherheit:** kein frei eingegebener Python-Code aus der Oberfläche, nur Vorlagen und
  Baukasten. Damit kann über das Terminal nichts Fremdes ausgeführt werden.
- **Frontend:**
  - Funktion BTST und Seite 5.
  - Charts mit lightweight-charts (Equity, Kurs mit Markern), Heatmaps und Histogramme mit
    ECharts.
  - Gespeicherte Strategien im Browser wie gespeicherte Screens.
- **Installation:**
  - vectorbt (mit numba, pandas, numpy) ist groß und kommt deshalb als **optionaler Zusatz**
    in `backend/requirements-backtest.txt`, installiert über `Backtester-installieren.bat`.
  - Ohne den Zusatz zeigt BTST einen Hinweis, wie man ihn installiert. Der Rest des Terminals
    bleibt schlank.
  - Vor der Umsetzung prüfen, welche Python-Versionen vectorbt und numba aktuell
    unterstützen. Die Startdatei findet beim Nutzer Anaconda-Python.
- **Lizenz:** vectorbt (Open Source) steht unter Apache 2.0 mit Commons Clause. Private
  Nutzung ist frei. Das Terminal als Produkt zu verkaufen, wäre nicht erlaubt. vectorbt PRO
  ist kostenpflichtig und für diesen Plan nicht nötig.
- **Tests:**
  - Buy & Hold gleich Kursrendite minus Gebühren.
  - SMA-Kreuzung mit von Hand berechneten Trades.
  - Prüfung, dass Signale erst am Folgetag ausgeführt werden.
  - Stop-Auslösung.
  - Rotation mit bekannten Gewichten.
  - Kennzahlen gegen eigene Rechnung (CAGR, Max Drawdown, Sharpe).

## Phasen

| Phase | Inhalt | Aufwand |
|---|---|---|
| 1 | Einzelwert, Vorlagen, Kosten, Kennzahlen, Equity/Drawdown, Chart mit Markern, Trades | mittel |
| 2 | Regel-Baukasten, Stops, Kostenprofile, gespeicherte Strategien, Vergleich mehrerer Läufe | mittel |
| 3 | Universum aus Watchlist/Screener, Rotation, Benchmark-Analyse (Alpha/Beta) | mittel |
| 4 | Optimierung mit Heatmap, In-/Out-of-Sample, Walk-Forward | mittel |
| 5 | Später, mit IBKR: aktuelle Signale als Vorschlag an das Orderticket (Papierkonto zuerst) | groß |
