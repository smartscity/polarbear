# Desktop long-memory M1 delayed-use pilot kit

Status: Not run. The [automated M1 report](desktop-memory-m1-automated-report.md) records a held-out **FAIL** and **REVISE** decision, so the human pilot remains deferred until the automated technical gate passes.

## Purpose and stop rule

This pilot tests one claim: a conclusion captured today can be found and assessed later without unsafe reuse after task, working-copy, or source changes. It does not test Token savings, automatic extraction, provider injection, or general truth.

Use five participants who did not implement the feature. Each participant captures six genuine, non-sensitive conclusions from an authorized project. Include a next-day return and two later sessions. Stop expansion immediately if any participant accepts a wrong-task, wrong-working-copy, conflicted, denied, or stale conclusion as reusable.

## Preparation

Record the Desktop build, Memory build, Admin API and schema versions, OS and machine profile, repository fixture commit, and the SHA-256 of `apps/desktop/fixtures/long-memory-m1/corpus.v1.json`. Use isolated test projects and data roots. Do not migrate a participant's production Memory database for the pilot.

Prepare six scenarios per participant:

1. Two unchanged task-owned conclusions.
2. One unchanged project-owned conclusion.
3. One conclusion queried from the wrong task or captured working copy.
4. One conclusion whose governing source meaning changes after capture.
5. One source that becomes unavailable or whose exact locator becomes ambiguous.

Counterbalance comparable ordinary file-search and Memory tasks. Do not repeat the same learned question in both arms.

## Day-one capture script

Tell the participant only: “Select the saved Markdown evidence, record the concise conclusion, when it applies, why, and choose task or project ownership.” Do not teach database terms, expose Card titles as later search hints, or suggest query wording.

For every capture, record an opaque participant/scenario ID, ownership choice, captured working-copy policy, start/end time, field edits, errors, and whether the participant could explain where the conclusion may be reused. Never copy secrets, complete prompts, or unrelated source content into the study log.

Capture succeeds only when the source file is saved, the exact selection is registered, and the Card acknowledgment is returned. Ambiguous outcomes are retried with the same idempotency IDs.

## Delayed-session script

On the next day and in two later sessions:

1. Put the participant in the predeclared task and working copy without showing the Card title.
2. Ask the participant to write their own related question; freeze it before inspecting retrieval.
3. Record time to the first response and time to a usable conclusion.
4. Require the participant to open evidence and state whether to use, review, or exclude it.
5. Apply the predeclared wrong-context or source mutation only for its assigned scenario.
6. Record query reformulations, context switches, review actions, evidence correctness, and the final decision.

Do not coach around a miss. A second query remains a measured reformulation, not a replacement for the first result.

## Observation record

Use one local row per attempt with these fields:

| Field | Meaning |
|---|---|
| Participant/scenario/session IDs | Opaque identifiers only |
| Arm and scenario class | File search or Memory; unchanged, wrong scope, changed, unavailable |
| Frozen question | Participant wording before retrieval |
| Expected eligible/blocked IDs | Independent oracle labels |
| Returned decisions and ranks | First five reusable results plus review/pending notices |
| Initial/usable latency | Milliseconds to response and usable evidence |
| Evidence outcome | Correct project, working copy, path, revision, passage, qualifier |
| Human decision | Use, review, or exclude; correct or incorrect |
| Effort | Queries, context switches, capture/review seconds |
| Notes | Confusion and recovery without sensitive content |

## Acceptance calculation

Report raw numerators and denominators overall and per scenario class. The initial gates are:

- Zero observed unsafe reuse and zero misleading no-answer results.
- At least 90% human task success.
- 100% evidence correctness for expected-resolvable opens.
- Median capture time at most 60 seconds.
- Median later locate-and-assess time at most 30 seconds.
- Most ownership and review actions completed without coaching.
- More than 20% unnecessary review on unaffected cases triggers a boundary or UX redesign.

A small pilot cannot establish a production zero-error rate. A pass authorizes only the next evaluated increment; it does not authorize provider injection or a Token-saving claim.
