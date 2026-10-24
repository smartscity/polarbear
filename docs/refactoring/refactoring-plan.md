# Incremental Refactoring Plan

## Rules

Preserve the six unrelated Feedback changes and existing persistent formats. Reuse commands, adapters, locales and the Memory Admin API. No new runtime library, generic event bus, replacement editor, blanket formatting or package upgrade. Existing imports must be declared by the consuming workspace. Each batch is reversible independently; no accepted performance/security gate is relaxed.

| Batch | Scope / reason | Prerequisite | Risk | Validation | Rollback |
| --- | --- | --- | --- | --- | --- |
| A | Inventory, dependency graph, dead-code decisions | Git baseline and dynamic roots | Low | Manifests, AST scan, current tests | Documentation-only revert |
| B | Context session lifetime and revision observer | Failing delayed-response regressions | Medium | Old workspace completion, busy count, cleanup, existing config persistence | Revert lifecycle changes and keep tests as known failures |
| C | Shared bounded diagram render cache | Confirm map ownership, not guessed RSS | Medium | Pending sharing, bounded entries/strings, retry, real Mermaid browser suite | Restore previous cache implementation; no data migration |
| D | Visible operation status and validated reader history | Failure/persistence regressions | Low | Browser failed-open, malformed positions, desktop/iOS tests | Revert view/parser changes; original storage keys remain |
| E | Full available quality checks and report | B-D complete | Low | Typecheck/lint/unit/build/browser/native suites as available | Do not release failing batch |
| E.1 | Declare existing direct imports and check workspace dependency ownership | AST scan reproduces missing declarations | Low | Node dependency tests plus unchanged resolved lock versions | Revert declarations and test wiring together |
| F (implemented) | Native save transaction and editor snapshot acknowledgment | Four failing native tests and one failing browser regression | High | Same-process and real two-process saves, POSIX/ACL/xattr, external edits, delayed Save/Save As, denied close | Revert transaction/bridge/UI/error resources together; no persistent migration |
| G (implemented) | Repository progress listener lifecycle | Rejected-registration and late-event failures | Low | Error surface, late registration disposal, no stale callback | Revert hook/caller/locales together |
| H (implemented) | Separate local-save acknowledgment from sync bookkeeping; consolidate Sync preflight | Failing SQLite and browser save regressions | Medium | Committed revision plus warning, subsequent saves, batch dirty snapshots and in-flight guard | Revert DTO, consumer and locales together; no storage migration |
| I (implemented, bounded) | Window-local navigation intent and safe workspace replacement | Failed-read, stale recent-open and unsaved workspace browser failures | Medium | Only current read applies; no failed-read tab; drafts block replacement | Revert gate and callers together; no persistent navigation state |
| J (implemented, bounded) | Document-local reload permissions and unified reload application | Failing closed/reopened, dismissed reload and missing conflict-choice regressions | Medium | Edit/undo, competing reads, explicit discard/cancel, post-sync reload, late errors and disposal | Revert owner, callers and messages together; no migration |
| Next | Remaining document session extraction | Lifecycle coverage across close/reopen, external reload, rename and Save As | High | Document generation and metadata ownership across every asynchronous mutation | Separate commits; no storage rewrite |
| K (implemented) | Native menu resource ownership and bounded replacement queue | Failing resource-lease tests plus resolved Tauri ownership inspection | Medium | Create/install/disposal races, handle release, stable IDs and existing command state tests | Revert installer and inline-menu changes together |
| L (implemented) | Document-owned table widths and transactional column metadata | Failing multi-document and prefix-edit browser tests | Medium | Generation isolation, column operations/history, identical-content document switches and editor disposal | Revert state field and widget integration together; no data migration |
| Later | Measured native resource usage, diagram scheduling and startup performance | Equivalent workloads and interaction baselines | Medium-high | Native resource/RSS traces and reproducible timings | Preserve current product semantics |

## Compatibility

- Context operations already accepted remotely may complete after navigation. Only local result application is suppressed; this is not transaction cancellation.
- The default surface remains Workspace. Engine configuration remains owned by the Engine. No local substitute for project config is introduced.
- Diagram cache eviction affects reuse only. Markdown is untouched; no new remote request source is added. PlantUML consent remains per existing policy.
- Reader positions retain the same key/shape. Validate records individually and keep valid entries; do not clear the entire history on one corrupt value.
- Status messages reuse existing App state. Batch F adds permission and uncertain-durability codes. Batch H adds an optional sync warning to successful saves; revision and normal success shape remain unchanged. EN/ZH resources are synchronized.
- A superseded recent-file navigation returns `null`, distinct from unreadable-file `false`; the Recent panel must not report cancellation as a missing file. Workspace replacement refuses unsaved buffers and directs the user to existing Save/Close actions. Reload permissions reject late reads after changes or disposal; they do not cancel accepted native IO or remote sync operations.
- [File save safety](file-save-safety.md) owns the native transaction and its explicit cooperative-writer/platform limits. It does not claim an arbitrary external-writer filesystem CAS.
- [Menu and table lifetimes](menu-table-lifetimes.md) owns native handle disposal and session-only column widths. Neither change introduces a new persistent format or command system.

## Out of this release gate

No ASR model swap or long caption benchmark. No installed-app, microphone, real Memory Engine or iPhone acceptance claim from browser mocks. Local macOS native permission/coordination fixtures are now covered; multi-device iCloud coordination, non-macOS save semantics, Intel/Apple Silicon caption qualification and signed DMG installation still require their dedicated environments.
