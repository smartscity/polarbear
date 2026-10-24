# Refactoring Report

Date: 2026-10-24. Base `166e231c61dc568876aab8dbebdb6636a2c281ae`;
implementation `2747dc36d2a0cb559ba7e33415118597c711b96f`.

## Ownership Changes

```text
App / Memory source navigation
  -> existing revision-aware reloadDocumentFromDisk
  -> DocumentReadRequests + Workspace adapter
  -> native document IO

App / repository UI
  -> useRepositoryIdentity (workspace generation + update revision)
  -> existing repositoryApi
  -> native account and binding storage

TablePreviewWidget
  -> tableInteractionDom (owned layout frame)
  -> tableMenuLifecycle (owned portal, focus frame, outside/blur listeners)

Native commands
  -> workspace_paths (existing path policy)
  -> existing document save / filesystem implementation
```

There is no new global store, event bus, state-machine framework, repository
abstraction, persistence schema, dependency, or alternate editor model.

## Changes and Compatibility

| Files | Before / after | Compatibility |
| --- | --- | --- |
| `apps/desktop/src/App.tsx`; `features/repository/useRepositoryIdentity.ts` | App's unguarded refresh moves into an owner-scoped feature hook. Workspace identity and revision invalidate obsolete results; the visible binding clears immediately on workspace change. | Native credentials, bindings and provider APIs unchanged. Account is a projection, not a second credential store. Running native requests are not forcibly aborted; obsolete UI completions are discarded. |
| `App::openMemorySource`; `tests/browser/navigation-settings.spec.ts` | Direct document/revision writes after IO now reuse the existing guarded reload. | Selection proceeds only after a current reload; concurrent edits retain the existing explicit conflict flow. Close/reopen semantics remain. |
| `features/editor/table/tableInteractionDom.ts` | Initial layout uses the same cancellable scheduler as later layouts. | No geometry, resize, width persistence, Markdown or transaction rule changed. |
| `features/editor/table/tableMenuLifecycle.ts`; `components/TyporaLiveEditor.tsx` | Three duplicated delayed listener-registration/cleanup blocks become one feature-local lifecycle; widget destruction closes its portals. | Existing menu contents, commands, focus behavior and positioning retained. Cleanup is idempotent and does not focus a destroyed owner. |
| `src-tauri/src/workspace_paths.rs`; `main.rs` | Path/name policy moves without algorithm changes, with new characterization tests. | Existing errors, lexical path handling, root aliases and canonical containment preserved. No IPC/persistence change. |
| `live_caption/runtime_tests.rs`; `runtime.rs` | Unchanged test cases move below a dedicated test-module boundary. | No inference, audio, session, recording, translation, or release threshold change. |
| `save_regression_tests.rs`; `vocab_bridge.rs`; `vocab_outbox.rs` | Existing fixture unwrap/expect usage receives narrowly scoped allowances consistent with existing tests. | Production lint prohibition retained; no assertion removed or weakened. |
| `scripts/architecture-graph.mjs`, its Node tests, `package.json` | Adds dependency diagnostics and automatic reverse-boundary/cycle checks to the existing test command. | No new tooling dependency. Current known reader-core alias explicitly resolved. |
| `.github/workflows/quality.yml`, `release.yml` | Adds all-target native lint and release-local browser/native/translation/contract gates. | Existing alpha-only first-text advisory policy remains unchanged. No runtime or package format change. |

## Test-First Evidence

- Memory concurrent typing regression failed against the old direct-write path,
  then passed through the existing document reload owner. Closed-source and
  unchanged-source cases also pass; the closed-source case was protective
  coverage rather than an independently reproduced old failure.
- Immediate table disposal retained one RAF before the scheduler fix. Early
  menu close retained one pointer listener before synchronous registration and
  cancellable focus. Both now retain zero; mode-switch portal cleanup passes.
- Path-policy characterization tests passed before and after extraction.
- Repository hook tests were authored before the extracted module existed; that
  initial import failure is **not** proof of the old race. The old unguarded
  completion is established by source inspection; four post-change tests prove
  the new owner's workspace/error/disconnect behavior.
- Full Desktop browser and native regression followed the targeted checks.
  Exact counts, failures and scope are in [verification](verification.md).

## Removed Duplication and Retained Debt

Removed: the competing Memory direct-load/write path, App's repository-refresh
effect, and three copies of table portal listener lifecycle. No public command,
setting, locale key, serialized field, native entry point, or data file was
deleted. No user data migration is needed.

The App, editor and Rust entry files remain large. This change establishes real
ownership boundaries but does not meet the eventual goal of a composition-only
App or bootstrap-only main. Repository push/pull orchestration, document session
composition, table cell editing, and several native DTO/IO responsibilities
still need independent fault-tested refactors. File-size reduction alone is not
the acceptance criterion.

No old fallback was removed merely because static search found no caller.
Feature public-API consolidation is still incomplete; the 21 cross-feature
edges are visible in the graph report rather than hidden behind a giant barrel.

## Rollback

The implementation commit can be reverted as a unit on a follow-up branch;
there is no persistent migration to reverse. Do not reset unrelated changes or
rewrite published history. A rollback would restore the documented Memory and
table races and must not be presented as a correctness fix. The native path
module extraction may be reverted separately if necessary without data changes.
