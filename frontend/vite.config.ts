/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// "static"-Modus: Build ohne Backend, liest vorab exportierte JSON-Dateien aus ./data
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    __STATIC__: JSON.stringify(mode === "static"),
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: "node",
  },
}));
