import { test } from "node:test";
import assert from "node:assert/strict";
import { LAYOUT_15, defaultFor, normalizeSettings, remoteFor, partsFor, render, rankColor, fmtPct, fmtPrice, changeColor } from "../src/keys.js";

test("Vorbelegung nach Position (3 × 5)", () => {
  assert.equal(LAYOUT_15.length, 15);
  assert.deepEqual(defaultFor({ column: 0, row: 0 }), { art: "kurs", ticker: "GDAXI.INDX", label: "DAX" });
  assert.deepEqual(defaultFor({ column: 1, row: 1 }), { art: "stimmung", region: "us" });
  assert.deepEqual(defaultFor({ column: 4, row: 2 }), { art: "max" });
  assert.equal(defaultFor({ column: 2, row: 5 }).art, "kurs"); // außerhalb: Kursliste von vorn
  assert.equal(defaultFor(undefined).ticker, "GDAXI.INDX");
});

test("Einstellungen werden bereinigt", () => {
  assert.deepEqual(normalizeSettings({ art: "kurs", ticker: " sap.xetra ", label: "SAP" }), { art: "kurs", ticker: "SAP.XETRA", label: "SAP" });
  assert.deepEqual(normalizeSettings({ art: "seite", page: "irgendwo" }), { art: "seite", page: "equity" });
  assert.deepEqual(normalizeSettings({ art: "unsinn" }), { art: "befehl", command: "TOP", label: "TOP" });
  assert.equal(normalizeSettings({ art: "stimmung", region: "eu" }).region, "eu");
});

test("Drücken: Auftrag ans Terminal", () => {
  assert.deepEqual(remoteFor({ art: "kurs", ticker: "GDAXI.INDX" }), { command: "GDAXI.INDX GP" });
  assert.deepEqual(remoteFor({ art: "stimmung", region: "eu" }), { command: "STIM" });
  assert.deepEqual(remoteFor({ art: "seite", page: "macro" }), { page: "macro" });
  assert.deepEqual(remoteFor({ art: "max" }), { maximize: true });
  assert.deepEqual(remoteFor({ art: "befehl", command: "SAIS" }), { command: "SAIS" });
  assert.deepEqual(partsFor({ art: "stimmung", region: "eu" }), ["stim_eu"]);
});

test("Zahlen deutsch, Farben wie im Terminal", () => {
  assert.equal(fmtPct(1.2976), "+1,30 %");
  assert.equal(fmtPct(-0.05), "−0,05 %");
  assert.equal(fmtPct(null), "–");
  assert.equal(fmtPrice(24892.04), "24.892");
  assert.equal(fmtPrice(1.16973), "1,1697");
  assert.equal(rankColor(50), "#8f8f8f");
  assert.equal(rankColor(95), "#ff5fa2");
  assert.equal(rankColor(5), "#5b8cff");
  assert.match(changeColor(2), /^rgb\(41,209,125\)$/);
});

test("Bilder zeigen die Daten", () => {
  const data = { quotes: [{ ticker: "GDAXI.INDX", name: "DAX", last: 24892.04, changePct: 1.3 }], stim: { us: { value: 90.2, word: "sorglos", state: "ready" } },
    news: { urgent: 2 }, alerts: { active: 3 }, depot: { dayPnl: -53.8, dayPnlPct: -0.05, currency: "EUR" } };
  const kurs = render({ art: "kurs", ticker: "GDAXI.INDX", label: "DAX" }, data);
  assert.match(kurs, /24\.892/);
  assert.match(kurs, /\+1,30 %/);
  assert.match(render({ art: "stimmung", region: "us" }, data), />90</);
  assert.match(render({ art: "stimmung", region: "eu" }, data), /rechnet/);
  assert.match(render({ art: "news" }, data), />2</);
  assert.match(render({ art: "depot" }, data), /−0,05 %/);
  assert.match(render({ art: "kurs", ticker: "X.US", label: "<b>" }, null, { offline: true }), /nicht offen/);
  assert.doesNotMatch(render({ art: "befehl", command: "<script>", label: "<script>" }, null), /<script>/); // Text wird maskiert
});
