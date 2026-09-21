# Desktop-led memory: technical implementation plan

Status: M1 technical slice and validation assets implemented. The [automated M1 report](desktop-memory-m1-automated-report.md) records development **PASS**, held-out **FAIL**, and a **REVISE** decision; the human pilot, M1 acceptance, and all M2 work remain pending.

Date: 2026-09-19.

Companion: [Desktop-led memory and context design](desktop-memory-context-design.md). That document owns the product rationale and experimental success criteria; this document defines implementation boundaries, migration order, and acceptance work.

M1 acceptance owner: [Reliable next-day reuse validation plan](desktop-memory-m1-validation-plan.md). Its scope resolution table, held-out retrieval cases, delayed-use study, and joint safety/usability gates govern the first milestone. M1 does not attempt to establish token savings.

Implementation baseline: Desktop started at `a217f82`; Memory Engine started at `0c0e8c6` (`v0.3.12`). The M1 implementation raises the database schema to 11 and the Admin API to 1.8. Paths prefixed with `Desktop:` or `Engine:` refer to the respective repositories. Items explicitly labeled M2 or proposed below are not implemented APIs.

## 1. Delivery decision

Deliver two independently testable milestones, using the existing local Engine and external-agent integrations. Do not build a new Desktop chat runtime as a prerequisite.

| Milestone | User-visible result | Required implementation | What it does not prove |
|---|---|---|---|
| M1: Usable knowledge | Select a saved Markdown passage, create a scoped card, find it later, open its source, and recognize when it needs review | Scoped identities, approved sources, revision-aware cards, Engine search, Desktop capture/navigation | Finding a card is not measured token savings |
| M2: Bounded continuation | Resume one task using a sufficient checkpoint and relevant cards; avoid known duplicate delivery within an observable session | Current-state checkpoints, context preparation/expansion, delivery epochs, supported fresh-session flow, normalized usage and paired task evaluation | A smaller packet alone is not lower end-to-end cost |

Initial M1 scope: local Git projects on a supported Unix platform, approved Markdown files, and explicitly selected task/project ownership. Develop the happy path in one project; verify isolation with two projects, tasks, and worktrees. No runtime or provider account is required. For M2 only, qualify the existing Codex managed runtime first with fixtures and a real smoke test. Preserve existing Claude Code and MCP-assisted behavior without advertising equivalent new guarantees before adapter tests pass.

M1 is deterministic and does not call a model to extract knowledge. The user supplies or confirms the concise conclusion and applicability. M2 uses an already configured external runtime only after an explicit run/resume action. No background paid extraction, implicit network, workspace-wide automatic ingestion, graph service, remote vector database, Windows transport, or non-Git identity work is included.

Keep M1 strictly to capture → durable restart → related-question search → exact-source open → source change → review. Session rotation, context epochs, novelty suppression, usage-saving measurement, checkpoint resume, and embeddings are deferred. Finding nothing on every query is not a safety success: eligible recall, source accuracy, latency, and review burden must also pass.

### 1.1 M1 as-built increment

The implemented Admin API 1.8 surface is intentionally limited to `projects.context`, `sources.register`, `sources.resolve`, `knowledge.capture`, `knowledge.search`, and `knowledge.review`. Engine schema 11 adds canonical Source, Source Revision/Section, Card State/Revision/Source, validation, and idempotency-operation records. Desktop vendors the canonical contract and uses only the Rust-authenticated proxy; it never opens Engine storage.

M1 performs a synchronous bounded read of one explicitly selected Markdown file (maximum 1 MiB). It does not scan the workspace or introduce source jobs. The whole-document digest is the current conservative validation footprint, while the selected offsets/digest preserve exact evidence. Jobs, revocation, automatic extraction, context delivery, runtime resume, and token accounting remain later work. Automated tests establish the core restart, scope, mutation, review, migration, contract, and proxy behaviors. A frozen 30-Card development/held-out corpus, deterministic scorer, pilot kit, and report template are present, but their measured retrieval, performance, and delayed-use results still govern the final M1 decision.

## 2. Boundaries and module ownership

Keep the public model to Source, Card, Checkpoint, and Context Manifest. Preserve existing evidence, knowledge, task, packet, backup, and audit infrastructure underneath it.

| Responsibility | Existing integration point | Proposed focused implementation |
|---|---|---|
| Document identity, selection, save result | Desktop `features/editor/documentModel.ts`, `features/workspace/tauriWorkspaceAdapter.ts`, editor `onEditorReady` callbacks | `features/editor/documentContext.ts`; a selection adapter; a shared successful-save event |
| Find, capture, inspect, open source | Desktop `features/memory/context/ContextWorkspace.tsx`, `useContextOsSession.ts`, `memoryApi.ts` | `useMemorySearch.ts`, `sourceCapture.ts`, `sourceNavigation.ts`, `TaskContextPanel.tsx` |
| Native project authorization and proxy | Desktop `src-tauri/src/memory_admin.rs` and existing workspace file commands | Preserve proxy boundary; extract new source-navigation native helpers only if needed; do not grow `main.rs` with Memory policy |
| Card scope, authority, freshness | Engine `domain/memory.ts`, `domain/knowledge.ts`, `storage/knowledge-command-service.ts` | Small domain policies and an application card service, with repositories performing persistence |
| Approved-source reading and indexing | Engine `platform/project.ts`, `storage/knowledge-index.ts` | `application/source-service.ts`, a source-reader port, `platform/workspace-source-reader.ts`, `storage/source-repository.ts`, and a bounded indexing worker |
| Prepare/expand/acknowledge context | Engine `application/context-planner.ts`, packet repository, lifecycle orchestrator | `application/context-preparation.ts`, `context-expansion.ts`, `context-delivery.ts`; a replaceable selection policy |
| Recoverable task state | Engine `application/checkpoint-builder.ts`, task/checkpoint repository | A pure checkpoint reducer, observation cursor queries, and a readiness policy |
| Runtime boundary and usage | Engine `runtime/session-manager.ts`, `runtime/agent-runtime.ts`, provider adapters | Explicit execution-context capabilities, safe resume coordination, provider usage normalizers |

