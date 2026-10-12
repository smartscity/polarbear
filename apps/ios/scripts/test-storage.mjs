import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const output = mkdtempSync(join(tmpdir(), "polarbear-reader-tests-"));
const binary = join(output, "reader-tests");
try {
  for (const [command, args] of [
    ["swiftc", ["-module-cache-path", join(output, "cache"), join(root, "src-tauri/reader-plugin/ios/Sources/ReaderLibrary.swift"), join(root, "tests/ReaderLibraryTests.swift"), "-o", binary]],
    [binary, []],
  ]) {
    const result = spawnSync(command, args, { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
  }
} finally { rmSync(output, { recursive: true, force: true }); }
