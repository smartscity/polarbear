import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Reject new findings; exceptions are exact, expiring and severity-sensitive. */
export function evaluateAudits(npm, cargo, lock, policy, today) {
  const findings = [], failures = [];
  const accept = (finding) => {
    const exception = policy.exceptions.find((entry) =>
      ["id", "package", "version", "kind"].every((key) => entry[key] === finding[key]));
    const accepted = exception && exception.expires >= today && exception.reason?.trim()
      && !["high", "critical", "vulnerability"].includes(finding.kind);
    findings.push({ ...finding, status: accepted ? "PASS" : "FAIL", exception: accepted ? exception : null });
    if (!accepted) failures.push(`${finding.id}: ${finding.package}@${finding.version} (${finding.kind})`);
  };
  if (!npm.metadata?.vulnerabilities || !npm.vulnerabilities || npm.error) failures.push("Incomplete npm audit");
  const checked = new Set();
  const visit = (name, chain = new Set()) => {
    if (checked.has(name)) return;
    if (chain.has(name)) { failures.push(`Cyclic npm advisory chain: ${name}`); return; }
    const entry = npm.vulnerabilities?.[name];
    if (!entry || !Array.isArray(entry.via) || !entry.via.length) {
      failures.push(`Missing npm advisory: ${name}`); return;
    }
    const next = new Set(chain).add(name);
    for (const via of entry.via) {
      if (typeof via === "string") { visit(via, next); continue; }
      const id = via.url?.match(/GHSA-[\w-]+/)?.[0];
      if (!id || !entry.nodes?.length) { failures.push(`Unidentified npm advisory: ${name}`); continue; }
      for (const path of entry.nodes) accept({ id, package: name, version: lock.packages?.[path]?.version, kind: via.severity });
    }
    // A transitive advisory cannot downgrade a newly raised severity.
    if (["high", "critical"].includes(entry.severity)) failures.push(`Severe npm dependency: ${name}`);
    checked.add(name);
  };
  for (const name of Object.keys(npm.vulnerabilities ?? {})) visit(name);
  if (!cargo.database || !Array.isArray(cargo.vulnerabilities?.list) || !cargo.warnings || cargo.error) failures.push("Incomplete Cargo audit");
  for (const item of cargo.vulnerabilities?.list ?? []) accept({ id: item.advisory.id, package: item.package.name, version: item.package.version, kind: "vulnerability" });
  for (const [kind, rows] of Object.entries(cargo.warnings ?? {})) {
    for (const item of rows) accept({ id: item.advisory?.id ?? "UNKNOWN", package: item.package?.name, version: item.package?.version, kind });
  }
  return { status: failures.length ? "FAIL" : "PASS", evaluatedAt: today, findings, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [npmPath, cargoPath, output] = process.argv.slice(2);
  if (!output) throw new Error("Usage: check-dependency-audit.mjs NPM_JSON CARGO_JSON OUTPUT_JSON");
  const read = async (path) => JSON.parse(await readFile(path, "utf8"));
  const report = evaluateAudits(await read(npmPath), await read(cargoPath), await read("package-lock.json"), await read("docs/engineering/dependency-exceptions.json"), new Date().toISOString().slice(0, 10));
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(`${report.status}: ${report.findings.length} dependency findings reviewed`);
  for (const failure of report.failures) console.error(failure);
  if (report.failures.length) process.exitCode = 1;
}