Desktop frontend paths in this table are below `apps/desktop/src/`; Engine paths are below `src/`. New names are suggestions, not permission to create duplicate abstractions. Add a module only when its associated PR needs it.

Dependency rule: protocol adapters call application services; domain logic does not import SQLite or provider SDKs; storage implements ports. `SqliteMemoryStore` stays a delegating facade. Runtime writes have one `inImmediateTransaction` owner; repository helpers do not nest transactions. FTS lifecycle remains owned by `KnowledgeSearchIndex`, including any delegated source-document projection builder. Canonical row mapping belongs in the established read-model layer. Keep new production classes within the repository's 250-line target and 400-line limit.

## 3. Domain contracts and identity

### 3.1 Separate editor state from durable source identity

Pass an ephemeral work descriptor from Desktop to Engine:

```ts
type WorkDescriptor = {
  projectId: string;
  taskId?: string;
  worktreeId: string;
  head?: string;
  activeDocument?: {
    relativePath: string;
    editorRevision: string;
    dirty: boolean;
    selection?: { startLine: number; endLine: number };
  };
};
```

This is a design sketch, not a second canonical contract. Define final DTOs once in Engine's contract source.

- `projectId` must match the authenticated project binding. It is not a way to open an arbitrary project.
- Engine resolves `worktreeId` from the authorized canonical root and repository identity, distinct from the mutable branch name. Add a capability-gated project-context response to bootstrap this identity from the existing authenticated binding before constructing a work descriptor; Desktop does not invent it. A move or unknown identity requires rebinding; never guess continuity from the directory name.
- Desktop's current `editorRevision` is an opaque length/FNV-based concurrency token. Its metadata `watchToken` is also only a change hint. Neither is the Engine SHA-256 source revision.
- Engine computes `sourceRevision` from bytes read through the authorized source-reader port. A `sectionDigest` identifies the cited section, independently of unrelated edits in the file.
- A selection is a relevance/capture hint. It is neither authorization nor proof that the user accepts the selected text as a rule. Dirty buffers do not become durable sources automatically.

### 3.2 Card identity and authoritative edits

Use a stable card UUID plus monotonically increasing revision. For explicitly keyed cards, semantic identity is `(projectId, ownerKind, ownerId, topicKey)`, not the content hash. If retained as a column name, `normalizedScopeKey` encodes only the versioned ownership tuple, not applicability.

M1 exposes task or project ownership. Worktree/branch restrictions, module/path hints, and source/dependency compatibility are separately revisioned applicability constraints; changing them does not create another card identity. Default to the selected task and captured working context. Project promotion, broader working-copy compatibility, or copying into another task requires explicit review; task completion and merge do not promote automatically. Global/cross-project ownership is deferred. Preserve filesystem case rules and distinguish unknown ownership from project-wide ownership. The M1 validation document owns the resolution table and conflict behavior.

Each revision includes: kind, concise answer, applicability, critical constraints, reason, scope, source references, authority, verification state, and freshness. The existing `summary`/`body` remain the compatibility projection; source/scope/authority changes also create a revision. Do not embed all new meaning in unvalidated free-form metadata.

Two authoring modes:

- `DOCUMENT`: the card is an approved interpretation of a cited source section. If the underlying decision changes, edit the source and review/rederive the card. If only the card's interpretation was wrong, an explicit review/rederivation may create a new card revision against the same source revision; do not force a meaningless document edit. Generic content updates cannot bypass this source-grounded review. Annotation and applicability maintenance remain separate reviewed operations.
- `CARD`: the Engine card is an independent decision edited through revision-checked API commands, with evidence of the explicit user decision. Exporting it to a document is non-authoritative unless a separate authority-transfer operation completes.

Every mutating card command includes `expectedRevision` and an idempotency key. Validate authority, scope, referenced project ownership, and expected revision inside the transaction. A replay with the same key and body returns the same result; the same key with different input returns `IDEMPOTENCY_CONFLICT`. Concurrent writes return `REVISION_CONFLICT`, never last-writer-wins.

Enforce authority in Engine for Desktop, CLI, MCP, and legacy write routes. `memories.update` must not bypass document authority. Legacy independent cards retain their existing edit behavior until explicitly migrated. Do not silently reinterpret old records as document-authoritative.

Source-backed is not synonymous with verified. Maintain independent verification and freshness states. A source edit can leave a previously verified assertion in `NEEDS_REVIEW`; source availability alone cannot clear that state. An explicit review records who confirmed what revision and why.

## 4. Storage and migration plan

### 4.1 Reuse first; add only missing durable state

Allocate migration versions at merge time, beginning after schema 10. The groups below are dependency units, not a requirement to land one giant migration.

