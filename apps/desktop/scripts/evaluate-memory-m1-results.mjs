#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  evaluateResults,
  loadCorpus,
  parseJsonLines,
  validateCorpus,
} from "./memory-m1-fixtures.mjs";

function usage() {
  return [
    "Usage:",
    "  node scripts/evaluate-memory-m1-results.mjs --partition development|held-out --results PATH [options]",
    "",
    "Options:",
    "  --corpus PATH       Use a non-default corpus file.",
    "  --report PATH       Also write the JSON report to PATH.",
    "  --require-evidence  Fail unless all designated evidence opens were measured and correct.",
    "  --require-latency   Fail unless every case includes latency and the supported-profile gates pass.",
    "",
    "Each result JSONL row must contain queryId and items. See the fixture README for the full contract.",
  ].join("\n");
}

function optionValue(argumentsList, option) {
  const index = argumentsList.indexOf(option);
  if (index < 0) return undefined;
  if (!argumentsList[index + 1]) throw new Error(`${option} requires a value.`);
  return argumentsList[index + 1];
}

try {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.includes("--help")) {
    console.log(usage());
    process.exit(0);
  }
  const partition = optionValue(argumentsList, "--partition");
  const resultPath = optionValue(argumentsList, "--results");
  if (!partition || !resultPath) throw new Error("--partition and --results are required.\n\n" + usage());
  const loaded = loadCorpus(optionValue(argumentsList, "--corpus"));
  validateCorpus(loaded.corpus, loaded);
  const observations = parseJsonLines(readFileSync(resolve(resultPath), "utf8"));
  const report = {
    generatedAt: new Date().toISOString(),
    corpusPath: loaded.path,
    corpusSha256: loaded.sha256,
    ...evaluateResults(loaded.corpus, partition, observations, {
      requireEvidence: argumentsList.includes("--require-evidence"),
      requireLatency: argumentsList.includes("--require-latency"),
    }),
  };
  const serialized = JSON.stringify(report, null, 2) + "\n";
  const reportPath = optionValue(argumentsList, "--report");
  if (reportPath) writeFileSync(resolve(reportPath), serialized, "utf8");
  process.stdout.write(serialized);
  if (report.overall !== "PASS") process.exitCode = 1;
} catch (error) {
  if (error instanceof AggregateError) {
    console.error(error.message);
    for (const item of error.errors) console.error(`- ${item.message}`);
  } else {
    console.error(error.stack ?? error.message);
  }
  process.exit(1);
}
