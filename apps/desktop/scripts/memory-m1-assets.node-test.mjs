import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateResults,
  loadCorpus,
  queryCases,
  validateCorpus,
} from "./memory-m1-fixtures.mjs";

const loaded = loadCorpus();

function passingObservation(query) {
  const item = query.expectedEligibleIds[0]
    ? { cardId: query.expectedEligibleIds[0], decision: "REUSABLE", rank: 1, reasonCodes: ["SCOPE_AND_SOURCE_VALID"] }
    : undefined;
  return {
    queryId: query.id,
    items: item ? [item] : [],
    reviewNotices: [],
    initialResponseMs: 25,
    usableResponseMs: 50,
    partial: false,
    evidenceOpen: query.evidenceCheck ? {
      cardId: query.expectedEligibleIds[0],
      relativePath: query.expectedEvidence.relativePath,
      startLine: query.expectedEvidence.startLine,
      endLine: query.expectedEvidence.endLine,
      selectedText: query.expectedEvidence.selectedText,
      qualifierText: query.expectedEvidence.qualifierText,
    } : undefined,
  };
}

test("the frozen corpus satisfies the M1 oracle invariants", () => {
  const summary = validateCorpus(loaded.corpus, loaded);
  assert.equal(summary.cards, 30);
  assert.equal(summary.sourceFiles, 30);
  assert.equal(summary.developmentQueries, 100);
  assert.equal(summary.heldOutQueries, 100);
  assert.match(summary.sha256, /^[0-9a-f]{64}$/u);
});

test("the scorer accepts complete safe results and measures evidence and latency", () => {
  for (const partition of ["development", "held-out"]) {
    const queries = queryCases(loaded.corpus, partition);
    const report = evaluateResults(loaded.corpus, partition, queries.map(passingObservation), {
      requireEvidence: true,
      requireLatency: true,
    });
    assert.equal(report.overall, "PASS");
    assert.equal(report.gates.searchSafetyAndFindability, "PASS");
    assert.equal(report.gates.evidence, "PASS");
    assert.equal(report.gates.supportedProfileLatency, "PASS");
    assert.equal(report.metrics.eligibleHitAt5, 1);
    assert.equal(report.metrics.precisionAt5, 1);
  }
});

test("the scorer fails an unsafe wrong-task reuse", () => {
  const queries = queryCases(loaded.corpus, "development");
  const observations = queries.map(passingObservation);
  const unsafeQuery = queries.find((query) => query.class === "wrong-task");
  const observation = observations.find((candidate) => candidate.queryId === unsafeQuery.id);
  observation.items = [{ cardId: unsafeQuery.forbiddenCardIds[0], decision: "REUSABLE", rank: 1 }];
  const report = evaluateResults(loaded.corpus, "development", observations);
  assert.equal(report.overall, "FAIL");
  assert.equal(report.counts.unsafeReuse, 1);
  assert.equal(report.gates.searchSafetyAndFindability, "FAIL");
});

test("the scorer does not treat missing observations as successful rejection", () => {
  const report = evaluateResults(loaded.corpus, "held-out", []);
  assert.equal(report.overall, "FAIL");
  assert.equal(report.failures.missingQueries.length, 100);
  assert.equal(report.metrics.eligibleHitAt5, 0);
});
