// Tasten des Stream-Deck-Plugins: Vorbelegung nach Position, Aufträge beim Drücken und das Bild jeder Taste.
// Reine Funktionen ohne Netz – getestet in test/keys.test.js.

export const DEFAULT_URL = "http://127.0.0.1:8000";

/** Vorschlag für das Stream Deck mit 15 Tasten (3 Reihen × 5), Index = Reihe × 5 + Spalte. */
export const LAYOUT_15 = [
  { art: "kurs", ticker: "GDAXI.INDX", label: "DAX" },
  { art: "kurs", ticker: "GSPC.INDX", label: "S&P 500" },
  { art: "kurs", ticker: "NDX.INDX", label: "NASDAQ" },
  { art: "kurs", ticker: "VIX.INDX", label: "VIX" },
  { art: "kurs", ticker: "EURUSD.FOREX", label: "EUR/USD" },
  { art: "depot" },
  { art: "stimmung", region: "us" },
  { art: "stimmung", region: "eu" },
  { art: "news" },
  { art: "alarme" },
  { art: "seite", page: "equity" },
  { art: "seite", page: "macro" },
  { art: "seite", page: "news" },
  { art: "befehl", command: "BRIEF", label: "BRIEFING", sub: "MORGEN" },
  { art: "max" },
];

export const PAGE_LABEL = { equity: "AKTIE", macro: "MAKRO", screener: "SCREEN", news: "NEWS", depot: "DEPOT" };
export const ARTEN = ["kurs", "stimmung", "news", "alarme", "depot", "seite", "befehl", "max"];

/** Belegung für eine Position (Spalte, Reihe); außerhalb der 15 Tasten: Kursliste von vorn. */
export function defaultFor(coords, columns = 5) {
  const col = coords?.column ?? 0;
  const row = coords?.row ?? 0;
  const i = row * columns + col;
  return { ...(LAYOUT_15[i] ?? LAYOUT_15[i % 5]) };
}

/** Vollständige, gültige Einstellungen (fehlende Angaben ergänzt, Unbekanntes verworfen). */
export function normalizeSettings(s) {
  const art = ARTEN.includes(s?.art) ? s.art : "befehl";
  const out = { art };
  if (art === "kurs") {
    out.ticker = String(s.ticker || "GDAXI.INDX").trim().toUpperCase().slice(0, 30);
    out.label = String(s.label ?? "").slice(0, 12);
  } else if (art === "stimmung") {
    out.region = s.region === "eu" ? "eu" : "us";
  } else if (art === "seite") {
    out.page = PAGE_LABEL[s.page] ? s.page : "equity";
  } else if (art === "befehl") {
    out.command = String(s.command || "TOP").trim().slice(0, 80);
    out.label = String(s.label || out.command).slice(0, 12);
    if (s.sub) out.sub = String(s.sub).slice(0, 10);
    // frühere Vorbelegung „BRIEF“ war als Briefkurs missverständlich
    if (out.command.toUpperCase() === "BRIEF" && out.label === "BRIEF" && !out.sub) Object.assign(out, { label: "BRIEFING", sub: "MORGEN" });
  }
  return out;
}

/** Was ein Druck auf die Taste im Terminal auslöst (Inhalt für POST /api/remote). */
export function remoteFor(s) {
  switch (s.art) {
    case "kurs":
      return { command: `${s.ticker} GP` };
    case "stimmung":
      return { command: "STIM" };
    case "news":
      return { command: "TOP" };
    case "alarme":
      return { command: "ALRT" };
    case "depot":
      return { page: "depot" };
    case "seite":
      return { page: s.page };
    case "max":
      return { maximize: true };
    default:
      return { command: s.command };
  }
}

/** Welche Teile des Datenpakets (GET /api/deck) eine Taste braucht. */
export function partsFor(s) {
  switch (s.art) {
    case "stimmung":
      return [`stim_${s.region}`];
    case "news":
      return ["news"];
    case "alarme":
      return ["alerts"];
    case "depot":
      return ["depot"];
    default:
      return [];
  }
}

// --- Zahlen und Farben ----------------------------------------------------------------------

const nf = (d) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });

export function fmtPrice(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  return nf(a >= 10000 ? 0 : a >= 100 ? 1 : a >= 10 ? 2 : 4).format(v);
}

export function fmtPct(v, d = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "±";
  return `${sign}${nf(d).format(Math.abs(v))} %`;
}

export function fmtMoney(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "±";
  return `${sign}${nf(0).format(Math.abs(v))}`;
}

