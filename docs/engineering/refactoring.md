# Refactoring Report

## Recent Documents in the Native File Menu: 2026-10-27

Source candidate: `3ff3ac3`, based on `eeea3b4`. The existing native File menu
now owns the Open Recent entry immediately after Open. The sidebar's recent list,
dedicated styles, forwarding props and empty footer are removed.

| Problem | Pattern decision | State owner and invariant |
| --- | --- | --- |
| Move an entry without migrating user data | Reuse the existing store; add a React projection hook | `RecentDocumentStore` remains the sole persisted authority (`polarbear.recentDocuments.v1`, limit 20). Existing normalization, ordering, deduplication, successful-open/save and rename behavior remain. |
| Dynamic native IDs can change a visible item's target before installation | Small bounded action-generation owner | `RecentMenuActions` alternates two banks of 20 IDs. Only the generation acknowledged by native installation may open its immutable path. Reuse `NativeMenuInstaller` for serialized, coalesced replacements and resource-lease disposal. |
| Native callbacks outlive renders or unmounts | Reuse current-value callbacks and explicit lifecycle admission | The hook subscribes to history invalidations/storage events, removes both listeners on unmount, rejects duplicate pending opens and rejects cleared/stale entries. The session still owns loading, tab identity, revisions and drafts. |
| Missing files need visible feedback outside the sidebar | Reuse the native dialog adapter and translations | Existing open errors/status remain; a failed recent open also displays an EN/ZH unavailable-file alert. Failure retains history and current buffers. Clear changes history only. |

Final boundary review: no second history database, independent file loader, global
event framework, new dependency or replacement native menu system. Same-name
entries include their parent paths; empty history and Clear are disabled. Local
browser tests exercise Tauri's actual JavaScript menu Channel handlers against
controlled IPC; macOS acceptance separately exercises the real native menu and IO.
See the current follow-up in [verification](verification.md).

## Sync and Session Acceptance Design: 2026-10-27

Starting point: `64d394ae9fd05c24bbf599f55bf1aeef3769b2d5`, `main`.
Engineering branch: `codex/sync-session-qualification`. The pre-existing `.idea/vcs.xml`
change is excluded. The external review at `1988263` remains historical evidence.

| Problem | Pattern decision | State owner and invariant |
| --- | --- | --- |
| GitHub medium-size content | Reuse provider Adapter and bounded reader | Request raw content from the constructed API URL at the frozen commit; never trust a returned download URL. Retain the 64 MiB file cap. |
| File-conditional publication | Explicit completion state in the existing coordinator | A receipt acknowledges submitted paths only. GitLab publication checkpoints those paths with complete=false and returns pending confirmation. Next explicit Sync observes a fresh frozen snapshot and reconciles against acknowledged baselines. No recursive catch-up loop or new manifest-as-baseline shortcut. |
| Save As identity collision | Reuse session identity allocator and completion transaction | Read the current registered IDs at completion, allocate before synchronous state publication, and preserve every other buffer/revision/dirty marker. Retain source identity-generation checks and save admission. |
| Performance | Profile before policy/cache changes | Preserve SHA-256 and content-conditional writes. No metadata-only cache, extra executor or unbounded retained content. |

GitHub's whole-head conditional publication retains its existing completion
semantics. A GitLab receipt deliberately requires one later Sync even without a
concurrent writer. This trades a bounded extra user action for a small recoverable
protocol: confirmed uploads survive read failure; unobserved paths retain their old
baseline; later local edits still undergo three-way comparison and conditional IO.
The session's existing current-value references now update in its mutation handlers,
with React as their rendered projection. The local `useImmediateSessionState` hook
owns this relationship for buffers, tab IDs, active ID, workspace root and dirty
IDs. A render-delayed ref and an empty `flushSync` barrier both failed the same-task
completion regression; neither is the final implementation. This prevents stale
registration, focus and dirty-state reads without a second global store or a
prohibition on tab switching.

## Provider Bounds and Settings Arbitration: 2026-10-25

Baseline: `f68680d37f4f470ffdb6b641cb4a6fed87fc0217`.

