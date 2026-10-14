# Markdown Reading P0 Verification

> Historical report: the Apple translation implementation described below has
> been superseded by bundled offline Bergamot translation. See
> [Desktop Vocabulary Capture](desktop-vocab-reading.md) for the current boundary,
> packaging and verification results. System language setup is no longer part of
> Desktop's reading flow. The Mermaid/clipboard findings below remain relevant.

## Scope and environment

This change completes the implementation work for Mermaid paste detection, rich
document copying, local translation compatibility and automatic selection reading.
It also addresses the reported iPhone position-restoration failure and desktop
release discoverability. Verification used macOS 26.5.1, Xcode 26.5, Chromium and
the repository's installed Mermaid 11 dependency. No language models were
downloaded and no selected document content was sent to a remote service.

The user described three flowchart families, rather than supplying their complete
source documents. `apps/desktop/tests/browser/mermaidFixtures.ts` contains explicit
representative fixtures for EventId deduplication, nested Kafka consumption and
the replay dashboard. Exact customer documents still require a manual check.

## Findings and root fixes

| Problem | Location and cause | Change |
| --- | --- | --- |
| Raw Mermaid appears as text | Editor paste handlers had no pure-diagram recognizer | `mermaidPasteExtension.ts` validates explicit flowchart/graph documents with the existing renderer before wrapping them in a standard fence |
| Later code blocks treated as prose | `markdown/codeFenceState.ts` stopped after the first closed fence | Continue scanning; do not wrap Mermaid pasted into another code block |
| Multi-line diagram image conversion fails | `diagramExport.ts` parsed sanitized HTML labels containing `<br>` as XML | Parse sanitized content as inert HTML, then XML-serialize the cloned SVG for rasterization |
| Failed diagrams leak source during normal copy | `richMarkdownClipboard.ts` used source-code fallback and raw Markdown plain text | Use readable text and explicit diagram placeholders, with a separate Copy Markdown Source command |
| Native rich paste loses table structure | `nativeDocumentClipboard.ts` and `DocumentClipboard.swift` flattened table cells | Carry typed table metadata, native text tables, heading sizes and PNG attachments |
| Translation unnecessarily requires macOS 26 | `LocalTranslation.swift` used the macOS 26 installed-session initializer | Reuse macOS 15 SwiftUI translation sessions with installed-model checks and distinct availability errors |
| Manual reading action interrupts selection | `useVocabReading.tsx`, `VocabPopover.tsx`, `PassageReading.tsx` | Default-on stable pointer-release trigger; no autofocus; cancellation, outside-click, Escape, blur and persistent opt-out |
| Reader exit can persist zero progress | `ReaderSurface.tsx` reread DOM geometry during teardown | Capture valid geometry immediately on scroll; debounce only persistence; retain the snapshot after the container is hidden or detached |
| Recent pushes produce no desktop installer | `release.yml` responds to `v*`, while recent tags were `ios-v*` | Keep separate release channels; add an explicit manual release-tag input and a DMG Actions artifact |

The reported iPhone CI failure did not reproduce in three isolated runs or one
initial single-worker suite. The teardown geometry risk was confirmed by code
inspection and covered with a deterministic hidden-container regression. The
900-pixel restoration assertion has not been relaxed.

GitHub confirms the existing `v0.9.0` macOS release workflow succeeded:
<https://github.com/smartscity/polarbear/actions/runs/38109180886>.
Later iOS-only tags do not start desktop packaging. Desktop release uploads remain
draft releases as before; the new Actions artifact makes a built DMG discoverable
independently of draft publication. Manual dispatch now checks out the selected
release tag instead of using the branch name as an invalid application version.

## Ownership and compatibility

| Concern | Reused design | Invariant |
| --- | --- | --- |
| Paste | CodeMirror plugin and transactions | Markdown remains the persistent source; one paste is one undo operation; queued positions map through edits |
| Diagram images | Existing renderer, sanitizer and export pipeline | No second renderer, remote rendering or private Markdown syntax |
| Clipboard | Typed Tauri adapter and native format builder | HTML/plain text/Markdown/RTF/RTFD coexist; stale asynchronous copies cannot overwrite a newer clipboard |
| Selection | Existing reading hook and popover lifecycle | Transient selection stays local; a cancelled response cannot replace the next selection |
| Translation | Native adapter and per-request completion object | Installed models only, one callback, 30-second timeout, explicit cancellation and resource release |
| Settings | Existing versioned user-settings store | Old settings default to enabled; an explicit opt-out survives reopening |
| Reader progress | Existing position store | Store only valid geometry and flush before losing the last snapshot |

