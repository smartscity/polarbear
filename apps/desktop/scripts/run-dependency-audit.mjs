import { spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { evaluateAudits } from "./check-dependency-audit.mjs";

const [outputArg, database] = process.argv.slice(2);
if (!database || !outputArg) throw new Error("Usage: run-dependency-audit.mjs OUTPUT_DIR RUSTSEC_DB");
const output = resolve(outputArg); mkdirSync(output, { recursive: true });
const version = (command, args) => execFileSync(command, args, { encoding: "utf8", timeout: 30_000 }).trim();
const meta = { timestamp: new Date().toISOString(), head: version("git", ["rev-parse", "HEAD"]),
  npm: version("npm", ["--version"]), cargoAudit: version("cargo", ["audit", "--version"]),
  rustsecCommit: version("git", ["-C", database, "rev-parse", "HEAD"]),
  npmDatabase: "npm advisory service at timestamp; service does not expose a database version",
  yankedCheck: "NOT RUN; separate from RustSec advisories", locks: Object.fromEntries(["Cargo.lock", "package-lock.json"].map((path) => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])) };
writeFileSync(join(output, "audit-provenance.json"), JSON.stringify(meta, null, 2) + "\n");
const scan = (name, command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 180_000, maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(join(output, `${name}.json`), result.stdout ?? "");
  writeFileSync(join(output, `${name}.stderr.log`), result.stderr ?? "");
  if (result.error || ![0, 1].includes(result.status)) throw new Error(`${name} scanner failed: ${result.error?.message ?? result.status}`);
  return JSON.parse(result.stdout);
};
const npm = scan("npm-audit", "npm", ["audit", "--json"]);
const cargo = scan("cargo-audit", "cargo", ["audit", "--db", database, "--no-fetch", "--no-yanked", "--json"]);
const report = evaluateAudits(npm, cargo, JSON.parse(readFileSync("package-lock.json")), JSON.parse(readFileSync("docs/engineering/dependency-exceptions.json")), meta.timestamp.slice(0, 10));
writeFileSync(join(output, "dependency-gate.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`${report.status}: ${report.findings.length} reviewed findings`);
for (const failure of report.failures) console.error(failure);
if (report.failures.length) process.exitCode = 1;
