# Plan: Futures und Forwards im Market Terminal

## Stand der Daten (geprüft November 2026)

| Was | EODHD | Lösung im Terminal |
|---|---|---|
| Börsen-Futures (Index, Rohstoffe, Zinsen, Devisen; CME, Eurex, ICE) | **nicht enthalten** (in Anbietervergleichen „nicht unterstützt“; die Rohstoffdaten sind FRED-Spotreihen, keine Kontrakte) | später über **Interactive Brokers** (siehe unten) |
| Devisen-Terminkurse (Forward-Punkte) | nicht enthalten | **berechnet** aus Kassakurs und Zinsen beider Währungen (gedeckte Zinsparität) – **umgesetzt in FWD** |
| Forward-Zinsen (1Y1Y, 5Y5Y …) | nicht direkt | **berechnet** aus den Zinskurven (Staatsanleihen) – **umgesetzt in FWD** |
| Geldmarktzinsen | EURIBOR über den Kürzel-Bereich MONEY (Paket All World Extended); SOFR/€STR laut EODHD „in Vorbereitung“ | heute Renditen kurzlaufender Staatsanleihen (3M–2J) als Näherung |

## Umgesetzt: Funktion FWD (Terminkurse)

- **Devisen:** Terminkurse 1 Woche bis 2 Jahre, Swap-Punkte, Auf-/Abschlag p. a., Terminkurve.
  Formel: F = S · (1 + r_Notierung · t) / (1 + r_Basis · t), über ein Jahr mit Zinseszins.
  Am Markt weicht der Terminkurs um den Cross-Currency-Basis ab (meist wenige Basispunkte).
- **Absicherung:** Ertrag oder Kosten pro Jahr, Fremdwährungsanlagen per Termin in die
  Heimatwährung abzusichern (≈ Heimatzins − Fremdzins). Das Depot (PORT) zeigt diese Werte für
  seine Fremdwährungen und den Effekt einer Vollabsicherung auf das ganze Depot.
- **Zinsen:** implizite Einjahreszinsen in 0–15 Jahren und die Kennzahlen 1Y1Y, 2Y1Y, 2Y3Y,
  5Y5Y, 10Y10Y mit Veränderung zum Vormonat (Renditen als jährlich verzinste Nullkuponsätze
  genähert).
- Kennzeichnung überall: „berechnet aus Kassakursen und Zinsen · keine Börsenkurse“.

## Später: echte Futures über Interactive Brokers

Voraussetzung ist die IBKR-Anbindung (docs/PLAN-IBKR.md, Phase 1) und ein Marktdaten-Abo der
jeweiligen Börse bei IBKR (z. B. CME, Eurex). Ohne Abo liefert IBKR nur verzögerte Daten.

### Daten

- **Kontraktkette je Basiswert** über `reqContractDetails` (Fälligkeiten, Multiplikator,
  letzter Handelstag, erste Andienung), Kurse über `reqMktData`, Historie über
  `reqHistoricalData` (abgelaufene Kontrakte nur rund zwei Jahre zurück).
- **Ticker im Terminal:** Wurzel plus Fälligkeit im Bloomberg-Stil, z. B. `ES Z6 Index`
  (S&P-500-Future Dezember 2026), `FDAX Z6 Index`, `CL F7 Comdty`, `GC G7 Comdty`; dazu der
  generische Folgekontrakt `CL1 Comdty`, `ES1 Index` (heute schon als Kürzel für Rohstoffe
  bekannt, dann mit echten Futures statt ETF-Ersatz).
- **Rollen:** Für den Folgekontrakt wird am Tag gerollt, an dem das Volumen des nächsten
  Kontrakts das des laufenden übersteigt (oder fester Rolltag vor Verfall). Für lange Charts
  wird verkettet und rückwärts angepasst (Differenz bzw. Verhältnis), damit Rollsprünge nicht
  als Kursbewegung erscheinen.

### Funktionen

| Funktion | Inhalt |
|---|---|
| **CT** (Kontraktliste) | alle laufenden Fälligkeiten eines Basiswerts mit Kurs, Veränderung, Volumen, offenen Kontrakten, Verfall und Tagen bis Verfall |
| **FUT** (Terminkurve) | Futures-Kurve nach Fälligkeit, heute gegen vor 1 Woche/1 Monat; Contango/Backwardation, annualisierte Roll-Rendite zwischen den Kontrakten |
| **Basis** (in FUT) | Abstand des Index-Futures zum fairen Wert (Kassakurs · Finanzierung − Dividenden) – nutzt dieselbe Zinsrechnung wie FWD |
| **Roll-Kalender** (in EVTS) | Verfall und Rolltermine der wichtigsten Kontrakte |
| **GP** | Charts von Einzelkontrakten und vom verketteten Folgekontrakt |
| **WMAP/CMDT** | Rohstoffe und Indizes wahlweise mit echten Futures statt ETF-Ersatz |
| **FWD** | Vergleich berechneter Devisen-Terminkurs gegen Devisen-Future (z. B. 6E an der CME) – zeigt den tatsächlichen Cross-Currency-Basis |

### Reihenfolge

1. Kontraktkette und Kurse (CT) für eine kleine Liste: ES, NQ, FDAX, FESX, CL, BZ, GC, SI, NG,
   ZN, FGBL, 6E.
2. Terminkurve (FUT) mit Contango/Backwardation und Roll-Rendite.
3. Verketteter Folgekontrakt im Chart (GP), Ersatz der ETF-Proxys in CMDT.
4. Basis gegen fairen Wert und Vergleich mit FWD.
5. Handel von Futures erst mit IBKR Phase 3 und eigenen Sicherungen (Kontraktgröße,
   Margin-Prüfung, kein Halten in die Andienung).
