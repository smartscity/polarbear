# M1 validation: reliable next-day knowledge reuse

Status: Acceptance specification with the automated M1 technical slice and frozen validation assets implemented. The [2026-09-21 automated report](desktop-memory-m1-automated-report.md) records development **PASS**, held-out **FAIL**, and a **REVISE** decision; the delayed-use human pilot remains unrun.

Date: 2026-09-19.

Companions: [Implementation plan](desktop-memory-implementation-plan.md) and [Architecture rationale](desktop-memory-context-design.md).

This document owns M1's validation scope, decision rules, test oracle, and exit gates. It refines the earlier ownership/applicability model and narrows the first delivery to P1 → minimal P2 → minimal P3. Later runtime work is not a prerequisite. Admin API 1.8 now implements the six-method M1 surface described below; unimplemented rows and targets remain explicit validation or later-roadmap requirements.

## 1. The claim being tested

A conclusion deliberately captured today can be found with a natural related question tomorrow, traced to the correct evidence, and withheld from current reuse when the selected task, branch/worktree, or supporting source makes it inapplicable or uncertain.

Break this into four independently falsifiable claims:

| Claim | Observable success | Failure that invalidates the direction |
|---|---|---|
| Durable and findable | After both processes restart, a related question finds the intended card without its exact title or ID | Only the author who remembers the wording can find it |
| Applicable | The result states why it applies to the selected task and working copy | A persuasive answer from the wrong task/branch is presented as reusable |
| Grounded and maintainable | The user opens the correct evidence and can review an affected card after an edit | A source link opens an unrelated passage, or correcting a card requires understanding tables |
| Worth the interaction | The workflow requires tolerable capture, search, and review effort | Safety is achieved by hiding all results, or maintenance costs exceed ordinary document lookup |

M1 proves neither general truth of a human-approved statement nor model obedience to a retrieved statement. Unchanged evidence only supports the reviewed claim under its declared applicability; it is not a universal correctness certificate.

### Explicit scope cut

Include approved local Markdown sources, manual reviewed capture, task/project ownership, deterministic search, source navigation, freshness/review, process restart, and the minimum migrations/contracts/UI needed for them.

Exclude session rotation, context epochs, provider novelty suppression, checkpoint reduction/resume, automatic extraction, embeddings, model-based query rewriting, and token-saving experiments. M1 must run without a provider account or model call. Do not implement P0 usage instrumentation or P4–P7 to satisfy M1. Existing unrelated integrations remain regression-tested, not expanded.

Develop the happy path within one project, but test isolation with two projects, two tasks, and two worktrees. A single-context demonstration cannot establish the claim about branch/task safety.

## 2. Define the output before testing the implementation

Separate discoverability from permission to reuse. The following are proposed application decisions, not replacements for every existing lifecycle enum:

| Decision | Normal related-question results | Authorized review/history view | Meaning |
|---|---|---|---|
| `REUSABLE` | May show as an applicable conclusion | Available | Relevant, scope-compatible, and evidence validated for this request snapshot |
| `NEEDS_REVIEW` | Not in the actionable conclusion list; may offer a separate review notice | Card, old evidence, and change reason | Known change/conflict needs a human decision |
| `VALIDATION_PENDING` | Not an applicable conclusion; display incomplete-result status | Last validated revision with an explicit warning | The budget or unavailable evidence prevents a current decision |
| `INAPPLICABLE` | Excluded | Inspectable only through an explicitly authorized management/history route | Wrong task/worktree/branch, missing applicability, or superseded current claim |
| `NOT_RELEVANT` | Excluded | Ordinary authorized inventory remains available | Valid somewhere, but does not answer this question |
| `DENIED` | No content, title, snippet, or existence disclosure | No unauthorized access | Outside the authenticated project/source authority |

The result includes card ID/revision, decision/reason codes, evidence locator/revision, and a validation snapshot tied to project/task/worktree and the observed source digests. Clicking a current-source/reuse action rechecks that snapshot if context or source state changed; stale UI data cannot authorize the action. Review/history is not a back door into normal reusable results.

Validation promises a bounded observed snapshot, not that external files can never change after a response. Tests mutate files before search, during validation, between search and open, and before review commit. Return a conflict/pending result when an observed race cannot be resolved. Never label a cached assertion permanently current.

