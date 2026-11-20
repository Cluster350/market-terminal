# Entwurf A – „Profi-Händler-UX“: STIM · Stimmung

## Kürzel, Ort, Größe
- **STIM – Stimmungsterminal** (Alias `MOOD`, Suche „Angst“, „Gier“, „Sentiment“). Kürzel noch frei in `lib/commands.ts`.
- Seite **2 MAKRO**: ersetzt in der Standardbelegung **ECO** (rechts unten, ca. 640×360 bei 1280×800); ECO bleibt im Pool. Zusätzlich in den Pools von 3 SCREENER und 5 DEPOT.
- Designziel: **Viertelpanel = 10-Sekunden-Blick**, maximiert (Alt+m) = Arbeitsansicht.

## Layout normal (Viertelpanel)
```
STIM Stimmung                             Stand 20.11. 22:10   CSV ⧉ □
┌──────────────┬─────────────────────────────────────────────────────┐
│ ANGST & GIER │ BAUSTEIN        HEUTE   PERZ.  ░░░░░░░░░█░░  1W   │
│    ▄▄▄▄▄     │ VIX             13,4    18 %   ═══●════════   ↗   │
│  ▄▀  ╲  ▀▄   │ Breite >200T    61 %    55 %   ══════●═════   →   │
│     72       │ Hoch/Tief 52W   +38     81 %   ═════════●══   ↗   │
│    GIER      │ Sichere Häfen   +2,1 %  70 %   ════════●═══   ↘   │
│ seltener als │ Kreditrisiko    +0,4 %  64 %   ═══════●════   →   │
│ 84 % d. Tage │ Schwung S&P     +5,8 %  77 %   ═════════●══   ↗   │
│ Vorw. 65 ↗   │ News-Stimmung   +0,21   59 %   ═══════●════   →   │
└──────────────┴─────────────────────────────────────────────────────┘
 Gegenindikator: Extremwerte eher Warnung (Gier) bzw. Chance (Angst). Keine Empfehlung.
```
**Oben links (der 10-Sekunden-Blick):** Halbtacho 0–100 mit einer großen Zahl (28 px, Plex Mono), darunter Wort-Einordnung (EXTREME ANGST · ANGST · NEUTRAL · GIER · EXTREME GIER) und **Perzentil-Satz** („höher als an 84 % der Tage seit 2016“). Daneben „Vorwoche 65 ↗“ – Richtung ist für Händler wichtiger als Niveau.

Rechts eine **Bausteintabelle** (Spalten wie in FCTR/BWT): Rohwert, Perzentil (10 J.), **Lage-Balken** (Punkt auf einer fließend gefärbten Spur, angelehnt an die „Lage“-Spalte in BWT), Wochenrichtung als Pfeil. Kein Diagramm im Viertelpanel außer dem Tacho – Dichte vor Dekoration.

## Layout maximiert
```
STIM Stimmung   [Gesamt|USA|Europa]  [3M|1J|3J|10J]          CSV ⧉ □
┌ KPI-LEISTE (.kpis) ────────────────────────────────────────────────┐
│ ANGST&GIER 72 GIER│ VIX 13,4 · 18 %│ BREITE 61 %│ PUT/CALL* 0,71│ NEWS +0,21 │
├───────────────┬────────────────────────────────────────────────────┤
│ TACHO + Satz  │ VERLAUF Angst&Gier (Linie, Hintergrund fließend    │
│ Bausteintab.  │ eingefärbt 0–100) über S&P 500 (log, dünn grau)    │
│ (wie normal,  │ Markierung: Tage mit <10 / >90 = vertikale Bänder  │
│ + Spalte 1M)  ├──────────────────────────┬─────────────────────────┤
│               │ MARKTBREITE              │ VIX-STRUKTUR*            │
│               │ Heatmap Sektor × Region  │ VIX9D·VIX·VIX3M Kurve,   │
│               │ (% über 200T), 11×2      │ Contango/Backwardation   │
├───────────────┴──────────────────────────┴─────────────────────────┤
│ RÜCKBLICK: „Nach Werten >80 lag der S&P 6 Monate später im Median  │
│ +4,1 % (n=38), sonst +5,3 %.“  – ehrlich, mit Stichprobengröße     │
└────────────────────────────────────────────────────────────────────┘
 * nur falls Daten verfügbar; sonst Kachel ausgegraut mit „nicht verfügbar“
```

