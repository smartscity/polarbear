import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { build } from "vite";

if (process.platform !== "darwin") throw new Error("Native WKWebView settings acceptance requires macOS.");
const root = fileURLToPath(new URL("../", import.meta.url));
const output = mkdtempSync(path.join(tmpdir(), "polarbear-settings-test-"));
try {
  await build({
    configFile: false, root, logLevel: "warn",
    build: { outDir: output, emptyOutDir: false, minify: false,
      lib: { entry: path.join(root, "src/shared/settings/settingsDatabase.ts"), name: "SettingsPersistence", formats: ["iife"], fileName: () => "settings.js" },
    },
  });
  execFileSync("swift", [path.join(root, "scripts/test-settings-webview.swift"), path.join(output, "settings.js")], { stdio: "inherit", timeout: 60_000 });
} finally {
  rmSync(output, { recursive: true, force: true });
}
