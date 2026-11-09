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
  Beta: "Schwankung im Verhältnis zu einem Index (1 Jahr, Tagesrenditen): bei einer Aktie zum Heimatindex, im Depot (RISK) zum gewählten Vergleichsindex. Über 1: schwankt stärker als der Markt.",
  Nettomarge: "Gewinn nach Steuern in % des Umsatzes.",
  "Operative Marge": "Operatives Ergebnis (EBIT) in % des Umsatzes.",
  Eigenkapitalrendite: "Gewinn in % des Eigenkapitals (ROE).",
  Gesamtkapitalrendite: "Gewinn in % der Bilanzsumme (ROA).",
  "RSI 14": "Relative-Stärke-Index über 14 Tage (0–100). Über 70 gilt als überkauft, unter 30 als überverkauft.",
  VWAP: "Volumengewichteter Durchschnittskurs des Tages – Richtwert für Intraday-Händler.",
  "Ehlers-Indikatoren": "Indikatoren von John F. Ehlers aus der Signalverarbeitung (Radartechnik): Sie trennen Trend, Zyklus und Rauschen und reagieren schneller als klassische Durchschnitte. Im Kurschart (GP) unter „Ehlers“ (Linie auf dem Kurs) und „Unterfenster“.",
  SuperSmoother: "Ehlers-Glättung mit zwei Polen: so ruhig wie ein gleitender Durchschnitt, aber mit deutlich weniger Verzögerung.",
  UltimateSmoother: "Ehlers 2024: Kurs minus Hochpass – im Trend fast ohne Verzögerung, nur kurzes Rauschen wird entfernt.",
  "MAMA / FAMA": "MESA Adaptive Moving Average und seine langsamere Begleitlinie: passen ihre Geschwindigkeit dem gemessenen Marktzyklus an. Kreuzt MAMA die FAMA nach oben, dreht der Trend aufwärts.",
  "Fisher Transform": "Ehlers 2002: rechnet die Kurslage in eine annähernd normalverteilte Größe um, sodass Wendepunkte als deutliche Spitzen erscheinen. Kreuzung mit dem Vortageswert = Signal.",
  "Roofing-Filter": "Ehlers-Filter, der Trend (lange Wellen) und Rauschen (sehr kurze Wellen) entfernt – übrig bleibt der handelbare Zyklus.",
  "Laguerre-RSI": "Schneller, glatter RSI von Ehlers zwischen 0 und 1; über 0,8 überkauft, unter 0,2 überverkauft.",
  "Reflex / Trendflex": "Ehlers 2020: zwei fast verzögerungsfreie Oszillatoren – Reflex für den Zyklus, Trendflex für den Trend.",
  "Correlation Trend": "Ehlers 2020: wie sehr die letzten 20 Kurse einer steigenden (+1) oder fallenden (−1) Geraden folgen.",
  "Trend-Scanning": "López de Prado / mlfinlab (Hudson & Thames): je Balken Geraden über 5 bis 19 (bzw. 59) Balken, die mit dem größten t-Wert der Steigung bestimmt den Trend. Im Chart ein Punkt je Balken: grau = im Zufallsbereich, farbig erst wenn gerader als 90 von 100 reinen Zufallskursen (grün auf, rot ab, groß ab 99 von 100). Rückblick (hohle Punkte) = folgender Trend, nutzt spätere Kurse, kein Signal; laufend = bisheriger Trend, keine Prognose.",
  Zykluslänge: "Länge der gerade vorherrschenden Kursschwingung in Balken, gemessen mit Ehlers' MESA-Verfahren (Hilbert-Transformation).",
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
  "Implizite Volatilität": "Die Schwankung, die in den Optionspreisen steckt (IV, % pro Jahr). IV 30 Tage: auf genau 30 Tage umgerechnet. Vergleich mit der historischen Schwankung (HV) zeigt, ob Optionen teuer oder günstig sind.",
  "Erwartete Bewegung": "Preis des Straddles am Geld (Call + Put): Um so viel muss sich der Kurs bis zum Verfall bewegen, damit Käufer beider Optionen keinen Verlust machen – grob die vom Markt erwartete Spanne (etwa eine Standardabweichung).",
  "Put/Call-Verhältnis": "Umsatz bzw. offene Positionen in Puts geteilt durch Calls. Hohe Werte zeigen viel Absicherung oder Pessimismus, niedrige Optimismus. Oft als Gegenindikator gelesen.",
  Skew: "Unterschied der impliziten Volatilität von Puts und Calls mit gleichem Abstand (25 Delta) in Prozentpunkten. Positiv: Absicherung nach unten ist teurer als Wetten nach oben – der Normalfall bei Aktien.",
  "Max Pain": "Strike, bei dem die Käufer aller offenen Optionen beim Verfall den geringsten Wert hätten. Kurse ziehen kurz vor großen Verfällen manchmal in diese Richtung – keine verlässliche Regel.",
  "Open Interest": "Anzahl offener Optionskontrakte. Große Bestände an einem Strike wirken oft wie Widerstand (Calls über dem Kurs) oder Unterstützung (Puts darunter), weil Händler dort absichern.",
  Laufzeitstruktur: "Implizite Volatilität nach Restlaufzeit. Steigend ist normal; ein Buckel zeigt ein erwartetes Ereignis (z. B. Quartalszahlen), fallend eine aktuelle Unruhe.",
  "Auffällige Umsätze": "Kontrakte, deren Tagesumsatz das Open Interest deutlich übersteigt (Vol/OI über 1,2): neue, größere Positionen – oft beachtet als Hinweis auf informierte Käufer.",
  Terminkurs: "Kurs für einen Tausch in der Zukunft (z. B. in einem Jahr), heute vereinbart. Er ergibt sich aus Kassakurs und Zinsen beider Währungen: Die Währung mit dem niedrigeren Zins notiert per Termin teurer (gedeckte Zinsparität). Keine Prognose.",
  "Swap-Punkte": "Abstand zwischen Termin- und Kassakurs in Pips (EUR/USD: 0,0001; Yen-Paare: 0,01). Positiv = Aufschlag der Basiswährung.",
  Absicherungskosten: "Ertrag (+) oder Kosten (−) pro Jahr, wenn Fremdwährungsanlagen per Devisentermingeschäft gegen die Heimatwährung abgesichert werden – ungefähr Heimatzins minus Fremdzins.",
  "Forward-Zins": "Vom Anleihemarkt eingepreister künftiger Zins, z. B. 1Y1Y = Einjahreszins in einem Jahr, 5Y5Y = Fünfjahreszins in fünf Jahren. Enthält eine Laufzeitprämie, ist also keine reine Erwartung.",
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
  // Grundbegriffe für Einsteiger
  Option: "Recht (keine Pflicht), eine Aktie bis zu einem Tag (Verfall) zu einem festen Preis (Strike) zu kaufen (Call) oder zu verkaufen (Put). Ein Kontrakt umfasst in den USA meist 100 Aktien; der Preis heißt Prämie.",
  Call: "Kaufoption: gewinnt an Wert, wenn der Kurs steigt. Lohnt sich am Verfall, wenn der Kurs über dem Strike liegt.",
  Put: "Verkaufsoption: gewinnt an Wert, wenn der Kurs fällt – oft als Absicherung genutzt. Lohnt sich am Verfall, wenn der Kurs unter dem Strike liegt.",
  Strike: "Ausübungspreis einer Option: der Preis, zu dem gekauft (Call) oder verkauft (Put) werden darf.",
  Verfall: "Letzter Tag einer Option. US-Monatsoptionen verfallen am dritten Freitag, Wochenoptionen jeden Freitag (an Börsenfeiertagen am Donnerstag davor).",
  "Im Geld": "Option mit innerem Wert: Call mit Strike unter dem Kurs, Put mit Strike über dem Kurs. In OMON hinterlegt.",
  Straddle: "Kauf von Call und Put mit demselben Strike und Verfall – setzt auf eine große Bewegung, egal in welche Richtung.",
  Delta: "Wie stark sich der Optionspreis bewegt, wenn die Aktie um 1 steigt (Call 0 bis 1, Put −1 bis 0); grob auch die Wahrscheinlichkeit, am Verfall im Geld zu liegen.",
  Theta: "Wertverlust einer Option pro Tag, nur durch die verstreichende Zeit.",
  Vega: "Wie stark sich der Optionspreis ändert, wenn die implizite Volatilität um einen Prozentpunkt steigt.",
  ETF: "Börsengehandelter Indexfonds: bildet einen Index (z. B. DAX, MSCI World) nach und lässt sich wie eine Aktie kaufen. Die Demo-Daten enthalten keine ETFs.",
  Einstand: "Durchschnittlicher Kaufkurs einer Position (bei Nachkäufen gemittelt). Daraus ergibt sich das Ergebnis seit Kauf.",
  Dividendenrendite: "Jährliche Dividende geteilt durch den Kurs, in Prozent.",
  Leerverkauf: "Verkauf geliehener Aktien in der Erwartung fallender Kurse; später werden sie günstiger zurückgekauft.",
  FIX: "Fixiertes Panel: behält sein Wertpapier, auch wenn die übrigen Panels wechseln.",
};