| Change group | Reuse/extend | Required invariant |
|---|---|---|
| Scoped cards | `knowledge_units`, `knowledge_versions`, evidence/anchor/relation tables | Stable UUID; versioned normalized scope and topic; authority/freshness columns; validated revision snapshot for new fields |
| Approved sources | New `sources` and `source_revisions`; existing evidence stores cited section snapshots/locators | Source identity includes project and worktree; immutable revision metadata; active revision advanced with compare-and-swap |
| Derived section index | New source search-document projection and FTS representation under `KnowledgeSearchIndex` | Rebuildable from approved revisions; not a second canonical knowledge store |
| Asynchronous indexing | New bounded `source_jobs` | Durable lease, desired revision, attempt count, progress, cancellation, error, and index-version marker |
| Context v2 | Extend `context_packets` and `context_packet_items`; reuse retrieval traces | Packet format version; item revision/representation/source locator; exact rendered-payload digest |
| Delivery attempts | New `context_dispatches`; existing `context_deliveries` remain terminal compatibility receipts | Distinguish prepared, sent, accepted, unknown, failed; bind every attempt to project/task/worktree/session/epoch |
| Checkpoint v2 | `observations`, `checkpoints`, `tasks` | Monotonic ingest cursor; schema-versioned current-state payload; consumed watermark; atomic task pointer |
| Usage v2 | `usage_ledger`, execution runs, evidence, task acceptance projection | Event idempotency key, normalization version, validated nullable usage/cost envelope; task acceptance independent of process exit |

Use typed columns for identities, filters, indexes, and state transitions. Use schema-validated JSON only for versioned structured payloads such as checkpoint state or normalized usage. Put project ownership on new records and enforce composite ownership on cross-record references, either with matching composite foreign keys or a transactionally tested repository check where the existing schema prevents one. UUID existence alone is insufficient authorization.

The source registry stores approved paths and current revision pointers; the revision record stores cryptographic digests, parser version, timestamp, and available local snapshot/immutable Git reference. For an uncommitted source without a durable Git object, retain the approved, bounded, non-secret cited excerpt as evidence. Do not claim historical recoverability from a digest alone. A source revoked or purged by the user must not remain usable through its derived index.

### 4.2 Existing constraints that must change deliberately

1. `knowledge_project_content_hash` is currently UNIQUE on `(project_id, current_content_hash)`. Replacing application dedup alone is insufficient. Replace it with a non-unique lookup index; add an active-card unique index on the new normalized identity for explicitly migrated/new cards. Restore must detect an active identity collision. Same text in two tasks must be allowed.
2. Legacy records without reliable scope receive a legacy identity namespace, not a guessed task assignment. Preserve UUIDs, versions, and evidence. New automatic retrieval excludes ambiguous task state; the inspector can still display it. Stop project/branch-wide `TASK_STATE` supersession; checkpoint v2 owns task recovery state.
3. `context_packet_items.source_type` currently permits only `TASK`, `CHECKPOINT`, and `MEMORY`. A new `SOURCE` item needs a tested table-constraint migration and a format-v2 DTO, not a cast around the current type.
4. `context_deliveries.status` currently permits only `DELIVERED` and `FAILED`. Keep it for existing terminal receipts; store dispatch lifecycle and uncertainty in `context_dispatches`. Never record `DELIVERED` simply because preparation succeeded.
5. The current upgrade path executes `CREATE TABLE IF NOT EXISTS` schema text. Introduce explicit ordered migrations for new columns, indexes, and table rebuilds. Editing fresh-install DDL alone does not upgrade existing databases. Fresh installs and upgraded databases must converge to the same schema.

### 4.3 Upgrade, rollback, and retention

- Use the existing exclusive-maintenance/client-lease mechanism to quiesce writers, take and verify a migration backup, run checksummed ordered migrations, and run integrity/foreign-key checks before reopening clients. If old live clients cannot be proven quiescent, require a coordinated stop/restart.
- Test populated schema-10 fixtures, supported older upgrade paths, empty installs, repeated startup, disk-full/fault injection, and rollback. Do not mark a migration applied before its transaction commits.
- Preserve the existing refusal to open a database newer than the binary supports. A feature flag disables a behavior, not a schema migration. Binary downgrade requires an explicit compatible restore/export procedure; never automatically overwrite newer user data with the pre-migration backup.
- Rebuild derived indexes in bounded background work. Canonical card reads and source-by-ID inspection must work when the index is unavailable. Do not rebuild the entire source corpus on every connection.
- Canonical cards, source citations, and checkpoints follow explicit retention/purge policy. Jobs and diagnostics may expire; dispatch retention must be long enough for supported session continuity. If a manifest has expired, treat continuity as unknown and rehydrate rather than suppressing from absent records.

## 5. Versioned API changes

Target additive Admin v1 capabilities, provisionally starting at 1.8. Allocate actual versions and names in the contract PR. Do not add every operation to agent tool descriptions: Desktop Admin may be rich, while the agent-facing surface should stay small.