/** Gleiche Farbskala wie STIM: blau (Angst) – grau (30–70) – magenta (Sorglosigkeit). */
export function rankColor(r) {
  if (r === null || r === undefined || !Number.isFinite(r)) return "#5c5c5c";
  const mix = (a, b, t) => `#${a.map((x, i) => Math.round(x + (b[i] - x) * t).toString(16).padStart(2, "0")).join("")}`;
  const B = [0x5b, 0x8c, 0xff], G = [0x8f, 0x8f, 0x8f], M = [0xff, 0x5f, 0xa2];
  if (r <= 10) return mix(B, B, 0);
  if (r < 30) return mix(B, G, (r - 10) / 20);
  if (r <= 70) return mix(G, G, 0);
  if (r < 90) return mix(G, M, (r - 70) / 20);
  return mix(M, M, 0);
}

/** Hintergrund der Kursleiste: je stärker die Bewegung, desto kräftiger (ab ±2 % voll). */
export function changeColor(pct) {
  if (pct === null || pct === undefined || !Number.isFinite(pct) || pct === 0) return "#2a2a2a";
  const t = Math.min(1, Math.abs(pct) / 2) * 0.75 + 0.25;
  const [r, g, b] = pct > 0 ? [0x29, 0xd1, 0x7d] : [0xff, 0x52, 0x52];
  return `rgb(${Math.round(r * t)},${Math.round(g * t)},${Math.round(b * t)})`;
}

// --- Bilder (SVG 144 × 144) -----------------------------------------------------------------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const FONT = "font-family='Consolas, Menlo, monospace'";

function svg(body, border = "#262626") {
  return `<svg xmlns='http://www.w3.org/2000/svg' width='144' height='144' viewBox='0 0 144 144'>` +
    `<rect width='144' height='144' fill='#000'/><rect x='2' y='2' width='140' height='140' rx='10' fill='#0a0a0a' stroke='${border}' stroke-width='3'/>${body}</svg>`;
}

const text = (x, y, size, color, value, weight = "normal", anchor = "middle") =>
  `<text x='${x}' y='${y}' ${FONT} font-size='${size}' font-weight='${weight}' fill='${color}' text-anchor='${anchor}'>${esc(value)}</text>`;

/** Schriftgröße so wählen, dass der Text in die Taste passt. */
const fit = (s, max, base) => Math.max(14, Math.min(base, Math.floor((max / Math.max(1, String(s).length)) * 1.65)));

export function dataUrl(markup) {
  return `data:image/svg+xml;charset=utf8,${encodeURIComponent(markup)}`;
}

/** Bild einer Taste. ``data``: Datenpaket des Terminals (oder null = nicht erreichbar); ``flash``: auffällig zeigen. */
export function render(s, data, opts = {}) {
  const { flash = false, offline = false } = opts;
  if (offline) {
    const label = s.art === "kurs" ? s.label || s.ticker.split(".")[0] : titleOf(s);
    return svg(text(72, 46, fit(label, 120, 24), "#ffa028", label, "bold") + text(72, 88, 18, "#8f8f8f", "Terminal") + text(72, 112, 18, "#8f8f8f", "nicht offen"), "#3a3a3a");
  }
  switch (s.art) {
    case "kurs": {
      const q = data?.quotes?.find((x) => x.ticker === s.ticker);
      const label = s.label || shortName(q?.name, s.ticker);
      const price = fmtPrice(q?.last);
      return svg(
        text(72, 27, fit(label, 124, 21), "#ffa028", label, "bold") +
          text(72, 59, fit(price, 128, 29), "#ececec", price, "bold") +
          rangeBar(q) +
          `<rect x='8' y='106' width='128' height='30' rx='6' fill='${changeColor(q?.changePct)}'/>` +
          text(72, 128, 21, "#fff", fmtPct(q?.changePct), "bold"),
      );
    }
    case "stimmung": {
      const st = data?.stim?.[s.region];
      const v = st?.state === "ready" && Number.isFinite(st.value) ? Math.round(st.value) : null;
      const color = rankColor(v);
      return svg(
        text(72, 28, 17, "#ffa028", "ANGST&GIER", "bold") +
          text(72, 48, 17, "#8f8f8f", s.region === "eu" ? "EUROPA" : "USA") +
          text(72, 102, 54, color, v === null ? "…" : String(v), "bold") +
          text(72, 130, fit(st?.word || "rechnet", 128, 17), "#d8d8d8", st?.word || "rechnet …"),
        v !== null && (v < 5 || v > 95) ? color : "#262626",
      );
    }
    case "news": {
      const n = data?.news?.urgent ?? 0;
      const hot = n > 0;
      return svg(
        text(72, 34, 22, "#ffa028", "EILMELD.", "bold") +
          text(72, 96, 56, flash ? "#000" : hot ? "#ff8000" : "#5c5c5c", String(n), "bold") +
          text(72, 128, 15, "#8f8f8f", "letzte 3 Std."),
        flash ? "#ff8000" : hot ? "#ff8000" : "#262626",
      ).replace("fill='#0a0a0a'", flash ? "fill='#ff8000'" : "fill='#0a0a0a'");
    }
    case "alarme": {
      const n = data?.alerts?.active ?? 0;
      return svg(
        text(72, 34, 22, "#ffa028", "ALARME", "bold") +
          text(72, 96, 56, flash ? "#000" : "#ececec", String(n), "bold") +
          text(72, 128, 15, "#8f8f8f", flash ? "AUSGELÖST!" : "scharf"),
        flash ? "#ff3b30" : "#262626",
      ).replace("fill='#0a0a0a'", flash ? "fill='#ff3b30'" : "fill='#0a0a0a'");
    }
    case "depot": {
      const d = data?.depot;
      const pct = d?.dayPnlPct;
      return svg(
        text(72, 30, 20, "#ffa028", "DEPOT", "bold") +
          text(72, 52, 15, "#8f8f8f", "heute") +
          text(72, 92, fit(fmtPct(pct), 128, 30), pct > 0 ? "#29d17d" : pct < 0 ? "#ff5252" : "#ececec", d ? fmtPct(pct) : "–", "bold") +
          text(72, 124, 18, "#d8d8d8", d ? `${fmtMoney(d.dayPnl)} ${d.currency ?? ""}`.trim() : "kein Depot"),
      );
    }
    case "seite": {
      const label = PAGE_LABEL[s.page] ?? "SEITE";
      return svg(text(72, 58, 16, "#8f8f8f", "SEITE") + text(72, 98, fit(label, 124, 30), "#f2c200", label, "bold"), "#f2c200");
    }
    case "max":
      return svg(
        `<rect x='40' y='30' width='64' height='50' fill='none' stroke='#ececec' stroke-width='5'/>` + text(72, 120, 22, "#ececec", "MAX", "bold"),
      );
    default: {
      const label = s.label || s.command;
      return svg(text(72, 66, 16, "#8f8f8f", s.sub || "BEFEHL") + text(72, 104, fit(label, 124, 30), "#ffa028", label, "bold"), "#ff8000");
    }
  }
}

