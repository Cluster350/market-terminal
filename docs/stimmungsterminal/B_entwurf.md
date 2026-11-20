# Entwurf B – Datenvisualisierung: Stimmungsterminal „SENT“

Gesehen (Screenshots in `design/b/`): WEI, CRYP, FCTR, RRG, BWT, DCF, ECST mit Prognose, QBIT GP mit Trend-Scan. Was das Terminal schon gut macht und ich übernehme: graue Grundfarbe, Farbe erst bei Auffälligkeit (`dotStyle`: grau → kräftig ab Rang 90 %), ehrliche Bänder (DCF-Histogramm P10/P90, ECST-Prognosefächer mit „Rückblick: schwach“), Gitter `#171717`, Achsen `#8f8f8f`, Plex Mono 10 px. Schwächen: FCTR-Linienknäuel (9 Farben, 1 Achse), ECST-Balken ohne Einordnung.

## Leitprinzip
Jeder Indikator spricht dieselbe Sprache: **Rohwert + Perzentil-Rang (10 Jahre) + gleiche Zeitachse**. Die Farbe kodiert nur „wie extrem im Vergleich zur eigenen Geschichte“, nie „gut/schlecht“ – Stimmung ist Gegenindikator.

## Indikatoren
| Indikator | Hauptzahl | Verlauf | Einordnung | Index-Bezug |
|---|---|---|---|---|
| **VIX** | 13,4 · „P12“ | 1 J., **log-Achse** (VIX ist schief) | rollierendes P10–P90-Band grau hinterlegt | S&P darunter, Spitzen > P95 als senkrechte Haarlinien |
| **VIX/VIX3M** (falls verfügbar) | 0,87 | 1 J. | Linie bei 1,0; Bereich > 1 (Inversion) zart getönt | „x Tage invertiert seit 2016“ |
| **Breite % > 200T** (USA/EU) | 64 % | 2 J., feste Achse 0–100 | P10/P90-Linien gestrichelt | S&P gleiche x-Achse; Divergenz sieht man direkt |
| **Steigend/fallend** | kumulierte A/D-Linie | 1 J. | – | Index normiert darübergelegt (2 Linien, nicht mehr) |
| **52W-Hochs/-Tiefs** | +38 netto | 1 J., Hochs als Balken nach oben, Tiefs nach unten | Perzentil des Nettowerts | – |
| **Sektorbreite** | Heatmap Sektor × Woche (26 W.) | – | Zellfarbe = Perzentil | Stil wie FCTR-Korrelationsmatrix |
| **Sichere Häfen** | SPY−TLT 20T: +3,1 Pp | 2 J., Fläche um 0 | P-Rang | – |
| **Kredit HYG/IEF** | Verhältnis, 20T-Änderung | 2 J. | P-Rang, Hinweis „Näherung“ | – |
| **Schwung** | S&P vs. 125T: +4,2 % | 3 J., Fläche um 0 | P-Rang | ist selbst Index-basiert |
| **Put/Call (Näherung)** | 10-T-Schnitt 0,82 | 1 J.; Tageswerte als blasse Punkte | P-Rang | **keine invertierte Achse** – Farbe trägt die Bedeutung |
| **News-Stimmung** | 20-T-Mittel +0,12 | 6 M.; Tagespunkte, **Größe = Artikelzahl**, wenige Artikel = blass | P-Rang nur ab 1 J. Historie | – |

„Wie oft war es so extrem?“ steht als Satz unter jeder Zahl: „In 10 Jahren an 7 % der Tage niedriger (Basis 2.510 Tage).“ Kurze Historie → Basis offen nennen, Rang grau statt farbig.

## Gesamtwert „Angst und Gier“
**Kein Tacho.** Stattdessen ein **horizontaler Skalenbalken 0–100** (Bullet-Bar): Verlaufsspur, kräftige Marke für heute, hohle Marken für vor 1 W./1 M./1 J. (Bewegung statt Momentaufnahme), graues Band = Spannweite der letzten 12 Monate. Begründung: lineare Position ist die genaueste Wahrnehmungsaufgabe (Cleveland/McGill), Winkel die schlechteste; Platz in der Breite statt Halbkreis-Leerfläche; im Quad-Panel 1 Zeile hoch.

Darunter **Zerlegung als Punktdiagramm**: jede Zeile ein Baustein auf derselben 0–100-Achse, Punkt in Skalenfarbe, Pfeil vom Monatswert. Rechts Beitrag in Punkten (gleich gewichtet: Baustein/n). So sieht man sofort, ob „Gier 72“ breit getragen oder von einem Ausreißer kommt. Fehlende Bausteine stehen als Zeile „– keine Daten“ und das Gewicht verteilt sich sichtbar um („aus 5 von 7 Bausteinen“).

