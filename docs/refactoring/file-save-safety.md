# Desktop File Save Safety

This document owns the native local-save contract introduced after the v0.10.5 audit. It does not redefine the linked-document journal or the Memory Engine Admin API.

## Ownership and call path

```text
Save / Save before close / Save before quit
  -> App.saveTab (one in-flight save per document)
  -> existing Workspace Tauri adapter
  -> save_markdown_file_content / write_markdown_file
  -> document_save::save
  -> bounded process-local lock + macOS SystemDocumentCoordination
  -> read and validate revision -> stage -> preserve metadata -> recheck -> replace -> sync
```

Save As keeps its existing file picker and document identity transition. Both paths compare the captured content with the current editor buffer before clearing dirty state. A completed save of an earlier version updates the disk revision but leaves newer edits dirty; close/quit does not treat that result as a fully saved document. Repeated save requests for an already-saving document are ignored, not queued with stale revisions. Retry remains an explicit user action.

`document_save.rs` owns the write transaction and temporary file lifetime. The existing Rust command names, parameters, revision format and success DTO are unchanged. The existing atomic-write helper for creation and repository download also delegates to this implementation. A fixed 64-stripe mutex array bounds process-local coordination state. Unrelated paths that hash to one stripe may briefly serialize; no unbounded lock registry is retained.

The narrow C bridge invokes the shared Swift `SystemDocumentCoordination.write` accessor synchronously. Revision validation and replacement both run inside it. This reuses the same NSFileCoordinator implementation as the Apple document store, without forcing Desktop local files into the linked-workspace bookmark/journal model. Rust panics cannot unwind across the C callback.

## Save transaction

1. Resolve the existing parent directory for lock identity, keeping the caller's logical document identity unchanged. Existing workspace confinement validation remains in the command boundary. Reject a symbolic-link or non-regular destination.
2. Open an existing destination for reading and writing **without truncation**. This checks file ACLs as well as POSIX read-only status; directory rename permission alone cannot bypass target write restrictions.
3. Capture the content and metadata. When an expected revision was supplied, reject missing or changed content before staging. Normal workspace saves require an existing file even without a revision. Save As without a revision remains an explicitly authorized replacement operation. New-document creation uses a distinct create-only policy and cannot overwrite a destination that appeared after the command's initial existence check.
4. Create a unique same-directory staging file with exclusive creation, initially mode `0600` on Unix. Write all bytes. On macOS, copy metadata using descriptor-based `fcopyfile(COPYFILE_METADATA)`, including mode, owner/group, ACL and extended attributes, then update modification time. Reject an owner/mode mismatch rather than silently broadening permissions. Other platforms retain their existing permissions with no claim of macOS-equivalent ACL coverage.
5. Sync the staged file. Re-open and compare the destination immediately before publication, including inode, metadata and bytes on Unix. A detected external change or deletion aborts and removes the staging file.
6. Replace an existing file by rename. Publish a newly created file through an exclusive hard link so a destination that appeared concurrently is not overwritten. Drop the temporary pathname and sync the containing directory on Unix.
7. Return the new revision only after these operations succeed. Normal failures remove the staging file and leave the editor buffer dirty. A directory-sync failure after publication is reported as an uncertain-durability result, not as proof that the old file remains intact.

## Errors and UI behavior

| Code | Meaning | UI behavior |
| --- | --- | --- |
| `workspace.documentChanged` | Revision, identity or observed contents changed | Keep local edits; existing conflict/reload flow |
| `workspace.documentMissing` | Required file was deleted | Keep local edits; Save As remains available |
| `workspace.permissionDenied` | Target ACL/mode, parent permissions or metadata preservation prevent saving | Localized permission guidance; do not clear dirty state or close the tab |
| `workspace.saveDurabilityUncertain` | Replacement succeeded but directory sync failed | Localized warning to retain the buffer and verify disk before retrying |
| `workspace.saveFailed` | Other IO or coordination failure | Existing error surface, with no success acknowledgment |

Do not retry automatically after an uncertain result. A completed local write followed by a repository-outbox failure still uses the legacy command behavior and is a separate post-commit acknowledgment limitation; this batch does not change the sync DTO or introduce an implicit network action.

## Guarantee boundaries

- Verified on local macOS x86_64: overlapping entry points in one process and two actual native processes cannot both commit the same expected revision. The second writer receives a conflict after the first commits.
- NSFileCoordinator is cooperative. A tool that ignores coordination can still mutate a file after the final comparison and before rename. The recheck narrows and detects observed races; it is **not a filesystem compare-and-swap primitive** or a guarantee against hostile path replacement.
- Non-macOS implementations have in-process serialization and a final recheck, not cross-process NSFileCoordinator coordination. Windows/Linux ACL, ownership and file-replacement semantics need platform-specific acceptance before equivalent guarantees are advertised.
- File and directory sync are executed, but power-loss durability has not been fault-tested. Killing the process can leave a staging file; automatic orphan cleanup and recovery-journal integration are not introduced here.
- Symlink targets are rejected; parent-path canonicalization does not provide a capability-secure defense against a malicious process continuously replacing ancestors. Existing sandbox and workspace authorization remain necessary.
- Browser tests exercise real React/editor behavior with mocked IPC. Native tests exercise real filesystem permissions/ACLs and process coordination separately; neither is an installed signed-DMG acceptance test.

## Regression evidence

Before implementation, four native tests failed: overlapping saves both succeeded, private `0600` mode widened to `0644`, a read-only destination was replaced, and macOS ACL/xattr metadata disappeared. A browser test failed because newer unsaved text lost its dirty indicator after a pending save completed.

The checked-in regression suite covers those cases plus late external edits/deletion, parent-directory permission failure, target ACL denial, symlink rejection, Save As creation, two-process coordination, stale editor snapshots, repeated Save, Save As identity changes, and denied save-before-close. Every fixture uses temporary files or mocked browser IPC, never user documents. Current command results are recorded in [the execution report](refactoring-report.md).

Pattern review: reuse the platform adapter and coordination boundary; centralize the transactional write pipeline; use RAII for staging cleanup. Do not add a general repository framework, event bus, duplicated content store or YAML business logic.

Native API references: [NSFileCoordinator](https://developer.apple.com/documentation/foundation/nsfilecoordinator) and [copyfile/fcopyfile metadata semantics](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/copyfile.3.html).
