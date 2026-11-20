# Stimmungsterminal (STIM) – Design

Gemeinsamer Vorschlag dreier Design-Agenten (Profi-Händler-UX, Datenvisualisierung, Verständlichkeit), Fassung 2; vom Nutzer
am 20.11.2026 gutgeheißen („sieht gut aus, merke dir deine Idee“). Noch nicht gebaut.

- `design-vorschlag.html` – Nachbildung beider Ansichten (Viertelpanel, maximiert), Farbskala, Bausteine, offene Entscheidungen
  (im Browser öffnen; Zahlen sind Beispielwerte)
- `BRIEFING.md` – Auftrag und Datenlage (was EODHD liefert)
- `A_/B_/C_entwurf.md`, `A_/B_/C_diskussion.md` – Einzelentwürfe und Diskussionsrunde

Konsens: Skalenbalken statt Tacho · Blau–Grau–Magenta, grau zwischen Rang 30 und 70 · Schwung nicht im Gesamtwert ·
nur beschreibende Sätze („an X von 100 Tagen“), keine Signalwörter · Rückblick nach unabhängigen Episoden, 1/3/6 Monate
neben „alle Tage“ · Viertelpanel ohne Schalter, Diagramme nur maximiert.

Offene Entscheidungen: Put/Call (Optionsabrufe) · Platz auf MAKRO statt ECO · Nachrichtenton im Gesamtwert · Europa-Sicht.

## Festlegung des Nutzers (20.11.2026)
**Keine Ersatzgrößen für etwas, das es an einer Stelle gibt und an der anderen nicht.** Beispiel: Die durchschnittliche
Schwankung der Einzelaktien (ø Volatilität) darf nicht in Europa den VIX „vertreten“. Jeder Baustein misst überall dasselbe:
- Bausteine, die sich für jede Region gleich rechnen lassen (Marktbreite, Hochs/Tiefs, ADL, Trust, Breadth, TRIN,
  ø Volatilität), gibt es für jede Region und heißen überall gleich.
- Bausteine, die es nur für die USA gibt (VIX, ggf. Put/Call aus US-Optionen), stehen nur in der USA-Sicht; in der
  Europa-Sicht fehlen sie sichtbar („nur USA“) statt durch etwas Ähnliches ersetzt zu werden.
- Der Gesamtwert einer Region besteht nur aus ihren eigenen Bausteinen und nennt sie („aus 5 Bausteinen“).

Ergänzung aus den TraderFox-Beispielen: Bereich „Marktbreite“ (200-Tage-Index, NHNL, ADL mit Index, Trust, Breadth,
TRIN nur im Detail) je Region/Sektor; ø Volatilität als eigener Baustein. Wochentags-/Monatszyklen als eigene Funktion
„Saisonalität“ (mit Vergleich zum Zufall), nicht in STIM.

## Entscheidung (20.11.2026)
Put/Call (aus Optionen auf S&P 500/Nasdaq 100) und Risikoaufschlag (Hochzins- gegen Staatsanleihen-ETF) kommen hinein –
überall mit dem Zeichen ≈ und der Erklärung „Näherung, nicht die offizielle Zahl“, nur in der USA-Sicht. Der Gesamtwert
USA besteht damit aus 8 Bausteinen, Europa aus 5.