| Problem | Pattern / decision | Owner and invariant |
| --- | --- | --- |
| Provider bodies buffered without admission | Reuse provider adapter; one bounded-response policy | `response_limits` checks actual and declared bytes before parsing, with separate metadata/content/error limits. No independent downloader or new dependency. |
| Pagination retains unbounded metadata | Small enumeration budget object | One budget owns cumulative bytes, entries and page count; failure never returns a partial tree as complete. |
| Cross-window read/modify/write loses preferences | Transactional persistence behind the existing typed patch API | IndexedDB owns atomic read/merge/write; Web Locks bound admission. Native WebView regression disproved lock-only localStorage safety. No new dependency or read-cache authority. |
| Cached caption/layout groups overwrite unrelated intent | Leaf patches and generation-qualified optimistic layout | UI submits only the fields it changed; acknowledged generations clear their own overlays. Persistence errors retain usable layout and report failure. |

All settings mutation callers handle the asynchronous acknowledgment. Theme
commands, translation switches and caption controls do not claim persistence
before it succeeds. Audio source changes do not restart capture after a failed
preference write. Language selection retains its existing session-only fallback.
Web Locks are required for mutation; unsupported or timed-out lock acquisition
does not silently use an unsafe read/modify/write. Legacy nonparticipating
application versions are not made concurrent-safe by this change.

The existing v1-v5 document is imported once, inside the transaction, only if no
database record exists. The database is then authoritative; legacy keys remain
untouched, not dual-written. A monotonic revision guards in-memory projections;
BroadcastChannel carries invalidations only. Focus/reopen refreshes the authority.
Rollback can read legacy settings but cannot recover subsequent DB-only edits.
The native regression bundles the actual production transaction module and checks
200 concurrent updates across two WKWebViews plus a fresh observer.

The first regressions failed against the baseline before production edits. This
slice does not solve large-file hashing performance, installed-app acceptance,
recursive filesystem rollback or authorize main merge/release. Earlier sections
below describe historical snapshots; the owning current contract is ARCHITECTURE.

## Entry Mutation Completion: 2026-10-25

Baseline: `3c39b338e74a04947bdae766cf7bf423418065d3`. This follow-up completes
the session ownership protocol for create, duplicate and delete, not just rename
and move. It does not represent whole-audit or installed-application acceptance.

| Problem | Pattern / decision | Owner and invariant |
| --- | --- | --- |
| Delayed native completion overwrites newer navigation | Reuse navigation generation and root-qualified projections | `useDocumentSession` applies disk acknowledgement independently from active-tab intent; only the owning workspace's tree changes. |
| Deletion drops late edits or new unrelated tabs | Pure completion policy, applied to current state | `workspaceEntryCompletion` selects clean target IDs to close; the session retains dirty buffers and offers the existing recovery flow. No second buffer store. |
| Recovery saves the wrong active tab | Reuse the single `saveTab` command | Recovery supplies the deleted document's ID and clears only the acknowledged recovery notice. |
| Duplicated create-file/folder completion | Shared typed creation flow | One acknowledgement/projection/refresh path; loading a new buffer is optional and cannot change disk success. |
| Native entry IO mixed with Tauri and sync bookkeeping | Extract filesystem service, reuse existing lifecycle admission | `workspace_entries` does root validation, copy/delete and no-overwrite creation. Tauri wrappers supply sync callbacks; failed optional enqueue becomes an acknowledgement warning. |
| Creation modifies parent directories before admission | Extend existing save lifecycle | `document_save::create_workspace_markdown` acquires access before path resolution and parent creation, then uses the existing document lock and coordinated atomic publication without recursively acquiring the lifecycle lock. |

No event bus, repository framework, new persistent store or parallel save engine.
The session file loses duplicated completion code; a pure policy module and native
filesystem module isolate the two actual change axes. The remaining recursive IO
partial-failure boundary is explicit in the owning architecture document.

## Native Platform Boundary Follow-up: 2026-10-25