| Roadmap capability | Minimum request | Minimum response/behavior |
|---|---|---|
| `projects.context` | Existing authenticated workspace binding | Engine-resolved project/worktree identity and current HEAD; bootstraps the work descriptor |
| `sources.register` | Approved Markdown path, current worktree, exact selection, request ID | M1: synchronously read only that bounded file; return Source and approved/observed section digests |
| `sources.resolve` | Source ID and optional revision/section locator | Current availability/decision, safe relative locator, and bounded approved/observed excerpt |
| `sources.refresh`, `sources.revoke`, source jobs | Source ID, expected revision, request ID | M2 proposal; not advertised by Admin API 1.8 |
| `knowledge.capture`, `knowledge.review` | Scope, authority, source references, expected revision where applicable, request ID | Card and new revision, or explicit conflict/review requirement |
| `knowledge.search` | Query, validated scope, cursor, limit, optional source hints | Ranked cards and source hits, stable page cursor, partial-index status |
| `contexts.prepare` | Work descriptor, transient request, mode, budget, adapter session/epoch handle when available, request ID | Packet/manifest, included/excluded reasons, budget status, freshness and continuity requirements |
| `contexts.expand` | Prepared item handle, requested revision/representation, bounded budget, request ID | Evidence at the expected revision or a freshness/availability conflict |
| `contexts.ack` | Adapter-bound dispatch handle, payload digest, observed delivery stage/event ID | Idempotent receipt; no claim of comprehension/usefulness |
| `contexts.inspect` | Packet/dispatch ID | Version-aware explanation and delivery evidence for Desktop |
| `tasks.checkpoint_v2`, `tasks.readiness` | Task, expected previous checkpoint, observation boundary; resume worktree/runtime descriptor | Current-state checkpoint; readiness with explicit blockers |
| `usage.task_costs` | Project/task/time window, cursor | Observed totals, unknown coverage, acceptance counts, normalization/pricing versions |

Prefer extending an existing operation when its semantics and compatibility are identical; the table expresses distinct requirements, not a mandatory count of public methods. Add stable error codes including `CAPABILITY_UNAVAILABLE`, `SCOPE_REQUIRED`, `REVISION_CONFLICT`, `SOURCE_UNAVAILABLE`, `SOURCE_REVIEW_REQUIRED`, `BUDGET_INSUFFICIENT`, `CONTEXT_LINEAGE_UNKNOWN`, and `CHECKPOINT_NOT_READY`.

A new packet has a format version and full manifest even when optional content is empty. Format-v2 fields/items must never leak into v1 DTOs with incompatible enums. Keep old `contexts.build/current/packet_explain` on their legacy format/projection; new callers use version-aware operations. Explicitly route legacy writes to shared authority guards. Do not infer safe replacement from the legacy `safeToReplaceSession` flag in new clients.

Contract synchronization order:

1. Update Engine `api/admin-v1.json`, `api/admin-v1.types.ts`, validators/router dispatch, and contract tests together. Advertise a capability only when implemented.
2. Pin/copy that canonical revision into Desktop `apps/desktop/contracts/memory/admin-v1.json` and `.types.ts`.
3. Run `npm --workspace apps/desktop run memory-contract:generate` in Desktop.
4. Update Desktop typed wrappers/capability guards and Rust `memory_admin.rs` `API_VERSION`/`ALLOWED_METHODS`. The generator only emits TypeScript; it does not update Rust.
5. Run both repositories' contract checks. Test same-major older Engine negotiation; missing capabilities disable only the new feature, not basic existing Memory inspection.

Keep the existing 1 MiB frame bound and five-second native read timeout. Set lower per-operation page/excerpt limits with envelope headroom. M1 source methods perform one bounded targeted read; future long-running work must use an explicit job boundary. Authentication, socket permissions, and workspace binding stay in force; no database path or access token enters frontend DTOs.

## 6. Source-to-card workflow

### 6.1 Capture and index

1. The user selects a passage and invokes capture. Desktop requires a saved file or offers an explicit save; cancellation does not persist the buffer. It collects a concise conclusion, applicability, topic, and scope.
2. Desktop registers the approved relative path. Engine verifies the active project/worktree, canonical path containment, file type, allowed source set, size, and expected revision. Reject absolute paths, traversal, symlink escapes, and forbidden files. Defend the read itself against path-swap races, not just a prior path check.
3. Engine commits registry state and a coalesced job in one short transaction. A worker reads only approved sources, parses Markdown into heading-aware sections, computes digests, and creates derived search documents. Parsing respects fenced code, lists, heading hierarchy, and duplicate headings; the current regex outline helper is not the canonical chunker.
4. Preserve path, heading ancestry, section identity, source revision, bounded excerpt, and line/offset locator. A renamed/reordered heading is not automatically the same semantic section: use exact digest and nearby context as evidence, and surface ambiguity. A path rename needs an explicit mapping or verified repository rename; preserve source ID only when identity is established.
5. Before publishing an index revision, recheck that the job still targets the current desired revision and approval. In one transaction publish the derived projection and current pointer; stale/cancelled workers cannot overwrite a newer revision. Never hold a database write transaction while reading files or parsing a large document.
6. Engine returns the resolved section excerpt, `sourceRevision`, and `sectionDigest` for confirmation. Desktop compares it with the saved passage the user selected and rechecks its editor revision; if the file/selection changed, require re-selection or explicit re-confirmation. The card capture command submits `expectedSourceRevision` and `sectionDigest`, pins that approved revision, and records the card/evidence atomically after Engine revalidation. Never substitute the editor's FNV token for a source digest. If indexing is pending, show that state; do not create an ungrounded card using guessed section IDs.

Start with one Engine-owned worker, per-source revision coalescing, bounded batches, expiring leases, and bounded retries. Suggested initial limits to validate in load tests: 1 MiB per approved Markdown source, 100 results per page, and 16 KiB per returned evidence excerpt before the stricter context token budget. Oversized sources receive an explicit unsupported-size result, not silent truncation. These are adjustable product limits, not transport changes.

