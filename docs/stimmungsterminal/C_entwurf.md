# Entwurf C – Stimmungsterminal (STIM), Schwerpunkt: Verständlichkeit

**Befund im Terminal** (Screenshots `design/c/`): Erklärt wird über `explain()`-Tooltips, graue Fußzeilen (RRG: „Auch Zufallskurse drehen … im Uhrzeigersinn“) und Rückblick-Plaketten mit Satz (ECST: „Rückblick: schwach“; KGV-Band: „im Schnitt +X % nach 12 Monaten, Y % im Plus (N Monate)“). Diese Muster übernehme ich. Probleme: Glossar-„Stimmung“ meint heute den Nachrichtenton – Verwechslung; VIX fehlt im Glossar; BWT/ECO färben hart rot/grün; Glossar „ETF: Demo enthält keine ETFs“ kollidiert mit HYG/TLT.

## 1. Der eine Satz (Kopfzeile, immer sichtbar)
> **„Wie ängstlich oder sorglos sind die Anleger gerade – verglichen mit allen Tagen seit 2015? Keine Kauf- oder Verkaufsempfehlung: Extreme Stimmung kippte früher eher ins Gegenteil, aber oft erst nach Wochen oder Monaten.“**

## 2. Indikatoren (Laienname · Erklärung · Lagesatz · Warnhinweis)
Lagesätze immer als **Rang („wie an X % aller Tage“)**, nie als Urteil. Wörter nach Perzentil: <5 % „extrem selten so ängstlich“, 5–20 „ängstlich“, 20–40 „eher vorsichtig“, 40–60 „gewöhnlich“, 60–80 „eher zuversichtlich“, 80–95 „sorglos“, >95 „extrem selten so sorglos“.

| Laienname (Fachname) | Ein Satz | Vorlage Lagesatz | Warnhinweis |
|---|---|---|---|
| **Angstbarometer** (VIX) | Was Anleger für Absicherung gegen Kursstürze in den nächsten 30 Tagen bezahlen. | „Der VIX steht bei {v}. Höher (= ängstlicher) war er nur an {p} % der Tage seit {start}.“ | Hoher VIX heißt nicht „Kurse fallen weiter“ – er misst erwartete Schwankung, nicht Richtung. |
| **Kurz- vs. Langfristangst** (VIX9D/VIX3M, falls verfügbar) | Ist die Angst vor den nächsten Tagen größer als vor den nächsten Monaten? | „Kurzfristige Angst ist {größer/kleiner} als die langfristige – das kam an {p} % der Tage vor.“ | Selten und meist kurz; kein Timing-Werkzeug. |
| **Wie viele machen mit?** (Marktbreite, % über 200-Tage-Linie) | Anteil der ~600 Firmen, deren Kurs über dem eigenen Durchschnitt der letzten 200 Tage liegt. | „{a} % der Firmen (USA {u} %, Europa {e} %) liegen über ihrem 200-Tage-Schnitt – weniger waren es nur an {p} % der Tage.“ | Ein Index kann steigen, während die Mehrheit fällt – dann tragen wenige Riesen. |
| **Neue Hochs gegen Tiefs** | Wie viele Firmen ein 52-Wochen-Hoch erreichen, verglichen mit einem Tief. | „Heute {h} neue Hochs, {t} neue Tiefs.“ | Tageswerte springen; aussagekräftig ist der 10-Tage-Schnitt. |
| **Flucht in Sicherheit** (Aktien vs. Staatsanleihen/Gold, 20 T) | Haben Anleger zuletzt eher Aktien oder sichere Anlagen gekauft? | „In 20 Tagen liefen Aktien {x} Prozentpunkte {besser/schlechter} als Staatsanleihen.“ | Zinsentscheidungen verzerren das; Gold steigt auch aus anderen Gründen. |
| **Risikoaufschlag** (HYG vs. IEF) | Wie viel Sorge um Firmenpleiten in den Anleihekursen steckt. | „Hochzinsanleihen liefen {x} schwächer als Staatsanleihen – so sorgenvoll an {p} % der Tage.“ | Näherung über ETF-Kurse, nicht der echte Zinsaufschlag. |
| **Schwung** (S&P 500 vs. 125-Tage-Schnitt) | Wie weit der Index über oder unter seinem Halbjahresschnitt liegt. | „Der S&P 500 liegt {x} % {über/unter} dem Halbjahresschnitt.“ | Schwung ist Trendfolge, kein Gegenindikator – deshalb eigene Farbe/Erklärung. |
| **Absicherungsquote** (Put/Call aus SPY/QQQ) | Wie viele Absicherungs-Optionen im Verhältnis zu Wetten auf steigende Kurse gehandelt werden. | „Auf 100 Calls kamen {n} Puts (5-Tage-Schnitt).“ | Nicht die offizielle CBOE-Quote; „berechnet aus SPY/QQQ“. |
| **Nachrichtenton** (News-Sentiment SPY/QQQ/DAX) | Klingen die Schlagzeilen eher positiv oder negativ? | „Der Nachrichtenton zum US-Markt ist {Wort} ({n} Artikel, 7 Tage).“ | Automatische Wortauswertung, hinkt Kursen hinterher. Begriff im Glossar zu „Nachrichtenton“ umbenennen. |
| **Angst-&-Gier-Wert** (eigener Index 0–100) | Mittelwert der Ränge der Bausteine oben. | „Zusammen: {w} von 100 – {Wort}.“ | Eigene Nachbildung, **nicht** der CNN-Index; nennt die Bausteine, aus denen er besteht. |