Memory workspace binding remains portable, but its current Admin transport uses
Unix-domain sockets. Runtime descriptor resolution, socket authorization and
transport helpers are compiled only on Unix; the public command keeps its typed
unsupported-platform error elsewhere. This is not a Windows transport implementation.
Live Caption's FFI callbacks, capture singleton and pinch event belong to macOS.
The bounded capture ingress remains available to platform-independent unit tests.
No callback stub reports success for an unavailable capture provider. Windows
native Clippy is a real matrix check, not a macOS preprocessor simulation.

## Preview and Workspace Layout: 2026-10-25

The existing MarkdownIt renderer owns fence/image semantics. It emits one HTML
document and typed resource slots; React portals mount Mermaid, PlantUML and image
components into those slots without splitting their parent list/quote/table.
Unchanged parser rules are restored in `finally`. The document generation owns
portal targets; replacing Markdown disposes obsolete resources. The image viewer
uses a body portal rather than inserting a block overlay inside a paragraph.
Raw HTML remains disabled; SVG sanitization and PlantUML consent are unchanged.

`App` composes `useLayoutPreferences`; `AppShell` composes `useWorkspaceResize`.
`workspaceLayout` owns pure constraints, while shared settings own validated v5
preferences. Pointer movement updates scoped CSS variables once per frame; one
write occurs on release. Capture loss, Escape, blur, resize and disposal cancel.
The opposite effective sidebar is held during a same-viewport resize, without
overwriting its preferred size. Window changes recompute deterministic compression
and right-before-left temporary hiding. Narrow navigation uses inert background
content, a drawer, focus restoration and the existing localized controls.

Migration accepts v1-v4, defaults missing layout fields, clamps corrupt widths,
and preserves explicit v4 caption-translation consent. A failed layout write
remains usable in memory; unrelated settings notifications do not resurrect the
unchanged disk value. The later transactional-settings follow-up above supersedes
this slice's unverified cross-process merge boundary. Reset Layout is one
existing-registry command shared by Settings and the native View menu.

The theme and original grid/tab/status/editor CSS are edited at their source.
Fixed 260/224px tracks, forced 860px live-editor content and a duplicate dark-only
status rule are removed. Reading width is 760px, independent from the center
workspace width; high-frequency dragging does not replace the editor instance.

Sync follow-up: an acknowledged partial checkpoint clears the complete-head
marker so status cannot hide unfinished remote work. Local upload reads acquire
the workspace lifecycle lease before path resolution and are bounded by the
remaining 64 MiB batch budget; at most 10,000 changes are admitted. Exceeding the
budget does not submit or blindly split an atomic provider commit.

## Conditional Sync Ownership: 2026-10-25

`repository/sync_plan` owns pure three-way comparison including deletion;
`sync_coordinator` owns acknowledgment/recovery; `conditional_publish` owns provider
version preconditions. The unsafe per-file upload path that fetched a fresh SHA
before overwrite is removed. Native admission matches whole-binding store ownership.
`document_save::apply_sync_change` resolves paths after acquiring workspace access,
then shares per-document coordination with normal saves.

Baselines migrate from legacy original bytes transactionally. Manifest hashing
streams current content instead of trusting size/mtime; excluded directories are
pruned before recursion. Provider tree filtering shares one path policy; truncated
GitHub trees fail closed. A pure planner plus IO adapter and an operation lease
are sufficient here; no event bus, parallel sync implementation or retry queue.

## Document Completion Protocol: 2026-10-25

The document session remains the owner of buffers, identity and dirty state.
`saveTab(id, saveAs)` is now the single ordinary/Save As/close/quit save entry.
The former second Save As implementation is removed. Native write acknowledgments
commit identity and revision before best-effort directory refresh. Refresh failure
reports a saved-file warning rather than undoing the acknowledged identity.

`DocumentReadRequests` also issues non-mutating lifetime checks for saves; edits
do not invalidate save identity, but close/reopen and path changes do. Close is
serialized per document and cannot remove a document while its write is pending.
The existing native dialog adapter exposes Save / Discard Changes / Cancel.
Only the explicit discard result permits closing without a save.

Quit reuses `saveWorkspaceDocuments` against current session state, including
Save As identity changes. Earlier-document edits and new documents abort quit.
Only after this check does a synchronous final phase make the workspace inert,
invalidate pending navigation and reject editing before calling native quit.
Failures release the phase and the reentrancy guard. Native atomic write and
permission/revision behavior is unchanged in this stage.