Use a local Markdown parser only after dependency/license review. Source text is untrusted data: strip/escape active rendering, never execute embedded instructions, and do not enable remote images/resources. Apply the existing secret-redaction policy before storing excerpts or diagnostics; if redaction removes an essential premise, mark the evidence insufficient instead of claiming complete recovery.

### 6.2 Save, invalidate, reconcile

Unify Desktop successful-save notifications across active save, tab save/close, batch save before sync, untitled save, and Save As. An index notification failure must not turn a successfully saved document into a failed save or cause an overwrite retry. Unsaved edits affect only the transient descriptor.

The notification is a hint, not the only freshness mechanism. Before returning an automatically injectable card, Engine revalidates its approved source using bounded targeted reads; it cannot depend on Desktop being open. Reconcile approved sources incrementally at startup/explicit refresh, with a persisted cursor. A complete background workspace watcher is deferred.

When the approved validation footprint changes, invalidate affected assertions and show `NEEDS_REVIEW`. That footprint includes governing context and declared dependencies, not just the selected paragraph. Use whole-document validation when a narrower dependency boundary has not been approved; test and measure its review burden. An unchanged approved footprint can retain validity across proven unrelated edits after target-context revalidation. A missing/revoked source is excluded from current reuse. Historical lookup is explicit and labeled; it never silently falls back to a different current section. Target worktree validation is separate from original approval, so divergence in one worktree does not overwrite another's validity.

Freshness checks can require hashing a bounded file to find the current section; cache validated revisions and budget these reads. If they cannot finish within the request budget, enqueue refresh and exclude the uncertain optional card. Essential resume state instead produces a readiness blocker. A metadata-only check is not sufficient for a correctness claim.

Authority transfer from an independent card to a document is deferred from M1. Its later implementation must be an idempotent prepare/save/confirm operation with both card and document expected revisions; file save and database commit are not one transaction. Switch authority only after the saved digest is verified, and expose interrupted operations for recovery.

## 7. Retrieval, context preparation, and delivery

### 7.1 Deterministic selection policy

Implement the new planner behind a policy version and compare it with the current planner in shadow mode before delivery:

1. Resolve explicit project/task/worktree and request mode (`continue`, `resume`, `lookup`). Do not infer a conflicting task from recency.
2. Apply authorization, scope, lifecycle, source-validity, and temporal filters inside candidate queries, before `LIMIT`. Otherwise unrelated records can crowd out eligible hits.
3. Retrieve bounded lexical/entity/path/symbol candidates. Include only relevant source sections and cards; no unconditional recent-record filler.
4. Apply a calibrated relevance threshold; deduplicate overlapping evidence and normalized identities. Project-wide constraints are mandatory only when explicitly applicable, never just because their kind is `CONSTRAINT`.
5. Build an indispensable state block for resume, then rank optional items by a deterministic benefit-per-estimated-token heuristic. Stable ties use stable IDs. Preserve applicability, negations, and safety qualifiers.
6. Select catalog, concise answer, or evidence representation. Prefer a direct concise answer when a likely extra tool round trip would cost more. Permit zero optional items.
7. Apply session-aware novelty only with confirmed continuity. Render, count/estimate the entire Memory packet including labels and provenance, and enforce the budget. If mandatory state does not fit, return `BUDGET_INSUFFICIENT`; never mark the task ready by truncating it.

Initial experimental Memory-only budgets: resume 600–1,500 tokens, continuing unchanged task 0–300 additional tokens, expansion 300–800 tokens. Use a provider-compatible counter when available, otherwise report an estimate with a safety margin. User requests, provider instructions, tool schemas, and retained history are not hidden inside these targets; they remain part of total usage.

Test Chinese/English text, identifiers, file paths, and no-hit queries. Keep embeddings out of M1/M2 unless lexical miss fixtures establish a specific need; an optional local embedding implementation must earn its complexity with retrieval and cost results.

### 7.2 Packet and dispatch state machine

```text
prepare(requestId) -> immutable packet + manifest
bind(adapter session, epoch) -> dispatch PREPARED
send exact rendered payload -> SENT
observable provider acceptance -> ACCEPTED
uncertain send/ack outcome -> UNKNOWN
definite rejection -> FAILED
```

Assembly, transport acceptance, and task usefulness are different facts. Store a durable dispatch before sending; a crash between provider acceptance and local recording becomes `UNKNOWN`, not a safe automatic retry. The existing delivery receipt is written only when its documented terminal condition is supported by evidence.

The novelty key is `(project, task, worktree, providerSession, contextEpoch, itemId, itemRevision, representation)`. Bind dispatch handles to the authorized adapter/session and payload digest. Late acknowledgments for an old epoch remain audit evidence and cannot update the new epoch's novelty state. Desktop packet preview cannot acknowledge delivery. An agent claiming that it read a card is not sufficient to mark provider-history continuity.

Use operation IDs for retry idempotency, separately from packet content hashes. Two sessions may legitimately receive identical bytes. Do not let the current project-wide packet-hash uniqueness suppress a new dispatch. Every repeated prepare/ack validates scope and request fingerprint; an expansion is its own versioned representation and delivery event.

Begin a new epoch on fresh session, observed compaction/reset, task switch, or uncertain lineage. Rehydrate essentials when retained state is unknown. An ordinary MCP tool response cannot prove future context retention; use bounded on-demand results without persistent novelty suppression unless the host provides that guarantee. Do not promise that omitting a card removes its old text from provider history. Send a short, explicit correction when an already-delivered assertion becomes stale or superseded.

