# Desktop Document Navigation

`features/workspace/documentNavigation.ts` owns the current navigation intent for one App window. It owns no Markdown, filesystem handle, tab list or persistent state. `begin()` invalidates earlier result acceptors; `invalidate()` rejects pending results after new-tab, close or App disposal. This is result cancellation, not native IO cancellation.

## Application boundary

- Recent/native file opens check intent after native read and before applying root, tree, buffer, revision or tab state. Superseded success/error returns `null`. A real open failure returns `false`, allowing Recent to retain the entry with an error; cancellation must not label the file unavailable.
- File-tree opens read before creating/activating a tab. A failed read leaves the active document and dirty buffer intact. Document identity uses the existing workspace-aware factory rather than assuming every relative path is globally unique.
- Tab activation checks intent after awaited tree/file reads and rejects results for a closed tab. It does not replace a buffer that appeared while reading.
- Workspace replacement prepares the tree and first document before replacing state. It checks unsaved documents both before IO and before commit, including newly typed edits during the read. Users must use existing Save/Close actions before replacement; no implicit discard or automatic save is introduced.
- App continues to own document content and metadata. This is a bounded extraction, not a claim that the entire document-session controller has been refactored. Reload lifetime is described below; rename/move, Save As completion and asynchronous close confirmation still require broader session-level coverage before consolidation.

## Reload permissions

`features/workspace/documentReadRequests.ts` owns read-result permissions for one window. Its map contains only currently open, loaded file identities and references to their current immutable snapshots. It does not persist data, clone Markdown, perform IO or become a second document store. App reconciles it after committed content, revision, path, root or tab changes. Unmount clears it. Typing invalidates the active permission synchronously, before the next React commit.

| Concern | Pattern decision | Reason |
| --- | --- | --- |
| Competing asynchronous reloads | Adopt a document-local optimistic permission | Only the newest read of the unchanged document can commit, once |
| Existing App state and Tauri IO | Reuse existing state and adapter | Avoid a parallel buffer store or new storage provider |
| Navigation versus reload | Keep separate owners | Switching tabs should not cancel a valid background reload of another open document |
| Events and cancellation | No event bus or native cancellation protocol | The requirement is local result rejection, not cancellation of filesystem operations |

- An observer's expected root, relative path and revision are checked before it can supersede another read. A stale observer cannot cancel a valid newer request.
- Content/revision changes invalidate the pending permission. Close removes the session; reopening the same path creates a different session even when its bytes and revision match. Path changes replace the session. A consumed permission cannot commit twice.
- Automatic watcher reload, explicit Reload from Disk and post-sync reload all use `reloadDocumentFromDisk`. Successful content and revision updates share this boundary. Errors from obsolete reads are ignored; errors from current reads remain visible.
- Automatic reload never discards dirty content. If typing occurs during IO, retain the buffer and show the existing conflict choice. Explicit Reload from Disk accepts the snapshot present when clicked; subsequent edits invalidate that consent. Keep Editing, Escape and outside dismissal revoke a pending explicit reload before closing the dialog.
- Sync reload uses current open-document metadata after listing the workspace, not a captured tab list. Dirty documents are retained and reported. Read failure is not reported as successful sync completion; a completed remote operation with retained local edits has a distinct localized message. This does not roll back remote writes.
- Reload success consumes its permission before queuing React updates. The map is bounded by live loaded documents; pending native IO itself is not cancelled or newly concurrency-limited by this change.

This contract covers reads. It does not certify every asynchronous write/rename/close completion, non-cooperating external writers, or operating-system file coordination. Those boundaries remain in [file-save-safety.md](file-save-safety.md) and TD-06.

## Evidence

Before implementation, browser regressions reproduced a failed file-tree read adding a tab, an old recent-file completion adding a tab after a new untitled document was created, and opening an empty workspace discarding an unsaved draft. Current tests cover the corrected paths using the real App/editor with controlled native IPC. Unit tests cover replacement, invalidation and independent window owners. Native save correctness is separately covered by [file-save-safety.md](file-save-safety.md).

No new event bus, storage provider, dependency, Markdown format or shared global navigation state is introduced.

Reload regressions first reproduced a stale result updating a closed/reopened document, Keep Editing failing to revoke an explicit reload, and missing conflict choices after input during automatic/post-sync reads. Browser coverage also checks successful explicit discard, current read failure, and obsolete read failure. Unit tests cover independent documents/windows, edit/undo, close/reopen, path/root/revision changes, competing readers, stale observers, one-time consumption and disposal. Browser tests use real App/editor state with controlled native IPC, not installed-app filesystem acceptance.
