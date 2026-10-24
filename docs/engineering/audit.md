# Engineering Audit

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
The post-change AST graph covers 167 production TypeScript files, not Rust,
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
imports, or computed imports; 21 cross-feature edges remain for explicit review.
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
| ENG-04 | P2 / Confirmed | `TyporaLiveEditor::openTableSizeMenu/openTableActionMenu/openTableInsertCountMenu` registered outside listeners inside a later RAF | Closing before that frame could revive listeners. New pre-fix test reproduced one retained listener. Feature-local `tableMenuLifecycle` registers disposal synchronously, cancels focus, and closes portals when their widget is destroyed. |
| ENG-05 | P2 / Confirmed | All-target Clippy found 126 fixture-only unwrap/expect diagnostics plus one test-module placement diagnostic | Scoped test-only allowances follow existing repository policy; unchanged caption runtime fixtures move into `runtime_tests.rs`. Production prohibitions and all assertions remain. This is lint-policy consistency, not 127 production bugs fixed. |
| ENG-06 | P2 / Confirmed | `src-tauri/src/main.rs` mixed path normalization/containment/name validation with bootstrap and IO | Extracted unchanged functions into `workspace_paths.rs` after adding compatibility tests. Canonical ancestor containment and logical-root paths are preserved. Other filesystem and repository responsibilities remain in main. |
| ENG-07 | P2 / Confirmed | `App`, `TyporaLiveEditor`, `main.rs` still combine several responsibilities | Partial: removed repository refresh ownership and duplicated table portal cleanup. App function remains about 4,057 lines; ImageViewer 690; table controller 435. Further extraction must follow behavioral ownership, not arbitrary file-size limits. |
| ENG-08 | P2 / Confirmed design limit; resource impact Suspected | `features/diagram/diagramRenderCache.ts::getOrRender` bounds completed entries/code units but not distinct pending render requests | Deduplication and completed-cache bounds remain intact. Queue growth under many unique diagrams has no new measured memory/latency evidence. Add a fixed stress fixture before introducing admission control. OPEN. |
| ENG-09 | P1 / Confirmed fallback and validation defects; exploitation not reproduced | `shared/tauri/openExternalUrl.ts` treated native rejection as browser availability; native launcher ignored unsuccessful exit status and used Windows command-shell parsing | FIXED in the boundary follow-up: explicit runtime choice, validation on both IPC sides, no current-page navigation, localized failure feedback, checked process status, and direct Windows ShellExecuteW URL dispatch. Browser/native regressions pass; actual Windows handler acceptance remains NOT RUN. See the follow-up in verification. |
| ENG-10 | P1 / Confirmed by injected failures | `src-tauri/src/secret_store.rs::delete_repository_secrets` ignored both keychain deletion errors | FIXED for deletion acknowledgement: attempt both keychains and fallback cleanup, return a sanitized coded error if any fail, retain the existing account/UI failure path and support idempotent retry. No real credentials were deleted in tests. Debug fallback file-creation permissions and restart recovery after partial deletion remain separate follow-up work. |
| ENG-11 | P2 / Suspected | Settings are local persistent values projected into React/native state; cross-window read-modify-write has no stress proof | Existing restart/invalid-setting tests pass. Do not infer multi-writer atomicity from them. No new storage format or speculative global store was added. OPEN. |
| ENG-12 | P1 / Confirmed verification gap | macOS release lacked Desktop browser, real bundled translation, all-target Clippy/native correctness, and Memory contract checks in its own dependency path | Added blocking steps to `release.yml`; `quality.yml` gains all-target Clippy. Local commands pass. Hosted execution and branch protection are NOT VERIFIED for this revision. |
| ENG-13 | P2 / Confirmed governance gap | Cargo license declarations exist but root license texts are missing; no root contribution/security guide or issue/PR template existed | Added `CONTRIBUTING.md`, `SECURITY.md`, and evidence-oriented issue/PR templates. License ownership/grant must be resolved by maintainers; no arbitrary copyright/license text added. Private reporting and required checks require GitHub administration. |
| ENG-14 | P2 / Not Reproduced in this pass | Real microphone ASR accuracy, physical-device behavior, and two-hour caption continuity | Existing mocked/fake-helper tests and historical release evidence do not prove these outcomes. No ASR model, latency threshold, or recording behavior changed. OPEN acceptance work. |

## State and Trust Boundaries

| Area | Authority and inspected safeguards | Remaining limit |
| --- | --- | --- |
| Document | Markdown text plus revision; `DocumentReadRequests`, save acknowledgement and `document_save.rs` transactions | Cooperative macOS writer tests are not proof against every hostile filesystem mutation or unsupported filesystem. |
| Editor | CodeMirror state/history; table widths are document UI state, not Markdown metadata | Large widget/controller ownership remains; physical IME is not proven by synthetic browser events. |
| Repository | Native credentials/bindings; feature hook owns only their UI projection | Push/pull state and dialogs remain in App; live provider rate-limit/auth/network fault acceptance not run. |
| Memory | Versioned Admin API, method allowlist, bound workspace, private Unix socket/token, bounded response frame/read timeout and blocking work off the async executor | No direct `memory.db` access added. Real installed Engine opt-in integration remains unrun. Non-Unix transport is not demonstrated. |
| Caption | Existing native session owns capture/store; frontend observes, translator has separate lifecycle | Mock/helper coverage is not production recognition accuracy or hardware endurance. |
| Rendered input | Existing Markdown/SVG sanitation and diagram error/consent boundaries retained | Rich browser/native paste fixtures passed, not a complete XSS fuzzing campaign. |
| Native capabilities | Main and caption windows have separate capabilities; caption command restrictions exist in native handlers | A capability JSON description alone does not prove application-command authorization. No comprehensive IPC fuzzing or Windows audit was performed. |
| Secrets | Production keychain storage, debug-only fallback, no new diagnostic content logging; deletion failures now block disconnect acknowledgement | Debug file-creation permissions and restart recovery after partial cleanup remain open. Cross-store deletion is not transactional. |

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

1. Complete real OS-handler acceptance for the external-navigation correction;
   separately test debug credential-file creation permissions and recovery after
   a partially successful credential cleanup followed by process restart.
2. Document session ownership out of App and repository sync out of main: retain
   payloads, revision rules, errors, and fault tests; move one owner per commit.
3. Fixed small/medium/large/table/diagram document corpus; measure opening,
   editable readiness, input/preview latency and CPU/RSS on the same machine.
4. Use those measurements to bound pending diagram work or reduce reparsing;
   no unmeasured cache/thread expansion.
5. Required checks, license decision, physical iPhone and both macOS architecture
   acceptance, then packaged release validation for the exact new tag.

Earlier [refactoring records](../refactoring/architecture-audit.md) remain
historical evidence; this audit does not retroactively upgrade their results.
