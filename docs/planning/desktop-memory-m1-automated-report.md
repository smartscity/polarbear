# Desktop long-memory M1 automated evaluation report

Status: Automated development and held-out evaluation completed. Decision: **REVISE**. The development partition passed, the held-out partition failed, and the delayed-use human pilot has not been run.

Date: 2026-09-21.

Acceptance specification: [M1 validation: reliable next-day knowledge reuse](desktop-memory-m1-validation-plan.md).

## 1. Decision and scope

| Item | Result |
|---|---|
| Decision | **REVISE** |
| Development partition | **PASS** |
| Held-out partition | **FAIL** |
| Delayed-use human pilot | **NOT RUN** |
| M1 accepted | **NO** |
| Token-saving claim | **NONE** |

The held-out search/safety/findability gate and evidence gate failed. Zero unsafe reuse was observed in both automated partitions, but that safety result does not compensate for held-out precision of `22 / 30` reusable results shown (`0.7333333333333333`), eligible hit@5 of `22 / 90` answerable queries (`0.24444444444444444`), or only `9 / 30` required evidence checks being correct. The automated latency gate passed for both runs.

This report covers only the synthetic cross-process Engine harness represented by the two result and report artifacts below. It does not claim completion of the delayed-use study, the broader load matrix, or every technical-suite gate named in the validation plan.

## 2. Frozen inputs and reproducibility

| Item | Value |
|---|---|
| Corpus ID | `polarbear-long-memory-m1-v1` |
| Frozen corpus | [`apps/desktop/fixtures/long-memory-m1/corpus.v1.json`](../../apps/desktop/fixtures/long-memory-m1/corpus.v1.json) |
| Corpus frozen at | `2026-09-20T00:00:00.000Z` |
| Corpus shape | 30 Cards, 30 source files, 90 answerable plus 10 safety/no-answer queries per partition |
| Corpus SHA-256 | `3f875f617fefdf3990f3e456cca43e9e6cbeba65bfa0484a0eadb6e665eddb91` |
| Engine CLI recorded by both reports | `/Users/liyunlong/git/smartscity/polarbear-memory/dist/cli.js` |
| Harness | `apps/desktop/scripts/run-memory-m1-engine-evaluation.mjs`; evidence and latency are required by the harness scorer |
| Development report | `/private/tmp/pbm-m1-development-report.json`; generated `2026-09-20T18:12:20.922Z`; SHA-256 `51fba97019a9ac33aab2f811a455b34e22065c21a760b074fb0fd81c2d040a16` |
| Development observations | `/private/tmp/pbm-m1-development-results.jsonl`; 100 rows; SHA-256 `bf2793f73c04a3723d9d365f6ffce893ab00212d591865ca6ae4ce767e39308a` |
| Held-out report | `/private/tmp/pbm-m1-held-out-report.json`; generated `2026-09-20T18:13:12.038Z`; SHA-256 `0508dd49395dc60a48f41580ca3d38f13946c82b0a8ca25c6e67fce0bd0a1c25` |
| Held-out observations | `/private/tmp/pbm-m1-held-out-results.jsonl`; 100 rows; SHA-256 `313e93e32bc0a819a8103de0a533869b53ffe56a8678a37f33d41db75b252a83` |

The report JSON does not record the Desktop revision, Memory revision, Node runtime, machine profile, filesystem, OS-cache condition, or hashes of the built Engine files. The `/private/tmp` paths are ephemeral. The hashes above identify the measured artifacts, but the missing build and host metadata prevent a claim of complete environment reproducibility.

## 3. Automated gate results

| Gate | Development | Held-out |
|---|---:|---:|
| Search safety and findability | **PASS** | **FAIL** |
| Evidence | **PASS** | **FAIL** |
| Supported-profile latency scorer | **PASS** | **PASS** |
| Overall | **PASS** | **FAIL** |

The scorer's combined search gate failed on held-out findability and relevance, not on an observed unsafe-reuse event. Both reports contain zero missing query observations, zero duplicate or unknown result IDs, zero misleading no-answer results, zero disclosure failures, and zero unsafe-reuse failures.

## 4. Retrieval and safety measurements

| Metric | Development | Held-out | M1 rule |
|---|---:|---:|---:|
| Expected / observed queries | `100 / 100` | `100 / 100` | Complete run |
| Answerable queries | `90` | `90` | Raw denominator |
| Eligible hit@5 | `90 / 90` (`1`) | `22 / 90` (`0.24444444444444444`) | Development `1`; held-out at least `0.9` overall and `0.8` per answerable class |
| Relevant / reusable results shown | `90 / 94` | `22 / 30` | Raw precision denominator |
| Precision@5 | `0.9574468085106383` | `0.7333333333333333` | At least `0.9` |
| Unsafe reusable results | `0 / 94` | `0 / 30` | `0` |
| Misleading no-answer | `0 / 10` | `0 / 10` | `0` |
| False withholding | `0 / 90` | `0 / 90` | Investigate every cause |
| Pending answerable | `0 / 90` | `0 / 90` | No more than `0.05` in a claimed profile |
| Pending fraction | `0` | `0` | No more than `0.05` |

### Answerable query classes