Farbe: fließend von Blaugrau (ängstlich) über Neutralgrau zu Amber (sorglos) – **bewusst kein Rot/Grün**, weil Rot als „verkaufen“ gelesen wird, obwohl extreme Angst historisch eher vor Erholungen lag.

## 3. Lagetext oben (automatisch, 2 Sätze)
Vorlage:
> „Die Stimmung ist **{Wort}**: Angst-&-Gier {w}/100, so ängstlich wie an {p} % der Tage seit 2015. {Auffälligster Baustein, z. B. ‚Am deutlichsten: nur 31 % der Firmen über dem 200-Tage-Schnitt.‘} {Wenn uneinig: ‚Die Bausteine sind sich uneinig – {k} von {n} zeigen Angst.‘}“

Gegen Signal-Klang: (a) nur Beschreibungs­verben („ist“, „liegt“, „war seltener“), **verboten:** „kaufen“, „Chance“, „Warnung“, „sollte“, Ausrufezeichen; (b) immer Vergleich + Zeitraum, nie nackter Wert; (c) Uneinigkeit wird ausgesprochen; (d) Fußzeile wie in ECST: „Beschreibung der Lage – keine Empfehlung.“

## 4. Ehrlicher Rückblick („Was folgte früher?“)
Aufklappbar, nicht Standard. Pro Stimmungsfünftel eine Zeile im bekannten BWT/DCF-Format:
> „**Ähnlich ängstlich wie heute** (unterstes Fünftel): S&P 500 nach 3 Monaten im Mittel +4 %, in 68 % der Fälle im Plus, Spanne der mittleren 80 %: −9 % bis +14 % · **42 unabhängige Episoden** (nicht 380 Tage – überlappende Tage zählen als eine).“

Daneben dieselbe Zeile für **alle Tage** als Vergleich – erst der Unterschied ist die Aussage. Urteils-Plakette wie bei der Prognose: „Rückblick: deutlich / schwach / zu wenig Fälle“ (deutlich nur, wenn Unterschied > Streuung und ≥ 20 Episoden). Pflichtsatz: „Nur ein Zeitraum (seit 2015), nur ein Markt; Zahlen aus heutiger Firmenauswahl – Vergangenheit ist geschönt.“ 2020 und 2022 explizit nennen: „Fiel teils noch weiter, bevor es besser wurde.“

