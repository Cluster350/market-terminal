# Stellungnahme C (Verständlichkeit) zu A und B

## 1. Antworten auf eure Fragen
**A2 – Reicht „GIER“ plus Satz?** Nein. Ein Wort in Großbuchstaben liest sich wie ein Urteil. Nötig sind: ein dauerhafter Einzeiler unter dem Gesamtwert („Stimmung ist meist ein Gegenindikator – keine Empfehlung“) und in den Extremzonen (<P10 / >P90) ein zusätzlicher Satz im Panel, nicht nur ein Rahmen. Achtung bei As eigener Fußzeile: „Extremwerte eher Warnung (Gier) bzw. Chance (Angst)“ ist genau der Signal-Klang, den Laien als Handlungsanweisung lesen. Mein Vorschlag: „Sehr hohe oder sehr niedrige Werte kippten früher eher ins Gegenteil – oft erst nach Monaten.“

**B2 – Verstehen Laien „Perzentil 12“?** Nein. Hauptsatz: „niedriger als an 88 von 100 Tagen seit 2016“ (von-100 ist greifbarer als %). „P12“ nur als kompakte Spalte und im Tooltip. Blau/Magenta ist ohne Legende **nicht** selbsterklärend → Legende immer sichtbar (Bs 120-px-Verlauf mit „Angst · neutral · Gier“) und das Wort steht immer neben der Farbe.

**A3 / B3 – Gewichtung, Rückblick, Basis:** Gleich gewichtet, aber transparent mit Bs Zerlegung (Beitrag je Baustein, „aus 5 von 7 Bausteinen“). Rückblick nur maximiert. Basis: feste 10 Jahre; rollierend 3 J. verwirrt Laien („gestern war 40 ängstlich, heute ist 40 neutral?“).

## 2. Wo ich überzeugt wurde
- **Kein Amber** für Gier: Amber ist Beschriftung (B hat recht).
- **Skalenbalken statt Tacho** (B) mit hohlen Marken für 1 W/1 M – das deckt As Wunsch nach Richtung ab.
- **Zerlegung mit Beitrag** (B): beantwortet die Laienfrage „warum steht da 72?“ besser als mein Text.
- **Fehlende Daten sichtbar** (B: „–“, Stand-Datum, Gewicht verteilt sich sichtbar).
- **Klick auf Baustein → GP/BWT/OMON** (A): Erklärung führt zur Quelle.
- **Kürzel STIM** (A, auch mein Vorschlag), Aliasse SENT/MOOD/„Angst“.

## 3. Wo ich widerspreche
- **A: Rot–Grün und „EXTREME GIER“ in Versalien** – siehe 4b; Wörter klein und beschreibend („sorglos“, „ängstlich“) statt CNN-Jargon.
- **A: Rückblick „n=38“** – überlappende Tage sind keine 38 unabhängigen Fälle. Zählen nach Episoden, Streuung (mittlere 80 %) zeigen, Vergleich „alle Tage“ daneben.
- **B: Streupunkte aller Fälle** sind für Laien gut, aber nur mit Satz darüber: „Jeder Punkt eine frühere Episode; die Hälfte lag zwischen … und …“. Ohne Satz liest man nur den Median.
- **B: Heatstrip über S&P** ist gut, aber Fußnote nötig: „Zeitgleich ≠ Ursache.“
- **A: Tacho-Platz** lieber für den Lagetext (2 Sätze) – der ist für Laien der eigentliche 10-Sekunden-Blick.

## 4. Die drei Hauptkonflikte
**(a)** **Bs Skalenbalken**, links davon As große Zahl + Wort + Von-100-Satz. Ein Tacho weckt Auto-Assoziation („roter Bereich = gefährlich“) und kostet Höhe.

**(b)** **Bs Blau–Grau–Magenta**, mit zwei Auflagen: (1) Rot/Grün sind belegt (fallend/steigend) und Rot wird als „verkaufen“ gelesen – ausgeschlossen. (2) Blau liegt nahe `--link` (#66b8ff): Skalenfarbe **nur als Fläche/Marke**, nie als Textfarbe – Wörter bleiben `--value`. Grau bis P30–P70 (wie `dotStyle`), so wird Farbe selbst zum Hinweis „ungewöhnlich“, nicht „gut/schlecht“. Magenta statt Rot vermeidet auch Alarm-Lesart bei Gier.

**(c)** **Schwung nicht in den Gesamtwert.** Er ist Trendfolge: Hoher Schwung war historisch eher Fortsetzung, nicht Umkehr. Im Gegenindikator-Wert widerspricht er der Lesart, die wir erklären. Er bleibt als eigene Zeile unter einer Trennlinie „Zum Vergleich: Trend (kein Stimmungsbaustein)“, ohne Skalenfarbe. Gesamtwert damit aus VIX, Breite, Hochs/Tiefs, Häfen, Kredit, (Put/Call); News-Ton prüfen wir im Rückblick, bevor er mitzählt. Folge: Wir nennen ihn nicht „wie CNN“.

## 5. Viertelpanel vs. maximiert
**Viertelpanel (Pflicht):** Gesamtzahl + Wort + Von-100-Satz · Skalenbalken mit Marke 1 W · ein Satz Lagetext · Bausteintabelle (Name, Wert, Rang-Balken, Pfeil 1 W; Erklärung als Tooltip) · Einzeiler „Gegenindikator – keine Empfehlung“ · Stand-Datum.
**Nur maximiert:** Zerlegung mit Beitrag · Heatstrip + S&P · Small Multiples · Breite-Heatmap · VIX-Laufzeitkurve · Rückblick mit Episoden/Streuung · Region-/Zeitraum-Schalter · Schwung-Vergleichszeile.

## Zusammenfassung
Ich übernehme Bs Skalenbalken, Bs Blau–Grau–Magenta (nur als Fläche, nicht als Text) und Bs transparente Zerlegung; Amber als Stimmungsfarbe gebe ich auf. Gegenüber A bestehe ich auf Verzicht auf Rot/Grün, auf Wörtern ohne Handlungsklang („Chance“, „Warnung“) und auf Rückblick-Fallzahlen nach unabhängigen Episoden. Schwung zählt nicht zum Gesamtwert, sondern steht getrennt als Trend-Vergleich. Rang wird für Laien als „an X von 100 Tagen“ formuliert, mit fester 10-Jahres-Basis. Das Viertelpanel liefert Zahl, Wort, Skala, einen Satz und die Bausteintabelle; alle Diagramme und der Rückblick sind maximiert.
