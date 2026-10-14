# Desktop Vocabulary Capture

## Scope

Read a Markdown article in Desktop and select an English word, sentence or
paragraph. After pointer release and a stable 180 ms selection, the reading card
opens automatically in source, live and preview modes. Settings > Selection
translation is enabled by default and persists opt-out. The existing command
remains available for keyboard access; no manual Read Selection step is required.

Vocab owns dictionary lookup, dictionary pronunciation data, vocabulary membership and source
history. Desktop never opens Vocab databases. No article is sent to a remote
service. Dictionary lookup has no AI dependency or background network lookup;
passage translation uses installed system language models.

## Interaction and persistence

### Passage reading

Selection accepts English sentences and paragraphs, punctuation and line breaks
included, up to 8,000 characters. Saved sentence context remains bounded at 2,000
characters. Code, controls, empty selections and Chinese-only selections do not
automatically open the card. Selecting, copying and editing retain their focus.
Dictionary term normalization remains separate: selections that do not qualify
as dictionary terms are not silently saved or sent to the lookup endpoint.

The existing popover includes local translation and English playback. Translation
starts automatically for passages and when dictionary lookup has no result;
English playback uses installed macOS US/UK voices independently of Vocab.
Words retain dictionary pronunciation (IPA), senses and vocabulary
membership. For a passage, users can enter a word/phrase to look up and save with
the original reading context. Each new capture uses a new request ID; retries of
the same save retain its ID and payload.

The Desktop native translation adapter uses SwiftUI `translationTask` and
`LanguageAvailability` for English to Simplified Chinese on macOS 15+, compiled
with Xcode 16+. The macOS 26-only `TranslationSession(installedSource:)`
initializer is not required. An AppKit-owned hosting view supplies the session
for each request. Both before creating the session and before translating, the
adapter requires installed models for automatic translation. When models are
missing, the card offers **Download language packs**. Only that explicit action
calls `prepareTranslation`, allowing Apple's consent UI to request the download.
Preparation uses a fixed non-document placeholder, not the selection. It has a
180-second native deadline and survives card dismissal while system consent is
active. Afterwards, an open card retries translation; otherwise the next selection
uses the installed models. Cancellation or failed preparation has a separate error
and a System Settings recovery path. No automatic download or remote translation
provider is introduced. OS availability, SDK availability,
missing language packs, unsupported languages, window availability, cancellation,
timeout and translation failures have distinct error codes. Dictionary lookup
and installed-voice speech remain usable when translation is unavailable.

The Swift bridge is statically linked by the existing Cargo build script. Native
CI and macOS releases use the `macos-26` runner so the translation API is included.
The application's minimum deployment target is not raised for unrelated features.
Requests have a 30-second native timeout and stable request IDs. Dismissal,
replacement, document changes, window blur and disabling the setting cancel
pending work. Each native callback completes once; late results cannot replace
a new selection. Temporary hosting views and timers are released on completion.

[Apple's TranslationSession documentation](https://developer.apple.com/documentation/translation/translationsession)
states that translation content is processed on-device. Apple may collect system
API usage metrics, but not the original or translated content. Polarbear adds no
telemetry and never accesses the Vocab database.

### Vocabulary capture

- Exact local dictionary matches precede dictionary-validated inflection hints.
- Phrases remain intact. A chosen sense becomes vocabulary membership; an
  ambiguous or unknown term can be favorited without inventing a sense and stays
  pending until explicitly resolved in Vocab.
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

### Background favorites

The top-right star replaces the bottom save button. Dictionary lookup and
translation availability never disable it. A click freezes the term, sense and
source preference and durably enqueues the capture before reporting **Saved on
this device · waiting to sync with Vocab**. Only an acknowledged Vocab response
produces a filled star and a delivered state. Unknown terms are explicitly shown
as saved for later, not falsely reported as dictionary membership.

Desktop owns `vocab-outbox.sqlite3` in its application local-data directory. It is
a delivery queue, not a second vocabulary database. The native application owns
one background worker independently of cards and windows. Requests use the
existing v1 Vocab socket and immutable retry keys. Closing Desktop leaves queued
work for the next launch. Private file permissions protect saved source context.

The queue accepts at most 1,000 pending captures and keeps at most 200 completed
receipts. Identical payloads excluding request ID reuse a receipt, including after
reselecting a word. A 60-second claim prevents concurrent sending; expired claims
recover on restart. Connection failures retry with 30-second to five-minute
backoff. Background launch is attempted only on the first delivery; later retries
do not continually launch Vocab. Invalid protocol or permission errors retain
the capture and require an explicit retry. Retry never changes the payload.
Acknowledgements must match the captured content, allowing Vocab's documented
cross-request deduplication and receiver-owned resolution of pending senses.

The UI polls receipts only while a queued card is mounted. Dismissal stops polling,
not delivery. A bounded wake signal and an exit flag prevent unbounded worker
notifications. No Vocab database or Memory Engine storage is accessed directly.

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

The passage UI regression covers a full sentence/paragraph speech request, local
translation response, missing language packs, word lookup and saving, live locale
switching, and narrow-screen layout. Native IPC is mocked in that browser test.
An actual native translation probe on the development Mac returned
`languagePackMissing`; successful model inference is therefore not claimed for
that machine. No language packs were downloaded during verification.

### Background favorite verification

The installed Vocab socket initially returned `ECONNREFUSED`. A normal background
LaunchServices start recovered a real v1 lookup; `OEMS` returned an empty result,
confirming dictionary absence rather than a protocol error. No real vocabulary
was modified during this probe.

Native outbox tests cover disk reopen, exact acknowledgement, deduplication,
immutable retry payloads, concurrent claims, retry backoff, receiver-side sense
resolution, invalid input and queue capacity. Browser tests cover an offline
favorite, source opt-out, card dismissal, completion, header placement, narrow
dark layout and explicit model preparation. Browser IPC is mocked. The native
translation probe covers missing resources and cancellation without downloads;
actual Apple consent/download UI and successful translation after installation
remain manual acceptance items.

Validation for this change: Desktop typecheck and lint, 192 unit tests, four asset
checks, 11 browser tests, the production frontend build, Rust formatting and 22
native tests passed (one existing engine-installation test remains opt-in).
The native Swift probe compiled and passed cancellation/resource checks; actual
model inference remains blocked by missing installed language packs.

### Initial capture release verification

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

### iPhone reading integration

The standalone iPhone reader now provides native local translation/speech and a
versioned offline capture transfer consumed by Vocab's existing ReadingService.
It does not reuse the desktop Unix socket or access Vocab storage. See
[iPhone Reading Assistant](iphone-reading-assistant.md) for the interaction,
pending-versus-imported states, file contract and remaining mobile limitations.