/** Tooltip-Text zu einem Begriff (exakt oder ohne Zusatz in Klammern). */
export function explain(term: string): string | undefined {
  return GLOSSARY[term] ?? GLOSSARY[term.replace(/\s*\(.*\)$/, "")];
}

const SYNONYMS: Record<string, string> = {
  "put-option": "Put", "putoption": "Put", "puts": "Put", "verkaufsoption": "Put",
  "call-option": "Call", "calloption": "Call", "calls": "Call", "kaufoption": "Call",
  optionen: "Option", "basispreis": "Strike", "ausübungspreis": "Strike", "strike-preis": "Strike",
  verfallstag: "Verfall", verfallsdatum: "Verfall", etfs: "ETF", indexfonds: "ETF",
  volatilität: "Schwankung (Volatilität)", vola: "Schwankung (Volatilität)", kgv: "KGV (TTM)",
  "einstandskurs": "Einstand", "kaufkurs": "Einstand", "var": "Value at Risk", drawdown: "Max. Drawdown",
  "iv": "Implizite Volatilität", "max-pain": "Max Pain", "open-interest": "Open Interest", "5y5y": "Forward-Zins", "1y1y": "Forward-Zins",
};

/**
 * Antwort auf „Was ist …?“ aus dem Glossar (für die Demo-KI, die freie Fragen nicht versteht).
 * Liefert [Begriff, Erklärung] oder null.
 */
export function glossaryAnswer(question: string): [string, string] | null {
  const m = /^\s*(?:was\s+(?:ist|sind|bedeutet|bedeuten|heißt|meint\s+man\s+mit)|erkläre?(?:n\s+sie)?(?:\s+mir)?|wofür\s+steht)\s+(?:eine?n?\s+|der\s+|die\s+|das\s+)?(.+?)[\s?.!]*$/i.exec(question);
  if (!m) return null;
  const raw = m[1].trim().toLowerCase();
  const byLower = new Map<string, string>();
  for (const k of Object.keys(GLOSSARY)) {
    byLower.set(k.toLowerCase(), k);
    byLower.set(k.replace(/\s*\(.*\)$/, "").toLowerCase(), k);
  }
  const candidates = [raw, raw.replace(/\s+/g, "-"), raw.replace(/(en|s|n)$/, "")];
  for (const c of candidates) {
    const key = SYNONYMS[c] ?? byLower.get(c);
    if (key && GLOSSARY[key]) return [key, GLOSSARY[key]];
  }
  return null;
}
