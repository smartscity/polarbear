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
| Next | Remaining document session extraction and post-commit acknowledgment | Delayed-open/session-switch and outbox failure tests | High | Closed/reopened identity, async navigation, save/outbox outcome | Separate commits; no storage rewrite |
| Later | Native menu lifetime, table width ownership, performance | Resource traces and interaction baselines | Medium-high | Compare equivalent workloads and native behavior | Preserve current product semantics |

## Compatibility

- Context operations already accepted remotely may complete after navigation. Only local result application is suppressed; this is not transaction cancellation.
- The default surface remains Workspace. Engine configuration remains owned by the Engine. No local substitute for project config is introduced.
- Diagram cache eviction affects reuse only. Markdown is untouched; no new remote request source is added. PlantUML consent remains per existing policy.
- Reader positions retain the same key/shape. Validate records individually and keep valid entries; do not clear the entire history on one corrupt value.
- Status messages reuse existing App state. Batch F extends the existing save error codes for permission denial and uncertain directory durability, with synchronized EN/ZH resources; success payloads remain unchanged.
- [File save safety](file-save-safety.md) owns the native transaction and its explicit cooperative-writer/platform limits. It does not claim an arbitrary external-writer filesystem CAS.

## Out of this release gate

No ASR model swap or long caption benchmark. No installed-app, microphone, real Memory Engine or iPhone acceptance claim from browser mocks. Local macOS native permission/coordination fixtures are now covered; multi-device iCloud coordination, non-macOS save semantics, Intel/Apple Silicon caption qualification and signed DMG installation still require their dedicated environments.
