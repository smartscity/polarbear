import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAudits } from "./check-dependency-audit.mjs";

const npm = { metadata: { vulnerabilities: {} }, vulnerabilities: {
  renderer: { severity: "low", via: ["math"], nodes: ["node_modules/renderer"] },
  math: { severity: "low", via: [{ url: "https://github.com/advisories/GHSA-test-1234-5678", severity: "low" }], nodes: ["node_modules/math"] },
} };
const cargo = { database: {}, vulnerabilities: { list: [] }, warnings: { unsound: [{ advisory: { id: "RUSTSEC-TEST" }, package: { name: "native", version: "1" } }] } };
const lock = { packages: { "node_modules/math": { version: "1" } } };
const policy = { exceptions: [
  { id: "GHSA-test-1234-5678", package: "math", version: "1", kind: "low", expires: "2026-11-24", reason: "Scoped renderer review" },
  { id: "RUSTSEC-TEST", package: "native", version: "1", kind: "unsound", expires: "2026-11-24", reason: "Scoped platform review" },
] };
const run = (n = npm, c = cargo, l = lock, day = "2026-10-27") => evaluateAudits(n, c, l, policy, day);
test("reviews a transitive finding once and retains exact expiring exceptions", () => {
  const report = run(); assert.equal(report.status, "PASS"); assert.equal(report.findings.length, 2);
});
test("blocks expired, changed-version and newly severe findings", () => {
  assert.equal(run(npm, cargo, lock, "2026-11-25").status, "FAIL");
  assert.equal(run(npm, cargo, { packages: { "node_modules/math": { version: "2" } } }).status, "FAIL");
  const severe = structuredClone(npm); severe.vulnerabilities.math.via[0].severity = "high";
  assert.equal(run(severe).status, "FAIL");
});
test("blocks new native warnings, vulnerability findings and malformed scanner output", () => {
  const changed = structuredClone(cargo); changed.warnings.unsound[0].advisory.id = "NEW";
  assert.equal(run(npm, changed).status, "FAIL");
  const vulnerable = structuredClone(cargo); vulnerable.vulnerabilities.list = vulnerable.warnings.unsound;
  assert.equal(run(npm, vulnerable).status, "FAIL");
  assert.equal(run({}, cargo).status, "FAIL"); assert.equal(run(npm, {}).status, "FAIL");
});
test("rejects unresolvable transitive chains instead of silently treating them as reviewed", () => {
  const changed = structuredClone(npm); delete changed.vulnerabilities.math;
  assert.equal(run(changed).status, "FAIL");
});