Treat in-flight updates conservatively: a changed source may invalidate a prepared packet before send. Recheck essential item revisions/readiness at dispatch; rebuild if necessary. Pin expansions to their expected revision or return a conflict with the current revision available for explicit review.

The current request is transient ranking input. Do not persist raw prompts, selections, or secrets in packet/retrieval diagnostics. New operations store only allowed redacted summaries, bounded reason codes, and request fingerprints. Version-aware rendering must not depend on a stored raw prompt. Apply the repository's retention and purge rules to existing records separately; this plan does not authorize a bulk rewrite of historical data.

## 8. Checkpoint reducer and safe resume

### 8.1 Current state instead of accumulated summaries

Initially bind one task to one worktree. A different worktree requires an explicit handoff and drift validation; the single existing `tasks.last_checkpoint_id` must not represent concurrent state in multiple worktrees. Multi-worktree task heads are a later schema/product extension.

Protect that head across old and new writers. Once a task adopts checkpoint v2, every checkpoint entry point, including legacy Admin, MCP, and lifecycle hooks, must route through the shared v2 service or reject an incompatible write with a clear capability/conflict error. A legacy checkpoint cannot overwrite the v2 head or discard its watermark. Unmigrated tasks may retain the existing route; compatibility does not mean silently downgrading recovery state.

Use `checkpoints.schema_version = 2` with a validated payload containing:

- Objective and acceptance criteria; applicable constraints with source/card revision references.
- Current completed work and changed files; HEAD, worktree identity, and relevant dirty-file/section digests.
- One next action, remaining actions, blockers, unresolved user intent, and significant failed approaches with their conditions.
- Latest verification by check identity and tested code state; a pass on old code is not a pass on the current worktree.
- Last consumed observation ingest sequence, settled runtime boundary, and required-but-unavailable evidence.

Define explicit keyed reducer events such as `set_next_action`, `upsert_blocker`, `resolve_blocker`, `record_verification`, and `retract_claim`. Validate event authority; provider prose is not automatically a trusted state command. Rule-based updates handle structured tool/runtime facts; user-confirmed decisions remain distinguishable from model proposals.

Add a persistent monotonic ingestion sequence to observations; retain provider event time separately. One migration option rebuilds the table with `ingest_seq INTEGER PRIMARY KEY AUTOINCREMENT`, preserving the UUID as `UNIQUE NOT NULL` and all existing constraints. Assign deterministic sequences to legacy rows; never use a reusable hidden rowid as the durable watermark. Read bounded pages after the watermark up to a captured high-water mark, so late/replayed events are consumed once without rereading the earliest 500 events. Duplicate event fingerprints do not advance state twice.

Ingestion order is not semantic recency. Reducer updates carry the check/state identity, tested revision, and trustworthy provider ordering where available. A late old result stays historical instead of overwriting a newer current result. If ordering or authority cannot be resolved, retain an explicit conflict and block affected readiness rather than guessing from wall-clock timestamps.

Reduce outside a long write transaction, then atomically compare the expected previous checkpoint, insert the new checkpoint, update the watermark, and advance the task pointer. On conflict reread/reduce; do not publish a mixed snapshot. New observations after the captured boundary are handled by the next checkpoint and prevent stale readiness where relevant. Superseded verification remains historical evidence, not another current-state array entry.

### 8.2 Readiness and actual execution

Return `READY`, `NOT_READY`, or `UNKNOWN` plus reason codes. `READY` requires all of:

1. A committed checkpoint covering the latest settled task boundary.
2. No running tools, unresolved approvals, unacknowledged side effects, or unconsumed essential events.
3. Resolvable essential evidence; sufficient context budget without dropping recovery-critical state.
4. Validated current worktree/HEAD/dirty digests, with drift reconciled and obsolete verification invalidated.
5. A runtime that can start a fresh session while preserving the selected model, workspace, permissions, approval policy, tool configuration, and original user intent.

Evaluate readiness immediately before execution, not only when the checkpoint was created. In M2, rotation is an explicit user action; automatic rotation is deferred until actual cost/quality results justify a policy.

Extend the current runtime contract beyond its coarse `writable` boolean where needed to represent the execution policy faithfully. If the adapter cannot prove equivalence, report unsupported instead of upgrading permissions or silently dropping settings. A newly started session receives the checkpoint plus selected knowledge, not the entire old conversation.

Replace the current catch-all resume-error fallback to `runtime.start` with explicit reconciliation: distinguish failure before execution from an ambiguous provider failure after possible side effects. Preserve the run/dispatch record and require reconciliation before retrying potentially mutating work. Cancelled/failed runs still contribute observed usage. A provider process returning successfully does not mark the user's task accepted.

## 9. Desktop integration details

Implement the UI in focused adapters/components, with `App.tsx` passing document/task context and navigation callbacks rather than owning retrieval policy.