| Partition / class | Hit@5 | Reusable shown | Relevant shown | Precision@5 | Class result |
|---|---:|---:|---:|---:|---|
| Development / direct | `30 / 30` (`1`) | `31` | `30` | `0.967741935483871` | Pass |
| Development / identifier | `30 / 30` (`1`) | `32` | `30` | `0.9375` | Pass |
| Development / paraphrase | `30 / 30` (`1`) | `31` | `30` | `0.967741935483871` | Pass |
| Held-out / alternate-language | `4 / 30` (`0.13333333333333333`) | `5` | `4` | `0.8` | Fail hit@5 |
| Held-out / natural | `9 / 30` (`0.3`) | `13` | `9` | `0.6923076923076923` | Fail hit@5 and precision |
| Held-out / situational | `9 / 30` (`0.3`) | `12` | `9` | `0.75` | Fail hit@5 and precision |

All three held-out answerable classes are listed in `classHitFailures`. The ten non-answerable safety cases in each partition cover changed source, denied project, no answer, same-keyword distractor, task required, unavailable source, wrong task, and wrong working copy. None produced a reusable result or prohibited disclosure in these runs.

Zero observed unsafe reuse is a required result, but it is a finite-fixture observation rather than a production zero-error guarantee. An irrelevant Card returned for a positive query is counted as a relevance or evidence error unless the oracle also marks that Card as forbidden or blocked; it must not be relabeled as safe success merely because it is absent from the unsafe-reuse count.

## 5. Evidence results

| Measurement | Development | Held-out |
|---|---:|---:|
| Expected evidence checks | `30` | `30` |
| Evidence opens measured | `30 / 30` | `13 / 30` |
| Exact evidence checks correct | `30 / 30` | `9 / 30` |
| Correct among measured opens | `30 / 30` | `9 / 13` |
| Gate | **PASS** | **FAIL** |

The scorer requires every designated evidence check to be measured and exact. Exactness includes the eligible Card ID, relative path, start and end lines, selected text, and qualifier text.

The held-out evidence failures were:

- No evidence open for 17 designated queries: `held-out:m1-001:natural`, `held-out:m1-004:natural`, `held-out:m1-009:natural`, `held-out:m1-010:natural`, `held-out:m1-011:natural`, `held-out:m1-013:natural`, `held-out:m1-014:natural`, `held-out:m1-018:natural`, `held-out:m1-019:natural`, `held-out:m1-020:natural`, `held-out:m1-022:natural`, `held-out:m1-023:natural`, `held-out:m1-024:natural`, `held-out:m1-027:natural`, `held-out:m1-028:natural`, `held-out:m1-029:natural`, and `held-out:m1-030:natural`.
- Four measured opens targeted an irrelevant Card: `held-out:m1-005:natural` opened `m1-002`; `held-out:m1-006:natural` opened `m1-010`; `held-out:m1-007:natural` opened `m1-003`; and `held-out:m1-016:natural` opened `m1-017`.

## 6. Latency results

All 100 queries in each partition have both initial and usable latency. Values below are milliseconds exactly as serialized in the reports.

| Partition / response | Measured | P50 | P95 | P99 | Maximum |
|---|---:|---:|---:|---:|---:|
| Development / initial | `100` | `111.9191690000007` | `129.82426999999734` | `137.07296599999972` | `142.15801199999987` |
| Development / usable | `100` | `115.99142900000152` | `228.77933400000256` | `251.31466799999907` | `283.76689599999736` |
| Held-out / initial | `100` | `109.71923300000344` | `127.45630199999869` | `132.27034800000183` | `142.5081680000003` |
| Held-out / usable | `100` | `110.30274499999723` | `226.94223000000056` | `233.8398410000009` | `241.62250399999903` |

Both runs pass the scorer's configured latency rule: all cases measured, initial-response P95 no more than 350 ms, usable-response P95 no more than 1,000 ms, and pending fraction no more than 5%.

This is not yet the validation plan's broader supported-capacity envelope. These artifacts cover the 30-Card synthetic corpus and 100 queries per partition; they do not record the required 100/1,000/10,000-source profiles, at least 1,000 queries per reported load profile, warm versus process-cold versus genuinely cold OS-cache conditions, edit-heavy or overloaded-queue behavior, files opened, bytes hashed, sections parsed, or queue age. The JSON field `supportedProfileLatency: PASS` therefore supports only the harness profile above, not a general release capacity claim.

## 7. Human practicality and token claims

The delayed-use human pilot remains unrun. There are no participant, later-session, human task-success, accepted-unsafe-reuse, capture-time, locate-and-assess-time, unnecessary-review, coaching, or maintenance-effort measurements. Missing pilot data is not zero and cannot be treated as a pass.

No provider or model usage was measured in these runs. This report makes no claim that Memory saves tokens, context, cost, or end-to-end task effort. Token-saving evaluation remains separate M2 work and must not be inferred from retrieval hits or latency.

## 8. Required revision and retest

Before an M1 `PROCEED` decision:

1. Repair general retrieval/ranking behavior responsible for held-out alternate-language, natural, and situational misses and irrelevant results without weakening authorization, scope, source-freshness, or evidence checks.
2. Rerun complete development and independently frozen held-out partitions with evidence and latency required. Because this held-out partition has now been inspected, a tuned rerun must be labeled a regression run rather than an unseen held-out result; a new independently frozen partition is required for a fresh held-out acceptance claim.
3. Record the exact Desktop and Engine build identities and the missing machine, runtime, filesystem, cache-condition, and I/O profile metadata for any claimed supported envelope.
4. Run the delayed-use pilot only after the automated technical gate passes, and report all human denominators and failures.

Until those steps pass, the decision remains **REVISE**, M1 remains unaccepted, provider/runtime expansion remains out of scope, and no token-saving claim is warranted.