## 3. Ownership is not applicability

### 3.1 Freeze a small M1 model

- Stable identity: card UUID. Semantic duplicate key: `(projectId, ownerKind, ownerId, topicKey)` for explicitly keyed active cards.
- Ownership exposed to the user: **this task** or **this project**. A task owner uses its task ID; a project owner uses the project ID. Unknown/legacy ownership is not project-wide ownership.
- Applicability is separately revisioned: working-copy policy, branch restriction if explicitly requested, source/dependency bindings, and human-readable use conditions. Branch, path, HEAD, and source digest are not parts of card identity.
- Default capture is task-owned and restricted to the captured working context. Project-wide ownership and reuse in another working copy require explicit review. No ownership promotion on task completion, merge, or rebase.
- Cross-project “Global” sharing is deferred. It requires independent authorization and provenance rules; it must not become an automatic fallback search scope.
- A user need not design a topic taxonomy. An opaque topic key may be allocated for a new card; similarity can suggest a duplicate, never merge automatically. Scope/constraint changes create a card revision without changing its UUID. Ownership transfer checks target identity collisions and preserves history.

For M1, use two named working-copy policies: `CAPTURED_CONTEXT` and explicitly reviewed `COMPATIBLE_SOURCES`. The former binds the captured worktree and branch reference; the latter can apply in another authorized working copy only after all declared evidence/dependency bindings resolve and validate there. Branch names, merge ancestry, and equal paragraph text alone cannot establish that compatibility. A repository move or ambiguous branch rename requires rebinding.

### 3.2 Scope resolution table: fixture oracle

All positive rows also require query relevance, project authorization, and current evidence. These rules determine expected fixtures before implementing search.

| Card and change | Request context | Expected result |
|---|---|---|
| Task A card; evidence unchanged | Task A, same captured context | `REUSABLE` |
| Task A card; evidence unchanged | Task B, even on the same branch | `INAPPLICABLE`; no fallback to A |
| Task A card | No task selected | Require task selection for task reuse; project-owned candidates may still be searched |
| Project-owned card; captured-context policy | Another task in that working context | Eligible if relevant; ownership alone does not make it mandatory |
| Captured-context card from feature branch | Main branch after merge | `INAPPLICABLE` until explicit applicability review, even if the commit is an ancestor |
| Project-owned compatible-sources card | Main after merge; approved target bindings and complete validation footprint match | `REUSABLE`; keep the same card ID, record target validation separately |
| Same card | Main has a changed prerequisite despite identical selected paragraph | `NEEDS_REVIEW`; paragraph hash is insufficient |
| Rebase changes HEAD, same worktree/branch | Evidence footprint and declared dependencies revalidate unchanged | `REUSABLE`; HEAD change alone does not create a new card |
| Branch switch in the same directory | Captured-context policy no longer matches | `INAPPLICABLE`, even if the path and file content match |
| Branch renamed or worktree moved | Binding cannot be established unambiguously | Pending/inapplicable until explicit rebind; never infer identity by basename |
| Same conclusion needed by A and B | Still task A-owned | M1 offers an explicit copy with a distinct ID and shared provenance, or reviewed project promotion; never silently widens A |
| Task A completes | Another task asks a related question | No automatic promotion; task A's history remains inspectable |
| Project rule and a task-local contrary claim | Both otherwise applicable | `NEEDS_REVIEW` conflict; no automatic “more specific wins” rule in M1 |
| Cited passage/qualifier/prerequisite changed | Same task/branch | `NEEDS_REVIEW`, not an old conclusion with a current badge |
| Proven unrelated edit outside an approved narrow validation footprint | Same task/branch | Revalidate binding; retain eligibility if all required evidence matches |
| Source revoked/deleted or anchor ambiguous | Any current-use query | No reusable conclusion; show an authorized explanation/history option |
| Identical content in another project | Current authorized project | `DENIED`; no cross-project title/snippet leak |

Compatibility validation is per target working context. A divergent worktree must not globally invalidate or validate a card for every other worktree. Store the original approval and target validation separately. A permanent change to the authoritative source can require a new card review; an unavailable target copy does not erase the original history.

### 3.3 What must be hashed or reviewed

Define a **validation footprint**: the selected passage, heading ancestry and governing qualifiers, plus explicitly declared prerequisite sources. A selection that says “this is allowed” is incomplete without what “this” refers to and the conditions that allow it.

