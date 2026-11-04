// Kurze Erklärungen für Kennzahlen und Begriffe (Tooltips in DES und Glossar in HELP).

export const GLOSSARY: Record<string, string> = {
  "KGV (TTM)": "Kurs-Gewinn-Verhältnis: Kurs geteilt durch den Gewinn je Aktie der letzten 12 Monate. Niedrig = günstig bewertet (im Branchenvergleich).",
  "KGV erwartet": "Kurs geteilt durch den von Analysten erwarteten Gewinn je Aktie des laufenden Jahres.",
  PEG: "KGV geteilt durch das erwartete Gewinnwachstum in %. Um 1 gilt als fair; nur bei positivem Wachstum sinnvoll.",
  KUV: "Kurs-Umsatz-Verhältnis: Börsenwert geteilt durch den Jahresumsatz.",
  KBV: "Kurs-Buchwert-Verhältnis: Börsenwert geteilt durch das Eigenkapital laut Bilanz.",
  "EV/EBITDA": "Unternehmenswert (Börsenwert plus Nettoschulden) geteilt durch den operativen Gewinn vor Abschreibungen. Vergleichbar auch bei unterschiedlicher Verschuldung.",
  "EV/Umsatz": "Unternehmenswert geteilt durch den Jahresumsatz.",
  "Enterprise Value": "Unternehmenswert: Börsenwert plus Nettoverschuldung.",
  Beta: "Schwankung der Aktie im Verhältnis zum Heimatindex (1 Jahr, Tagesrenditen). Über 1: schwankt stärker als der Markt.",
  Nettomarge: "Gewinn nach Steuern in % des Umsatzes.",
  "Operative Marge": "Operatives Ergebnis (EBIT) in % des Umsatzes.",
  Eigenkapitalrendite: "Gewinn in % des Eigenkapitals (ROE).",
  Gesamtkapitalrendite: "Gewinn in % der Bilanzsumme (ROA).",
  "RSI 14": "Relative-Stärke-Index über 14 Tage (0–100). Über 70 gilt als überkauft, unter 30 als überverkauft.",
  VWAP: "Volumengewichteter Durchschnittskurs des Tages – Richtwert für Intraday-Händler.",
  bp: "Basispunkt = 0,01 Prozentpunkte. Zinsänderungen werden in bp angegeben.",
  "2s10s": "Rendite 10 Jahre minus Rendite 2 Jahre in bp. Negativ = inverse Zinskurve.",
  EIL: "Eilmeldung: besonders kursrelevante Nachricht.",
  Stimmung: "Automatische Einschätzung des Nachrichtentons von −1 (negativ) bis +1 (positiv).",
  "Schwankung (Volatilität)": "Wie stark der Wert schwankt: Standardabweichung der Tagesrenditen, aufs Jahr hochgerechnet. 15 % heißt: In zwei von drei Jahren liegt das Ergebnis grob im Bereich ±15 % um den Durchschnitt.",
  "Max. Drawdown": "Größter Rückgang vom bisherigen Höchststand bis zum folgenden Tiefpunkt im betrachteten Jahr.",
  "Value at Risk": "Verlust, der an 95 von 100 Handelstagen nicht überschritten wurde (historisch, ein Tag). An den übrigen 5 Tagen war der Verlust größer.",
  "Expected Shortfall": "Durchschnittlicher Verlust an den 5 % schlechtesten Tagen – zeigt, wie schlimm es an schlechten Tagen wird.",
  Risikoanteil: "Anteil einer Position am Gesamtrisiko (Schwankung) des Depots, berücksichtigt Gewicht, Schwankung und Korrelation. Alle Anteile ergeben 100 %.",
  "Effektive Positionen": "Wie viele gleich große Positionen dieselbe Streuung hätten (1 ÷ Summe der quadrierten Gewichte). Deutlich weniger als die tatsächliche Anzahl heißt: Klumpenrisiko.",
  Korrelation: "Gleichlauf zweier Werte von −1 (gegenläufig) über 0 (unabhängig) bis +1 (gleichläufig). Viele hohe Werte bedeuten wenig Streuung.",
  Weltkarte: "WMAP färbt Länder nach einer Kennzahl ein: grün gut, rot schlecht (bei Renditen: steigend rot). Die Farbskala reicht bis zum 90-%-Wert, damit einzelne Ausreißer nicht alle anderen Länder grau wirken lassen.",
  "Market Profile": "Darstellung eines Handelstags nach Preis und Zeit: Jeder 30-Minuten-Abschnitt bekommt einen Buchstaben (A, B, C …), der auf jeder in dieser Zeit gehandelten Preisstufe steht. Breite Stellen = Preise, an denen viel Zeit verbracht wurde (fairer Wert), schmale = schnell verlassene Preise.",
  Volumenprofil: "Umsatz je Preisstufe statt je Zeit. Zeigt, wo viel gehandelt wurde (Unterstützung/Widerstand) und wo kaum (Preislücken). Im Kurschart aus 5-Minuten-Kerzen (1T/5T) bzw. aus Tageskerzen geschätzt.",
  POC: "Point of Control: Preisstufe mit dem meisten Volumen (Volumenprofil) bzw. den meisten Buchstaben (Market Profile) – der am stärksten akzeptierte Preis.",
  "Value Area": "Preisbereich um den POC mit 70 % des Volumens bzw. der Buchstaben (VAH = Obergrenze, VAL = Untergrenze). Eröffnet der Markt außerhalb der Vortags-Value-Area, ist das ein Hinweis auf einen Trend- statt Rotationstag.",
  "Initial Balance": "Spanne der ersten Handelsstunde (Buchstaben A und B). Ausbrüche aus dieser Spanne zeigen, ob größere Marktteilnehmer aktiv werden.",
  "KI-Einordnung": "Zusammenfassung, Stimmung, Ereignisart und Relevanz einer Meldung – von einem lokalen Sprachmodell in LM Studio oder, ohne LM Studio, von der regelbasierten Demo-KI. Eine automatische Einschätzung, keine Anlageberatung.",
  "KI-Relevanz": "Wie stark eine Meldung den Kurs bewegen dürfte: 0 unwichtig, 1 gering, 2 kursrelevant, 3 stark kursbewegend (Punkte ●●● in der Nachrichtenliste).",
  "Ohne Beleg": "Markierte Zahl in einer KI-Antwort: Sie steht in keinem der Datensätze, die die KI abgefragt hat. Bitte selbst prüfen.",
  TTM: "Trailing Twelve Months: die letzten vier berichteten Quartale.",
  FIX: "Fixiertes Panel: behält sein Wertpapier, auch wenn die übrigen Panels wechseln.",
};

/** Tooltip-Text zu einem Begriff (exakt oder ohne Zusatz in Klammern). */
export function explain(term: string): string | undefined {
  return GLOSSARY[term] ?? GLOSSARY[term.replace(/\s*\(.*\)$/, "")];
}