## Workspace Mutation and Diagram Admission Follow-up

Base: `a2e0b32a899a1fffe73827166687bdeff6abd59e`. This slice keeps the existing
document-session, renderer, native command and translation-resource boundaries.

| Concern | Decision / owner | Compatibility |
| --- | --- | --- |
| Move/rename versus saves, repeated actions and old reads | `WorkspacePathMutations` admits one session path operation; `useDocumentSession` coordinates existing actions and invalidates navigation/read leases. Saves, Save As, close, replacement workspace loads and conflicting path operations report busy rather than racing. | Typing remains allowed during move/rename. No new persistent state or command IDs. Other-workspace document opens remain possible. |
| Cross-workspace path remapping | Preserve document IDs, buffers, revisions, dirty flags and editor history; change root-qualified relative-path metadata only. | Opaque IDs and same-named documents in another workspace are not rewritten. |
| UI/native consumers of identity | AppShell receives a separate active path and root-qualified dirty-path projection; image adapters receive the active document root/path rather than opaque ID. | Tab IDs remain stable; renamed documents retain visible dirty markers and place images beside the current Markdown file. |
| Disk commit followed by failed tree refresh | Apply native acknowledgment immediately; project the moved subtree and update recent-document metadata before fetching the authoritative tree. | A failed refresh reports partial success, not a failed disk mutation or rollback. Recent timestamps remain intact; duplicates collapse through the existing store. |
| Old tree/revision notifications | Tree requests capture a mutation generation; late missing-file callbacks verify current document identity. | Polling and native command contracts remain unchanged. |
| Native save versus directory rename | `workspace_io` owns a process-wide read/write lifecycle lock: saves take shared access before resolving their destination; rename/move take exclusive access before resolving source/target. Existing per-file save locks and macOS save coordination remain. | Covers application windows and descendant saves, not uncooperative external processes. Lock order is lifecycle, then per-file, then macOS save coordination. |
| Destination creation between exists-check and rename | `rename_exclusive` uses OS no-replace publication; no copy/delete fallback. | macOS `RENAME_EXCL`, Linux `RENAME_NOREPLACE`, Windows `MoveFileExW` without replacement. Unsupported filesystems/platforms fail closed. Cross-volume moves remain unsupported. |
| Renderer-internal task accumulation | Shared `DiagramRenderQueue` policy at each renderer entry, also covering Mermaid validation and clipboard callers. | One active renderer call, at most 16 waiting calls and 1,000,000 retained source code units per renderer. Overload is a retryable localized error; Markdown is retained. |
| Cache and preview lifecycle | Pending cache has count/source bounds and consumer leases; widget destruction and React effect cleanup cancel ownership. | A shared render is cancelled only when its last cancellable consumer leaves. A cancelled active Mermaid call keeps its slot until the engine actually settles. |

### Boundaries Deliberately Retained

- This is a window-local scheduler, not a Worker or an interruptible Mermaid
  runtime. One pathological renderer call can still block its own window. The
  queue bounds admitted work; it does not establish a CPU or render-time SLA.
- PlantUML remains remote only after the existing explicit source consent. No
  new network path, model, framework or dependency was introduced.
- Create/delete/duplicate actions share admission with move/rename. Their full
  async buffer/projection redesign is not claimed by these move/rename tests.
  Deletion during subsequent typing and repository sync racing native directory
  changes still require separate characterization.
- Markdown links are not automatically rewritten by a path change. Multi-window
  settings arbitration, hostile ancestor replacement, real Windows/Linux native
  execution, installed AppKit acceptance and ASR qualification remain explicit.
- Windows no-replace behavior follows the documented
  [MoveFileExW flags](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw).
  Local macOS tests do not claim Windows execution.

### Test-first Record

The initial three browser regressions failed on the original implementation:
save still wrote the source path during rename/move, and a second path mutation
reached native IO. The cache cancellation tests then timed out against the old
cache. New queue/tree-generation APIs initially failed import/member checks;
those failures specify new contracts, not independently reproduced old races.
An intermediate browser fixture incorrectly returned the renamed file in every
workspace; it was corrected to model each root, rather than counted as a product
failure. Final commands and results are recorded in `verification.md`.

