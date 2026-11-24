// Ende-zu-Ende ohne Gerät: eine nachgebaute Stream-Deck-Software startet das gebaute Plugin (bin/plugin.js) wie die
// echte, dazu ein nachgebautes Terminal. Geprüft: Anmeldung, Vorbelegung, Live-Bilder, Drücken, Blinken, offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { WebSocketServer } from "ws";

const PLUGIN = new URL("../com.marketterminal.terminal.sdPlugin/bin/plugin.js", import.meta.url).pathname;

function fakeTerminal() {
  const state = { remote: [], deck: [], delivered: 1, urgentId: "n1" };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url.startsWith("/api/deck")) {
        state.deck.push(req.url);
        res.end(JSON.stringify({ quotes: [{ ticker: "GDAXI.INDX", name: "DAX", last: 24012.4, changePct: -0.8 }],
          stim: { us: { value: 42, word: "eher vorsichtig", state: "ready" } }, news: { urgent: 1, latestId: state.urgentId },
          alerts: { active: 2, lastEventId: null }, depot: null, windows: 1 }));
      } else if (req.url === "/api/remote" && req.method === "POST") {
        state.remote.push({ body: JSON.parse(body), ctype: req.headers["content-type"], origin: req.headers.origin });
        res.end(JSON.stringify({ delivered: state.delivered, target: "main" }));
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
  });
  return { server, state };
}

const until = async (cond, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Zeitüberschreitung");
};

test("Plugin mit nachgebauter Stream-Deck-Software und Terminal", async () => {
  const term = fakeTerminal();
  await new Promise((r) => term.server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${term.server.address().port}`;
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((r) => wss.on("listening", r));
  const got = [];
  let sock;
  wss.on("connection", (s) => {
    sock = s;
    s.on("message", (m) => got.push(JSON.parse(String(m))));
  });
  const child = spawn(process.execPath, [PLUGIN, "-port", String(wss.address().port), "-pluginUUID", "PLUG", "-registerEvent", "registerPlugin", "-info", "{}"], { stdio: "pipe" });
  try {
    await until(() => got.some((m) => m.event === "registerPlugin" && m.uuid === "PLUG"));
    await until(() => got.some((m) => m.event === "getGlobalSettings"));
    const send = (m) => sock.send(JSON.stringify(m));
    send({ event: "didReceiveGlobalSettings", payload: { settings: { url } } });
    // drei frische Tasten: oben links (DAX), Mitte (Angst & Gier USA), unten rechts (Maximieren)
    const A = "com.marketterminal.terminal.taste";
    for (const [ctx, column, row] of [["k0", 0, 0], ["k6", 1, 1], ["k14", 4, 2], ["k8", 3, 1]]) {
      send({ event: "willAppear", action: A, context: ctx, payload: { settings: {}, coordinates: { column, row } } });
    }
    await until(() => got.filter((m) => m.event === "setSettings").length === 4);
    assert.deepEqual(got.find((m) => m.event === "setSettings" && m.context === "k0").payload, { art: "kurs", ticker: "GDAXI.INDX", label: "DAX" });
    assert.deepEqual(got.find((m) => m.event === "setSettings" && m.context === "k6").payload, { art: "stimmung", region: "us" });
    const img = (ctx, re) => got.some((m) => m.event === "setImage" && m.context === ctx && re.test(decodeURIComponent(m.payload.image)));
    await until(() => img("k0", /24\.012/) && img("k0", /−0,80 %/));
    await until(() => img("k6", />42</));
    assert.ok(term.state.deck.some((u) => u.includes("tickers=GDAXI.INDX") && u.includes("stim_us") && u.includes("news")));
    // Drücken: Auftrag als JSON ohne Origin (wird von der Zugriffsprüfung des Terminals angenommen)
    send({ event: "keyDown", action: A, context: "k0", payload: { settings: {} } });
    send({ event: "keyDown", action: A, context: "k14", payload: { settings: {} } });
    await until(() => term.state.remote.length === 2);
    assert.deepEqual(term.state.remote[0].body, { command: "GDAXI.INDX GP" });
    assert.deepEqual(term.state.remote[1].body, { maximize: true });
    assert.equal(term.state.remote[0].ctype, "application/json");
    assert.equal(term.state.remote[0].origin, undefined);
    // kein Terminal-Fenster offen: Warnsymbol auf der Taste
    term.state.delivered = 0;
    send({ event: "keyDown", action: A, context: "k6", payload: { settings: {} } });
    await until(() => got.some((m) => m.event === "showAlert" && m.context === "k6"));
    // neue Eilmeldung: Taste blinkt (orange Fläche)
    term.state.urgentId = "n2";
    await until(() => img("k8", /fill='#ff8000'/), 12000);
    // Einstellungen geändert: neuer Wert wird abgefragt
    send({ event: "didReceiveSettings", action: A, context: "k0", payload: { settings: { art: "kurs", ticker: "SAP.XETRA", label: "SAP" } } });
    await until(() => term.state.deck.some((u) => u.includes("SAP.XETRA")));
    // Terminal beendet: Tasten zeigen „nicht offen“, Knöpfe bleiben
    await new Promise((r) => term.server.close(r));
    term.server.closeAllConnections?.();
    await until(() => img("k6", /nicht offen/), 12000);
  } finally {
    child.kill();
    wss.close();
    term.server.close();
  }
});
