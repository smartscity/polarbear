# Refactoring Execution Report

Base: `22d9e0b`. Repository audit and the bounded, evidence-backed implementation batches are complete; OPEN debt is not claimed fixed. Verification ran locally on macOS x86_64 on 2026-10-23.

## Reproduced before changes

- Desktop Vitest: 238 passed; iOS Vitest: 36 passed. Desktop typecheck and ESLint passed.
- New disposed revision test failed: onMissing called once after cleanup.
- New Context Playwright regressions failed: previous workspace save replaced current config, and completing the first of two operations cleared busy early.
- Cross-workspace draft and invisible workspace-feedback browser assertions failed before their fixes. Two reading-position boundary tests failed against unvalidated records. Dependency ownership test failed for ten Desktop import sites.

## Implemented batches

- `ContextSessionLifetime` owns activation epochs and in-flight operation accounting. Old callbacks cannot update a replaced session. Hook refresh resets project-specific data and uses the same lifetime checks. A multi-stage knowledge capture checks session lifetime before issuing its second mutation.
- Revision observer checks disposal after its awaited native read.
- Two duplicate completed/pending cache implementations become one feature-local cache policy. Retention is limited to 32 successful entries and 4,000,000 combined source/SVG UTF-16 code units per renderer. Oversized values still render but are not retained. Failures are retryable and localized at presentation, not permanently cached. This is a retention bound, not a measured process-memory limit or speedup.
- `ContextWorkspace` is a keyed project boundary; unsaved drafts and selected memory state cannot cross projects. Switching projects resets the Context subpage; refreshing within the same project preserves its draft.
- `Sidebar` renders the existing operation status with a bounded, wrapping live region. No duplicate store or untranslated UI string was added.
- `readingState` validates persisted positions per record, preserves valid records and the existing 500-entry policy, and clamps display offsets/ratios. No key, schema or user document changes.
- Removed only the five proven-unused plugin-list/status selectors. Deleted the duplicate widget cache machinery, not model assets or compatibility migrations.
- Added direct declarations for existing CodeMirror language and Lucide libraries and synchronized lock metadata without changing resolved versions. Added a source dependency/lock consistency check to the existing Desktop test command.

## Audit Batch A-E Validation (Historical)

| Check | Result | Scope |
| --- | --- | --- |
| Desktop TypeScript / ESLint | PASS | Zero errors and zero warnings after lifecycle lint fixes |
| Desktop Vitest | PASS, 50 files / 245 tests | Includes seven new lifecycle/cache tests |
| Desktop Node script tests | PASS, 24 existing + 2 dependency tests | Asset fixtures, process protocol, package artifact paths and manifest ownership |
| Desktop Playwright | PASS, 33 tests | Three new Context cases plus feedback assertion; actual Mermaid rasterization and bundled translation, mocked native APIs |
| iOS TypeScript / ESLint | PASS | Reader source checked separately |
| iOS Vitest | PASS, 5 files / 39 tests | Three new persisted-position cases |
| iOS Playwright | PASS, 11 tests | Includes early navigation scroll-position flush |
| Desktop / iOS Vite builds | PASS | Existing large-chunk warnings remain; not a startup performance result |
| Desktop Rust tests | PASS, 35; 1 ignored | Ignored real Engine launch requires explicit runtime/CLI fixture |
| iOS Rust plugin tests | PASS, 1 | Pending native-open delivery/acknowledgment |
| Swift document-store tests | PASS, 29 | Coordination, conflicts, recovery, grants, encoding and bounded traversal on temporary fixtures |
| iOS native storage script | PASS | Persistence, transfer, import validation and failure fixtures |
| Rust formatting / generated Admin contract | PASS | No native or generated contract changes |
| Caption native CTest | PASS, 7 | Existing local x86_64 build artifacts; no fresh helper build or engine qualification claim |
| Caption Python research suite | BLOCKED | Attempted; six modules cannot import numpy/soundfile in current Python. No dependencies installed and no thresholds changed |
| Visual checks | PASS for inspected frames | Desktop light 1024px and dark 320px Settings screenshots inspected; feedback screenshot captured separately |
| Git whitespace check | PASS | Existing Feedback edits preserved |

Commands used the existing bundled Node executable for `tsc --noEmit`, `eslint src`, `vitest run`, `playwright test`, `vite build` and `node --test` from each workspace. Native checks used `cargo test --manifest-path ...`, `cargo fmt --all -- --check`, `swift test --package-path packages/apple-document-store`, and `node apps/ios/scripts/test-storage.mjs`. Python discovery was `python3 -m unittest discover -s apps/desktop/scripts/caption-evaluation -p 'test_*.py'`.

## Structural review and remaining work

In batches A-E, session lifetime and cache policy are feature-local owners with actual invariants. No new global singleton, event bus, framework or storage abstraction was introduced in those batches. Existing App and native binary responsibilities were not enlarged. Markdown, Engine API, user-setting formats and models remain compatible. Local runtime resource tests do not prove stable RSS or typing latency; those remain unmeasured.

Native save metadata/concurrent-writer protection and delayed-save snapshot acknowledgment were implemented in the follow-up below. A full behavior-tested document-session extraction, native menu-resource ownership, table-width identity and massive-document render scheduling remain open. Third-party advisory freshness, real microphone/ARM qualification, iPhone devices, installed Engine and signed DMG installation are not inferred from these tests.

