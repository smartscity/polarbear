import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { build } from "vite";

if (process.platform !== "darwin") throw new Error("Native Gantt acceptance requires macOS WKWebView.");
const root = fileURLToPath(new URL("../", import.meta.url));
const output = mkdtempSync(path.join(tmpdir(), "polarbear-gantt-native-"));
try {
  await build({ configFile: false, root, logLevel: "warn", build: { outDir: output, emptyOutDir: false, minify: false,
    lib: { entry: path.join(root, "tests/browser/nativeGanttProbe.ts"), name: "GanttProbe", formats: ["iife"], fileName: () => "gantt.js" },
    rollupOptions: { output: { inlineDynamicImports: true } },
  } });
  execFileSync("swift", [path.join(root, "scripts/test-gantt-webview.swift"), path.join(output, "gantt.js"), path.join(root, "tests/fixtures/gantt-original.mmd")], { stdio: "inherit", timeout: 90_000 });
} finally { rmSync(output, { recursive: true, force: true }); }
