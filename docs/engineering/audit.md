# Engineering Audit

## Current Follow-up: 2026-10-25

Baseline `dc5e11e3c78283b55f6b004d73df8f4df2883c98`, isolated engineering branch.
The fixed evaluation contract is in [scorecard](scorecard.md#fixed-acceptance-contract-2026-10-25).

- **P0, reproduced:** `useDocumentSession.requestAppQuit` saves its initial dirty
  list and quits after A is edited while B saves. The real-App browser regression
  observed a `quit_app` invocation with A still dirty.
- **P0, reproduced:** boolean `ask` conflates cancellation and explicit discard
  in `closeTab`; returning Cancel removed the dirty document.
- **P1, reproduced:** both Save As implementations await the directory before
  acknowledging a successful write. A directory error left the committed file
  represented as a dirty Untitled tab.
- **P0, locally remediated:** repository pull previously skipped
  divergent local changes but returns no conflict; push obtains fresh content
  SHAs and may replace remote work. Downloads read mutable branch content.
- **P1, migrated with rollback coverage:** sync digests previously encoded the
  entire content; excluded directories are traversed before filtering files.
- **P1, confirmed by inspection, remediation pending:** preview image regex runs
  inside ordinary code fences. Fixed-grid sidebars have no shared resize owner
  or persisted width preferences.

The first three findings have targeted green browser regressions. Repository
sync now uses frozen snapshots, conditional publication and conditional local IO.
Real GitHub/GitLab write acceptance remains NOT RUN. Full
cross-platform and final-checkout acceptance is tracked separately. This section
does not supersede earlier dated evidence or imply whole-audit completion.

Date: 2026-10-24. Baseline: `166e231c61dc568876aab8dbebdb6636a2c281ae`.
Implementation: `2747dc36d2a0cb559ba7e33415118597c711b96f`.
Boundary follow-up: `e1fd7c08b0bd8102e97c0b57764a9f17869b2cf2` (ENG-09/ENG-10).
See [verification](verification.md) for the exact worktree and environment limits.

## Conclusion

Polarbear is a feature-oriented modular application with useful existing native
adapters, command definitions, revision-aware document IO, local translation,
and explicit Memory contracts. It is not an unstructured rewrite candidate.
Its main weakness is incomplete ownership separation inside application and
editor composition, with asynchronous paths bypassing otherwise sound guards.

This pass fixes reproducible document and table lifecycle defects, extracts
repository identity ownership and filesystem path policy, and strengthens CI.
It does **not** establish completion of every requested governance phase, a
9.5/10 quality level, a security certification, or a performance improvement.
App still owns too much. Device acceptance and performance measurements remain
material gaps, not optional evidence that a successful build can replace.

## Coverage and Method

The baseline inventory contained 541 tracked files. Inventory and entry-point
inspection covered Desktop, iPhone Reader, shared packages, native helpers,
scripts, manifests, workflow definitions, tests, and documentation. Generated
contracts were inspected at their generator/canonical-source boundary, not
counted as authored production logic. Models, dependencies, target/dist output,
and third-party code were excluded from production-size analysis.

The initial authored TS/Rust source-size slice contained 183 production-classified
files and 34,514 physical lines. This deliberately narrow slice excludes native
Swift/C++ and includes inline Rust tests; it is **not** total repository LOC.
The current AST graph covers 181 production TypeScript files, not Rust,
Swift, CSS, Tauri registration, or every possible bundler dependency.

Deep review focused on `App`, `TyporaLiveEditor`, table widgets, document read/save
ownership, repository refresh/sync, settings, Memory Admin transport, caption
runtime, external navigation, secret storage, and quality/release workflows.
An inventory of every tracked path is not a claim that every line received a
formal security review. No numerical duplication ratio, branch coverage, or
cyclomatic-complexity measurement was produced.

Reproduce the TypeScript dependency and function-size inventory with:

```sh
node apps/desktop/scripts/architecture-graph.mjs
```

Its report records HEAD plus untracked-file count. Type-only dependencies are
included in boundary checks but excluded from runtime cycles. Relative imports
and the existing reader-core alias are resolved; external npm internals are not.
Computed imports are reported for review, not assumed safe. Current results:
zero runtime cycles, forbidden reverse dependencies, unresolved relative
imports, or computed imports; 24 cross-feature edges remain for explicit review.
For example, editor rendering depends on diagram rendering, and Memory/Vocab
selection types still come from an editor component. Those are coupling points,
not automatically proven defects.

## Findings

All paths below are relative to the repository. P1 means prompt correction or
focused follow-up; P2 means planned maintainability/verification work. No newly
confirmed P0 catastrophic failure was reproduced in this pass.

| ID | Priority / evidence | Location and root cause | Impact / disposition |
| --- | --- | --- | --- |
| ENG-01 | P1 / Confirmed | `apps/desktop/src/App.tsx::openMemorySource` directly loaded an already-open source and wrote document/revision state after an await, bypassing `DocumentReadRequests` | Concurrent typing was overwritten in the new pre-fix browser regression. Fixed by reusing `reloadDocumentFromDisk`; conflict, close/reopen, and revision ownership stay authoritative. |
| ENG-02 | P1 / Confirmed by code inspection | `App::refreshRepositoryState` committed account/binding or errors without workspace-generation checks | Extracted `features/repository/useRepositoryIdentity.ts`; obsolete results/errors cannot replace the current projection. Four browser hook tests cover workspace changes, A-B-A, disconnect, and current errors. This is not a complete push/pull controller extraction. |
| ENG-03 | P2 / Confirmed | `tableInteractionDom::installTableInteractionControls` scheduled its initial RAF outside its disposal bookkeeping | A new pre-fix test retained one frame after immediate disposal. Fixed by routing the initial frame through the existing scheduler. |
| ENG-04 | P2 / Confirmed | Table portal helpers, now in `table/tableWidgetMenus.ts`, registered outside listeners inside a later RAF | Closing before that frame could revive listeners. New pre-fix test reproduced one retained listener. Feature-local `tableMenuLifecycle` registers disposal synchronously, cancels focus, and closes portals when their widget is destroyed. |
| ENG-05 | P2 / Confirmed | All-target Clippy found 126 fixture-only unwrap/expect diagnostics plus one test-module placement diagnostic | Scoped test-only allowances follow existing repository policy; unchanged caption runtime fixtures move into `runtime_tests.rs`. Production prohibitions and all assertions remain. This is lint-policy consistency, not 127 production bugs fixed. |
| ENG-06 | P2 / Confirmed | `src-tauri/src/main.rs` mixed path normalization/containment/name validation with bootstrap and IO | Extracted unchanged functions into `workspace_paths.rs` after adding compatibility tests. Canonical ancestor containment and logical-root paths are preserved. Repository extraction followed under ENG-07; workspace command composition remains in main. |
| ENG-07 | P2 / Confirmed | `App`, `TyporaLiveEditor`, `main.rs` combined several responsibilities | App delegates repository workflow, document-session state and zoom lifetimes to feature owners. The live React host delegates scanning, decorations and widgets; Table composition delegates input, menus, widths, clipboard and transactions. Session/zoom owners remain substantial internally; App still coordinates editor commands, image insertion and view composition. No whole-repository decomposition claim. |
| ENG-08 | P2 / Confirmed design limit; resource impact Suspected | `features/diagram/diagramRenderCache.ts::getOrRender` bounds completed entries/code units but not distinct pending render requests | Deduplication and completed-cache bounds remain intact. Queue growth under many unique diagrams has no new measured memory/latency evidence. Add a fixed stress fixture before introducing admission control. OPEN. |
| ENG-09 | P1 / Confirmed fallback and validation defects; exploitation not reproduced | `shared/tauri/openExternalUrl.ts` treated native rejection as browser availability; native launcher ignored unsuccessful exit status and used Windows command-shell parsing | FIXED in the boundary follow-up: explicit runtime choice, validation on both IPC sides, no current-page navigation, localized failure feedback, checked process status, and direct Windows ShellExecuteW URL dispatch. Browser/native regressions pass; actual Windows handler acceptance remains NOT RUN. See the follow-up in verification. |
| ENG-10 | P1 / Confirmed by fault injection and real filesystem fixtures | Credential cleanup hid partial failures; debug creation wrote before chmod and followed links | FIXED for scoped deletion/restart/publication paths: durable intent and private atomic publication; mode 0600 and macOS ACL removal before secret bytes; no symlink reads/writes; old hard links never receive new secrets. Disconnect cleans precisely named crash staging files and reports partial failure. Real Keychain/Windows prompts, power-loss and hostile same-user processes are not covered. |
| ENG-11 | P2 / Suspected | Settings are local persistent values projected into React/native state; cross-window read-modify-write has no stress proof | Existing restart/invalid-setting tests pass. Do not infer multi-writer atomicity from them. No new storage format or speculative global store was added. OPEN. |
| ENG-12 | P1 / Confirmed verification gap | Release lacked independent critical gates; Quality's main/PR-only triggers skipped engineering branch pushes | Release blocking checks retained; Quality also listens to `codex/**` after GitHub confirmed zero runs for `358d0b2`. Trigger/registration regression tests added. Hosted execution is reported separately from local results; branch protection remains NOT VERIFIED. |
| ENG-13 | P2 / Confirmed governance gap | Cargo license declarations exist but root license texts are missing; no root contribution/security guide or issue/PR template existed | Added `CONTRIBUTING.md`, `SECURITY.md`, and evidence-oriented issue/PR templates. License ownership/grant must be resolved by maintainers; no arbitrary copyright/license text added. Private reporting and required checks require GitHub administration. |
| ENG-14 | P2 / Not Reproduced in this pass | Real microphone ASR accuracy, physical-device behavior, and two-hour caption continuity | Existing mocked/fake-helper tests and historical release evidence do not prove these outcomes. No ASR model, latency threshold, or recording behavior changed. OPEN acceptance work. |
| ENG-15 | P1 / Confirmed by browser regression | The live preview collector scanned the body of ordinary code fences for tables/images/callouts | A fenced Markdown example became an interactive table. The extracted `markdown/previewBlocks.ts` treats closed and unfinished ordinary fences as opaque, preserving valid diagram fences and exact source ranges. |
| ENG-16 | P2 / Confirmed by delayed-response regression | Repository status orchestration in App applied a previous workspace's response after navigation | The feature workflow uses workspace-lifetime ownership for status reads/context resolution; stale responses/errors cannot reopen the status dialog or overwrite the new workspace status. Native requests are not cancelled. |
| ENG-17 | P1 / Confirmed by delayed-response browser regressions | Document Save As and close completion used the initiating render's active ID and tab list | Save As stole focus after switching documents; delayed close removed newly opened tabs. The session checks current active identity and reads the current tab list before committing completion. Native writes are not cancelled. |
| ENG-18 | P2 / Confirmed by browser regression | Zoom Reset did not invalidate queued gesture frames/settle work | A queued gesture reapplied a scaled canvas after Reset. `useAppZoom` cancels pending work and releases anchors/locks before the command. Locale changes no longer reinitialize native zoom; adapter tests cover late registration and asynchronous teardown failure. |
| ENG-19 | P2 / Confirmed by dual-editor browser regression | Table focus restoration queried the whole document by source offset | Inserting in the second editor focused the first editor's table at the same offset. `tableWidgetTransactions` scopes lookup to the originating EditorView and rejects stale/disconnected document retries. |

## State and Trust Boundaries

| Area | Authority and inspected safeguards | Remaining limit |
| --- | --- | --- |
| Document | `useDocumentSession` owns Markdown buffers, revisions, dirty markers and tab identities; existing `DocumentReadRequests`, save acknowledgement and native `document_save.rs` transactions remain authoritative | Cooperative macOS writer tests are not proof against every hostile filesystem mutation or unsupported filesystem. Rename/move/delete races need further focused qualification. |
| Editor | CodeMirror state/history; pure preview scanner, decoration policy, Table-local input/menu/transaction modules; widths remain document UI state | Physical IME is not proven by synthetic browser events. No new rich-cell persistence format was introduced. |
| Repository | Native identity owner serializes credential access and persists cleanup intent; feature workflow owns UI actions and dialogs, reusing the identity projection | App connects document-session save/reload actions through explicit callbacks. Live provider rate-limit/auth/network fault acceptance is not run. Already in-flight HTTP requests are not revoked by local cleanup. |
| Memory | Versioned Admin API, method allowlist, bound workspace, private Unix socket/token, bounded response frame/read timeout and blocking work off the async executor | No direct `memory.db` access added. Real installed Engine opt-in integration remains unrun. Non-Unix transport is not demonstrated. |
| Caption | Existing native session owns capture/store; frontend observes, translator has separate lifecycle | Mock/helper coverage is not production recognition accuracy or hardware endurance. |
| Rendered input | Existing Markdown/SVG sanitation and diagram error/consent boundaries retained | Rich browser/native paste fixtures passed, not a complete XSS fuzzing campaign. |
| Native capabilities | Main and caption windows have separate capabilities; caption command restrictions exist in native handlers | A capability JSON description alone does not prove application-command authorization. No comprehensive IPC fuzzing or Windows audit was performed. |
| Secrets | Production keychain storage; Unix debug fallback is privately staged and atomically published, including macOS ACL handling; cleanup intent covers crash staging files | Real OS prompt acceptance remains open. Non-Unix debug builds require the system credential store. Cross-store deletion uses forward recovery, not an atomic transaction. Historical copies cannot be revoked. Legacy orphaned credentials without metadata or intent cannot be inferred safely. |

## Dependency and Cleanup Decisions

Keep caption research scripts, platform branches, hidden translation entry points,
generated contracts, and model resources: manifests/build scripts/workflows or
native command registration reference them. A missing static import is not
proof of dead code. No npm/Cargo dependency was removed or upgraded in this pass.
The graph guard complements existing ESLint boundaries; it does not ban every
cross-feature edge or pretend to be a complete reachability analyzer.

The actual duplicate implementation removed is the three portal-menu cleanup
blocks and the competing direct Memory reload path. Existing compatibility
fallbacks and historical documentation remain until their retirement is proven.

## Next Safe Sequence

1. Complete real OS-handler and Keychain-prompt acceptance. Debug creation,
   publication and restart cleanup now have isolated filesystem/ACL/umask faults;
   those fixtures do not establish real system-store or power-loss behavior.
2. Qualify session rename/move/delete completion against workspace changes and
   simultaneous edits before further internal decomposition. Document-session,
   zoom and Table responsibilities now have owners; preserve those boundaries
   and avoid creating another store or mutation path.
3. Fixed small/medium/large/table/diagram document corpus; measure opening,
   editable readiness, input/preview latency and CPU/RSS on the same machine.
4. Use those measurements to bound pending diagram work or reduce reparsing;
   no unmeasured cache/thread expansion.
5. Required checks, license decision, physical iPhone and both macOS architecture
   acceptance, then packaged release validation for the exact new tag.

Earlier [refactoring records](../refactoring/architecture-audit.md) remain
historical evidence; this audit does not retroactively upgrade their results.
