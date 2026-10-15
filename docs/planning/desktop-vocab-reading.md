# Desktop Vocabulary Capture

## Current status: v0.9.4 notebook integration

The notebook integration requires Vocab 0.3.2 and is verified separately in the
[v0.9.4 release record](../releases/v0.9.4.md). The translation baseline remains
the `66eec710` release recorded in [v0.9.3](../releases/v0.9.3.md). See the
[documentation index](../README.md) for related implementation and historical reports.

Bundled Bergamot translation supersedes the earlier Apple language-pack path.
Production Chromium/WebKit inference and cancellation/recovery are recorded as
PASS. Installed-DMG/actual Tauri WebView verification remains `NOT_RUN` in the
written record; that is an evidence gap, not proof that nobody tested the app.
The successful release build and uploaded installers do not by themselves close
that runtime-verification gap. The results below are retained evidence, not
application tests rerun during this documentation review.

## Scope

Read a Markdown article in Desktop and select an English word, sentence or
paragraph. After pointer release and a stable 180 ms selection, the reading card
opens automatically in source, live and preview modes. Settings > Selection
translation is enabled by default and persists opt-out. The existing command
remains available for keyboard access; no manual Read Selection step is required.

Vocab owns dictionary lookup, dictionary pronunciation data, vocabulary membership and source
history. Desktop never opens Vocab databases. No article is sent to a remote
service. Dictionary lookup has no AI dependency or background network lookup;
passage translation uses the same bundled Bergamot engine and English-to-Chinese
model as Polarbear Vocab. Neither Apple language packs nor a running Vocab app
are required for sentence translation.

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

Desktop bundles BrowserMT Bergamot 0.4.9 and Vocab's byte-identical Mozilla
English-to-Chinese model. The four gzip model assets total 36,745,493 bytes
(about 35 MiB); the WASM engine adds further installer size. Models and license
notices live in `public/models/en-zh`; the canonical manifest lives next to the
translation adapter. Vite verifies compressed and decompressed SHA-256 digests
before building, packages the classic worker and its adjacent WASM runtime, and
includes the same resources in the Tauri frontend bundle. There is no first-run
download, remote registry, Apple consent sheet or cloud fallback.

`OfflineTranslation` owns the current window's single active request and worker
lifecycle. `BergamotWorker` is a small adapter to the pinned upstream worker's
message protocol, not a second translation algorithm. It transfers verified
model buffers to the upstream worker. Decompression runs in fflate workers;
neural inference runs in Bergamot's worker, not on the editor thread. Model load,
initialization and inference share a 60-second deadline. Replacement or dismissal
terminates active inference and aborts asset loading. Successful engines may be
reused and are released after 90 idle seconds or page exit. No selected text or
translation cache is persisted. Late results cannot replace a newer selection.

The translation API no longer crosses Tauri IPC, so Desktop translation has no
Apple Translation framework, SDK or installed-language-pack dependency. Native
clipboard and installed-voice speech remain unchanged. Desktop CSP permits
WebAssembly and local/blob workers without enabling general JavaScript eval.
Missing packaged assets, failed integrity checks, timeouts and inference errors
have distinct localized feedback. Reinstall/update is offered only for a damaged
installation, not as a routine language setup step. Listening and favorites stay
available independently.

This is English-to-Chinese neural translation, not a replacement for dictionary
senses or IPA. Acronyms and specialist terms can be mistranslated; the recorded
`OEMS` output was `制造商`, which is not a validated domain-specific definition.
Vocab still owns word lookup, pronunciation data and vocabulary membership
through its existing IPC boundary. No database access is introduced.
The standalone iOS reader's native translation implementation is outside this
Desktop change and must not be described as using the bundled engine yet.

### Vocabulary capture

- Exact local dictionary matches precede dictionary-validated inflection hints.
- Phrases remain intact. Dictionary results select an existing notebook sense or
  the first stable dictionary match by default; users can choose another meaning.
- Vocab resolves null sense IDs at its application/storage boundary. Unknown terms
  become canonical local entries with empty definitions, not a pending-only list.
  The live notebook participates in normal dataset study and statistics.
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
with a non-null canonical sense ID produces a filled star and a delivered state.
Old Vocab versions acknowledging only a pending capture produce a version error,
not a false successful membership state. Reopening a card reads membership from
Vocab; the filled star can remove membership through the same local IPC boundary.

Desktop owns `vocab-outbox.sqlite3` in its application local-data directory. It is
a delivery queue, not a second vocabulary database. The native application owns
one background worker independently of cards and windows. Requests use the
existing v1 Vocab socket and immutable retry keys. Closing Desktop leaves queued
work for the next launch. Private file permissions protect saved source context.

The queue accepts at most 1,000 pending captures and keeps at most 200 completed
receipts. Identical outstanding payloads reuse a receipt. A new explicit capture
after successful delivery uses a fresh request ID, allowing re-add after removal.
A 60-second claim prevents concurrent sending; expired claims
recover on restart. Connection failures retry with 30-second to five-minute
backoff. Background launch is attempted only on the first delivery; later retries
do not continually launch Vocab. Invalid protocol or permission errors retain
the capture and require an explicit retry. Retry never changes the payload.
Acknowledgements must match the captured content, allowing Vocab's documented
cross-request source deduplication and receiver-owned sense resolution. Vocab owns
durable idempotency receipts, so old transport retries cannot undo later removals.

Reading excerpts are rendered as plain text from Markdown without modifying stored
provenance. Equivalent filenames and article headings are not displayed twice.

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
  The current view shows the latest 100 sources associated with the word.