## Save Safety Follow-up (Batches F-G, 2026-10-23)

Base: `2bc4339`. Scope: real native save concurrency/permissions, frontend save acknowledgment, and the already-tracked progress-listener lifetime issue. The six pre-existing Feedback changes remain excluded from this batch's commits.

### Test-first diagnosis

- Four temporary-file native regressions failed before production changes: two overlapping save entry points accepted the same revision; `0600` widened to `0644`; read-only content was replaced; macOS xattr/ACL metadata disappeared.
- A real editor browser test failed because a deferred save cleared the dirty indicator despite subsequent typing.
- An additional Save As permission test reproduced incorrect generic failure classification when parent-directory creation was denied.
- Repository progress tests reproduced an unhandled rejected registration and a post-disposal callback. These are now handled and reported through the existing localized status surface.

### Implementation and ownership

- Extracted `document_save.rs` from native main. It owns bounded process-local serialization, revision checking, staging, metadata preservation, final disk revalidation, publication and temporary-file cleanup. A shared Swift bridge reuses `SystemDocumentCoordination`; two actual macOS processes are tested, not just two Rust threads.
- Both native save entry points and the existing atomic-write callers share this transaction. Create-only, existing-file and replace-or-create policies remain distinct. Existing command IDs, revision format and success payloads are retained.
- macOS saves preserve POSIX mode/ownership, ACLs and extended attributes. Opening the target without truncation checks its write permissions; parent write access alone no longer permits replacing read-only content. Failures do not clear the editor buffer.
- Ordinary save and save-before-close use one frontend path. An in-flight guard prevents duplicate stale requests. Acknowledgment compares the saved snapshot with current content; Save As preserves subsequent input while changing identity. Newer edits remain dirty and block save-driven close/quit.
- Permission and uncertain directory-sync outcomes have stable error codes and matching EN/ZH messages. A sync-progress subscription error does not masquerade as an operation result.
- No dependency installation, data migration, editor redesign, Memory database access or caption gate relaxation.

### Current-run validation

| Check | Result | Boundary |
| --- | --- | --- |
| Desktop typecheck / ESLint | PASS | Existing frontend plus new save/error/subscription paths |
| Desktop Vitest | PASS: 51 files, 249 tests | New error mapping and three subscription regressions |
| Desktop Playwright | PASS: 36 tests | Three new save cases; actual editor/UI with mocked native IPC; existing translation, caption, Mermaid and Context coverage retained |
| Desktop Node scripts | PASS: 26 tests | Asset, process-protocol, artifact-path and dependency-ownership checks |
| Desktop Vite production build | PASS | Existing large-chunk warning remains |
| Shared Swift package | PASS: 29 tests | Compiled new bridge and ran existing coordinated-document suite on macOS x86_64 |
| Generated Memory Admin contract | PASS | No drift from canonical contract |
| Desktop native suite | PASS: 48 tests; 2 direct invocations ignored | Includes 13 new save regressions. The ignored subprocess fixture is invoked successfully twice by its parent test; the real Memory Engine test remains unrun |
| Rust formatting | PASS | Only touched native files formatted; whole-workspace check passed |
| Strict native Clippy | PASS | `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --bin polarbear-desktop -- -D warnings` |

Native file-coordination tests require macOS coordination-service access. An initial sandboxed attempt rejected the coordinator before reaching file IO; rerunning with that service accessible exercised the production implementation. No fallback disabling coordination was added to make tests pass.

Strict Clippy initially found two pre-existing redundant returns in the macOS clipboard bridge. Those tail expressions were cleaned without changing clipboard behavior; the final strict check passed with zero warnings. The shared Swift package was rerun, but iOS browser/device suites were not rerun in this save-only follow-up.

### Remaining boundaries

The [owning save contract](file-save-safety.md) explicitly distinguishes cooperating macOS writers from non-cooperating external tools. The final recheck does not eliminate the last filesystem race window. Power-loss/ENOSPC fault injection, orphan-staging recovery, Windows/Linux ACL parity, and installed signed-DMG acceptance are not verified. A local write followed by sync-outbox failure remains a separately tracked acknowledgment issue (TD-23). Full App session extraction and the other OPEN debt entries are not labeled complete.

Manual save acceptance: open the same document in two windows, save divergent edits and verify the conflict; save a `chmod 600` fixture and verify permissions; try a read-only fixture and confirm the tab remains dirty; type while saving/Save As and verify the newer text survives and requires another save. Use disposable copies for permission tests.

## Manual follow-up

1. Open Workspace, visit Context, alter settings, refresh and restart: canonical saved settings persist and launch remains Workspace.
2. Change project while Context Settings has an unsaved draft: the next project must not inherit it.
3. Open an unavailable recent document: the failure is visible, existing document/history remain available, and the history item can be removed.
4. Edit/render many distinct Mermaid blocks, then revisit an evicted source: it must re-render without changing Markdown; retry a failed PlantUML render only through the existing consent path.
5. On iPhone, read mid-document and immediately return to Library; reopen and check position. Browser/native fixture coverage does not replace device acceptance.

## Explicit limits

The audit does not certify every file, every dynamic dependency, third-party vulnerability status, ASR performance or installed DMG behavior. No dependency/security upgrade is made from version numbers alone. Remaining technical debt is tracked separately, not represented as completed.
