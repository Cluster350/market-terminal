# Stellungnahme B (Datenvisualisierung)

## 1. Antworten
- **A1 (Tacho oder Balken?):** Balken. Ein Tacho braucht für dieselbe Genauigkeit doppelt so viel Fläche, und Winkel liest man schlechter als Positionen. Den Wiedererkennungswert liefern große Zahl, Wort und Balken in derselben linken Spalte.
- **A3:** Der Gesamtwert ist ein gleich gewichtetes Mittel der Perzentile. Die Zerlegung ist maximiert immer sichtbar, nicht aufklappbar. Den Rückblick gibt es nur maximiert, im Viertel steht nur die Plakette.
- **C2 (S&P ohne Scheinursache):** Keine zweite Linie und keine zweite y-Achse. Der S&P steht dünn, grau und logarithmisch in einem eigenen Streifen darunter, auf gemeinsamer x-Achse. Extreme Phasen erscheinen als blasse senkrechte Bänder durch beide Streifen. Dazu der Satz: „Bänder zeigen nur, wann die Stimmung extrem war.“
- **C3:** Die Horizonte 1, 3 und 6 Monate werden fest und immer gemeinsam gezeigt, nicht wählbar. Erst die Wahlfreiheit erzeugt das Rosinenpicken.

## 2. Davon wurde ich überzeugt
- **Episoden statt Tage (C)** mit der Vergleichszeile „alle Tage“ und der Plakette deutlich/schwach/zu wenig Fälle.
- **Wortstufen und verbotene Verben (C).** Die Farbe bleibt fließend, das Wort gibt die Stufe an.
- **Viertel = Tabelle (A).** Meine Sparkline-Kacheln gibt es nur maximiert.
- **Richtung (A):** eine Spalte Δ 1 W und eine hohle Vorwochen-Marke auf jedem Rang-Balken.
- **Klick → GP/BWT/CN und KPI-Leiste (A).** Basis „seit 2015“ (C) statt „10 Jahre“.

## 3. Widerspruch
- **Rot–Grün (A):** Im Terminal bedeutet Grün „steigt“. Gier in Grün liest sich wie „kaufen“; der nötige Amber-Rahmen zeigt genau dieses Problem. Rot/Grün ist zudem die häufigste Farbsehschwäche.
- **Blaugrau–Amber (C):**
  - Amber ist die Farbe für Beschriftungen und die Standardfarbe einzelner Reihen (BWT-Lage, ECST-Balken, Prognosefächer). Jedes ECST-Diagramm hieße dann „sorglos“.
  - Blaugrau ist schwächer gesättigt als Amber. Die Angst-Seite wirkt dadurch kleiner. Divergierende Pole müssen gleich hell und gleich kräftig sein.
- **Heatmap Sektor × Region (A):** Sie ist nur eine Momentaufnahme. Besser ist Sektor × Woche (26 W.); die Region wählt man per Schalter.

## 4. Vorschlag zu den Hauptkonflikten
**(a)** Ein Skalenbalken 0–100 mit fließender Spur, Marke für heute und hohlen Marken für 1 W und 1 M. Darüber stehen groß Zahl und Wort, in As linker Spalte. Jeder Baustein bekommt denselben Balken in klein, also gibt es nur eine Kodierung im ganzen Panel. Ein Tacho bräche diese einheitliche Lesart.

**(b) Blau ↔ Grau ↔ Magenta-Rosa:**
- Die Mitte ist #8f8f8f. Die Pole liegen etwa bei #5b8cff und #ff5fa2, gleich hell und deutlich vom Link-Blau #66b8ff abgesetzt.
- Die Skala ist rot-grün-sicher und kollidiert weder mit steigend/fallend noch mit Amber.
- Wie bei `dotStyle` bleibt der Bereich P30–P70 grau. Extreme bekommen eine größere Marke, damit sie auch ohne Farbe erkennbar sind.
- Vor der Umsetzung prüfen wir die Skala mit einer Farbenblind-Simulation.

**(c) Schwung kommt nicht in den Gesamtwert.**
- Ein Mittel aus Trendfolge und Gegenindikatoren lässt sich nicht deuten, weil sich beide bei Extremen teilweise aufheben. Außerdem wird doppelt gezählt, denn Breite und Hochs/Tiefs sind schon trendnah.
- Schwung steht stattdessen als abgesetzte Zeile „Trend (Kontext)“ mit grauem Balken. Im Kopf steht, wie viele Bausteine in den Gesamtwert eingehen. Eine Fußnote erklärt: „CNN rechnet Schwung mit.“
- Im Rückblick zeigen wir beide Varianten, aber das Ergebnis entscheidet nicht allein. Sonst wäre es wieder Rosinenpicken.

## 5. Viertel vs. maximiert
**Viertelpanel (≈640×330):**
- Kurzsatz „keine Empfehlung“ und Stand-Datum
- Zahl, Wort, Rang-Satz und Skalenbalken
- Bausteintabelle: Rohwert, Rang-Balken, Δ 1 W, fehlende Werte als „–“
- abgesetzte Schwung-Zeile
- Plakette „Rückblick: …“

**Nur maximiert:**
- KPI-Leiste und Lagetext
- Farbstreifen über dem S&P mit Extrem-Bändern
- Sparkline-Kacheln mit P10–P90-Band
- Heatmap Sektor × Woche und VIX-Laufzeitkurve
- Rückblick-Tabelle und Schalter

## Zusammenfassung
Von C übernehme ich die Zählung nach Episoden, die Wortstufen und die Verbregeln. Von A übernehme ich die Tabelle im Viertelpanel, die Vorwochen-Richtung und die Klick-Verknüpfungen. Den Tacho lehne ich ab. Stattdessen gilt ein Skalenbalken für den Gesamtwert und jeden Baustein, also eine einzige Kodierung. Bei der Farbe bleibe ich bei Blau–Grau–Magenta mit gleich hellen Polen, weil Rot/Grün und Amber im Terminal schon belegt sind. Schwung bleibt als Kontextzeile sichtbar, geht aber nicht in den Gesamtwert ein.
