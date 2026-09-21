# Long-memory M1 frozen corpus

This directory contains the independent oracle for M1's reliable next-day reuse claim. It is synthetic, local-only test data. It is not evidence that an implementation passed M1.

`corpus.v1.json` freezes 30 source-backed conclusions, exact Markdown bytes and locators, ownership and working-copy contexts, source mutations, 90 answerable queries and 10 safety/no-answer queries in each of the development and held-out partitions. `COMPATIBLE_SOURCES` entries represent cards that already completed an explicit review; new cards still begin as `CAPTURED_CONTEXT`.

Do not tune aliases, ranking rules, or thresholds from held-out failures and continue to describe that partition as unseen. If a held-out case is ambiguous or wrong, version the corpus and record the adjudication instead of editing the frozen file silently.

## Validate the oracle

Run from `apps/desktop`:

```sh
npm run memory-m1:fixtures:check
npm run memory-m1:assets:test
```

To emit request-only JSON Lines without expected IDs:

```sh
node scripts/validate-memory-m1-fixtures.mjs --requests development
node scripts/validate-memory-m1-fixtures.mjs --requests held-out
```

The harness that exercises Polarbear must use Memory Admin API 1.8 and map each runtime Card UUID back to its frozen `m1-NNN` oracle ID. It must not inspect `memory.db` or obtain expected labels while issuing requests.

After building Polarbear Memory, the included isolated cross-process harness can capture the corpus, restart the Engine, execute one partition, open designated evidence, and score the observations:

```sh
npm run memory-m1:engine-evaluate -- \
  --engine-node /absolute/path/to/node \
  --engine-cli /absolute/path/to/polarbear-memory/dist/cli.js \
  --partition development \
  --results /absolute/path/development-results.jsonl \
  --report /absolute/path/development-report.json
```

The harness creates synthetic Git projects and a private data root under the operating-system temporary directory. It removes that fixture on completion unless `--keep-fixture` is passed.

## Score observed results

Each JSON Lines observation contains:

```json
{
  "queryId": "held-out:m1-001:natural",
  "items": [{ "cardId": "m1-001", "decision": "REUSABLE", "rank": 1, "reasonCodes": [] }],
  "reviewNotices": [],
  "partial": false,
  "initialResponseMs": 42,
  "usableResponseMs": 58,
  "evidenceOpen": {
    "cardId": "m1-001",
    "relativePath": "docs/settlement/recovery.md",
    "startLine": 3,
    "endLine": 3,
    "selectedText": "A FAILED settlement must not be retried automatically.",
    "qualifierText": "Qualifier: an operator may retry only after proving that no provider submission completed."
  }
}
```

Score a complete run with:

```sh
npm run memory-m1:evaluate -- \
  --partition held-out \
  --results /absolute/path/results.jsonl \
  --require-evidence \
  --require-latency \
  --report /absolute/path/report.json
```

The scorer reports raw counts, precision@5, eligible hit@5, unsafe reuse, misleading no-answer results, false withholding, pending fraction, evidence correctness, and P50/P95/P99 latency. Missing or unknown observations fail the search gate; an always-empty result cannot pass.

The corpus does not replace the real cross-process smoke test, supported-profile load run, or delayed-use pilot. Keep participant data outside this directory.