The initial safe fallback is whole-document validation, plus declared external prerequisites. Narrow section-level validation is an optimization requiring an approved dependency boundary and fixtures showing that outside edits are genuinely unrelated. If that boundary is unknown, a document change enters review; record the resulting review burden rather than pretending the dependency is known. No general semantic dependency extractor is required for M1.

Even matching footprint bytes cannot prove unrecorded external assumptions. Capture review must identify the meaningful applicability and evidence limitations. Include intentionally under-specified claims in usability testing: rejecting or repairing the capture is a success; silently treating them as universal facts is a failure.

## 4. One executable vertical slice

Use a synthetic repository, a decision such as “do not automatically retry FAILED settlement,” and nearby distractors with opposite conditions. Persist no real customer secrets in fixtures. Final API DTOs belong in Engine canonical contracts.

| Step | UI/API boundary | Application/persistence boundary | Required evidence |
|---|---|---|---|
| 1. Bind and select | Desktop selects project, task A, saved passage; proposed `projects.context` | Existing authorized binding resolves worktree/HEAD | Selection is tied to the saved editor revision, not guessed from a path |
| 2. Register | `sources.register` | Source service → guarded reader port → source repository transaction | Approved path, request ID, one bounded synchronous file read, no workspace scan |
| 3. Resolve | `sources.resolve` | Current guarded read → source revision/evidence comparison | SHA-256 source revision, section/footprint digest, exact excerpt |
| 4. Confirm capture | `knowledge.capture` with expected source revision and reviewed conditions | Card service → knowledge/version/evidence/anchor plus index update/dirty marker in one transaction | Stable ID; ownership separate from constraints; replay creates no second card |
| 5. Close | Exit Desktop and Engine | Real processes stop; no in-memory state retained | Record process exit and durable capture acknowledgment |
| 6. Restart | Start normal application/Engine path | Open existing test database; no reseeding | Original ID, revision, ownership and evidence survive |
| 7. Ask differently | `knowledge.search`, task A, a held-out paraphrase | Authorized/scoped query → bounded freshness validator → ranking | Intended eligible card in top five, or an honest pending reason |
| 8. Open evidence | `sources.resolve` and authorized editor navigation | Revalidate locator/snapshot; open correct working copy | Exact passage and qualifier, not just the correct filename |
| 9. Change source externally | Edit fixture outside Desktop while Engine may be closed | No dependence on a Desktop save notification | Governing rule actually changes while the card remains stored |
| 10. Ask again | Normal related-question search | Targeted validation → review state/exclusion | No actionable old conclusion; explicit affected-source reason |
| 11. Review | Source-grounded review with expected card/source revisions | Atomic new card revision + evidence/audit | Concurrent further edit conflicts; same-source interpretation correction is permitted |
| 12. Restart and repeat | Search and source open | Durable new state | New conclusion is found; old version remains labeled history |

Then repeat steps 7–10 in task B, main, and a second worktree using the resolution table. These are required parts of the slice, not later polish. Run both clean shutdown and a crash after acknowledged capture. A crash before acknowledgment may leave a recoverable operation, but must not report a completed card that does not exist.

Expose canonical setup/assertion helpers only in Engine tests. Desktop integration tests must use Admin API and native file APIs; they must never open `memory.db`. Complete this slice before broadening card categories or building runtime context delivery.

## 5. Evidence-driven test suite

### 5.1 Freeze ground truth independently of retrieval

Each fixture declares source bytes/commits, task and working-copy bindings, captured/reviewed claim, mutation sequence, query, expected eligible IDs, expected blocked IDs/reasons, exact evidence locator, and applicable performance class. Do not generate expected IDs or validity labels by invoking the implementation under test.

The frozen v1 oracle is [`apps/desktop/fixtures/long-memory-m1/corpus.v1.json`](../../apps/desktop/fixtures/long-memory-m1/corpus.v1.json). It contains 30 Cards and separate 100-case development and 100-case held-out partitions. Its validator and result scorer live under `apps/desktop/scripts/`; the fixture README defines the result contract and commands. Validation of the corpus shape or scorer is not a retrieval pass: observed Admin API results must still be collected and scored.