- Add CodeMirror selection tracking for both source and live editor modes. Existing `onEditorReady`/content callbacks do not continuously report selections. On file/mode switch, wait for the new editor instance before applying a source locator.
- Replace `useContextOsSession.ts`'s first-100-record local filtering with Engine query/paging. Debounce queries, cancel or discard superseded results, and bind requests to the current authorized workspace/task. A response from the previous project must never populate the new panel.
- Add explicit task selection and an adjacent `TaskContextPanel`; active file is only a ranking hint. Show loading, partial index, no match, unavailable Engine, missing capability, ambiguous scope, and stale source as different states.
- Source actions call `sourceNavigation.ts`, which resolves the source through Engine, then uses the existing authorized workspace opening path. Revalidate anchors; show the original excerpt and revision mismatch if a precise jump is no longer possible. Never open an arbitrary URL or shell command embedded in source text.
- Keep Markdown opening in its existing adapter. Code/test evidence initially uses a bounded read-only excerpt; a generic code IDE is not assumed.
- Document-authoritative cards display an edit-source action; independent cards use revision-checked editing. Surface conflicts rather than overwriting. Wire packet inspection into included/skipped reasons, source revision, freshness, budget, and actual delivery state.
- Show checkpoint blockers and next action. Keep safe-resume execution in the qualified external runtime until a Desktop run host is separately designed; the panel can expose readiness and instructions without pretending to own that host.
- Sync new UI strings in `apps/desktop/src/shared/i18n/locales/en.properties` and `zh-CN.properties`. Engineering docs, comments, and test descriptions remain English.

## 10. Usage accounting and acceptance experiment

This is M2 work, after M1's reliable-reuse gate. Collect the usage baseline before enabling new runtime behavior; it is not a dependency of M1's Desktop/source slice.

Normalize provider events into a versioned envelope with provider/model, event/run/task IDs, usage basis (`per_call` or `cumulative`), measurement status, input total, uncached input, cache-read/write, output, and pricing version/currency when known. Unavailable fields remain null/unknown. Preserve field semantics without retaining secret-bearing raw event payloads.

Use adapter-specific fixtures to establish whether reported input includes cached tokens. Do not sum included cache counts twice. Deduplicate repeated events; for cumulative reports compute deltas only within a known counter epoch, and handle resets/out-of-order reports explicitly. Record final usage in success, failure, cancellation, timeout, and recovery paths whenever observed; expose coverage gaps.

Keep existing legacy metrics labeled as packet/candidate estimates. New reporting separates observed totals, estimates, unknown usage, and task acceptance. Task acceptance is a recorded user/evaluator outcome with evidence at a code revision, not `execution_runs.status = SUCCEEDED` or a mention of a source ID.

Create a reproducible local evaluation runner with four isolated arms: native history; current Memory plus native history; fresh session plus checkpoint; fresh session plus checkpoint and new knowledge. Record scenario/fixture versions, repository state, provider/model/configuration, all attempts, acceptance evidence, usage coverage, and cold/warm cache conditions. External paid runs require explicit authorization; CI uses fixture runtimes and deny-network tests.

Count all model usage attributable to the workload, including retries, failures, recovery, capture/extraction, and checkpoint work. Declare shared preprocessing attribution and actual reuse, rather than assuming future reuse. Report cost per accepted task as all attempt costs divided by accepted tasks; if accepted count is zero or pricing/usage coverage is insufficient, report undefined/incomplete, not zero cost or proven savings.

Start with the companion design's 30-task repeated pilot and expand if uncertainty is inconclusive. Predeclare workload classes such as one-off edits, architecture lookup, recurring maintenance, long tasks, and cross-session continuation, and report each separately. Positive net savings, quality non-inferiority, and no observed critical regression govern a savings claim for a supported class. The earlier 20% lower-cost goal is an experimental ambition for suitable workloads, not M1 acceptance or a universal product success/failure line. Include failed and low-value classes rather than hiding them in a favorable aggregate.

## 11. Implementation backlog and dependency order

Each row is a reviewable work package and may require several small PRs. Do not merge all schema, protocol, runtime, and UI work as one change.

| Package | Scope and main files | Dependencies | Required exit evidence |
|---|---|---|---|
| P0: Measurement baseline (M2) | Engine usage adapters, `context-telemetry-repository.ts`, `session-manager.ts`; Desktop metric labels | M1 validation gate; before new runtime behavior | Missing usage is not zero; failures counted; cache/cumulative fixtures pass; reproducible control arm |
| P1: Identity and migration foundation | Engine `schema-v2.ts`, explicit migration modules, `knowledge-command-service.ts`, read models | Reviewed M1 fixture oracle | Same text in two tasks creates distinct cards; identity excludes applicability; no cross-task supersession; CAS/idempotency/restore conflicts tested; schema-10 restore verified |
| P2: Approved-source/card service | Engine source port/reader/repositories/jobs/index; card authority service | P1 | Capture pins a saved section; project/path isolation; stale job cannot publish; source changes invalidate only affected assertions |
| P3: Contract and Desktop M1 | Engine canonical API; Desktop vendor/generator/Rust/client; capture, search, navigation | Minimal P2; API definitions may be reviewed earlier | Full restart/mutation/isolation slice; held-out findability and exact-source gates; supported-profile latency; delayed-use pilot; old Engine fallback |
| P4: Context v2 and manifest | Engine planner, packet migration/repository, prepare/expand/dispatch; Desktop inspector | P1, P2; coordinate API additions with P3 | Zero optional context on no-hit; eligibility before limit; budget safety; repeated known revision suppressed only with continuity; version correction delivered |
| P5: Checkpoint v2 | Engine observation cursor, pure reducer, task/checkpoint repository, readiness | P1; readiness budgeting integrates with P4 | More than 500 events, replay, late events, concurrent checkpoints, code drift, pending tools/approvals all behave correctly |
| P6: Qualified managed resume | Engine runtime contract, Codex adapter, `session-manager.ts`, gateway/lifecycle integration | P0, P4, P5 | Fresh-session restore preserves policy; uncertain side effects are not retried blindly; loss of acknowledgment does not claim delivery/usefulness |
| P7: M2 evaluation and gated rollout | Local evaluation harness, docs, Desktop outcome display, cross-version fixtures | P3, P6 | Same tasks pass acceptance with complete cost accounting; pilot supports or rejects enabling the feature |

