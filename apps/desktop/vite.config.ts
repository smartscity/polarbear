import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { bundledTranslationAssets } from "./scripts/bundled-translation-assets.mjs";

export default defineConfig({
  plugins: [react(), bundledTranslationAssets()],
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { input: { main: "index.html", caption: "caption.html" } }
  }
});