Create at least 30 distinct conclusions, each with three independently written queries: direct wording, paraphrase, and identifier/path or Chinese/English variant where relevant. Add no-answer and same-keyword wrong-task/obsolete distractors. Keep development queries separate from a frozen held-out set; do not tune aliases from held-out failures and still report that set as unseen. These counts are starting coverage, not proof of production reliability.

If two humans cannot agree whether a conclusion applies, the fixture should test ambiguity/review, or clarify its evidence first. Do not force an arbitrary binary answer to improve the score. Record disagreements and their resolution.

### 5.2 Required scenarios

| Group | Mandatory cases | Primary assertion |
|---|---|---|
| Persistence | Both processes restart; crash after acknowledgment; index rebuilt; approved source unavailable on restart | Canonical ID/history survives; no fabricated current availability |
| Findability | Paraphrase; Chinese/English; short symbol; identical titles; record beyond 100; no answer | Retrieval works without exact recall; no irrelevant filler |
| Ownership | Two tasks with identical text; completed task; absent task; explicit promotion/copy; two projects | No silent merge, promotion, task selection, or unauthorized leakage |
| Working copy | Merge; rebase; branch switch in same directory; rename; two worktrees with divergent prerequisites | Apply the resolution table, not branch-name/hash shortcuts |
| Source meaning | Negation changed; parent heading changed; prerequisite changed; duplicated paragraph; irrelevant edit | Validate footprint/identity; distinguish review from unrelated change |
| Freshness race | Same-length edit with preserved mtime; delete/recreate; edit during hash; edit between result and open | Metadata/TTL is not validity; ambiguous snapshot fails safely |
| Review and revocation | Source revoked; approval scope withdrawn; conflicting claims; review after another edit | Exclude from reuse; revision conflict; old history cannot reactivate itself |
| Async index | Delayed, cancelled, out-of-order, crashed jobs; budget exhaustion; external save while Desktop closed | Old worker cannot republish current truth; pending is visible |
| Safety | Forged IDs; path traversal/symlink swap; malicious Markdown instructions; secret-bearing excerpt | No authority escalation, active execution, remote fetch, or secret persistence |
| Real UI | Source/live editor selection; all save routes; Save As; mode switch; delayed old-project result | Capture and navigation target the correct saved document/context |

Use deterministic unit tests for the resolution policy, repository tests for identity/migrations/transactions, API integration tests for authorization/results, and native/Desktop end-to-end tests for the full slice. Add bounded randomized event-sequence tests for edit/revoke/search/restart ordering with a fixed seed and recorded counterexample. Passing unit tests cannot substitute for the cross-process UI path.

## 6. Freshness cost without weakening the claim

`HOT`, `WARM`, and `COLD` are scheduling/cache classes, not correctness states:

- HOT: a validated immutable revision is available. Reuse parsing and evidence work for that exact revision. A mutable current file still needs a valid observation binding it to that revision.
- WARM: metadata changed, a hint arrived, or a recheck interval expired. Prioritize bounded targeted validation.
- COLD/UNKNOWN: no adequate validation snapshot, missed events, restart, or uncertain binding. Validate before marking reusable; otherwise return pending.

A TTL or unchanged mtime alone never proves a mutable source unchanged. The same-length/preserved-mtime fixture must still catch a changed rule. In M1, selected mutable sources may need bounded reads to establish their digest; caching saves repeated parsing and duplicate reads within a request. Immutable approved Git evidence can be reused as historical evidence, but does not prove the current worktree matches it.

### Proposed performance envelope

Measure on a named local machine with recorded CPU, memory, filesystem, runtime/build, and corpus. These targets are initial hypotheses to confirm or revise explicitly, not measured guarantees.

| Operation | Starting target/budget | On exhaustion |
|---|---|---|
| Scoped index lookup | P95 ≤ 100 ms; candidate cap 50 | Return partial/error status, never an unscoped fallback |
| Foreground source validation | 200 ms scheduling/wait budget; ≤ 8 distinct sources and ≤ 4 MiB source reads per request | Remaining candidates are pending; coalesce async refresh |
| Search to initial UI response | P95 ≤ 350 ms under the declared interactive corpus | Show progress/partial state, not a validated badge |
| Search to usable top results | P95 ≤ 1 second for unchanged, supported-size interactive cases | Count as a latency/availability failure, even if an empty response arrived quickly |
| One normal saved source indexed | P95 ≤ 2 seconds while queue is not overloaded | Display lag; source validation still guards current reuse |
| Evidence response | ≤ 16 KiB excerpt within existing frame limits | Return a bounded locator/continuation, never silently omit a critical qualifier |

