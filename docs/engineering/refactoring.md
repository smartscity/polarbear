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

## Credential and Navigation Boundary Follow-up

The next slice starts from `ad33ca4` and is implemented in `e1fd7c08b0bd8102e97c0b57764a9f17869b2cf2`. It addresses ENG-09 and the deletion portion
of ENG-10, without changing account files, bindings, command names or arguments.
See [verification](verification.md#boundary-hardening-follow-up) for its commit
identity and measured results.

| Problem | Pattern decision | Implementation owner |
| --- | --- | --- |
| Keychain failures need deterministic fault injection and complete cleanup attempts | Reuse the existing `SecretStore` adapter; no new repository framework | `secret_store::delete_repository_secrets_using` attempts both providers and fallback cleanup before deciding success. No rollback restores a deleted credential. |
| Native rejection must not be mistaken for browser availability | Explicit environment selection in the existing adapter, not exception-driven fallback | `shared/tauri/openExternalUrl.ts` chooses Tauri or browser before launching and consumes UI-action failures with localized feedback. |
| Native URL validation and launcher outcomes must be independently testable | Small native platform module, not more policy in main | `external_url.rs` validates HTTP(S), host and absence of embedded credentials/control characters; checks Unix launcher exits and uses a URL argument to ShellExecuteW on Windows. |

The disconnect IPC still returns `Result<(), String>`; deletion failures now use
the existing JSON error-envelope convention with `repository.secretDeletionFailed`.
The feature adapter maps that code to the active locale. The existing App catch
path reports failure without clearing identity or announcing success. Partial
cleanup is not an atomic cross-store transaction; retries remove remaining
entries and do not restore credentials already removed.

`openExternalUrl` remains a UI action returning `Promise<void>`. All existing
callers, including the uncommitted Feedback entry, share its error handling.
Native failures never invoke a browser fallback. Browser mode opens only a new
noopener/noreferrer target; a null return never redirects the editing window.
Because noopener can return null even on success, this is not a reliable popup
blocker detector. Malformed links, non-HTTP(S) schemes, backslashes/control
characters and embedded credentials are deliberately rejected. URL normalization
preserves query/fragment semantics. No Markdown content is rewritten.

Windows no longer passes URLs through `cmd /C start`. The isolated FFI adapter
uses the documented [ShellExecuteW contract](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shellexecutew).
Its return-code policy is unit tested; a macOS pass does not establish Windows
compilation or real browser-association acceptance. No dependency was added.

## Restart-safe Credential Cleanup

This slice starts from `4fe099f`. The old restart path deleted account metadata
as soon as the active provider's token was missing. After partial disconnect,
that could hide a remaining credential in another store and remove the retry
action. A Keychain read error also looked like a missing credential.

| Concern | Pattern decision | Owner |
| --- | --- | --- |
| Disconnect spans stores that cannot share a transaction | Persistent intent / forward recovery, not rollback | `repository_identity.rs::DisconnectJournal` owns pending intent and completion ordering. |
| Reads, reconnects and cleanup must not interleave inside the application | Reuse the native adapter boundary with one process-wide lifecycle mutex | `repository_identity.rs` guards metadata, token acquisition and credential persistence across windows. |
| The entry file mixes identity rules, persistence and provider HTTP calls | Extract the identity lifecycle, not arbitrary file fragments | DTO, provider validation, metadata access, token access, verified persistence and recovery leave `main.rs`; provider HTTP and push/pull remain there. |
| Restart errors need a usable action without claiming authentication | Extend the existing feature projection and Command state | `useRepositoryIdentity` exposes cleanup pending; only the existing disconnect command is enabled. Native menu and command resolver share it. |

### Persistence and Completion Contract

`repository-disconnect.pending` is an additive, secret-free intent file in the
existing application config directory. Its presence means cleanup is incomplete;
`1\n` identifies the current writer, but even an interrupted empty marker must
be treated as pending. Non-file markers and filesystem access errors fail closed.
Existing account JSON fields, binding storage and IPC command signatures remain
compatible. No credential is copied into the marker.

1. Create and sync intent before touching credentials; sync the parent on Unix.
2. Attempt GitHub, GitLab and debug-fallback deletion using the existing adapter.
3. Only after all succeed, remove account metadata and sync its parent.
4. Remove intent last. Success means all stores and account metadata were cleared.

Every account refresh with pending intent makes one bounded recovery attempt,
including after metadata has already disappeared. Failure retains intent and
returns `repository.secretDeletionFailed`; there is no retry timer. Missing
active credentials in a legacy account also trigger complete cleanup before
metadata is hidden. An actual read error uses `repository.secretReadFailed` and
preserves account metadata rather than starting deletion. Release builds still
never read the debug plaintext fallback. Both messages are localized by the
existing feature adapter.

Fallback-file cleanup now calls removal directly and accepts only `NotFound` as
absence. A real inaccessible-directory fixture reproduced the old false-success
behavior of `exists()`. Debug fallback reads likewise preserve access failures.
This does not yet change the fallback's creation-time permission policy.

The same marker blocks new token acquisition and reconnect persistence. Existing
in-flight HTTP requests that already hold a token are not remotely revoked.
The mutex coordinates windows in the existing single-instance desktop process,
not independent binaries accessing one config directory. Pending cleanup is not
an authenticated account; the UI does not persist another copy of that fact.
Account retrieval and disconnect run on the existing blocking task executor.

### Compatibility and Rollback

No existing data requires bulk migration. Legacy partial cleanup is recoverable
when account metadata still exists; already orphaned credentials with neither
metadata nor intent cannot be inferred safely. Recovery retries are idempotent
and never restore deleted secrets. Complete pending cleanup before downgrading
to an older binary that does not understand the marker. Do not delete the marker
to conceal a failed cleanup. Windows durability/Keychain behavior and real OS
denial prompts still require platform acceptance; directory sync is Unix-only.

This is one core-owner extraction, not completion of all decomposition. Provider
HTTP, sync orchestration, editor composition and document-session state remain
separate follow-up slices with their own fault-test requirements.

## Private Credential Publication and Native Repository Ownership

This follow-up starts from `358d0b2`. It changes debug credential-file publication
and separates the native repository owners; it does not change editor behavior,
ASR, language resources, binding schemas or public command identifiers.

### Design and Responsibility

| Concern | Owner and decision |
| --- | --- |
| Credential file lifecycle | `secret_store/credential_file.rs`, a private filesystem adapter used by the existing Keychain-first store; no general persistence framework. |
| Crash-safe publication | A fresh exclusive sibling file is private before the first credential byte, then synced and atomically renamed. A failed pre-publication write preserves the old file. |
| macOS inherited access grants | Empty the temporary file's extended ACL before writing. Mode 0600 alone does not revoke inherited macOS grants. ACL setup failure aborts publication. |
| Non-POSIX debug builds | Require the system credential store rather than claiming a POSIX mode secures a Windows ACL. Release behavior remains Keychain-only. |
| DTO and stored binding schema | `repository/model.rs` is the canonical Rust owner, also consumed by `cloud_sync_store.rs`; JSON names and legacy defaults are unchanged. |
| Sync path and manifest rules | `repository/policy.rs` owns pure filtering, digest, change-count and path mapping. |
| Local snapshots and outbox | `repository/store.rs` composes existing SQLite operations and filesystem scanning. It does not own credentials. |
| Provider protocol | `repository/provider.rs` owns GitHub/GitLab HTTP models and requests. Existing timeouts, error strings, incremental compare limits and upload semantics remain unchanged. |
| Progress delivery | `repository/progress.rs` composes the existing Tauri event and durable run-event append. |
| Command orchestration | `repository/mod.rs` owns connect/link/status/push/pull/sync execution. Main only registers the same ten command names. |
| Shared native helpers | `app_paths.rs` owns the existing config directory resolution; unconditional document-byte publication stays in `document_save.rs`, reusing its existing transaction. |

No dependency, alternate credential database, generic Repository trait, global
event bus or public IPC version was introduced. The private writer deliberately
does not reuse the document saver: document saving preserves original metadata,
while a credential must not inherit a legacy file's permissive mode or ACL.

### Security and Recovery Contract

- Existing `repository-secrets.json` and its map keys remain compatible on Unix.
  Symlink/non-file targets are rejected; atomic replacement never mutates an old
  hard-linked inode. Reads use `O_NOFOLLOW` and reject nonregular files.
- Fresh files are created with 0600 before content, including under umask 000.
  macOS inherited ACL grants are removed before content. Linux relies on POSIX
  creation-mode masking; Linux runtime acceptance has not been performed here.
- Normal failure removes unpublished staging. Disconnect also removes precisely
  named UUID staging files left by a crash, without glob-deleting unrelated files.
  Any failed deletion remains a failure of the existing durable cleanup journal.
- A directory-sync failure after rename is reported, but the new credential may
  already be published. Retry is safe; an error is not a guarantee of rollback.
- Secure-write failures use `repository.secretWriteFailed` at the native store
  boundary. The existing connection adapter localizes the code in both resource
  files and preserves its cause, without exposing raw filesystem diagnostics or
  acknowledging a completed connection. Unrelated provider errors are unchanged.
- This is debug-only plaintext hardening, not encryption. It does not revoke
  historical copies or defeat another process running as the same user/root.
  The existing identity mutex owns concurrent operations in the single Desktop
  process. Power-loss and independent-binary concurrent writers are not proven.

### CI Trigger Correction

GitHub returned zero workflow runs for `358d0b20b37f8bbb199e6b4dc6e35442baa13ecc`.
Quality previously listened only to `main` pushes and PRs, so pushing the current
`codex/caption-streaming` branch did not mean CI had run. Quality now also listens
to `codex/**` pushes. Tests protect that trigger, the unchanged native command
registration and the new contract boundary. No release tag or DMG is implied by
a branch quality run; release gates and the alpha latency policy are untouched.

The first triggered run also exposed a separate clean-job prerequisite:
`custom-protocol`, enabled by all-feature Clippy, embeds `frontendDist`. The
independent native job did not build that directory, although a developer's
checkout could already contain it. The native job now sets up Node, installs
locked dependencies and builds the real Desktop frontend before Clippy. A
test-first workflow ordering assertion protects this dependency; no empty asset
placeholder, reduced feature set or disabled lint substitutes for the build.

### Verification and Remaining Ownership

New symlink and hard-link tests failed against the previous writer before the
fix. Five protocol/schema/manifest/scan/HTTP-diagnostic characterization tests
passed before and after extraction. The inherited-ACL fixture verifies actual
ACL inheritance rather than relying on a displayed principal name, which may be
a UUID under sandboxed account lookup. See [verification](verification.md) for
the final local counts and limits.

The native entry point no longer owns repository protocols or sync algorithms.
This is not a claim that App's document session, repository dialogs, or editor
widgets have become composition-only. Those remain independent work, along with
measured diagram admission policy, cross-window settings contention, license
ownership and physical-device/packaged acceptance. Reverting publication
hardening would restore a confirmed secret-exposure path; it is not a safe
rollback strategy. The module extraction alone needs no data migration.