Historie: **Streifen** (Heatstrip, wie Warming Stripes) über 5 Jahre, 1 Pixel-Spalte je Tag, direkt **über der S&P-Linie** auf gleicher x-Achse. Dazu Rückblick-Tabelle: S&P nach 1/3/6 M. bei Wert < 20 bzw. > 80, als **Streupunkte aller Fälle + Median, mit N** – kein einzelner Durchschnitt (überlappende Fälle ehrlich ausweisen).

## Farbskala
Divergierend, fließend, durch Grau: **Angst = Blau `#4a9eff` ← Grau `#8f8f8f` → Gier = Koralle/Magenta `#ff5fa2`**. Blau–Magenta ist für Rot-Grün-Schwäche (Deutan/Protan) trennbar und in Helligkeit symmetrisch. Bewusst **nicht** Grün/Rot (im Terminal = Kurs steigt/fällt) und **nicht Amber** (reserviert für Beschriftung). Abbildung über den Perzentil-Rang wie `dotStyle`: P30–P70 grau, volle Sättigung ab P10/P90, zusätzlich größere Marke ab P5/P95 → doppelte Kodierung (Farbe + Größe), funktioniert auch in Graustufen. Legende einmal oben als 120-px-Verlaufsbalken „Angst · neutral · Gier“ mit Ticks 10/50/90.
**Fehlende Daten:** Lücke in der Linie (nie interpolieren), im Streifen schraffiert dunkelgrau, Zahl „–“ plus „Stand 14.11.“; veraltete Werte (> 3 Handelstage) in `--dim`.

## Small Multiples statt Großdiagramm
Startansicht: **Raster aus Kacheln gleichen Formats** (2×4 bei Max), jede: Titel amber, Hauptzahl, P-Rang, 1-J.-Sparkline mit P10–P90-Band, gemeinsame x-Achse (gleiche Daten­spanne!), eigene y-Achse. Klick → Detail im selben Panel (keine neuen Knöpfe). Abstände: 8 px Rinne, 1 px `--rule`, keine Kästen-in-Kästen.
**Quad-Panel (~640×330):** Bullet-Bar, darunter Tabelle `Baustein | Wert | P-Balken | 1-J.-Farbstreifen` – Streifen statt Linien, weil sie bei 16 px Höhe noch lesbar sind.

## Skizze (maximiert)
```
SENT Stimmung   [USA|Europa]  [1J|3J|5J]            Stand 20.11. CSV
ANGST UND GIER  62  „leichte Gier“  ·  in 10 J. an 71 % der Tage niedriger
0 |▓▓▓▓▒▒░░░░░░░░░░░▒▒▒▓▓▓▓|100   ● heute  ○1W ○1M ○1J  [▬▬12M▬▬]
BAUSTEINE (0–100)            0     25     50     75    100   Beitrag
 VIX (P12)                   ·      ·      ·   ○→●   ·     +11
 Breite >200T               ·      ·   ○──→●   ·     ·      +9
 Hochs/Tiefs                ·      ·      ●←○   ·     ·      +8 ...
 Put/Call                   – keine Daten (5 von 7) –
STREIFEN 5J ▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌
S&P 500     ____/‾‾\__/‾‾‾‾\___/‾‾‾‾‾‾‾  (gleiche x-Achse)
┌VIX────┐┌BREITE─┐┌HOCH/TIEF┐┌HÄFEN──┐
│13,4 P12││64% P58││+38 P66 ││+3,1 P70│
│~~band~~││~~~~~~~││▁▃▅▂▁▃  ││~~~~~~~ │
└────────┘└───────┘└────────┘└───────┘  (+ Kredit, Schwung, P/C, News)
Fußzeile: Gegenindikator, wirkt über Monate · Näherungen markiert · keine Empfehlung
```

## Schlechte Praxis (vermeiden)
3D- oder Halbkreis-Tachos mit Nadel; Ampeln ohne Skala und Basis; Rot/Grün für Stimmung (impliziert gut/schlecht); invertierte oder abgeschnittene y-Achsen ohne Hinweis; zwei y-Achsen mit frei gewählter Skalierung (scheinbare Korrelation); Mittelwert ohne N und Streuung; Glätten/Interpolieren über Datenlücken; Linienknäuel mit > 4 Farben (siehe FCTR); Perzentile über unterschiedliche Basiszeiträume ohne Angabe.

## Offene Fragen
1. **An A:** Braucht der Profi die Rohwerte (VIX 13,4) prominent oder reicht der Perzentil-Rang als Hauptzahl – und welche Zeiträume (1T/1W) gehören in die Kachel?
2. **An C:** Verstehen Laien „Perzentil 12“ – oder besser „seltener als 88 von 100 Tagen“ (analog `vsRandomText`)? Und ist Blau=Angst/Magenta=Gier ohne Legende intuitiv genug?
3. **An beide:** Basiszeitraum der Einordnung: feste 10 Jahre (vergleichbar) oder rollierend 3 Jahre (aktueller Markt-„Normalzustand“)? Ich bevorzuge 10 J. fest, mit Schalter nur im Detail.