Deduplicate validation per source/footprint and request. Bound parsing work and large inputs; the current proposal's 1 MiB per-source support limit remains explicit. A deadline limits foreground waiting/publication, not a promise that the OS can interrupt an arbitrary disk call. Keep file work off the request event loop; late completion cannot publish a stale result.

Load profiles: 100, 1,000, and 10,000 approved sources, approximately three cards per source, median 8 KiB/P95 64 KiB files plus near-limit files. Include many eligible distractors, not only unrelated sources. Run warm, process-cold, edit-heavy, and overloaded-queue cases with at least 1,000 queries per reported profile. Distinguish process restart from a genuinely cold OS cache; do not call them equivalent.

Record P50/P95/P99, time to usable results, files opened, bytes hashed, sections parsed, queue age, eligible-result coverage, and pending fraction together. Ten thousand sources is a stress/discovery profile, not an automatic first-release capacity claim. Publish a supported envelope only for profiles that meet both availability and latency gates. Never improve reported latency by excluding every expensive relevant result.

## 7. Acceptance gates and real-user practicality

### 7.1 Metrics with denominators

| Metric | Definition | Initial decision rule |
|---|---|---|
| Unsafe reuse | Returned `REUSABLE` items independently labeled wrong-scope, stale, conflicted, denied, or lacking required evidence; report count/rate by cause | Zero observed in mandatory fixtures and pilot; any observed case blocks wider rollout pending fix/retest |
| Relevant-result precision@5 | Relevant, applicable items / all items actually shown in the first five reusable positions; do not pad missing results | ≥ 90% held-out overall; report by query/context class separately from safety errors |
| Eligible hit@5 | Queries with at least one truly eligible expected card in first five reusable results / all answerable queries | 100% curated golden-path cases; ≥ 90% held-out overall and ≥ 80% each declared query/context class |
| False withholding | Eligible expected answers withheld for scope/review/pending reasons / answerable queries; report each reason separately | Investigate alongside recall; cannot count rejection as success on positive cases |
| Evidence correctness | Correct working copy, source revision, passage, and qualifier on open / all expected-resolvable opens | 100% required fixtures; any silent wrong-source jump blocks rollout |
| Misleading no-answer results | Queries labeled no-answer that show an applicable conclusion / no-answer queries | Zero observed in mandatory fixtures/pilot |
| Unnecessary review | Review requests on independently labeled unaffected cases / all unaffected mutation cases | Report both whole-document fallback and narrow-footprint policies; > 20% in pilot triggers boundary/UX redesign before expansion |
| Unknown availability | Valid unchanged interactive queries with no usable result within one second because validation is pending / those queries | ≤ 5% in the claimed supported profile, or narrow the support claim and rerun |
| Human task success | User finds the right conclusion, opens evidence, and correctly decides use/review/exclude / attempted scenarios | ≥ 90% observed in the pilot, with no accepted unsafe reuse |

Report raw counts and per-class results; a small pilot does not prove a zero production error rate. Positive cases remain in denominators even when the implementation says pending or excludes them. Do not score by card-title matches alone. Precision, recall, source correctness, latency, and review effort must pass together; an always-reject system fails.

The 20% unnecessary-review trigger is an initial M1 usability threshold, not the older 20% token-cost goal. It may be adjusted only with documented evidence and a rerun, not silently after seeing a failed result.

### 7.2 Delayed reuse study

Use the executable facilitator checklist in [Desktop long-memory M1 delayed-use pilot kit](desktop-memory-m1-pilot-kit.md) and record the aggregate decision in [Desktop long-memory M1 evidence report](desktop-memory-m1-report-template.md).

Start with five users who did not implement the feature, each capturing six genuine non-sensitive conclusions from authorized projects. Include at least one real next-day return and two later sessions. A one-user self-test can debug the flow but is not independent usability evidence.

On day one, record capture completion, time, field edits, and whether participants understand task/project ownership and future applicability. Do not train them on database terms. On a later day, let them formulate their own related questions without showing card titles or suggesting the exact query. Freeze those questions before inspecting retrieval results.

