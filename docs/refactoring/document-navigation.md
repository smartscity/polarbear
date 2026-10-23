# Desktop Document Navigation

`features/workspace/documentNavigation.ts` owns the current navigation intent for one App window. It owns no Markdown, filesystem handle, tab list or persistent state. `begin()` invalidates earlier result acceptors; `invalidate()` rejects pending results after new-tab, close or App disposal. This is result cancellation, not native IO cancellation.

## Application boundary

- Recent/native file opens check intent after native read and before applying root, tree, buffer, revision or tab state. Superseded success/error returns `null`. A real open failure returns `false`, allowing Recent to retain the entry with an error; cancellation must not label the file unavailable.
- File-tree opens read before creating/activating a tab. A failed read leaves the active document and dirty buffer intact. Document identity uses the existing workspace-aware factory rather than assuming every relative path is globally unique.
- Tab activation checks intent after awaited tree/file reads and rejects results for a closed tab. It does not replace a buffer that appeared while reading.
- Workspace replacement prepares the tree and first document before replacing state. It checks unsaved documents both before IO and before commit, including newly typed edits during the read. Users must use existing Save/Close actions before replacement; no implicit discard or automatic save is introduced.
- App continues to own document content and metadata. This is a bounded extraction, not a claim that the entire document-session controller has been refactored. External reload, rename/move, Save As and close/reopen generations require additional session-level tests before consolidation.

## Evidence

Before implementation, browser regressions reproduced a failed file-tree read adding a tab, an old recent-file completion adding a tab after a new untitled document was created, and opening an empty workspace discarding an unsaved draft. Current tests cover the corrected paths using the real App/editor with controlled native IPC. Unit tests cover replacement, invalidation and independent window owners. Native save correctness is separately covered by [file-save-safety.md](file-save-safety.md).

No new event bus, storage provider, dependency, Markdown format or shared global navigation state is introduced.
