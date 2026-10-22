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

## Validation

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

Session lifetime and cache policy are feature-local owners with actual invariants. No new global singleton, event bus, framework or storage abstraction was introduced. Existing App and native binary responsibilities were not enlarged. Markdown, Engine API, user-setting formats, models and locales remain compatible. Local runtime resource tests do not prove stable RSS or typing latency; those remain unmeasured.

The next highest-value work is native save metadata/concurrent-writer protection and a behavior-tested document-session extraction. Menu native-resource ownership, table-width identity and massive-document render scheduling require dedicated evidence. Third-party advisory freshness, real microphone/ARM qualification, iPhone devices, installed Engine and signed DMG installation were not verified in this task.

## Manual follow-up

1. Open Workspace, visit Context, alter settings, refresh and restart: canonical saved settings persist and launch remains Workspace.
2. Change project while Context Settings has an unsaved draft: the next project must not inherit it.
3. Open an unavailable recent document: the failure is visible, existing document/history remain available, and the history item can be removed.
4. Edit/render many distinct Mermaid blocks, then revisit an evicted source: it must re-render without changing Markdown; retry a failed PlantUML render only through the existing consent path.
5. On iPhone, read mid-document and immediately return to Library; reopen and check position. Browser/native fixture coverage does not replace device acceptance.

## Explicit limits

The audit does not certify every file, every dynamic dependency, third-party vulnerability status, ASR performance or installed DMG behavior. No dependency/security upgrade is made from version numbers alone. Remaining technical debt is tracked separately, not represented as completed.