Use counterbalanced, separate but comparable tasks for ordinary file search versus the Memory flow; avoid reusing the identical question after the user has learned its answer. Include useful unchanged cases, wrong-task/branch cases, and changed-source cases. Use approved synthetic changes where mutating a real project would be inappropriate.

Measure time to correctly locate and assess evidence, number of queries/context switches, capture/review burden, and wrong-use decisions. Starting usability targets: median capture ≤ 60 seconds, median later locate-and-assess ≤ 30 seconds, and most participants complete ownership/review actions without coaching. Report maintenance time as well as lookup benefit; speed gained by accepting a stale claim is failure.

If delayed queries cannot find the cards, ownership is routinely misunderstood, or users reflexively dismiss review warnings, stop feature expansion and repair that issue. Do not add embeddings, extraction, or a chat layer just to conceal an unproven basic workflow.

## 8. Threat model and explicit product limits

| Threat | M1 control and negative test |
|---|---|
| Source prompt injection / malicious Markdown | Render as untrusted data; no tool execution, elevated instruction, or remote resource load; fixture includes deceptive system-like text |
| Cross-project access / forged IDs | Authenticated project binding on search, resolve, review, and jobs; assert no unauthorized title, excerpt, count, or diagnostic leakage |
| Traversal / symlink or path-swap race | Authorized reader containment and guarded read; swap the path during validation and assert rejection |
| Secret persistence | Redaction/admission before excerpts/diagnostics; inspect isolated test stores/logs using Engine test helpers; never silently claim redacted premises are complete |
| Stale knowledge presented as current | Footprint and target-context validation, explicit review/pending states, blocked current-use action, same-mtime adversarial fixture |
| Revocation races / stale indexes | Revoked approval checked independently of search projection; queued workers and stale UI responses cannot reactivate future reuse |
| Historical evidence mistaken for current | Explicit history mode and source revision; source open cannot silently attach old text to a current unrelated passage |
| User misunderstanding applicability | Delayed study tests whether users reject wrong-task/branch/changed-source conclusions, not just whether they see a badge |

Revocation means blocked future access/delivery through the governed Memory surface, subject to explicitly authorized historical management. It is not proof that text already seen, copied, exported, backed up, or sent to a provider has been erased. Purge/backup retention is a separate explicit policy. M1 introduces no provider delivery. Provider-history revocation, permission-preserving resume, and side-effect replay remain mandatory M2 threat reviews, not M1 implemented guarantees.

## 9. Evidence bundle and stop/go decision

Produce a local, redacted report with: build/contract/schema versions; machine/corpus description; fixture/query-set hashes; scenario results and expected/actual decisions; source-navigation evidence; failure seeds; raw counts and latency/IO distributions; usability observations; known limits; and a signed-off release decision. Use synthetic artifacts for repository fixtures and keep participant data outside publication output.

No additional telemetry is introduced. All collection is explicit and local. Screenshots are optional evidence for UI behavior, not a replacement for result assertions. Run the existing implementation-plan contract, migration, frontend, native, and deny-network gates alongside this scenario suite.

Gate sequence:

1. **Oracle review:** agree on ownership, applicability, footprint, and blocked-result examples before implementing them.
2. **Technical slice:** pass the cross-process golden path, mutation/isolation matrix, migration/recovery, and supported-profile performance/availability gates.
3. **Practicality pilot:** pass delayed-use and review-understanding gates; report failure counts and maintenance cost honestly.
4. **M1 decision:** proceed, revise, or stop. A limited pilot pass authorizes the next evaluated increment, not a claim of universal reliability or automatic provider injection.

Only after M1 passes should P0/P4–P7 measure the next hypotheses. Evaluate later token/cost effects separately for simple one-off tasks, repeated architecture lookup, ongoing maintenance, long tasks, and cross-session continuation. The older 20% cost target is a workload-specific experimental ambition, not M1 acceptance or a universal product success line.

The next validation action is to execute both frozen query partitions through Admin API 1.8, run supported-profile latency/availability measurements, and complete the delayed-use study against the implemented P1 → minimal P2 → minimal P3 slice. Do not expand into provider runtime or token experiments until those results support an M1 proceed decision.