The real-App regression also failed before correcting the consumers: the renamed
tree item had no dirty marker, and image paste sent `/test::Original.md` instead
of `Renamed.md`. A temporary missing App destructuring field was caught by both
typecheck and this regression and fixed before the final verification run.

Final validation also reproduced a protocol-test flake: the Node child process
was killed by a three-second test-only deadline before its first handshake.
A deterministic fake-clock regression now separates host bootstrap allowance
from real-engine latency gates. Only the healthy synthetic protocol fixture
budget changes; production timeouts and ASR release thresholds are untouched.

Rollback: revert this slice's source/tests without migrating Markdown or settings.
Already completed filesystem moves are real user actions and must not be reversed
by a code rollback. Existing recent entries use the unchanged path/time schema.

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

## App Repository Workflow and Live Editor Ownership

Scope: move the existing repository UI workflow out of App and separate live
Markdown scanning, decorations and widget behavior from the React editor host.
Document buffers, save/navigation owners, native repository contracts, table
commands, table layout history and Markdown persistence retain their owners.

| Responsibility | Owner and contract |
| --- | --- |
| Account projection and cleanup recovery | Existing `useRepositoryIdentity`; no second account store. |
| Repository dialogs, operation status and async actions | Feature workflow hook; App supplies workspace open, save-before-sync and reload-after-download operations. |
| Repository dialog presentation | Feature dialog host composed from existing dialogs; no duplicate UI. |
| Preview block source ranges | Pure Markdown scanner; it does not create DOM or execute commands. Ordinary fenced code is opaque to block scanning. |
| CodeMirror decoration policy | Editor extension; selects source versus widget without owning persisted content. |
| Table DOM and editing bridge | Existing table feature, reusing command execution, interaction state, menu disposal and layout transactions. |
| Other block DOM | Editor widgets, reusing asset resolution and block DOM helpers. |
| React host | Editor instance, props, extension composition, viewport and debug lifecycle. |

| Problem | Pattern decision | Reason |
| --- | --- | --- |
| Repository actions and dialogs share feature state | Reuse Hook as a feature facade | Preserve React state and the identity hook; no ViewModel class or global store. |
| Sync requires document operations | Explicit callback ports | Repository workflow cannot mutate App's document maps or bypass the existing save/reload guards. |
| Block detection mixed with DOM | Pure scanner plus existing Widget adapter | Test source ranges independently and keep Markdown authoritative. |
| Variant preview rendering | Existing widget factory | No plugin registry or new event bus for a fixed set of supported blocks. |

Before extraction, browser cases characterize connection failure/retry, empty
repository results, status failures, mixed block source preservation and table
portal disposal. A code-fence regression checks that embedded Markdown examples
cannot become interactive document blocks. Existing save/reload, identity,
table history, clipboard and diagram suites remain mandatory. No changed IPC,
data migration, cloud request policy or ASR work is part of this batch.

### Implemented Boundaries and Review

`useRepositoryWorkflow` owns repository UI state and composes the existing
identity/progress hooks. `RepositoryWorkflowDialogs` renders the existing dialog
components. App supplies document save/reload and workspace opening callbacks;
no feature reaches into its document maps. The hook is not a credential store.

`previewBlocks.ts` owns deterministic source ranges and IDs. The existing
decoration policy is in `liveMarkdownDecorations.ts`; ordinary block DOM is in
`widgets/blockPreviewWidgets.ts`, and table DOM/editing is in
`table/tablePreviewWidget.ts`. Table editing still delegates to the existing
command, layout, clipboard, interaction and menu-lifetime modules. Moved table
and ordinary block function bodies were compared with the original source and
are unchanged apart from exports/imports. No alternative Markdown model exists.

The status-read regression exposed a separate obsolete-completion path beyond
the existing identity hook: an A response reopened a dialog while B was active.
The workflow now checks a workspace-lifetime token before applying context/status
reads and their errors. A workspace change releases the old status-query busy
projection, but does not release an active native sync lock. Current status reads
also clear their transient busy indicator on completion. This is UI ownership,
not cancellation or rollback of native IO, and not proof that every connect/link
mutation race has been qualified.