First review the M1 fixture oracle, then deliver P1 → minimal P2 → minimal P3 and run M1's technical and delayed-use gates. P3 implementation alone is not acceptance. Defer P0 and P4–P7 until M1 establishes reliable, practical reuse; then order the M2 work by its technical dependencies. P7, not the existence of a context panel, completes the later token-saving experiment.

The first batch contains P1 identity/migration tests and the minimal P2→P3 passage-to-card path. It excludes automatic extraction, provider runtime work, checkpoint resume, and savings instrumentation. The validation document defines concrete expected outcomes for merge/rebase, another task, changed prerequisites, stale caches, and exact-source navigation before any implementation chooses its own interpretation.

### 11.1 Mandatory regression matrix

| Area | Scenarios that must fail safely or remain correct |
|---|---|
| Identity and ownership | Same text across projects/tasks/worktrees; branch rename; ambiguous legacy task state; forged source/card IDs; concurrent revision updates; restore collisions |
| Sources and jobs | Unsaved selection; external edit; unrelated section edit; rename/delete/revoke; fenced headings; duplicate headings; Chinese text; cancelled/stale/crashed job; path/symlink escape; large file; secret redaction |
| Retrieval and delivery | Wrong-scope records filling top K; no hit; essential budget overflow; qualifier preservation; request replay; session switch; compaction; unknown send outcome; stale prepared packet; expansion at old revision |
| Checkpoints and execution | 1,500+ observations; late/replayed events; concurrent reducers; resolved blocker removal; failed-then-passed check on different code; dirty-file drift; running tool/approval; ambiguous provider failure; policy mismatch |
| Compatibility and UI | New Desktop/old Engine; old Desktop/new Engine; unsupported capabilities; old/new packet formats; all save paths; late response after project switch; editor-mode navigation; synchronized locales |
| Accounting and recovery | Cumulative usage reset; cache inclusion differences; cancelled/failed run; missing usage/pricing; zero accepted tasks; migration interruption; backup restore; index rebuild without canonical loss |

### 11.2 Repository gates

For Engine production changes, run in the Memory repository:

```sh
npm run typecheck
npm test
npm run admin-contract:check
npm run docs:check
```

Before an Engine release, use the existing repository gates, including `npm run check`, `npm run benchmark:ga`, and `npm run package:check`. Their current synthetic benchmarks do not replace the paired task evaluation. Update the single owning English behavior document and its Chinese counterpart when behavior is user-visible.

For Desktop changes, run in the Desktop repository:

```sh
npm --workspace apps/desktop run memory-contract:check
npm run typecheck
npm run lint
npm test
npm run build
cargo fmt --all -- --check
cargo test -p polarbear-desktop
git diff --check
```

Add the missing contract check and applicable native tests to Desktop CI; the inspected frontend quality workflow does not run all of them. The existing real-Engine native smoke test is ignored by default. After configuring the documented absolute `POLARBEAR_MEMORY_E2E_RUNTIME` and `POLARBEAR_MEMORY_E2E_CLI` fixture paths, run it separately on a supported local platform:

```sh
cargo test -p polarbear-desktop desktop_starts_the_real_engine_from_the_installed_runtime_descriptor -- --ignored --test-threads=1
```

These remain release gates even where focused M1 checks have passed. Use isolated temporary databases/worktrees and fixture runtimes; never migrate the user's production database just to test a PR.

## 12. Rollout, fallback, and definition of done

Introduce independent local flags for source capture/indexing, shadow planner, new context delivery, and explicit safe resume. Default new execution behavior off until its gates pass. Expose actual supported capabilities rather than a single vague enabled state.

| Condition | Expected behavior |
|---|---|
| Old Engine lacks new capabilities | Existing Memory UI works; new actions explain the missing capability |
| New Engine with an old client | Legacy contracts remain parseable; shared authority guards still apply |
| Source index rebuilding | Show partial results; allow direct card/source inspection; no full scan in the request path |
| Engine unavailable during save | Document save succeeds independently; indexing status can be retried |
| Source validity or runtime continuity unknown | Do not inject uncertain assertions or suppress essential rehydration |
| Checkpoint incomplete or policy cannot be preserved | Refuse fresh-session replacement; leave the existing session intact |
| New planner underperforms | Disable new delivery without deleting cards/sources; inspect measured causes |
| Schema rollback requested | Use explicit verified backup/export recovery; no automatic destructive downgrade |

M1 is done only when the dedicated validation plan's technical and delayed-use gates pass: users can capture a conclusion, restart both processes, find it without exact-title recall, inspect the correct evidence, and recognize or correct invalid applicability after task/branch/source changes. Zero observed unsafe reuse must be accompanied by useful eligible recall, bounded latency, and tolerable review effort. No token-saving claim follows from this milestone.

M2 is done when an interrupted task resumes through the qualified runtime with current recovery state and bounded relevant knowledge, passes the same acceptance checks, preserves permissions, and produces complete enough paired usage evidence to decide whether it saves tokens and cost. If the experiment is inconclusive or worse, deliver that result and keep automatic rollout disabled.

Production rollout, provider runs, commits, tags, and pushes remain separate actions. The implementation does not migrate a user's database until that Engine build opens the project normally.