## 5. Glossar (neu)
- **Gegenindikator** – Zeigt eher das Gegenteil des Kommenden an: Wenn alle ängstlich sind, haben viele schon verkauft.
- **VIX** – Aus S&P-500-Optionen berechnete erwartete Schwankung der nächsten 30 Tage, % pro Jahr.
- **VIX-Laufzeitkurve** – VIX für 9 T/30 T/3 M; kurz über lang = akute Unruhe.
- **Marktbreite** – Wie viele Aktien eine Bewegung mittragen.
- **200-Tage-Linie** – Durchschnitt der letzten 200 Schlusskurse.
- **52-Wochen-Hoch/-Tief** – Höchster/tiefster Schlusskurs des letzten Jahres.
- **Sicherer Hafen** – In Krisen gesuchte Anlagen (Staatsanleihen, Gold).
- **Hochzinsanleihe** – Anleihe schwächerer Firmen, höherer Zins und Ausfallrisiko.
- **Risikoaufschlag (Credit Spread)** – Mehrzins schwacher gegenüber sicheren Schuldnern.
- **Perzentil/Rang** – „wie an X % aller Tage“.
- **Episode** – Zusammenhängende Phase, im Rückblick einmal gezählt.
- **Angst-&-Gier-Wert** – Eigener Gesamtwert 0–100 aus den Bausteinen.
- **Nachrichtenton** – (Umbenennung des bisherigen „Stimmung“).
- Bestehend „Put/Call-Verhältnis“ ergänzen: „hier aus SPY/QQQ genähert“.

## 6. Skizze
```
STIM Stimmung  [USA|Europa|beide]  seit [2015▾]            CSV ⧉ ▣
Wie ängstlich oder sorglos …? Keine Empfehlung …            ← Satz 1
┌ LAGETEXT (2 Sätze, Fließtext, größer) ─────────────────────────┐
│ Die Stimmung ist ängstlich: 23/100, so ängstlich wie an 12 % … │
└────────────────────────────────────────────────────────────────┘
ängstlich ░░▒▒▓▓██▓▓▒▒░░ sorglos   ▲ heute 23   (fließende Skala)
BAUSTEIN            WERT    RANG-BALKEN (0–100)     IN WORTEN
Angstbarometer      24,8   ▕▔▔▔▔▔▔▔▔▔▔▲▔▔▔▔▕  höher nur an 9 % …
Wie viele machen mit 31 %  ▕▔▔▔▲▔▔▔▔▔▔▔▔▔▔▕  weniger nur an 14 % …
…                                  (Zeile anklicken → Verlauf + Erklärung)
──────────────────────────────────────────────────────────────────
[▸ Was folgte früher?]  Rückblick: schwach · 42 Episoden · Spanne …
Beschreibung der Lage – keine Empfehlung. Daten: EODHD, eigene Berechnung.
```
Kleines Panel (1/4-Layout): nur Kopfsatz-Kurzform („Stimmung – keine Empfehlung“), Gesamtwert + Wort + Skala, eine Zeile Lagetext, Rang-Balken der Bausteine ohne Wortspalte (Wort im Tooltip). Rückblick nur maximiert.

## 7. Offene Fragen
1. **An A:** Nehmen Profis den Rang-Balken statt Rohwert als Hauptzahl hin, oder brauchen sie Rohwert + Veränderung (Δ 1 W) in eigener Spalte?
2. **An B:** Wie zeigen wir den Verlauf des Gesamtwerts mit S&P 500 darunter, ohne dass Laien eine Ursache-Wirkung-Linie („Angst rot → Kurs fällt“) hineinlesen – z. B. Hintergrundbänder statt zweiter Linie?
3. **An beide:** Rückblick-Horizont: 1, 3 oder 6 Monate – oder alle drei, mit Gefahr des Rosinenpickens? Und gehört „Schwung“ (Trendfolge, kein Gegenindikator) überhaupt in den Gesamtwert?