/** Lage des Kurses in der Tagesspanne (0 = Tagestief, 1 = Tageshoch); null ohne Spanne. */
export function rangePos(v, low, high) {
  if (![v, low, high].every(Number.isFinite) || high <= low) return null;
  return Math.min(1, Math.max(0, (v - low) / (high - low)));
}

const lowHighSize = (q) => {
  const chars = fmtPrice(q.low).length + fmtPrice(q.high).length + 1;
  return Math.max(13, Math.min(19, Math.floor(132 / (chars * 0.6))));
};

/** Tagesspanne: Balken von Tief bis Hoch, Punkt = aktueller Kurs, Strich = Vortagesschluss, darunter Tief und Hoch. */
function rangeBar(q) {
  const x0 = 14, x1 = 130, y = 74;
  const pos = rangePos(q?.last, q?.low, q?.high);
  if (pos === null) return text(72, 90, 13, "#5c5c5c", "keine Tagesspanne");
  const px = x0 + (x1 - x0) * pos;
  const prev = rangePos(q?.prevClose, q?.low, q?.high);
  const up = (q?.changePct ?? 0) >= 0;
  const dot = up ? "#29d17d" : "#ff5252";
  return (
    `<rect x='${x0}' y='${y - 3}' width='${x1 - x0}' height='6' rx='3' fill='#3a3a3a'/>` +
    // vom Vortagesschluss bis zum Kurs eingefärbt (wie weit der Tag gelaufen ist)
    (prev !== null ? `<rect x='${Math.min(px, x0 + (x1 - x0) * prev)}' y='${y - 3}' width='${Math.abs(px - (x0 + (x1 - x0) * prev))}' height='6' fill='${dot}' opacity='0.55'/>` : "") +
    (prev !== null ? `<rect x='${x0 + (x1 - x0) * prev - 1}' y='${y - 7}' width='2' height='14' fill='#d8d8d8'/>` : "") +
    `<circle cx='${px}' cy='${y}' r='6' fill='${dot}' stroke='#000' stroke-width='1.5'/>` +
    // so groß, wie beide Zahlen nebeneinander passen (auf dem Gerät wird das Bild auf 72 Pixel verkleinert)
    text(x0 - 6, 98, lowHighSize(q), "#b0b0b0", fmtPrice(q.low), "normal", "start") +
    text(x1 + 6, 98, lowHighSize(q), "#b0b0b0", fmtPrice(q.high), "normal", "end")
  );
}

export function titleOf(s) {
  return { stimmung: "STIM", news: "NEWS", alarme: "ALARME", depot: "DEPOT", max: "MAX" }[s.art] ?? (s.art === "seite" ? PAGE_LABEL[s.page] : s.label || s.command || "");
}

function shortName(name, ticker) {
  const base = (ticker || "").split(".")[0];
  if (!name) return base;
  return name.length <= 9 ? name : base;
}
