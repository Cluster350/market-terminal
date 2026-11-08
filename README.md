# Market Terminal

Finanzterminal im Stil von Bloomberg Terminal und Reuters/LSEG Workspace auf Basis der
[EODHD-API](https://eodhd.com). Vier Arbeitsbereiche:

| Seite | Panels | Inhalt |
|---|---|---|
| **1 AKTIE** | GP · DES · FA · CN | Kurschart, Firmenprofil mit Kennzahlen, Finanzberichte, Firmen-News |
| **2 MAKRO** | WMAP · WEI · GC · ECO | Weltkarte, Weltindizes, Zinskurven, Wirtschaftskalender (FX, ECST, BWT Bewertungstrend über das Auswahlfeld) |
| **3 SCREENER** | EQS · IMAP · MOST | Aktien-Screener, Markt-Heatmap, Top-Bewegungen |
| **4 NEWS** | TOP · BRIEF · ASK | News-Terminal mit KI-Einordnung, Morgenbriefing, KI-Assistent |
| **5 DEPOT** | PORT · RISK | Eigenes Depot: Wert, Ergebnis, Aufteilung; Risiko mit Schwankung, Beta, VaR, Korrelationen; dazu ALRT (Kursalarme) |

Jedes Panel kann über sein Auswahlfeld oder die Befehlszeile jede Funktion zeigen; das Layout
jeder Seite ist umschaltbar (1, 2, 3 oder 4 Panels). Weitere Funktionen: HP (Kurshistorie),
ERN (Earnings), DVD (Dividenden), ANR (Analysten), RV (Peer-Vergleich), OMON (Optionen), TPO (Market Profile), FWD (Terminkurse), EVTS (Earnings-Kalender),
CMDT (Rohstoffe), SPRD (Zinsspreads), ECST (Länderdaten), W (Watchlist), HELP.

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

Ohne schwarzes Fenster: **`Start-Windows-Hintergrund.vbs`** doppelklicken. Das Terminal läuft
dann unsichtbar im Hintergrund (Kursalarme werden weiter geprüft), der Browser öffnet sich.
Ein zweiter Doppelklick öffnet nur den Browser. Beim ersten Start und nach einem Update erscheint
zur Einrichtung kurz das normale Fenster. Beenden mit **`Stop-Windows.bat`**. Bei einem Fehler
öffnet sich das Protokoll `market-terminal.log` im Editor.

Echte Daten statt Demo:
6. Die Datei **`.env`** im Ordner mit dem Editor öffnen (Rechtsklick → „Öffnen mit“ → Editor),
   hinter `EODHD_API_KEY=` den Schlüssel von eodhd.com eintragen, speichern.
7. **`EODHD-pruefen-Windows.bat`** doppelklicken: prüft, ob alle Datenarten ankommen.
8. Terminal neu starten (Schritt 4).

Mac/Linux: im Terminal in den Projektordner wechseln und `./start.sh` ausführen.

Neue Version installieren:
- Neue ZIP-Datei herunterladen und entpacken, die Datei **`.env`** aus dem alten Ordner in den
  neuen kopieren (sie enthält den Schlüssel) und dort `Start-Windows.bat` doppelklicken.
- Wer die neue Version über den alten Ordner entpackt: `Start-Windows.bat` erkennt die neue
  Version und baut Oberfläche und Pakete beim nächsten Start selbst neu.

## Depot und Risiko (Seite 5 DEPOT)

**PORT** zeigt das eigene Depot: Depotwert, Ergebnis heute und seit Kauf, jede Position mit Kurs,
Wert, Gewicht und Gewinn/Verlust sowie die Aufteilung nach Branchen, Ländern und Währungen.
- **＋ Position**: Ticker, Stückzahl, Einstandskurs und Kaufdatum (beides freiwillig) eintragen.
  Gibt es den Wert schon, werden Stück und Durchschnittskurs zusammengeführt. Negative Stückzahl
  = Leerverkauf. ✎ bearbeitet, ✕ löscht eine Position.
- **Import**: Liste einfügen, eine Zeile je Position (`SAP GR; 20; 182,50; 15.03.2024`), auch
  direkt aus Excel kopiert. **Export CSV** speichert das Depot als Datei für Excel.
- **Basis** wählt die Währung für alle Beträge (EUR, USD, CHF, GBP); Kurse in anderen Währungen
  werden umgerechnet. Mit Kaufdatum zählt das Ergebnis den Währungseffekt seit dem Kauf mit.
- **Kasse**: Bargeld bzw. Verrechnungskonto in Basiswährung.

**RISK** zeigt, wie riskant das Depot ist: Schwankung pro Jahr, Beta zum Vergleichsindex,
größter Rückgang im letzten Jahr, Value at Risk und Expected Shortfall (95 %, ein Tag), Rendite
gegen den Index, den **Risikoanteil** jeder Position (welche Werte das Risiko treiben) und die
Korrelationen der größten Positionen. Gerechnet wird mit den heutigen Stückzahlen über das letzte
Jahr (historische Simulation). Die Begriffe erklären sich per Tooltip und im Glossar (HELP).

Gespeichert wird das Depot auf dem eigenen Rechner im Benutzerordner unter `.market-terminal`
(Windows: `C:\Users\<Name>\.market-terminal\depot-eodhd.json`, im Demo-Modus `depot-demo.json`).
Es bleibt deshalb auch bei einer neuen Programmversion und nach „⟲ STANDARD“ erhalten. Im
Demo-Modus startet ein Muster-Depot zum Ausprobieren. Der KI-Assistent kann das Depot lesen
(„Wie riskant ist mein Depot?“), aber nicht verändern.

## Weltkarte (WMAP)

Die Weltkarte färbt rund 35 Länder nach einer Kennzahl ein; daneben steht die Rangliste.
- **Aktien:** Wertentwicklung des wichtigsten Index je Land heute, über 1 Woche, 1 Monat oder seit
  Jahresbeginn (grün steigend, rot fallend, in Landeswährung).
- **Zinsen:** Rendite der zehnjährigen Staatsanleihe oder ihre Veränderung über einen Monat in
  Basispunkten (steigende Renditen rot).
- **Konjunktur:** BIP-Wachstum, Inflation, Arbeitslosigkeit, Staatsschulden und Realzins
  (Jahreswerte, Weltbank-Basis; grün = günstig, rot = ungünstig).
- Ausschnitte Welt, Europa, Amerika, Asien/Pazifik. Mit der Maus über ein Land zeigt Wert und
  Index bzw. Anleihe, ein Klick öffnet den Index- bzw. Renditechart (Konjunktur: ECST).
- Mit EODHD zeigt `EODHD-pruefen-Windows.bat`, ob alle Länderindizes und Anleihen im Plan
  enthalten sind; fehlende Länder bleiben auf der Karte grau.

## Optionen (OMON)

Für US-Aktien und -ETFs, z. B. `AAPL US OMON` (Demo: `NWND OMON`). Tagesenddaten.
- **Übersicht:** implizite Volatilität 30 Tage gegen die tatsächliche Schwankung (IV/HV: sind
  Optionen teuer?), **erwartete Bewegung** bis zum gewählten Verfall (Straddle-Preis), Put/Call-
  Verhältnis, Skew (25 Delta), Max Pain; Open Interest je Strike (Calls grün nach oben, Puts rot
  nach unten), Volatilität nach Laufzeit, Strikes mit dem größten Open Interest als Widerstand
  bzw. Unterstützung, auffällige Umsätze (Volumen über Open Interest) und aktivste Kontrakte.
- **Kette:** Calls links, Strike in der Mitte, Puts rechts – Bid, Ask, letzter Preis, Volumen,
  Open Interest, IV und Delta, auf Wunsch alle Greeks; im Geld liegende Optionen hinterlegt,
  die Zeile am Geld markiert, Bereich ±10 %, ±20 % oder alle Strikes.
- **Volatilität:** Smile/Skew des Verfalls und alle Verfälle mit ATM-IV, erwarteter Bewegung,
  Skew, Put/Call und Max Pain (Klick wählt den Verfall).
- **Daten:** Bei EODHD sind Optionen ein **Zusatzprodukt** im Marketplace („US Stock Options
  Data API“, Anbieter Unicorn Bay), nur US-Werte, Tagesendstand; ein Abruf kostet 10 API-Calls
  je 1000 Kontrakte. `EODHD-pruefen-Windows.bat` zeigt, ob das Abo aktiv ist. Im Demo-Modus
  sind die Ketten berechnet – amerikanisch bewertet (Barone-Adesi/Whaley: kein Put unter seinem
  inneren Wert), mit Skew und höherer IV vor Quartalszahlen; Verfälle an US-Feiertagen am
  Handelstag davor.
- **Quartalszahlen:** Kachel mit dem nächsten Termin; der erste Verfall danach trägt ein **E**
  (Verfallsliste, Tabelle, Laufzeitkurve) – seine erwartete Bewegung enthält die Ereignisprämie.
- Gewählter Verfall bleibt je Wert gemerkt; Klick auf einen aktiven oder auffälligen Kontrakt
  öffnet dessen Kette, die Kette springt zur Zeile am Geld.
- Der KI-Assistent kann den Optionsmarkt einer Aktie lesen („Was preisen die Optionen für NWND
  ein?“).

## Terminkurse (FWD) und Futures

EODHD liefert keine Börsen-Futures und keine Devisen-Terminkurse. FWD **berechnet** deshalb, was
sich sauber aus Kassakursen und Zinskurven ableiten lässt, und kennzeichnet es so:
- **Devisen:** Terminkurse 1 Woche bis 2 Jahre, Swap-Punkte und Auf-/Abschlag pro Jahr nach der
  Zinsparität (die Währung mit dem niedrigeren Zins notiert per Termin teurer), mit Terminkurve.
- **Absicherung:** Was es pro Jahr kostet (−) oder bringt (+), Fremdwährungsanlagen gegen die
  Heimatwährung (EUR, USD, CHF oder GBP) abzusichern. Das Depot (PORT) zeigt dasselbe für seine
  Fremdwährungen und den Effekt einer vollständigen Absicherung.
- **Zinsen:** Vom Anleihemarkt eingepreiste künftige Zinsen (1Y1Y, 5Y5Y, 10Y10Y und die
  Einjahreszinsen der nächsten 15 Jahre) mit Veränderung zum Vormonat.

Als Zinsen dienen die Renditen kurzlaufender Staatsanleihen (3 Monate bis 2 Jahre). Echte
Futures (Index, Rohstoffe, Zinsen) sind mit der IBKR-Anbindung geplant: `docs/PLAN-FUTURES.md`.

## Echtzeit-Kurse und Intervalle

- **Intervalle:** In 1T und 5T wählt der Kurschart (GP) **1 Min, 5 Min, 15 Min oder 1 Std**
  (15 Minuten aus 5-Minuten-Kerzen gebildet). Die Einstellung bleibt gespeichert.
- **Echtzeit (Paket All-In-One):** Über den EODHD-WebSocket laufen **US-Aktien** (mit Vor- und
  Nachbörse), **europäische Aktien** (Cboe Europe: 18 Börsen, z. B. Xetra, London, Paris,
  Amsterdam, Schweiz), **Devisen** und **Krypto** in Echtzeit. Kopfzeilen, Watchlist, Depot,
  Alarme und die **laufende Kerze** im Chart folgen jedem Abschluss; im Chart steht „● Echtzeit“.
  Standardmäßig höchstens 50 Werte gleichzeitig: zuerst die geöffneten Panels, dann Alarme und
  Depot.
- **Ohne Strom (Indizes, Anleihen, Rohstoffe, Werte über der Grenze):** Das Terminal fragt die
  verzögerten Kurse minütlich ab, die laufende Kerze folgt mit Rückstand („verzögert“). Ist der
  Europa-Strom im Paket nicht enthalten, laufen europäische Werte automatisch verzögert weiter.
- **Minutenkerzen des laufenden Tages** liefert EODHD erst Stunden nach Börsenschluss; was der
  Strom seit dem Start des Terminals gesehen hat, füllt diese Lücke.
- **Demo:** ein simulierter Strom (jede Sekunde ein Kurs) mit denselben Regeln: Aktien, Devisen
  und Krypto live, Indizes verzögert.
- `EODHD-pruefen-Windows.bat` zeigt, ob Minutendaten und der WebSocket mit dem eigenen Schlüssel
  freigeschaltet sind (US, Europa, Devisen). `REALTIME=off` in der `.env` schaltet den Strom ab.

## Volumenprofil und Market Profile

- **VP im Kurschart (GP):** Häkchen „VP“ zeigt am rechten Rand, wie viel Umsatz auf jeder
  Preisstufe im gewählten Zeitraum lief (grün aus steigenden, rot aus fallenden Kerzen). Orange
  ist der **POC** (Preis mit dem meisten Umsatz), kräftig die **Value Area** mit 70 % des
  Volumens; POC, VAH und VAL stehen zusätzlich als Linien an der Preisachse. In 1T und 5T aus
  den Intraday-Kerzen des gewählten Intervalls, in längeren Zeiträumen aus Tageskerzen geschätzt.
- **TPO (Market Profile)**, z. B. `SAP GR TPO` oder `MP`: je Handelstag ein Profil aus
  30-Minuten-Buchstaben (A = erste halbe Stunde). Blau die erste Stunde (Initial Balance),
  hinterlegt die Value Area, orange der POC, ◆ der Schlusskurs, grüne Kante die Eröffnung.
  1, 3, 5 oder 10 Tage nebeneinander, Auflösung fein/mittel/grob, umschaltbar auf Volumen je
  Preisstufe. Darunter je Tag Eröffnung, Hoch, Tief, Schluss, erste Stunde, POC, Value Area,
  Volumen und die Lage der Eröffnung zur Value Area des Vortags (über/in/unter).
- Grundlage sind 5-Minuten-Kerzen (mit EODHD bis 10 Handelstage; „nur Haupthandel“ blendet vor-
  und nachbörslichen Handel aus). Echte Tick- oder Orderbuchdaten liefert EODHD nicht; die
  Verteilung innerhalb einer 5-Minuten-Kerze ist deshalb eine Annäherung. Devisen haben bei EODHD
  kein Volumen – dort gibt es nur die Buchstaben-Ansicht.

## Kursmarken und Alarme (ALRT)

Im Kurschart: **„＋ Marke“** setzt eine Marke mit Alarm, **„＋ Linie“** (oder Umschalt+Klick) nur
eine Linie ohne Alarm. Marken lassen sich mit der Maus **verschieben** (Linie greifen, Zeiger ↕).
Liegen Beschriftungen an der Preisachse zu dicht, bleibt nur die Linie; der Wert steht in der
Markenleiste unter dem Chart.

- **Im Chart (GP):** „＋ Marke“ drücken und in den Chart auf die gewünschte Höhe klicken. Die
  Linie erscheint sofort, mit Alarm (🔔). Liegt die Marke über dem Kurs, meldet sie sich beim
  Steigen darüber, sonst beim Fallen darunter. Unter dem Chart stehen alle Marken des Werts:
  🔔/🔕 schaltet den Alarm an oder aus (die Linie bleibt), ↻ schaltet einen ausgelösten Alarm
  wieder scharf, × löscht. Esc bricht das Setzen ab.
- **In ALRT:** Alarme anlegen („Kurs steigt über“, „Kurs fällt unter“, „Tagesplus/Tagesminus ab
  %“, „Kursmarke ohne Alarm“), mit Notiz. Die Liste zeigt Kurs, Abstand zur Marke und wann ein
  Alarm ausgelöst hat; darunter das Protokoll aller Auslösungen.
- **Meldung:** Der Server prüft im Hintergrund (Demo alle 15 s, EODHD jede Minute, einstellbar
  mit `ALERT_INTERVAL_SECONDS`), solange das schwarze Fenster offen ist. Ein ausgelöster Alarm
  erscheint unten rechts mit Ton, auf Wunsch auch als Windows-Benachrichtigung („Desktop-Hinweise
  erlauben“ in ALRT). Er meldet sich einmal und steht dann auf „ausgelöst“, bis man ihn wieder
  scharf schaltet. In der Statusleiste steht, wie viele Alarme scharf sind.
- Gespeichert wird wie das Depot im Benutzerordner (`.market-terminal\alarme-eodhd.json`).
  Jede Prüfung kostet bei EODHD je Wert mit scharfem Alarm einen API-Call; die Kurse sind meist
  15–20 Minuten verzögert.

## Signal bei wichtigen Nachrichten

Wichtige Meldungen melden sich mit **eigenem Ton** (anders als der Kursalarm) und einem Hinweis
unten rechts – auch wenn TOP gerade nicht offen ist. **„Lesen“** im Hinweis öffnet TOP mit der
Meldung in der Leseansicht. Eingestellt wird das in **TOP** in der Werkzeugleiste unter „🔔 Signal“:

| Einstellung | Bedeutung |
|---|---|
| **aus** | kein Signal |
| **Eilmeldungen** (Standard) | Meldungen mit EIL-Kennzeichen: drei schnelle, helle Töne, roter Hinweis ⚡ |
| **Eil + kursrelevant (KI)** | zusätzlich Meldungen, die die KI als kursrelevant einstuft (Relevanz ab 2 von 3): weicher Gong, Hinweis 📰. Braucht die KI-Einordnung (LM Studio oder Demo-KI) |
| **Watchlist + Depot** (Standard) / **alle Meldungen** | nur Meldungen zu eigenen Werten oder alle |
| **Ton** | Ton an oder aus (der Hinweis kommt trotzdem); ▶ spielt den Ton zur Probe |

- Gemeldet werden nur frische Meldungen (höchstens 30 Minuten alt), jede nur einmal. Beim
  allerersten Start gelten alle vorhandenen Meldungen als bekannt – es gibt keine Flut alter Hinweise.
- Bei mehreren Terminal-Fenstern (Multimonitor) klingelt nur eines.
- Liegt das Terminal im Hintergrund, kommt zusätzlich eine Windows-Benachrichtigung, sofern
  Desktop-Hinweise erlaubt sind (Schaltfläche „Desktop-Hinweise erlauben“ in ALRT).
- Das Terminal fragt jede Minute nach. Mit EODHD holt der Server neue Meldungen höchstens alle
  10 Minuten (EODHD liefert News je Wert, jeder Abruf kostet API-Calls). Ein Signal kann also bis
  zu 10 Minuten nach der Veröffentlichung kommen. News werden je Wert zwischengespeichert: TOP,
  CN, das Signal und weitere Fenster teilen sich dieselben Abrufe.

## Bewertungstrend (BWT): KGVs von Sektoren und Ländern über die Zeit

`BWT` (oder „KGV“, „Bewertung“, „Sektoren“ in die Befehlszeile tippen) zeigt, ob Sektoren und Länder
über die Jahre **teurer oder günstiger** geworden sind und **was die Analysten erwarten**.

| Spalte | Bedeutung |
|---|---|
| **KGV 2021 … 2025** | tatsächliche KGVs der Vorjahre: Kurs am Jahresende ÷ tatsächlicher Gewinn des Jahres |
| **heute** | heutiger Kurs ÷ Gewinn der letzten zwölf Monate |
| **2026e, 2027e** | heutiger Kurs ÷ Analystenkonsens (auf Kalenderjahre umgerechnet) |
| **Median 10 J. / Lage** | übliches KGV der letzten zehn Jahre und wo das KGV heute in dieser Spanne liegt (Kästchen links = günstig, rechts = teuer) |
| **Fair Value** | übliches KGV × Gewinnschätzung nächstes Jahr, verglichen mit dem Kurs (siehe KGV-Bänder) |
| **12 M** | Veränderung des KGV in einem Jahr (Punkte) |
| **Gewinn+** | erwartetes Gewinnwachstum nächstes Jahr |
| **Schätzung 90 T** | wie die Analysten ihre Gewinnschätzung fürs nächste Jahr in 90 Tagen verändert haben – oft der früheste Hinweis |
| **↑ / ↓ 30 T** | Zahl der Anhebungen und Senkungen in 30 Tagen |
| **Abst. Hoch** | Abstand zum 52-Wochen-Hoch; die Tabelle gliedert danach in Bärenmarkt (> 20 %), Korrektur (10–20 %) und nahe am Hoch |

- **Sektoren** für USA, Europa oder beide; **Länder** (USA, Deutschland, Frankreich, Großbritannien, Niederlande,
  Schweiz, Italien, Spanien) nach Region gegliedert.
- **Landkarte:** jede Gruppe als Punkt – waagerecht wie teuer im Vergleich zur eigenen Geschichte, senkrecht ob
  die Schätzungen steigen oder fallen. Vier Felder: Erholungskandidat, eingepreist, billig aus gutem Grund?, Vorsicht.
- **Klick auf eine Zeile:** KGV-Verlauf über zehn Jahre mit Durchschnitt und den Analystenpunkten, die Zerlegung
  „Kurse gegen Gewinne“ (warum das KGV gestiegen oder gefallen ist), der Verlauf des KGV aufs nächste Jahr und
  alle Einzelwerte im gleichen Aufbau.
- **Eigene Aufzeichnung:** Fertige Analystenhistorie gibt es nur für 90 Tage. Das Terminal speichert deshalb jeden
  Tag die Werte je Gruppe (Benutzerordner, `bewertung-verlauf-eodhd.json`); daraus wächst ein eigener Verlauf.

So wird gerechnet: KGV einer Gruppe = Börsenwert aller Firmen ÷ ihr Gesamtgewinn (wie bei Indexanbietern;
Verlustbringer mindern den Gewinn). Einbezogen sind die größten Firmen je Sektor (25) bzw. Börse (30) laut
Screener. Geschäftsjahre (z. B. bis Januar) werden anteilig auf Kalenderjahre verteilt. Die Datenquelle bereinigt
Kurse um Dividenden – für das KGV wird das zurückgerechnet; Splits und abweichende Einheiten (Pence, Bericht in
anderer Währung) werden erkannt und angeglichen.

Grenzen: Die Rückschau nutzt die heutige Zusammensetzung und Aktienzahl, heutige Gewinner sind also stärker
vertreten (gut für die Richtung, nicht auf die Kommastelle). Analysten schätzen nur das laufende und das nächste
Geschäftsjahr. Berechnet wird einmal täglich im Hintergrund (mit EODHD beim ersten Mal ein bis zwei Minuten,
etwa 600 Firmen; das kostet API-Abrufe, bleibt aber deutlich im Tageskontingent). `↻` rechnet sofort neu.
Der KI-Assistent ASK kann die Werte über das Werkzeug „bewertung“ abfragen.

## KGV-Bänder und Fair Value

Welcher Kurs entspräche dem **üblichen KGV**? Aus dem eigenen KGV-Verlauf der letzten zehn Jahre (Monatswerte)
werden Median sowie die Bereiche 25–75 % und 10–90 % bestimmt und als Kurslinien gezeichnet. Nach rechts laufen
sie mit den Gewinnschätzungen der Analysten bis Ende nächsten Jahres weiter.

- **Kurschart (GP), Schalter „KGV-Band“** (Aktien, Tageszeiträume): Median durchgezogen, 25–75 % gestrichelt,
  10–90 % gepunktet; daneben „KGV heute · üblich · Fair Value 2027 (Abstand)“.
- **DES:** „KGV üblich (10 J.)“ und „Fair Value“ im Block Bewertung.
- **BWT:** Spalten „Median 10 J.“ und „Fair Value“ (Plus = Kurs liegt darunter, Minus = darüber); im Detail die
  Ansicht „Kurs + KGV-Bänder“ (Kursindex der Gruppe, heute = 100) bzw. „KGV-Verlauf“ mit schattierten Bereichen,
  und je Einzelwert der Abstand zum Fair Value.

**Fair Value** = übliches KGV (Median) × Gewinnschätzung des nächsten Jahres. Median und Prozentränge statt
Mittelwert ± Standardabweichung, weil Gewinneinbrüche (2009, 2020) einzelne Jahre extrem machen.

**Drei Maßstäbe** (Kurschart-Kurzinfo und DES):

| Fair Value | Rechnung | Gut, wenn … |
|---|---|---|
| **eigenes KGV** | übliches KGV der Aktie × Gewinnschätzung | sich Geschäft und Zinsumfeld kaum geändert haben |
| **nach Sektor-KGV** | KGV des Sektors aufs nächste Jahr × Gewinnschätzung | die Firma dem Sektordurchschnitt ähnelt |
| **relativ zum Sektor** | übliches Verhältnis KGV Aktie ÷ KGV Sektor × heutiges Sektor-KGV × Gewinnschätzung | der ganze Sektor neu bewertet wurde (z. B. durch Zinsen), die Firma aber ihre übliche Prämie behält |

Das Sektor-KGV stammt aus BWT (Region nach Börse, bei zu wenigen Firmen USA + Europa) und wird **ohne die Aktie
selbst** gerechnet – sonst wäre der Sektor bei großen Firmen zum Teil die Firma selbst. Im Kurschart schaltet
„eigenes KGV / relativ zum Sektor“ die Basis der Bänder um. Hat der Sektor weniger als zwei andere Firmen, gibt es
keinen Sektorvergleich.

**Rückblick (Ehrlichkeitsprüfung):** Für jeden früheren Monat prüft das Terminal – nur mit dem bis dahin bekannten
Verlauf –, ob das KGV unten, in der Mitte oder oben lag, und wie sich der Kurs in den zwölf Monaten danach
entwickelte. „Band früher: hilfreich“ heißt: Nach einem Stand unten lief es im Schnitt besser als nach einem Stand
oben. Bei Zyklikern und Firmen im Umbruch taugen Bänder oft wenig; die Zeiträume überlappen sich, die Fallzahl ist
klein. Keine Empfehlung.

Grenzen: Ohne Gewinn (Verlustjahre) gibt es kein KGV und keine Bänder; mindestens zwei Jahre mit Gewinn sind
nötig. Ändern sich Geschäft oder Zinsumfeld dauerhaft, ist die eigene Geschichte ein schlechter Maßstab.

## Prognose mit Unsicherheitsbändern (Chronos-2)

Das Terminal kann Konjunkturdaten, Länderkennzahlen und die Schwankung einer Aktie vorausschätzen,
immer mit Bändern und einer **Ehrlichkeitsprüfung**. Kursrichtungen sagt es bewusst nicht voraus:
Dort schlägt kein Modell verlässlich die Regel „morgen wie heute“.

| Wo | Was |
|---|---|
| **ECST** | Land in der Tabelle anklicken: Verlauf der Kennzahl (Inflation, BIP-Wachstum …) mit Prognose für drei Jahre |
| **ECO** | Termin anklicken: frühere Veröffentlichungen, Prognose der nächsten drei und **Modell gegen Konsens** – samt der Angabe, wer bisher näher lag |
| **GP** | Schalter **Kegel**: erwartete Spanne der nächsten 21 Handelstage (gestrichelt ±1 Standardabweichung ≈ 68 %, gepunktet ±2 ≈ 95 %), ohne Richtung |
| **OMON** | Kennzahl **Schwankung Prognose** neben der impliziten Volatilität: liegt die IV über dem Band, preisen Optionen mehr Schwankung ein, als das Modell erwartet |
| **ASK** | Werkzeug „prognose“, z. B. „Wie entwickelt sich die Inflation in Deutschland?“ |

**So ist sie zu lesen:** gestrichelte Linie = Mittelwert (Median), dunkles Band = 50 %, helles Band =
80 % Wahrscheinlichkeit. Darunter steht das Ergebnis des **Rückblick-Tests**: Das Terminal rechnet an
bis zu 24 früheren Zeitpunkten so, als wäre die Zukunft unbekannt, und vergleicht mit dem, was
tatsächlich kam – gegen die einfache Regel „bleibt wie zuletzt“ und mit der Trefferquote der Bänder.
Waren die Bänder früher zu eng, werden sie verbreitert. „Rückblick: schwach“ heißt: Die Prognose war
früher nicht besser als „bleibt wie zuletzt“ – dann mit Vorsicht lesen.

**Zwei Methoden, Auto-Auswahl:** Die eingebaute Statistik (gedämpfter Trend) ist immer da.
**Chronos-2** (Amazon, frei nutzbar, läuft auf dem eigenen Rechner ohne Grafikkarte) ist meist genauer;
je Reihe nimmt das Terminal die Methode, die im Rückblick-Test besser war (Hinweis beim Darüberfahren
über das Kästchen „Chronos-2“/„Statistik“). Chronos-2 läuft nicht in LM Studio, sondern direkt im
Terminal-Server.

Chronos-2 einrichten (einmalig, ca. 1–2 GB Download):
1. Terminal einmal mit `Start-Windows.bat` gestartet haben.
2. **`Prognose-installieren-Windows.bat`** doppelklicken. Es installiert PyTorch und Chronos-2, lädt
   das Modell (ca. 0,5 GB) und macht eine Probe-Prognose.
3. Terminal neu starten (`Stop-Windows.bat`, dann `Start-Windows.bat`). Das Modell lädt beim Start im
   Hintergrund (rund 10 Sekunden); bis dahin rechnet die Statistik.

Danach braucht die Prognose kein Internet mehr. Speicher: etwa 1 GB Arbeitsspeicher, solange das
Terminal läuft. Einstellungen in der `.env`: `FORECAST_MODE=auto` (Standard), `simple` (nur Statistik)
oder `off`. Wird der Programmordner neu angelegt (neue Python-Version), die Installation wiederholen.

Grenzen: Die Modelle kennen nur den bisherigen Verlauf, keine Politik, Nachrichten oder Ereignisse.
Bei Notenbankzinsen ist „bleibt wie zuletzt“ meist schwer zu schlagen; der Analysten-Konsens liegt bei
Konjunkturdaten oft näher als jedes Modell – das zeigt ECO offen an. Keine Anlageberatung.

## KI-Helfer mit LM Studio

Das Terminal kann ein Sprachmodell nutzen, das auf dem eigenen Rechner in
[LM Studio](https://lmstudio.ai) läuft. Es gibt keinen Cloud-Dienst und keine Kosten pro Anfrage;
die Daten verlassen den Rechner nicht.

| Funktion | Was sie tut |
|---|---|
| **KI-Einordnung in TOP/CN** | Zu jeder Meldung: Zusammenfassung, Stimmung (−1 bis +1), Ereignisart, betroffene Werte und Branchen, Relevanz 0–3 (Punkte ●●● in der Liste). Filter „KI: kursrelevant“. Läuft im Hintergrund, die gerade gelesene Meldung zuerst. |
| **BRIEF** | Morgenbriefing: Märkte, Ihre Werte (Watchlist), Termine heute, Zinsen und Devisen. Jeder Punkt nennt seine Quelle; Kürzel wie WEI oder ECO öffnen sie. |
| **ASK** | Fragen in eigenen Worten („Ist SAP teuer im Vergleich zur Branche?“). Die KI holt sich die Zahlen über die Terminal-Funktionen, zeigt unter „Verwendete Daten“, was sie abgefragt hat, und markiert Zahlen ohne Beleg gelb. Vorschläge wie „→ SAP GR GP“ öffnen erst per Klick. |

Einrichten (einmalig):
1. LM Studio installieren und ein Modell laden, das Werkzeuge beherrscht – etwa **Qwen 3 8B**,
   **Llama 3.1 8B Instruct** oder **Mistral Small** (in LM Studio mit Hammer-Symbol gekennzeichnet).
   Faustregel: 8B-Modelle brauchen etwa 6–8 GB Grafik- oder Arbeitsspeicher.
2. In LM Studio links **„Developer“** öffnen und **„Start Server“** einschalten.
3. **`LLM-pruefen-Windows.bat`** doppelklicken (Mac/Linux:
   `cd backend && .venv/bin/python -m scripts.verify_llm`). Das Programm prüft Server, Modell,
   JSON-Ausgabe und Werkzeuge, misst die Zeiten und gibt Empfehlungen.
4. Terminal starten. Unten rechts steht dann **„KI: LM Studio · Modellname“**.

Ohne LM Studio übernimmt im Demo-Modus eine **regelbasierte Demo-KI** (Anzeige „KI: Demo“): Sie
zeigt, wie alles aussieht, versteht aber nur einfache Fragen – zu einem Wert, Optionen, größten
Bewegungen, Zinskurven, Devisenterminen, Terminen, Depot und Alarmen. Begriffsfragen („Was ist
eine Put-Option?“) beantwortet das Glossar. Mit echten EODHD-Daten und ohne
LM Studio steht „KI: offline“, die übrigen Funktionen laufen normal weiter.

Einstellungen in der `.env` (alle optional): `LLM_MODE` (`auto` Standard, `lmstudio`, `demo`,
`off`), `LLM_BASE_URL` (Standard `http://localhost:1234/v1`; LM Studio auf einem anderen Rechner:
dessen Adresse eintragen und dort „Serve on Local Network“ aktivieren), `LLM_MODEL` (leer = erstes
geladenes Modell), `LLM_TIMEOUT_SECONDS`, `LLM_MAX_CONCURRENCY`, `LLM_MAX_STEPS`.

Grenzen und Sicherheit: Die KI hat nur **lesende** Werkzeuge. Sie kann nichts kaufen, verkaufen
oder im Terminal verändern. Meldungstexte gelten für sie als Daten, nicht als Anweisungen. Ihre
Einschätzungen sind automatische Hilfen, **keine Anlageberatung**. Lokale Modelle irren sich.
Deshalb nennt jede Antwort ihre Datenquellen und markiert unbelegte Zahlen.

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
- **Länder im Befehl:** `IT GC` (oder `GC IT`), `FWD DE`, `ECO US`, `ECST DE`, `WMAP JP` – die
  Funktion zeigt gleich dieses Land. Ein Klick auf ein Land in der Weltkarte stellt es in GC
  (Zinsen) bzw. ECST (Konjunktur) ein.
- **Seite DEPOT:** Das Depot-Panel bleibt stehen; eine dort eingetippte Funktion öffnet im
  Nachbarpanel.
- **Screener (EQS):** Der zuletzt ausgeführte Screen bleibt nach dem Neuladen erhalten;
  „→ Watchlist“ übernimmt die ersten 20 Treffer.
- **Demo-ETFs:** `XDAX GR` (DAX), `XSX5 GR` (Euro Stoxx 50), `XSPX US` (S&P 500), `XNDX US`
  (Nasdaq 100), `XFTS LN` (FTSE 100) – fiktive Indexfonds, die sich ins Depot legen lassen.
- **Gespeichert wird automatisch** (im Browser): Watchlist, Layouts, Panels, Chart- und
  Filtereinstellungen bleiben nach dem Schließen erhalten. **⟲ STANDARD** oben setzt wahlweise
  die aktuelle Seite, die ganze Ansicht (Watchlist bleibt) oder alles auf den Auslieferungszustand
  zurück.
- **Alt+1–5** Seiten · **Alt+←/→** aktives Panel · **Alt+M** Panel maximieren · **Alt+L** Layout ·
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
   │  HTTPS (Key nur im Backend)          │  /api/ai/* → OpenAI-kompatibel (lokal)
EODHD API                                  LM Studio (http://localhost:1234/v1)
```

- `backend/app/eodhd/client.py` – Retry mit Backoff (429/5xx/Timeout), Fehlerübersetzung
  (401 Key, 402/403 Plan, 404 Ticker), Tagesbudget.
- `backend/app/eodhd/mapping.py` – tolerante Übersetzung der EODHD-Antworten (Strings als
  Zahlen, fehlende Felder, Split-bereinigte OHLC).
- `backend/app/providers/demo.py` – synthetische Daten im EODHD-Rohformat, laufen durch
  dasselbe Mapping wie echte Daten.
- `backend/app/services/terminal.py` – Caching, Makro-Aggregation, Screener (serverseitige
  EODHD-Filter + lokale Filter für KGV und technische Kennzahlen).
- `backend/app/ai/` – KI-Helfer: `client.py` (LM-Studio-Client, fängt `<think>`-Abschnitte, JSON
  in Codeblöcken und Server ohne JSON-Schema ab), `news.py` (Einordnung mit Hintergrund-
  Warteschlange), `brief.py`, `agent.py` (Werkzeugschleife mit Schrittgrenze und Zahlenprüfung),
  `tools.py` (nur lesende Werkzeuge über die Terminal-Dienste), `demo.py` (regelbasierte Demo-KI),
  `service.py` (Wahl LM Studio / Demo / aus). Plan und Hintergründe: `docs/PLAN-KI-AGENT.md`.
- `backend/app/portfolio/` – Depot: `store.py` (JSON-Datei mit Versionsprüfung gegen Überschreiben
  aus einem zweiten Fenster), `analytics.py` (Wert, Ergebnis, Währungsumrechnung über die
  Devisenkurse, Risiko per historischer Simulation, Muster-Depot). Endpunkte `/api/portfolio`
  und `/api/portfolio/analytics`.
- `backend/app/alerts/service.py` – Kursalarme: Datei, Prüfschleife im Hintergrund, einmaliges
  Auslösen mit Protokoll; Endpunkte `/api/alerts`.

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

`backend/tests/test_ai.py` simuliert LM Studio (feste Antworten, Werkzeugaufrufe, Server ohne
JSON-Schema, Ausfall) und braucht kein Sprachmodell.

Nach Änderungen an der Oberfläche `frontend/public/BUILD-VERSION` anpassen: Daran erkennen die
Startdateien, dass sie die Oberfläche neu bauen müssen.

## Statische Demo

Die REST-API ist unter `/docs` dokumentiert (OpenAPI); `/api/history/{ticker}?from=…&to=…`
liefert einen Zeitraum.

`npm run build:static` (im Ordner frontend) plus
`python -m scripts.export_static ../frontend/dist-static/data` (im Ordner backend) erzeugt
eine Version ohne Backend, die alle Demo-Daten als JSON mitbringt. Die KI-Teile sind dort mit
der Demo-KI vorab berechnet; ASK beantwortet nur die Beispielfragen.

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
