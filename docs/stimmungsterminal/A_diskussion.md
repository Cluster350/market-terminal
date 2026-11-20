# Stellungnahme A (Profi-Händler-UX) zu den Entwürfen B und C

## 1. Antworten auf eure Fragen
- **B1 / C1 – Rohwert oder Rang als Hauptzahl?** Beides, aber mit fester Reihenfolge: **Rohwert groß, Rang direkt daneben** („13,4 · P12“). Händler kennen VIX 13 oder 30 auswendig. Ein reiner Rang wirkt auf sie wie eine Black Box. Δ 1 W bekommt eine eigene schmale Spalte (Pfeil + Zahl). 1 T zeige ich nur maximiert, denn tägliche Stimmungswerte sind zu unruhig.
- **B3 – Basiszeitraum:** feste **10 Jahre** (bzw. ab 2015/16, so weit die Daten reichen), Basis immer genannt. Eine rollierende 3-Jahres-Basis gibt es nur in der Detailansicht.
- **C3 – Rückblick-Horizont:** Immer alle drei (1/3/6 M) in einer **festen** Tabelle, nicht wählbar. So kann niemand Rosinen picken. Die Urteils-Plakette bezieht sich auf 3 M. Schwung: siehe 4c.

## 2. Hier hat man mich überzeugt – mein Entwurf ändert sich
- **Kein Halbtacho.** Bs Skalenbalken mit hohlen Marken für 1 W/1 M/1 J liefert, was ich mit „Vorwoche 65 ↗“ wollte, nur besser: Man sieht die Bewegung, und er braucht im Viertelpanel nur eine Zeile.
- **Kein Rot/Grün.** Im Terminal heißt Grün/Rot steigend/fallend (WEI, CRYP, BWT). Stimmung in denselben Farben wäre ein Bedeutungsbruch, und Grün klänge nach „kaufen“.
- **Kein Amber-Rahmen für Extremwerte.** Amber ist für Beschriftungen und den aktiven Panel-Rahmen (`--label`, `--accent`) reserviert, Verwechslungsgefahr. Extreme kennzeichne ich stattdessen doppelt, wie B es vorschlägt: volle Sättigung plus größere Marke ab P5/P95, dazu das Wort „selten“.
- **Cs Sprachregeln** übernehme ich vollständig. In meinem Entwurf standen „Chance/Warnung“, das fliegt raus. Dazu kommen Episoden statt Tage und der Hinweis, dass der Rückblick „geschönt“ ist (heutige Firmenauswahl).
- **Kürzel STIM** (mit C), nicht SENT: Es ist deutsch und lässt sich nicht mit dem „Nachrichtenton“ verwechseln.

## 3. Wo ich widerspreche
- **C – lange Laiennamen als Zeilentitel** („Wie viele machen mit?“): Dafür ist das Viertelpanel zu schmal. Zeilentitel bleiben kurz (Angstbarometer (VIX), Marktbreite, Hochs/Tiefs, Sichere Häfen, Risikoaufschlag, Put/Call, Nachrichtenton). Laienname und Erklärung kommen in den Tooltip (`explain()`) und ins Glossar.
- **C – Kopfsatz immer sichtbar:** Zwei Zeilen Dauertext kosten im Viertelpanel 15 % der Höhe. Ich schlage vor: Der Kopfsatz steht in der Fußzeile (wie bei RRG/FCTR), oben nur **eine** Zeile Lagetext.
- **B – Spalte „Beitrag in Punkten“ und Small-Multiples-Raster:** gut, aber **nur maximiert**. Im Viertelpanel liest man Lage, nicht Arithmetik.
- **B – Blau `#4a9eff`:** Der Ton liegt zu nah an `--link` (#66b8ff). Blaue Zahlen sehen im Terminal anklickbar aus (DES: innerer Wert). Deshalb Farbe **nur auf Marken, Balken und Streifen**, Zahlen bleiben `--value`. Als Angstton ein gedämpfteres Stahlblau (z. B. #3f7fd0).

## 4. Vorschlag zu den drei Hauptkonflikten
**(a) Tacho vs. Skalenbalken:** **Skalenbalken (B)**. Davor steht links eine große Zahl (28 px) mit Wort, damit der Gesamtwert auch ohne Balken in einer Sekunde lesbar ist.

**(b) Farbskala:** **Blau – Grau – Magenta** (B), fließend über den Rang. Von P30 bis P70 bleibt alles grau, die volle Sättigung kommt erst ab P10/P90. Begründung: Grün/Rot ist durch Kursrichtung belegt, Amber durch Beschriftung (gegen C). Blau/Magenta ist bei Rot-Grün-Schwäche trennbar. Der Verlauf bekommt eine Legende mit 120 px Breite: „Angst · gewöhnlich · Gier“.

**(c) Schwung im Gesamtwert?** **Nein.** Der Gesamtwert soll als Gegenindikator lesbar sein. Schwung ist Trendfolge, er würde den Gesamtwert gerade in Trendphasen glätten oder verfälschen. Schwung bleibt **als Kontextzeile unter einer Trennlinie** stehen („Trend, nicht im Gesamtwert“), mit hohler grauer Marke und ohne Stimmungsfarbe. Der Gesamtwert sagt offen „aus 6 Bausteinen“ bzw. „5 von 6“, wenn Daten fehlen. Den Unterschied zum CNN-Original erklären wir im Glossar.

## 5. Viertelpanel vs. maximiert
**Viertelpanel (Pflicht):**
- große Zahl + Wort + Skalenbalken mit Marken heute/1 W/1 M
- eine Zeile Lagetext (C)
- Bausteintabelle: Kurzname · Rohwert · Rang-Balken · Δ 1 W
- Schwung als Kontextzeile
- Fußzeile „Beschreibung der Lage – keine Empfehlung“ + Stand
- Klick auf eine Zeile öffnet die maximierte Detailansicht. Keine Schalter.

**Nur maximiert:**
- Schalter USA/Europa und Zeitraum (`Seg`)
- Beitragsspalte, Small Multiples mit P10–P90-Band
- 5-Jahres-Streifen über S&P 500 (gleiche x-Achse, Hintergrundbänder statt zweiter Skala)
- Breiten-Heatmap Sektor × Woche
- VIX-Laufzeitkurve (falls verfügbar)
- Rückblick „Was folgte früher?“ mit Episoden und Plakette
- Tageswerte (1 T), rollierende Basis