No new global event bus, application-wide command system, translation provider or
diagram rendering framework was introduced. The UI uses the existing locale
resources and command registry. UK/US IPA is shown only when the dictionary supplies
it; installed system voices provide the two playback choices. Vocabulary capture
still uses the existing Vocab API and never accesses its database.

## Verification evidence

| Check | Result | Evidence and limits |
| --- | --- | --- |
| Desktop typecheck and lint | PASS | Workspace scripts |
| Desktop unit tests | PASS | 192 Vitest cases and four asset checks |
| Desktop browser suite | PASS | Eight tests: raw/fenced/invalid paste, undo/redo, consecutive diagrams, reopening, real PNGs, selection settings, source/live/preview and stale responses |
| Diagram families | PASS | TD/TB/LR flowcharts plus state, ER, sequence, gantt, pie, class and mindmap; PNG signatures, decoded nonblank pixels, visual inspection of the multi-line flowchart |
| Native rich-text receiver | PASS | `NSTextView` receives all three browser-generated Mermaid attachments, surrounding Unicode text and table structure |
| Native image copy | PASS | `public.png` bytes and stale-clipboard protection |
| Native translation bridge | PASS | Compiles with macOS 11 deployment target; cancellation completes once; missing models have a specific error |
| Actual sentence/paragraph model inference | BLOCKED | This Mac returns `languagePackMissing`; UI translation tests mock IPC and do not prove model inference |
| macOS 15 runtime | BLOCKED | API compatibility implemented and compiled; no macOS 15 test machine available |
| Word paste | BLOCKED | Word 16.112.4 answers version queries but document creation via automation returns no usable document; no Word paste acceptance claimed |
| Lark paste | BLOCKED | Lark is not installed; receiving application support for multi-image rich clipboard has not been verified |
| iPhone browser suite | PASS | Eleven tests with one worker, including visible and hidden-container exit before debounce |
| iPhone typecheck and lint | PASS | Workspace scripts |
| iPhone unit tests and build | PASS | 36 unit tests and Vite production build |
| Rust checks | PASS | `cargo check`, `cargo fmt --all -- --check`, 20 native tests; one pre-existing real Memory Engine test remains opt-in |
| Desktop frontend build | PASS | Vite production build; existing large-bundle advisory remains |

`quality.yml` now runs the Desktop browser suite and feeds its actual PNG fixture
into the native clipboard receiver on macOS. Vitest explicitly limits discovery
to source unit tests so it cannot accidentally execute Playwright specs.

## Manual acceptance still required

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
4. On a Mac with installed English/Chinese models, select `attractive`, a sentence
   and a paragraph. Verify local definitions, available IPA, US/UK speech, Chinese
   translation and Add to vocabulary. Check offline operation and rapid reselection.
5. Disable Selection translation in Settings, reopen the app, and confirm it stays
   disabled. Re-enable, verify Escape/outside-click/blur, then select code or Chinese
   text and confirm no unwanted card appears.
6. On iPhone, leave a long document immediately after scrolling and reopen it.
   Repeat after backgrounding and after images finish loading.
7. Push a desktop `vMAJOR.MINOR.PATCH` tag or manually dispatch Release Polarbear
   with an existing desktop tag. Verify the macOS job, its DMG artifact and the
   draft release asset. An `ios-v*` tag only validates the iPhone release channel.

## Remaining limits

Rich clipboard acceptance depends on the receiving application. HTML data URLs
are not assumed to work everywhere; native RTF/RTFD and individual PNG are provided.
Non-Mermaid remote/local document images retain the existing copy behavior and are
not fetched implicitly. Arbitrary invalid Mermaid syntax is never silently
rewritten. Actual translation requires installed Apple resources; older/non-macOS
platforms retain explicit unsupported states. These environment-dependent checks
must be completed before claiming universal application compatibility.
