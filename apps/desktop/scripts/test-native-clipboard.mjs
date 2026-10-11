import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  console.log("SKIP: native clipboard receiver test requires macOS");
} else {
  const directory = mkdtempSync(join(tmpdir(), "polarbear-clipboard-test-"));
  const native = resolve(dirname(fileURLToPath(import.meta.url)), "../src-tauri/native");
  const binary = join(directory, "clipboard-test");
  const run = (command, args) => {
    const result = spawnSync(command, args, { stdio: "inherit", timeout: 120_000 });
    if (result.error || result.status !== 0) throw result.error ?? new Error(`${command} failed: ${result.status}`);
  };
  try {
    run("xcrun", ["swiftc", "-module-cache-path", join(directory, "modules"), "-parse-as-library",
      join(native, "DocumentClipboard.swift"), join(native, "DocumentClipboardTests.swift"), "-o", binary]);
    run(binary, []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