## Kacheln im Detail
| Kachel | Indikator | Darstellung | Zeitachse | Große Zahl / Einordnung | Klick → |
|---|---|---|---|---|---|
| Tacho | Angst & Gier 0–100 (Mittel der Bausteine als Perzentile) | Halbkreis, fließende Skala, Nadel + Schatten-Nadel Vorwoche | heute vs. 1 W | Wert + Wort + Perzentil | Verlauf (maximiert) |
| VIX | VIX.INDX | Lage-Balken; max.: Linie mit 10/90-%-Band | 1 J | Stand + Perzentil, „Sprung +6 %“ | GP VIX.INDX |
| Breite | % über 200T/50T, steigend/fallend, 52W-Hoch−Tief | Lage-Balken; max.: Heatmap Sektor×Region | täglich, 1 J | % über 200T | BWT (Sektor vorgefiltert) bzw. RRG |
| Sichere Häfen | SPY vs. TLT/IEF, Gold, 20 T | Lage-Balken, Differenz in % | 20 T | Differenz % | GP SPY / FCTR |
| Kreditrisiko | HYG vs. IEF, 20 T | Lage-Balken; max.: Linie | 1 J | Differenz % | GP HYG |
| Schwung | S&P vs. 125T-Schnitt | Lage-Balken | 125 T | Abstand % | GP SPY |
| News-Stimmung | EODHD-Sentiment SPY/QQQ/DAX-ETF, 7-T-Mittel + Artikelzahl | Zahl −1…+1 + Mini-Spark (`Spark`) | 30 T | 7-T-Mittel | CN/TOP mit Ticker |
| Put/Call* | Näherung aus SPY/QQQ-Optionen | Lage-Balken, 5-T-Mittel | 3 M | Quote | OMON SPY |

Hover auf jeden Baustein: Erklärung in einem Satz einfachem Deutsch („Viele Anleger kaufen Absicherung = Angst“).

## Farbsystem
- **Fließende 5-Stufen-Skala**, interpoliert: tiefes Rot (#ff5252, Angst) → Orange → neutrales Grau (#5c5c5c) → Teal → Grün (#29d17d, Gier). Basis: `--down`, `--up`, `--dim` aus `terminal.css`; Interpolation analog `heatColor()` in `IMAP.tsx`.
- **Wichtig:** Farbe kodiert *Stimmung*, nicht *gut/schlecht*. Weil Gier=Grün sonst „Kaufen“ suggeriert, bekommen Extremzonen (<10 und >90 Perzentil) einen **Amber-Rahmen** (#ffa028) und den Hinweis „Gegenindikator – historisch selten“. So springt das Extrem ins Auge, ohne ein Signal vorzutäuschen.
- Extremwerte: Perzentile werden auf 1–99 % gekappt; Tacho-Nadel nie am Anschlag; Ausreißer (VIX 80) verzerren dank Perzentilskala die Balken nicht. Rohwert bleibt daneben sichtbar.

## Bewusst NICHT
- Keine Kauf-/Verkaufsampel, kein „Signal“-Text.
- Keine Einzelaktien-Stimmung (gehört in DES/CN).
- Keine Daten fremder Quellen (AAII, NAAIM, CNN-Original, COT) – höchstens später als eigene Zeile.
- Kein zweiter Achsen-Wirrwarr: max. 2 Serien pro Diagramm; keine Schalter im Viertelpanel (Seg-Schalter nur maximiert).
- Keine Intraday-Aktualisierung vortäuschen: Stand-Datum sichtbar, Daten täglich.

## Wiederverwendung
- `components/ui.tsx`: `Seg` (Region/Zeitraum), `Spark` (News, 30 T), `Table`/`Column` (Bausteintabelle inkl. CSV), `Q`, `Loading`, `Empty`, `Change`, `TickerLink` (Klick → GP).
- KPI-Leiste: `.kpis/.kpi/.kpi-l/.kpi-v` aus `theme/terminal.css` (Kpi-Komponente aus `screens/crypto.tsx` nach `ui.tsx` heben).
- `components/EChart.tsx` mit `AXIS`, `TOOLTIP` für Tacho (ECharts gauge), Verlauf, Heatmap; CSV automatisch.
- Lage-Balken: Muster der „Lage“-Spalte in `screens/valuation.tsx` (BWT).
- Farbinterpolation: `heatColor` (`IMAP.tsx`), `corrColor` (`factors.tsx`) – zu einer gemeinsamen `divergingColor()` zusammenführen.
- Breite-Daten: Universum aus BWT (`valuation`-Backend), Fußnotenstil wie FCTR/BWT/RRG („Keine Empfehlung“).

## Offene Fragen
1. **An B:** Halbtacho oder lieber ein horizontaler 0–100-Balken mit Perzentil-Punkt? Tachos sind ikonisch, aber im Viertelpanel platzhungrig – lohnt der Platz?
2. **An C:** Reicht ein Wort („GIER“) plus Satz „höher als an 84 % der Tage“, oder braucht es einen dauerhaften Gegenindikator-Hinweis, damit Grün nicht als „kaufen“ gelesen wird?
3. **An beide:** Soll der Gesamtwert gleich gewichtet aus Perzentilen gebildet werden oder transparent je Baustein (aufklappbar) – und zeigen wir den Rückblick-Test schon im Viertelpanel oder nur maximiert?
