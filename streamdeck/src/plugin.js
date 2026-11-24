// Stream-Deck-Plugin „Market Terminal“ (Stream-Deck-Schnittstelle SDK 2, WebSocket).
//
// - Jede „Terminal-Taste“ zeigt Live-Daten (Kurs, Angst & Gier, Eilmeldungen, Alarme, Depot) oder ist ein Knopf
//   (Seite, Befehl, Maximieren). Eine frisch platzierte Taste belegt sich nach ihrer Position selbst (Vorschlag
//   für das Stream Deck mit 15 Tasten); jede Taste lässt sich in den Einstellungen ändern.
// - Drücken schickt einen Auftrag an das laufende Terminal (POST /api/remote) – dieselben Befehle wie in der
//   Befehlszeile. Nur lesend: nichts wird gekauft, verkauft oder geändert.
// - Daten kommen alle paar Sekunden aus GET /api/deck. Läuft das Terminal nicht, zeigen die Tasten „nicht offen“.

import WebSocket from "ws";
import { DEFAULT_URL, defaultFor, normalizeSettings, partsFor, remoteFor, render, dataUrl } from "./keys.js";

const POLL_MS = 5000;
const FLASH_MS = 6000;

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i].startsWith("-")) out[argv[i].slice(1)] = argv[i + 1];
  }
  return out;
}

export function terminalUrl(raw) {
  const s = String(raw || "").trim().replace(/\/+$/, "");
  // nur der eigene Rechner – das Terminal ist ohnehin nur dort erreichbar
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d{2,5})?$/i.test(s) ? s : DEFAULT_URL;
}

export class Plugin {
  constructor({ send, fetchImpl = globalThis.fetch, now = () => Date.now(), log = () => {} }) {
    this.send = send; // Nachricht an die Stream-Deck-Software
    this.fetch = fetchImpl;
    this.now = now;
    this.log = log;
    this.keys = new Map(); // context -> { settings, coords }
    this.url = DEFAULT_URL;
    this.data = null;
    this.offline = false;
    this.seen = { news: undefined, alert: undefined };
    this.flashUntil = { news: 0, alarme: 0 };
    this.lastImages = new Map();
    this.uuid = "";
  }

  // --- Ereignisse der Stream-Deck-Software ------------------------------------------------------

  async onMessage(msg) {
    const { event, context, payload } = msg;
    switch (event) {
      case "willAppear": {
        let settings = payload?.settings ?? {};
        if (!settings.art) {
          // neue Taste: Vorbelegung nach Position und gleich speichern (verschieben ändert sie dann nicht mehr)
          settings = defaultFor(payload?.coordinates);
          this.send({ event: "setSettings", context, payload: settings });
        }
        const clean = normalizeSettings(settings);
        // bereinigt oder umbenannt (z. B. alte Vorbelegung BRIEF -> MORGEN-BRIEFING): auch dort speichern
        if (settings.art && JSON.stringify(clean) !== JSON.stringify(settings)) this.send({ event: "setSettings", context, payload: clean });
        this.keys.set(context, { settings: clean, coords: payload?.coordinates });
        this.draw(context, true);
        void this.poll();
        break;
      }
      case "willDisappear":
        this.keys.delete(context);
        this.lastImages.delete(context);
        break;
      case "didReceiveSettings": {
        const k = this.keys.get(context);
        if (k) {
          k.settings = normalizeSettings(payload?.settings ?? {});
          this.draw(context, true);
          void this.poll(); // neue Werte sofort holen
        }
        break;
      }
      case "didReceiveGlobalSettings":
        this.url = terminalUrl(payload?.settings?.url);
        void this.poll();
        break;
      case "keyDown":
        await this.press(context);
        break;
      case "systemDidWakeUp":
        void this.poll();
        break;
      default:
        break;
    }
  }

  // --- Drücken: Auftrag ans Terminal ------------------------------------------------------------

