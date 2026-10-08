# Desktop Vocabulary Capture

## Scope

Read a Markdown article in Desktop, select an English word or phrase, and use
Edit > Look Up in Vocab, the selection context menu, or primary+Alt+D. Preview
selection also exposes a small Vocab action. The lookup stays in Desktop.

Vocab owns dictionary lookup, pronunciation, vocabulary membership and source
history. Desktop never opens Vocab databases. No article is sent to a remote
service. There is no AI dependency or background network lookup.

## Interaction and persistence

- Exact local dictionary matches precede dictionary-validated inflection hints.
- Phrases remain intact. Multiple senses require an explicit choice.
- A missing term can be saved explicitly as a pending reading capture. In Vocab,
  the pending list permits another lookup and an explicit sense assignment.
- Captures include selected text, sentence, document title, optional absolute
  Markdown path, and source heading/line when available from the text selection.
  Preview captures use visible paragraph text and omit unreliable line mappings.
- Users can omit all source context before saving. Unsaved documents have no path.
- Vocab commits membership and capture in one transaction before acknowledging.
  Retries retain the same payload and request ID; duplicate sources are deduplicated.
- Escape/Close restores focus without requesting scroll. Outside-click dismissal
  does not steal focus back from the newly clicked location. Markdown is untouched.

## Boundary

The v1 local reading protocol is documented in Vocab's
`docs/desktop-reading-bridge.md`. Desktop uses `vocab_request` through its existing
typed IPC adapter. It launches the registered Vocab bundle on macOS via structured
`/usr/bin/open` arguments, then connects to the current user's private Unix socket.
There is no shell, PATH lookup, public TCP port or direct database access.

Request: one newline-delimited JSON object, at most 32 KiB, with `version: 1`
and `operation` tagged by `method` (`lookup`, `save`, `speak`). A successful response
contains `version: 1` and `result`; failures carry a stable `error` code. Socket
owner, type and permissions are validated before sending document context. Reads
are bounded to 256 KiB and five seconds; startup is bounded to eight seconds.

## Compatibility and limitations

- Both applications must be upgraded. An older/missing Vocab bridge produces a
  visible failure, never a false saved state.
- macOS is the supported automatic-launch integration. Unix transport exists on
  Linux, but Vocab must already be running. Windows/mobile transport is deferred.
- Return to source opens the existing Markdown file in Desktop, not the exact
  sentence. Renamed/missing sources fail visibly; no arbitrary URI is executed.
- Source history is local and included in full Vocab backups, not sync packages.
  The current view shows the latest 100 sources per sense or pending list.
- Dictionary coverage and simple suffix candidates are not a full lemmatizer.
- Existing macOS Services and listening workflows are not replaced in this slice.

## Acceptance

Select a single word and a phrase in edit/live/preview modes. Verify multiple-sense
selection, unknown-term pending save, source opt-out, duplicate save, timeout retry,
Escape, light dismissal, document scroll preservation, light/dark colors and both
locales. Reopen Vocab and inspect the source, resolve a pending capture, and open
the article. Test missing Vocab, a stale/insecure socket and unsupported versions.
Run Desktop typecheck/lint/tests and Rust tests, and Vocab typecheck/tests/Clippy.

## Implementation verification

Desktop typecheck, lint, frontend production build, 163 Vitest cases, four asset
checks, and 20 native Rust tests passed. One pre-existing Memory Engine installation
test remains opt-in. Vocab typecheck, frontend build, full Rust suite, 17 UI tests,
format checks and all-target/all-feature Clippy passed; the pre-existing full-seed
migration test remains opt-in. Capture tests cover retries, changed-payload rejection,
invalid-sense rollback, pending resolution, re-adding removed vocabulary and backup
restoration. A real private Unix-socket transport regression also passes.

A Chromium component harness verified explicit sense selection, identical retry
payloads, source opt-out, Escape, outside-click dismissal, live locale changes,
pending saves and light/dark layouts at 1100px and 390px widths. That harness mocks
the native API. Launching the two newly packaged applications through LaunchServices
and end-to-end return-to-source remain manual release acceptance checks.
