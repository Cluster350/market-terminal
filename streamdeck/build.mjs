// Baut das Plugin: bündelt src/ (mit der WebSocket-Bibliothek) nach *.sdPlugin/bin/plugin.js und packt das
// installierbare Paket dist/Market Terminal.streamDeckPlugin (ein ZIP mit dem *.sdPlugin-Ordner).
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

const DIR = "com.marketterminal.terminal.sdPlugin";
await build({
  entryPoints: ["src/plugin.js"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: `${DIR}/bin/plugin.js`,
  external: ["bufferutil", "utf-8-validate"], // optionale Beschleuniger von ws
  legalComments: "inline",
  banner: { js: "// Market Terminal – Stream-Deck-Plugin (gebaut mit build.mjs aus src/; nicht von Hand ändern)" },
});
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
execFileSync("zip", ["-qr", "-X", `dist/Market Terminal.streamDeckPlugin`, DIR, "-x", `${DIR}/logs/*`]);
console.log("fertig: dist/Market Terminal.streamDeckPlugin");
