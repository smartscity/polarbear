# Apple document store foundation

Shared Foundation code for the planned linked-folder editing workflow on macOS,
iPhone, and iPad. This package is a native persistence foundation, **not a shipped
iCloud synchronization feature**. Desktop compiles these sources in its Swift
bridge and the iOS plugin includes the Swift package. Neither application routes
user edits here yet. Existing local saves and Reader snapshots remain unchanged.

## Responsibilities

- `WorkspaceGrants`: native-picker URLs become device-local bookmarks and opaque
  workspace IDs. Resolve and renew bookmarks while holding scoped access.
- `CoordinatedFiles`: Foundation read/write coordination and bounded UTF-8 reads.
  An undownloaded ubiquitous item requests materialization and reports downloading;
  it is never represented by empty Markdown.
- `LinkedDocumentStore`: document-bound sessions, byte-based SHA-256 revisions,
  monotonically increasing edit generations, coordinated compare-and-replace,
  explicit restart recovery, and separation of missing from unavailable sources.
- `DraftJournal`: private atomic draft snapshots, pre-save history, and both
  versions of revision conflicts. No age-based eviction of pending work.

The public native API accepts a URL only for `connect(selectedFolder:)`. A host
must supply that URL from a native picker, not from JavaScript. Other operations
use a workspace ID, validated relative path, and native-issued session ID.
Bookmark data and source URLs must never cross the WebView boundary. The host is
responsible for rejecting incompatible workspace transport bindings before connecting.

The host must own **one store instance per private storage root**, shared by its
windows. Invoke it off the UI thread. Operations are serialized by the store;
there is no cross-process draft writer protocol or distributed lock. A session
reopen invalidates previous session IDs. A save only accepts the latest durable
generation; callers must serialize their autosave queue and retry with the updated
baseline rather than sending older drafts after a save acknowledgment.

## Save and recovery invariants

1. `persistDraft` writes the base and edited text locally before acknowledging a
   generation. Failure does not advance the in-memory generation.
2. `save` rereads the source and compares its SHA-256 revision **inside** the
   coordinated write accessor. It archives recovery before replacing the source.
3. A changed source is not overwritten. Conflict snapshots retain both the draft
   and the observed file, including successive observed remote versions.
4. A missing leaf beneath an accessible parent is reported as missing. An absent
   root, revoked bookmark, or provider failure defers the write and retains the draft.
5. `open` returns any pending recovery without replaying it. `resumeDraft` requires
   explicit user intent and an unchanged opening baseline; save checks again.
6. If the source write succeeds but local cleanup fails, the draft remains available
   for explicit recovery. Do not infer success or silently replay it after relaunch.

No revision markers, settings, journals, or bookmarks are written into Markdown.
UTF-8 BOMs and original line endings round-trip unchanged. These operations make
no claims about iCloud upload or other devices having received a write.

## Validation

```sh
swift test --package-path packages/apple-document-store
cargo check -p polarbear-desktop --locked
```

The XCTest suite uses real temporary files and real Foundation coordination on
macOS. It also injects bookmark and coordinator failures. A native macOS bookmark
round-trip is tested separately. These are not physical iCloud-provider tests.
The iPhone Reader quality workflow runs the suite; no external Swift dependency
is added by this package.

The foundation checkpoint passed 29 native tests, the existing Reader storage
regression executable, Desktop `cargo check`, the iOS simulator-target native
plugin `cargo check`, an arm64 iOS 16 SDK typecheck, and Rust formatting checks.
No physical iCloud synchronization test, mobile editing UX test, or signed-device
distribution was performed for this checkpoint.

## Release gates still open

- Host IPC adapters and typed TypeScript document contracts.
- Linked-folder picker UI, reconnection, and one-transport-per-workspace checks.
- Mobile editor, autosave scheduling, IME-safe flushes, and conflict/recovery UI.
- Coordinated create/rename/delete, relative assets, and rename identity tracking.
- File-presenter lifecycle, cancellation, bounded fallback polling, and provider status.
- Discovery and preservation of `NSFileVersion` conflict versions.
- User-visible history management and 30-day cleanup of resolved history only.
- Physical Mac/iPhone/iPad iCloud, offline, permission, lifecycle, and conflict tests.

Do not enable editing-in-place or declare the mobile document role as Editor until
these user-facing safety paths are wired and validated. The complete requirements
remain in [the implementation TRD](../../docs/planning/icloud-markdown-sync.md).
