# Desktop long-memory M1 evidence report

Status: Template. Replace every `TBD`; do not mark the milestone accepted while required evidence is missing.

## 1. Decision

- Decision: `TBD — PROCEED / REVISE / STOP`
- Decision date and reviewers: `TBD`
- Supported profile, if any: `TBD`
- Known exclusions: provider delivery, automatic extraction, checkpoint resume, and Token savings.

## 2. Reproducibility

| Item | Value |
|---|---|
| Desktop revision/build | TBD |
| Memory revision/build | TBD |
| Admin API / schema | TBD |
| Machine / OS / filesystem | TBD |
| Corpus path / SHA-256 | TBD |
| Development result/report hashes | TBD |
| Held-out result/report hashes | TBD |
| Fixed randomized-test seed/counterexample | TBD |

## 3. Automated technical gate

Record commands, exit codes, and raw artifact paths for contract generation, type checks, frontend tests/build, native tests, Memory tests/docs/contracts, migration/backup checks, real-Engine restart smoke test, and deny-network checks.

| Scenario group | Passed / total | Failures or limitation |
|---|---:|---|
| Restart, persistence, and index rebuild | TBD | TBD |
| Task/project/working-copy isolation | TBD | TBD |
| Mutation, unavailability, review, and conflicts | TBD | TBD |
| Cursor/action snapshot races | TBD | TBD |
| Exact source navigation and UI generation guards | TBD | TBD |
| Traversal, symlink/path swap, redaction, malicious Markdown | TBD | TBD |

## 4. Retrieval and evidence metrics

Report development and held-out separately.

| Metric | Development | Held-out | Gate |
|---|---:|---:|---|
| Unsafe reusable results | TBD / TBD | TBD / TBD | 0 |
| Precision@5 | TBD | TBD | at least 90% |
| Eligible hit@5 | TBD | TBD | 100% golden path; at least 90% held-out and 80% per class |
| Misleading no-answer | TBD / TBD | TBD / TBD | 0 |
| False withholding by reason | TBD | TBD | Investigate every cause |
| Evidence correctness | TBD / TBD | TBD / TBD | 100% |
| Pending within one second | TBD / TBD | TBD / TBD | at most 5% for claimed profile |

## 5. Performance profile

For every reported corpus size and warm/cold/edit-heavy condition, record source/card/query counts, file-size distribution, P50/P95/P99 initial and usable latency, files opened, bytes hashed, pending fraction, and eligible coverage. Do not call a process restart a cold OS-cache run. Label 10,000 sources as stress/discovery unless it independently passes the supported-profile gates.

## 6. Delayed-use pilot

| Measure | Result | Gate |
|---|---:|---|
| Participants / conclusions / later sessions | TBD | 5 / 30 / at least 3 |
| Human task success | TBD / TBD | at least 90% |
| Accepted unsafe reuse | TBD | 0 |
| Median capture time | TBD | at most 60 s |
| Median locate-and-assess time | TBD | at most 30 s |
| Unnecessary review | TBD / TBD | redesign trigger above 20% |
| Uncoached ownership/review completion | TBD | Most participants |

Summarize observed misunderstandings, query reformulations, review burden, maintenance time, and ordinary file-search comparison. Keep participant data local and publish only redacted aggregates.

## 7. Failures, limits, and follow-up

List every failed fixture, unavailable measurement, deviation from the frozen oracle, and retest result. Any unsafe reuse remains a blocking defect. Missing data is not zero. If M1 passes, name the narrow next experiment; if it does not, name the feature or boundary to repair before expansion.
