# Native Menu and Table Layout Lifetimes

## Scope and ownership

This contract covers batches K-L. It changes resource ownership, not menu commands, Markdown syntax, persistent settings or native IPC contracts.

| Object | Owner | Lifetime | Release / invalidation |
| --- | --- | --- | --- |
| Native menu installation | One `NativeMenuInstaller` per `useNativeAppMenu` mount | Hook lifetime; one in-flight build/install and at most one pending replacement | Effect cleanup cancels unaccepted installation; newer requests replace the pending request |
| Tauri resource handles | Installer | Build/install operation | Close the new root handle in `finally`; close the separate previous-menu handle returned by installation |
| Installed native menu | Tauri application | Until replaced by the application | Closing a JS resource handle releases that resource-table lease, not the application's native menu reference |
| Table widths | CodeMirror `tableLayoutExtension` state field | Current editor/document session | Reset on document identity change; release with editor state; prune deleted/invalid table positions |
| Width history metadata | Existing CodeMirror history | Existing bounded undo lifetime | Inverse effects restore changed/deleted metadata; session generations reject effects from a previous document incarnation |

## Native menus

The existing hook still derives labels, checked/enabled state, accelerators and actions from the existing command/i18n system. `NativeMenuInstaller` is a small resource owner, not a second command registry or platform framework. Installation is serialized so slow older requests cannot finish after a newer installation. Pending requests are coalesced rather than accumulating an unbounded promise chain.

Checkable entries are inline menu options, not separately allocated `CheckMenuItem` resources. Every custom action has a stable, unique menu ID. This matters because the Tauri menu plugin registers action channels by menu ID; generated IDs would grow that registry on every rebuild.

The ownership contract was checked against the locally resolved Tauri API and native plugin: `Menu.new` allocates a root resource, `setAsAppMenu` returns a separately registered previous-menu resource, and the application retains its installed native menu. Do not enumerate children just to close them: enumeration itself returns additional resource handles. A failed installation or a cancelled build still closes the newly returned root. Cleanup cannot cancel a native installation already accepted by Tauri; serialization ensures the next accepted request follows it.

Tests count mocked native resource leases, delay build/install, inject create/install errors, and assert stable action IDs. They do **not** measure installed AppKit process RSS or certify multi-window menu focus routing. Installed-app acceptance remains a separate check.

## Table layout

Markdown remains the only durable table content. Widths are session UI metadata, never serialized into Markdown or a new database. Switching documents or unmounting the editor resets widths. Reopening the same path starts a new generation; old width effects cannot reattach to it.

Positions map through CodeMirror changes. Before storing an entry, the state field validates the table header/separator using the existing parser and bounds the width array to the current column count. Deleted/invalid tables leave the live map; an undo entry may retain their previous widths until normal history eviction. Distinct tables and editor instances never share a module-global map.

Resize/Auto Fit update the state field without adding a standalone undo step or modifying Markdown. The existing table command path computes column metadata for insert, batch insert, duplicate, delete and move, then dispatches it alongside the Markdown replacement. Undo/redo restores structural content and widths together. Position-only changes rely on normal position mapping instead of saving stale width snapshots that could overwrite later resize choices. Refused last-column deletion keeps existing widths even if serialization normalizes spacing.

The widget equality check includes document identity, not just identical table text. Rendering reads widths from the current editor state; pointer resize updates the existing DOM without rebuilding the widget on each pointer move. No new global listener, persistent store, event bus or table engine is introduced.

## Compatibility and limits

- No data migration, Markdown extension, new dependency or locale change is required.
- Arbitrary source-level column permutations do not carry semantic column identity. Explicit table commands preserve width ordering; source edits preserve valid positional metadata or discard it when the table becomes invalid.
- Width persistence across app restart, document switches or switching away from an unmounted Live editor is deliberately not introduced.
- Resource-handle unit tests and browser tests are not installed native-menu acceptance or long-running memory profiling.

## Manual acceptance

1. In the native app, repeatedly change view, theme, document and language. Verify menu checkmarks, disabled states, labels and actions, including after opening/closing another window.
2. Resize/Auto Fit a column, open another document with an identical table at the same offset, and verify the new document uses default widths.
3. Insert text before a resized table. Verify its widths follow the table rather than the old document offset.
4. Insert several columns, duplicate/move/delete columns, and undo/redo each operation. Check content, alignment and widths together.
5. Delete a table adjacent to another resized table, then undo. The surviving table must not inherit the deleted table's widths; both layouts should return on undo.
6. Close/reopen the document or leave/re-enter Live mode. Session widths reset and Markdown remains unchanged by resizing.