Review outcome: React composition and CodeMirror/DOM behavior have distinct
owners without new dependency packages, global stores, event buses or protocol
versions. App's document-session/zoom coordination and the table widget's internal
size remain follow-up boundaries; moving code does not prove a performance gain.

## Document Session, Zoom and Table Interaction Ownership

The next slice keeps the current Markdown, IPC, settings and command contracts.
The document session owns buffers, revisions, tab identity, dirty markers, read
permissions and save/navigation lifetimes. App consumes snapshots and semantic
actions; it must not mutate those collections. Workspace file operations remain
inside this owner because they remap those same identities. Repository and Memory
features receive explicit document operations, not setters or a second store.

Zoom owns canvas references, transforms, gesture frames, settle timers, native
subscriptions and scroll locks. It receives the editor reference and a status
callback; document replacement requests viewport reconciliation through an
explicit callback. Reset supersedes queued gesture work. Disposing the owner
must release subscriptions, frames and timers.

Table composition delegates cell input, menus, widths and transaction/focus
restoration to table-local modules. Commands and layout history retain their
existing owners. Post-transaction focus queries must be scoped to the originating
EditorView, never a document-global table offset.

| Problem | Pattern decision | Rationale |
| --- | --- | --- |
| Document state transitions spread through App | Feature session facade with semantic actions | One owner of existing state; no parallel global store or ViewModel class. |
| Gesture and viewport lifetime mixed with document IO | Dedicated React lifecycle hook | Reuse zoom policies and native adapter; explicit editor/status ports. |
| Table DOM, menus and transactions coupled | Local composition and transaction adapter | Keep command/model pure and scope focus to the owning editor. |
| Delayed save/close completion | Current-session completion checks | Preserve navigation and newly opened tabs; do not claim cancellation of native writes. |

Test-first acceptance covers delayed Save As across a document switch, closing
after a new tab opens, Reset while a gesture is queued and duplicate table
offsets across editor instances. Existing save/reload, table undo/width, menu
disposal, clipboard and full browser suites remain required. No benchmark,
new format, data migration, ASR work, tag or release is included in this slice.

### Implementation and Review

- `features/workspace/useDocumentSession.ts` owns document collections, native
  read/save lifetimes, workspace identity remapping, and create/rename/conflict
  dialog state. It exposes snapshots and semantic actions, not collection
  setters. App supplies status, workspace-surface activation, empty-session
  notification and viewport-reconciliation callbacks. Repository sync and Memory
  source navigation reuse these actions rather than introducing another store.
- `features/zoom/useAppZoom.ts` owns canvas transforms and all gesture resources.
  `editorPointerPosition.ts` contains the existing hit-test fallback. Reset
  cancels queued gesture frames, settling and scroll-unlock work before applying
  its transform. Native subscriptions use stable callbacks with current locale;
  language changes do not reinitialize native WebView zoom. The adapter releases
  late registrations and contains asynchronous unlisten failures after disposal.
- `tablePreviewWidget.ts` composes the existing DOM. `tableCellEditing.ts` owns
  cell input/navigation, `tableWidgetMenus.ts` owns menu presentation,
  `tableColumnSizing.ts` owns width projection, and `tableWidgetClipboard.ts`
  owns clipboard representations. `tableWidgetTransactions.ts` is the shared
  mutation/focus bridge for cell and structural edits. It preserves existing
  history annotations, scroll restoration and width effects.
- Table focus restoration captures the originating EditorView before widget
  replacement, queries only that editor, and stops retrying after document change
  or teardown. Two editors with identical source offsets no longer compete.
- Save As updates an inactive document's identity without activating it or
  replacing the current workspace. Delayed close computes remaining tabs from
  current session state, preserving documents opened while confirmation was pending.

No protocol, storage migration, formatting policy, table syntax or model engine
changed. App still coordinates view/editor commands and image insertion. The
session and zoom hooks remain substantial; further splitting should follow
tested state ownership, not arbitrary file-size thresholds. Rename/move/delete
concurrency and measured editor performance remain separate audit work.