  async press(context) {
    const k = this.keys.get(context);
    if (!k) return;
    const body = remoteFor(k.settings);
    try {
      const r = await this.fetch(`${this.url}/api/remote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.delivered) {
        // Terminal läuft, aber kein Fenster offen – oder Befehl abgelehnt
        this.log(`Auftrag nicht ausgeführt: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
        this.send({ event: "showAlert", context });
        return;
      }
      if (k.settings.art === "news") this.flashUntil.news = 0;
      if (k.settings.art === "alarme") this.flashUntil.alarme = 0;
    } catch (e) {
      this.log(`Terminal nicht erreichbar: ${e?.message ?? e}`);
      this.send({ event: "showAlert", context });
    }
  }

  // --- Daten holen und zeichnen ----------------------------------------------------------------

  query() {
    const tickers = new Set();
    const parts = new Set();
    for (const { settings } of this.keys.values()) {
      if (settings.art === "kurs") tickers.add(settings.ticker);
      for (const p of partsFor(settings)) parts.add(p);
    }
    const q = new URLSearchParams();
    if (tickers.size) q.set("tickers", [...tickers].join(","));
    if (parts.size) q.set("parts", [...parts].join(","));
    return q.toString();
  }

  async poll() {
    if (!this.keys.size) return;
    if (this._polling) {
      this._again = true; // neue Taste oder Einstellung während eines Abrufs: gleich danach noch einmal
      return;
    }
    this._polling = true;
    this._again = false;
    try {
      const r = await this.fetch(`${this.url}/api/deck?${this.query()}`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      this.noticeChanges(data);
      this.data = data;
      this.offline = false;
    } catch (e) {
      if (!this.offline) this.log(`Terminal nicht erreichbar (${e?.message ?? e})`);
      this.offline = true;
    } finally {
      this._polling = false;
    }
    for (const ctx of this.keys.keys()) this.draw(ctx);
    if (this._again) void this.poll();
  }

  /** Neue Eilmeldung bzw. neu ausgelöster Alarm: Taste blinkt einige Sekunden (nicht beim ersten Abruf). */
  noticeChanges(data) {
    const newsId = data?.news?.latestId ?? null;
    const alertId = data?.alerts?.lastEventId ?? null;
    if (this.seen.news !== undefined && newsId && newsId !== this.seen.news) this.flashUntil.news = this.now() + FLASH_MS;
    if (this.seen.alert !== undefined && alertId && alertId !== this.seen.alert) this.flashUntil.alarme = this.now() + FLASH_MS;
    this.seen = { news: newsId, alert: alertId };
  }

  draw(context, force = false) {
    const k = this.keys.get(context);
    if (!k) return;
    const art = k.settings.art;
    const flashing = (art === "news" || art === "alarme") && this.flashUntil[art] > this.now();
    // im Blinken zwischen hell und normal wechseln (Takt 1 s)
    const flash = flashing && Math.floor(this.now() / 1000) % 2 === 0;
    const offline = this.offline && !["seite", "max", "befehl"].includes(art);
    const image = dataUrl(render(k.settings, this.data, { flash, offline }));
    if (!force && this.lastImages.get(context) === image) return;
    this.lastImages.set(context, image);
    this.send({ event: "setImage", context, payload: { image, target: 0 } });
  }

  tick() {
    // blinkende Tasten jede Sekunde neu zeichnen
    for (const [ctx, k] of this.keys) {
      if ((k.settings.art === "news" || k.settings.art === "alarme") && this.flashUntil[k.settings.art] > this.now() - 1000) this.draw(ctx);
    }
  }
}

// --- Start durch die Stream-Deck-Software ----------------------------------------------------------

export function start(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const ws = new WebSocket(`ws://127.0.0.1:${args.port}`);
  const send = (msg) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  const plugin = new Plugin({
    send,
    log: (message) => send({ event: "logMessage", payload: { message: `[Market Terminal] ${message}` } }),
  });
  plugin.uuid = args.pluginUUID;
  ws.on("open", () => {
    ws.send(JSON.stringify({ event: args.registerEvent, uuid: args.pluginUUID }));
    send({ event: "getGlobalSettings", context: args.pluginUUID });
  });
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    void plugin.onMessage(msg);
  });
  ws.on("close", () => process.exit(0));
  setInterval(() => void plugin.poll(), POLL_MS);
  setInterval(() => plugin.tick(), 1000);
  return plugin;
}

if (process.argv.includes("-registerEvent")) start();
