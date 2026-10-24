import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { auditArchitecture, cyclesIn, root } from "./architecture-graph.mjs";

test("detects self and indirect dependency cycles without rejecting shared leaves", () => {
  assert.deepEqual(cyclesIn(new Map([["a", ["b", "c"]], ["b", ["c"]], ["c", []]])), []);
  assert.deepEqual(cyclesIn(new Map([["a", ["b"]], ["b", ["a"]], ["c", ["c"]]])), [["a", "b", "a"], ["c", "c"]]);
});

test("production imports have no runtime cycles or reverse shared and feature dependencies", () => {
  const report = auditArchitecture();
  assert.deepEqual(report.runtimeCycles, []);
  assert.deepEqual(report.forbidden, []);
  assert.deepEqual(report.unresolved, []);
});

test("quality and macOS release keep native correctness and all-target lint checks", () => {
  for (const file of ["quality.yml", "release.yml"]) {
    const workflow = readFileSync(join(root, ".github/workflows", file), "utf8");
    assert.match(workflow, /cargo clippy --all-targets --all-features -- -D warnings/);
    assert.match(workflow, /cargo test --manifest-path apps\/desktop\/src-tauri\/Cargo.toml --no-fail-fast/);
    assert.match(workflow, /npm --workspace apps\/desktop run memory-contract:check/);
  }
  const release = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");
  assert.match(release, /npm --workspace apps\/desktop run test:ui/);
  assert.match(release, /npm --workspace apps\/desktop run test:offline-translation -- --webkit/);
  assert.match(release, /test:native-clipboard -- test-results\/real-mermaid-clipboard.json/);
});