- Dictionary coverage and simple suffix candidates are not a full lemmatizer.
- Existing macOS Services and listening workflows are not replaced in this slice.

## Acceptance

Select a single word and a phrase in edit/live/preview modes. Verify multiple-sense
selection, unknown-term canonical save, source opt-out, duplicate save, timeout retry,
Escape, light dismissal, document scroll preservation, light/dark colors and both
locales. Reopen Vocab and inspect the source, study an incomplete entry, and open
the article. Test missing Vocab, a stale/insecure socket and unsupported versions.
Run Desktop typecheck/lint/tests and Rust tests, and Vocab typecheck/tests/Clippy.

## Implementation verification

### Bundled offline translation verification

These are the recorded implementation-verification results. Test counts describe
that verification pass rather than a fresh v0.9.3 test run. Release CI evidence
is tracked separately in the [release record](../releases/v0.9.3.md).

The Desktop translation path now uses real bundled inference in browser tests;
it is not replaced by a mocked Tauri translation response. Vocab lookup,
favorites and speech IPC remain mocked in browser UI tests, with separate native
tests for the actual storage/protocol boundaries.

| Check | Result | Evidence |
| --- | --- | --- |
| Desktop typecheck and lint | PASS | No new errors |
| Unit tests | PASS | 201 tests plus four existing Memory asset checks |
| Desktop browser regression | PASS | 12 cases, including real sentence and >2,000-character paragraph translation, model missing/corrupt errors, retry, opt-out and favorites |
| Production offline inference | PASS | Chromium and WebKit, production CSP, packaged WASM/model assets, all external requests blocked |
| Cancellation and recovery | PASS | Unit tests cover supersession, late factories, deadlines and idle cleanup; both browser engines translate after cancellation |
| Model integrity | PASS | All four compressed and decoded hashes match Vocab's pinned model |
| Production frontend bundle | PASS | Includes model files, WASM, worker scripts and license notices |
| Native compile/tests | PASS | 22 passed; one existing real Memory installation test is opt-in; socket tests need sandbox permission |
| Rust formatting | PASS | `cargo fmt --all -- --check` |
| Installed DMG / actual Tauri WebView | NOT_RUN | No result is recorded for this layer; production browser passes and installer builds do not establish installed-app behavior |
| Older macOS / Windows devices | NOT_RUN | No device result is recorded; compatible WebAssembly/Web Worker support is required, while Apple Translation API availability is no longer the gate |

The production probe translates `This is an English sentence.` to
`这是一句英文句子。` and preserves paragraph breaks. It also exposes a quality
limitation: this model translates the standalone acronym `OEMS` to `制造商`,
which is not a validated domain-specific definition. Do not present neural output
as authoritative dictionary data. The original selection remains visible and
favorite capture preserves that original text.

To close the installed-runtime evidence gap, install the v0.9.3 DMG without Apple
translation packs, disconnect external networking, select a word absent from the
dictionary and a full paragraph, copy the translation, reselect quickly,
close/reopen the card, and verify header favorites still queue while Vocab is unavailable. No language
download button or system setup sheet should appear. Check the same flow after
restarting Desktop. Record the installer version, OS version and result. This
Desktop translation change does not replace the standalone iOS implementation.

### Previous Apple translation implementation (superseded)

The earlier passage UI regression covered a full sentence/paragraph speech
request, local translation response, missing language packs, word lookup and saving, live locale
switching, and narrow-screen layout. Native IPC was mocked in that browser test.
An actual native translation probe on the development Mac returned
`languagePackMissing`; successful Apple-model inference was therefore not claimed
for that machine. That historical resource limitation does not apply to the current
bundled Desktop translation path. No language packs were downloaded during that
verification.

### Background favorite verification (historical v0.9.2 record)

The outbox and socket evidence below remains relevant. The Apple translation
probe and language-pack acceptance items in this older pass were superseded by
the bundled-engine verification above; they are not current Desktop prerequisites.

The installed Vocab socket initially returned `ECONNREFUSED`. A normal background
LaunchServices start recovered a real v1 lookup; `OEMS` returned an empty result,
confirming dictionary absence rather than a protocol error. No real vocabulary
was modified during this probe.

Native outbox tests cover disk reopen, exact acknowledgement, deduplication,
immutable retry payloads, concurrent claims, retry backoff, receiver-side sense
resolution, invalid input and queue capacity. Browser tests cover an offline
favorite, source opt-out, card dismissal, completion, header placement, narrow
dark layout and the then-current explicit model preparation in v0.9.2. Browser
IPC was mocked. The historical native translation probe covered missing resources
and cancellation without downloads; Apple consent/download UI and successful
Apple translation after language-pack installation were still unverified in that
record. Those Apple-specific acceptance items are now superseded.

Validation for that change: Desktop typecheck and lint, 192 unit tests, four asset
checks, 11 browser tests, the production frontend build, Rust formatting and 22
native tests passed (one existing engine-installation test remains opt-in).
The native Swift probe compiled and passed cancellation/resource checks; actual
Apple-model inference was blocked by missing installed language packs in that
historical pass. Current bundled inference is recorded as PASS above.

### Initial capture release verification (historical)

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
and end-to-end return-to-source remained manual release acceptance checks in
that historical record.

### iPhone reading integration

The standalone iPhone reader now provides native local translation/speech and a
versioned offline capture transfer consumed by Vocab's existing ReadingService.
It does not reuse the desktop Unix socket or access Vocab storage. See
[iPhone Reading Assistant](iphone-reading-assistant.md) for the interaction,
pending-versus-imported states, file contract and remaining mobile limitations.

