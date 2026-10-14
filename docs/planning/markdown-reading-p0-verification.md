# Markdown Reading P0 Verification

## Current status: v0.9.3 (2026-10-14)

The current release baseline is `v0.9.3` at `66eec710`. The
[v0.9.3 release record](../releases/v0.9.3.md) is the canonical release-status
summary; the [documentation index](../README.md) separates current guidance from
historical implementation reports.

- Desktop now bundles offline Bergamot translation. Apple language packs and
  Apple Translation API availability are no longer Desktop prerequisites.
- Real production Chromium/WebKit inference and cancellation/recovery are
  recorded as PASS in [Desktop Vocabulary Capture](desktop-vocab-reading.md).
  The model's `OEMS` to `制造商` result remains a terminology-quality caveat.
- Installed-DMG/actual Tauri WebView verification remains `NOT_RUN` in the
  written record. This does not establish that nobody tested the installed app.
- Mixed text/table/Mermaid paste into Lark and Word has no recorded PASS.
  The earlier receiver-environment blockers below explain the limits of that
  historical test pass; they do not establish current failures or automatically
  make this a release blocker.
- The v0.9.3 [release workflow](https://github.com/smartscity/polarbear/actions/runs/38588952658),
  [Desktop quality workflow](https://github.com/smartscity/polarbear/actions/runs/38588952731)
  and [iPhone quality workflow](https://github.com/smartscity/polarbear/actions/runs/38588952736)
  succeeded. DMG and EXE assets were uploaded; the release is intentionally a
  draft. Installer generation is separate from installed-app acceptance.

The sections labeled historical retain the earlier implementation and test
record. They are not a fresh test run. Apple-specific blocked results have been
superseded; Mermaid and clipboard evidence remains useful within its stated scope.

## Historical scope and environment

The P0 change completed the implementation work for Mermaid paste detection, rich
document copying, local translation compatibility and automatic selection reading.
It also addressed the reported iPhone position-restoration failure and desktop
release discoverability. Verification used macOS 26.5.1, Xcode 26.5, Chromium and
the repository's installed Mermaid 11 dependency. No language models were
downloaded and no selected document content was sent to a remote service.

The user described three flowchart families, rather than supplying their complete
source documents. `apps/desktop/tests/browser/mermaidFixtures.ts` contains explicit
representative fixtures for EventId deduplication, nested Kafka consumption and
the replay dashboard. Exact customer documents still require a manual check.

## Historical findings and root fixes

| Problem | Location and cause | Change |
| --- | --- | --- |
| Raw Mermaid appears as text | Editor paste handlers had no pure-diagram recognizer | `mermaidPasteExtension.ts` validates explicit flowchart/graph documents with the existing renderer before wrapping them in a standard fence |
| Later code blocks treated as prose | `markdown/codeFenceState.ts` stopped after the first closed fence | Continue scanning; do not wrap Mermaid pasted into another code block |
| Multi-line diagram image conversion fails | `diagramExport.ts` parsed sanitized HTML labels containing `<br>` as XML | Parse sanitized content as inert HTML, then XML-serialize the cloned SVG for rasterization |
| Failed diagrams leak source during normal copy | `richMarkdownClipboard.ts` used source-code fallback and raw Markdown plain text | Use readable text and explicit diagram placeholders, with a separate Copy Markdown Source command |
| Native rich paste loses table structure | `nativeDocumentClipboard.ts` and `DocumentClipboard.swift` flattened table cells | Carry typed table metadata, native text tables, heading sizes and PNG attachments |
| Translation unnecessarily requires macOS 26 | `LocalTranslation.swift` used the macOS 26 installed-session initializer | At that stage, reuse macOS 15 SwiftUI translation sessions with installed-model checks and distinct availability errors; this Desktop path is now superseded by bundled Bergamot |
| Manual reading action interrupts selection | `useVocabReading.tsx`, `VocabPopover.tsx`, `PassageReading.tsx` | Default-on stable pointer-release trigger; no autofocus; cancellation, outside-click, Escape, blur and persistent opt-out |
| Reader exit can persist zero progress | `ReaderSurface.tsx` reread DOM geometry during teardown | Capture valid geometry immediately on scroll; debounce only persistence; retain the snapshot after the container is hidden or detached |
| Recent pushes produce no desktop installer | `release.yml` responds to `v*`, while recent tags were `ios-v*` | Keep separate release channels; add an explicit manual release-tag input and a DMG Actions artifact |

The reported iPhone CI failure did not reproduce in three isolated runs or one
initial single-worker suite. The teardown geometry risk was confirmed by code
inspection and covered with a deterministic hidden-container regression. The
900-pixel restoration assertion has not been relaxed.

The earlier `v0.9.0` macOS release workflow succeeded:
<https://github.com/smartscity/polarbear/actions/runs/38109180886>.
Later iOS-only tags do not start desktop packaging. Desktop release uploads remain
draft releases as before; the new Actions artifact makes a built DMG discoverable
independently of draft publication. Manual dispatch now checks out the selected
release tag instead of using the branch name as an invalid application version.

## Historical ownership and compatibility

| Concern | Reused design | Invariant |
| --- | --- | --- |
| Paste | CodeMirror plugin and transactions | Markdown remains the persistent source; one paste is one undo operation; queued positions map through edits |
| Diagram images | Existing renderer, sanitizer and export pipeline | No second renderer, remote rendering or private Markdown syntax |
| Clipboard | Typed Tauri adapter and native format builder | HTML/plain text/Markdown/RTF/RTFD coexist; stale asynchronous copies cannot overwrite a newer clipboard |
| Selection | Existing reading hook and popover lifecycle | Transient selection stays local; a cancelled response cannot replace the next selection |
| Translation (superseded) | Native adapter and per-request completion object | The earlier Apple path used installed models, one callback, a 30-second timeout and explicit cancellation; current bundled-engine ownership is documented in Desktop Vocabulary Capture |
| Settings | Existing versioned user-settings store | Old settings default to enabled; an explicit opt-out survives reopening |
| Reader progress | Existing position store | Store only valid geometry and flush before losing the last snapshot |

No new global event bus, application-wide command system, translation provider or
diagram rendering framework was introduced. The UI uses the existing locale
resources and command registry. UK/US IPA is shown only when the dictionary supplies
it; installed system voices provide the two playback choices. Vocabulary capture
still uses the existing Vocab API and never accesses its database.

## Historical verification evidence

| Check | Result | Evidence and limits |
| --- | --- | --- |
| Desktop typecheck and lint | PASS | Workspace scripts |
| Desktop unit tests | PASS | 192 Vitest cases and four asset checks |
| Desktop browser suite | PASS | Eight tests: raw/fenced/invalid paste, undo/redo, consecutive diagrams, reopening, real PNGs, selection settings, source/live/preview and stale responses |
| Diagram families | PASS | TD/TB/LR flowcharts plus state, ER, sequence, gantt, pie, class and mindmap; PNG signatures, decoded nonblank pixels, visual inspection of the multi-line flowchart |
| Native rich-text receiver | PASS | `NSTextView` receives all three browser-generated Mermaid attachments, surrounding Unicode text and table structure |
| Native image copy | PASS | `public.png` bytes and stale-clipboard protection |
| Native Apple translation bridge (superseded) | PASS | Compiled with macOS 11 deployment target; cancellation completed once; missing models had a specific error |
| Actual Apple sentence/paragraph model inference (superseded) | BLOCKED at that time | The test Mac returned `languagePackMissing`; the older UI tests mocked IPC. Current bundled production inference is recorded as PASS separately |
| Apple translation on macOS 15 (superseded) | BLOCKED at that time | API compatibility was implemented and compiled; no macOS 15 test machine was available. This is not a bundled-engine device result |
| Word paste | BLOCKED at that time | Word 16.112.4 answered version queries but document creation via automation returned no usable document; no mixed text/table/Mermaid paste PASS was recorded |
| Lark paste | BLOCKED at that time | Lark was not installed in that test environment; no mixed text/table/Mermaid paste PASS was recorded |
| iPhone browser suite | PASS | Eleven tests with one worker, including visible and hidden-container exit before debounce |
| iPhone typecheck and lint | PASS | Workspace scripts |
| iPhone unit tests and build | PASS | 36 unit tests and Vite production build |
| Rust checks | PASS | `cargo check`, `cargo fmt --all -- --check`, 20 native tests; one pre-existing real Memory Engine test remains opt-in |
| Desktop frontend build | PASS | Vite production build; existing large-bundle advisory remains |

`quality.yml` now runs the Desktop browser suite and feeds its actual PNG fixture
into the native clipboard receiver on macOS. Vitest explicitly limits discovery
to source unit tests so it cannot accidentally execute Playwright specs.

## Follow-up evidence checklist for the current implementation

Use these checks to add evidence where coverage is incomplete. They are not an
assertion that v0.9.3 is unreleasable or that a previously unrecorded test never
happened. Record application/OS versions and distinguish a failed test from a
blocked or not-run test. The old checklist's Apple language-pack setup step is
superseded by bundled offline translation.

1. Paste each original flowchart into a blank document, then into an existing code
   block. Only complete valid standalone diagrams should be wrapped. Undo once,
   redo, save and reopen. Invalid input must remain editable and visible.
2. Copy a document containing headings, lists, a table and several diagrams with
   Cmd+A/Cmd+C. Wait for the copied status, then paste into Lark and Word. Check
   image count, ordering, text and table structure. Use Copy Markdown Source to
   verify that the explicit source action still contains the fences.
3. If a receiver strips embedded images, use each diagram's Copy diagram as PNG
   button and paste it individually. This is an explicit fallback, not evidence
   that mixed multi-image paste works in that receiver.
4. In the installed v0.9.3 DMG, without Apple translation packs and with external
   networking disconnected, select `attractive`, a dictionary-absent word, a
   sentence and a paragraph. Verify available definitions and IPA, US/UK speech,
   Chinese translation, copying and header favorites. Check rapid reselection,
   dismissal/recovery and app restart. No language download/setup sheet should
   appear. Keep terminology accuracy, including `OEMS`, separate from successful
   engine operation.
5. Disable Selection translation in Settings, reopen the app, and confirm it stays
   disabled. Re-enable, verify Escape/outside-click/blur, then select code or Chinese
   text and confirm no unwanted card appears.
6. On iPhone, leave a long document immediately after scrolling and reopen it.
   Repeat after backgrounding and after images finish loading.
7. For installer provenance, use the successful v0.9.3 release run linked above
   and record the artifact/version used for manual checks. Its intentional draft
   state does not mean packaging failed. An `ios-v*` tag belongs to the separate
   iPhone release channel; no new tag is needed to document this release.

## Remaining limits

Rich clipboard acceptance depends on the receiving application. HTML data URLs
are not assumed to work everywhere; native RTF/RTFD and individual PNG are provided.
Non-Mermaid remote/local document images retain the existing copy behavior and are
not fetched implicitly. Arbitrary invalid Mermaid syntax is never silently
rewritten. Current Desktop translation uses bundled local assets and requires
compatible WebAssembly/Web Worker support; it does not require installed Apple
translation resources. Production-browser passes do not establish installed Tauri
behavior or every OS/device combination. The standalone iOS translation path is
separate. Receiver-specific and device-specific evidence is needed before making
those compatibility claims; no universal application compatibility is claimed.

