# Desktop Navigation and Settings Verification

## Scope and Diagnosis

The inspected committed baseline was `4d769c9`. The working tree already
contained an uncommitted change from Context to Workspace as the initial surface.
The committed application still started in Context; this was not a persisted
Context preference. The fix is included in this delivery, while unrelated
uncommitted feedback-navigation changes remain separate.

Additional state defects were found in the affected paths:

- `readUserSettings` applied legacy language/theme values even when the canonical
  settings explicitly selected `system`.
- `App` persisted the resolved light/dark theme on mount, replacing the user's
  system preference during initialization.
- Context settings exposed writable defaults before an Admin API configuration
  was available. A refresh also reset all draft fields, and an older refresh
  response could replace a newer confirmed save.
- The Settings dialog combined caption privacy text, shortcut, source and history
  without a consistent layout. Its runtime switch relied solely on polling after
  commands and could briefly show an older status.
- Desktop had no persistent recently opened document store. Memory's `recent`
  field is memory history, not document navigation, and was not reused incorrectly.

## Implementation and Ownership

| Concern | Owner and behavior |
| --- | --- |
| Initial navigation | App always starts in Workspace; Context remains an explicit destination |
| App preferences | Existing validated user-settings store; canonical values precede legacy migration |
| Theme | Apply on mount; persist only explicit user changes; subscribe to system and storage changes |
| Context config | Existing Admin API; loaded server state plus one UI draft; read generations and write revision prevent stale replacement |
| Recent documents | `RecentDocumentStore`: at most 20 paths/timestamps, deduplicated and ordered; no document content or authorization data |
| File access | Existing `tauriWorkspaceAdapter`; successful reads/loaded activations record history, repeated opens reuse existing tabs |
| Settings UI | Shared layout-only Section/Row components; feature-owned actions and state remain unchanged |
| Captions | Native status remains authoritative; source preferences persist, recording never auto-starts on launch |

No new framework, remote service, database, Admin API contract, or recording
engine was introduced. All new user-facing text is in both locale property files.
Shortcuts come from the existing registry and use Apple symbols in Settings.

## Regression Coverage

- Store tests: twenty-entry bound, deduplication, ordering, reopen from storage,
  removal, clear, cross-instance reads, Unicode/spaces, malformed data and write failure.
- Settings tests: canonical system choices versus legacy values, caption/keybinding
  preservation when unrelated settings change, and platform shortcut presentation.
- Browser tests: actual App launch/reload, opening history via native IPC boundary,
  unavailable-file handling, Context save/remount/reload, dirty draft refresh,
  failed saves, unavailable configuration, stale responses, cross-window settings,
  caption toggles/source/history, both themes, Chinese and 320px layout.
- Existing editor, clipboard, translation, caption shortcut and caption panel
  browser regressions are retained. Native capture is mocked in browser tests;
  the existing bundled translation test executes its real offline engine.

## Manual Native Acceptance Still Required

Local validation completed for this change:

| Check | Result |
| --- | --- |
| TypeScript / ESLint | PASS |
| Vitest | 238 passed |
| Node script tests | 24 passed |
| Playwright | 30 passed, including 8 new navigation/settings cases |
| Cargo tests | 35 passed, 1 real-Engine integration test ignored |
| Cargo formatting | PASS |
| Vite production build | PASS; existing large-chunk warning remains |

The first full browser run exposed the old caption CSS selector and word-form
shortcut expectation. That test now uses the labelled section and Apple symbols,
retaining all activation, remapping and disabled-binding assertions. The entire
suite was rerun successfully after this update.

1. Install the new DMG and launch from Finder: Workspace must appear.
2. Open initialized Context, change configuration, explicitly save, quit Desktop
   and Memory Engine, then reopen and verify against the real Admin API.
3. Open local Markdown files, quit/reopen Desktop and use Recent. Delete or move
   a fixture file externally and confirm that the history row reports an error
   and can be removed without deleting another file.
4. Toggle selection translation; reopen Settings and relaunch the application.
5. Select microphone, start and stop captions, open history, and verify actual
   permissions/capture. Relaunch must not automatically begin recording.

## Limits

- Pinning is deferred; the current list is the twenty most recent documents.
- Paths are not security-scoped bookmarks. Native access errors are surfaced;
  automatic relocation and sandboxed bookmark persistence are not implemented.
- WebView localStorage provides cross-window notifications, not transactional
  simultaneous multi-window writes. A native transactional history store would
  be needed for strict concurrent-update guarantees.
- Browser reload/remount tests use a persistent mocked Admin API, not proof of
  the independently installed Memory Engine's durable configuration storage.
- This task does not requalify caption recognition latency or accuracy.
