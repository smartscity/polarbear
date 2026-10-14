# Whole-document copying with Mermaid

## Current status: v0.9.3 (2026-10-14)

This page describes the implementation at `66eec710`, the `v0.9.3` release
commit. See the [v0.9.3 release record](../releases/v0.9.3.md) for canonical
release status and the [documentation index](../README.md) for related reports.

Current normal copy uses readable plain text, diagram images and explicit failure
placeholders. Copy Markdown Source is the explicit source-preserving action.
Native macOS output includes table structure rather than only tab-separated cell
text. The earlier harness results below are retained as historical evidence;
this documentation review did not rerun application tests.

Mixed text/table/Mermaid paste into Lark and Word has no recorded PASS. Native
receiver tests do not establish either application's behavior. This is a
receiver-specific evidence gap, not automatically a release blocker. Packaged
Tauri WebView acceptance also remains unrecorded; it must not be inferred from
successful installer builds or production-browser translation tests.

## Scope

Select an entire document containing Mermaid, then copy it into another
application. Source, Live Preview, and Preview share the same
Markdown-to-clipboard conversion. Documents without Mermaid retain the existing
copy behavior. Single-diagram toolbar actions and partial text selections are
unchanged.

## Historical findings

- The old copy handler required a completed background HTML cache. A cold cache
  silently fell through to CodeMirror's plain-text copying.
- Clipboard conversion reused a preview segment matcher that did not recognize
  tilde fences, longer fences, or nested fenced diagrams consistently.
- Preview had no whole-document rich copy handler, and its Select All command
  was disabled with other editing commands.
- Diagram failures could be cached as source-only output without notification.
- The first implementation retained raw Markdown in normal plain-text copy and
  used diagram source as the failed-render fallback. The later P0 change replaced
  both with readable text/placeholders and added explicit Copy Markdown Source.
- Early native output flattened table cells. The later P0 change added typed
  table metadata, native text tables and RTF table rows.

These paths were not an intentional allowlist of supported Mermaid types.

## Current implementation

### Native receivers (macOS)

HTML data URLs alone are not a sufficient cross-application clipboard contract.
On macOS, copying publishes one native pasteboard item with readable plain text,
a separate UTF-8 Markdown flavor, HTML, RTF with embedded PNG bytes, and flat RTFD
with actual text attachments. The native writer uses locally generated
text/style/image runs; it never imports arbitrary HTML, reads referenced files,
or downloads remote images.

`nativeDocumentClipboard.ts` carries heading levels and typed table cell
metadata. `DocumentClipboard.swift` builds native `NSTextTable` blocks for RTFD
and table rows/cells for RTF, alongside text formatting and image attachments.
This is implementation support, not a guarantee that every receiver preserves
all of those representations.

The browser first commits the readable plain-text fallback. The native adapter
captures the pasteboard change count only when that fallback is still current,
then checks the same count before publishing prepared attachments. A newer copy
in this or another application must not be overwritten by late diagram rendering.

`nativeDocumentClipboard.ts` performs the format adaptation through typed Tauri
commands. `reading_native.rs` schedules AppKit access on the main thread.
`native/DocumentClipboard.swift` builds and writes native representations. It is
statically linked into the existing app, not launched as a shell helper.

The checked-in `npm --workspace apps/desktop run test:native-clipboard` test uses
a private named pasteboard and an image-enabled `NSTextView` receiver. It checks
the actual paste result, including image attachments, Unicode text, table
structure and stale clipboard rejection. It does not read or modify the user's
general pasteboard.

### Browser fallback and source copy

`richMarkdownClipboard.ts` parses the complete document with MarkdownIt and
replaces Mermaid fence tokens with locally rendered PNG images. This preserves
surrounding list and blockquote structure. Normal `text/plain` uses
`markdownClipboardText.ts` to produce readable text in document order, with
placeholders for Mermaid diagrams. Non-Mermaid code remains code text.

A failed diagram produces an explicit unavailable placeholder in rich output,
not raw diagram source. Valid diagrams and surrounding text are retained, the
status reports partial failure, and failed renders are retried on the next copy.
The original document remains unchanged. The separate Markdown clipboard flavor
retains the source where supported; use Copy Markdown Source when source text,
including Mermaid fences, is required in the destination.

A ready cache supplies synchronous HTML. A cold cache starts a promised HTML
ClipboardItem write within the copy gesture, before waiting for rendering.
The status bar reports preparation, completion, partial diagram failure, or
clipboard failure. A later copy supersedes a pending payload.

Preview uses the same service, guarded by full-document selection. Its copy
listener is scoped by the selected preview range and removed on unmount.
Native menu Select All uses the existing editor command adapter to select the
preview contents without changing Markdown or moving the editor cursor.

## Verification evidence and limits

### Current source review and recorded regressions

The implementation described above was checked against these files at the release
commit during the documentation review:

- [richMarkdownClipboard.ts](https://github.com/smartscity/polarbear/blob/66eec710ecaad1dc294954256941afcbb98e6cce/apps/desktop/src/features/editor/richMarkdownClipboard.ts)
- [markdownClipboardText.ts](https://github.com/smartscity/polarbear/blob/66eec710ecaad1dc294954256941afcbb98e6cce/apps/desktop/src/features/editor/markdownClipboardText.ts)
- [nativeDocumentClipboard.ts](https://github.com/smartscity/polarbear/blob/66eec710ecaad1dc294954256941afcbb98e6cce/apps/desktop/src/features/editor/nativeDocumentClipboard.ts)
- [DocumentClipboard.swift](https://github.com/smartscity/polarbear/blob/66eec710ecaad1dc294954256941afcbb98e6cce/apps/desktop/src-tauri/native/DocumentClipboard.swift)
- [richMarkdownClipboard.test.ts](https://github.com/smartscity/polarbear/blob/66eec710ecaad1dc294954256941afcbb98e6cce/apps/desktop/src/features/editor/richMarkdownClipboard.test.ts)

The checked-in unit tests assert PNG replacement, common/nested fences, ordered
multiple renders and explicit placeholders without leaked diagram source. Source
inspection is not a new runtime test result.

The [P0 verification report](markdown-reading-p0-verification.md) records a PASS
for browser-generated Mermaid attachments, surrounding Unicode text and table
structure in an `NSTextView` receiver, plus native PNG copy and stale-clipboard
protection. Its Word automation attempt was blocked and Lark was unavailable in
that environment. Neither produced a passed mixed-document paste record.

### Initial implementation verification (historical)

Persistent tests in the original verification covered cold and warm caches,
denied writes, superseded copies, unavailable clipboard APIs, ordinary documents,
alternate/nested fences and render failures. Command-state tests covered Select
All availability in Preview.

The original local Chromium integration harness exercised the actual editor
components and renderer with a mocked clipboard sink and native APIs. Source,
Live Preview, and Preview produced HTML containing PNGs; a partial preview
selection remained native. Its unchanged plain-text Markdown result described
the earlier behavior and is superseded by the current readable-text contract.

A separate local browser run rendered and decoded PNGs for flowchart, state,
ER, sequence, class, gantt, pie, journey, mindmap, timeline, quadrant, sankey,
xychart, block, packet, architecture, and kanban diagrams. All 17 decoded to
nonblank pixels. The native receiver regression also passed with a payload of
all 17 real renders, verifying pasted attachments rather than only PNG generation.
These checks do not prove visual fidelity for every possible diagram or support
in third-party receivers.

The deliberately invalid diagram retained fenced source in that original pass.
That fallback is historical and superseded: current normal rich copy uses an
unavailable placeholder, while explicit source copy retains the fenced source.

## Follow-up acceptance and limitations

Use this checklist to add receiver and installed-app evidence. Record the
Polarbear version, OS, destination application/version and outcome. Missing
written evidence is not proof that no previous manual test took place.

1. In the installed v0.9.3 app, open a document containing headings, text, a table
   and several Mermaid types. Copy immediately after Select All, before
   background rendering finishes.
2. Wait for copied confirmation, then paste into Lark and Word. Check image
   count, ordering, Unicode text, headings and table structure separately.
3. Repeat after editing a diagram and in Source, Live Preview, and Preview.
4. Paste normal copy into a plain-text destination and verify readable text with
   diagram placeholders. Use Copy Markdown Source separately and verify the
   original Markdown, including fences.
5. Include invalid Mermaid syntax: valid diagrams should remain images and the
   failed diagram should have an explicit placeholder and partial-failure status.
6. Select a single paragraph: ordinary partial copying must remain unchanged.
7. Copy again while rendering is pending and verify that stale output cannot
   replace the newer clipboard. Repeat using the installed app's WebView.
8. If a destination strips embedded images, test each diagram's Copy diagram as
   PNG action. That fallback does not establish mixed-document paste support.

A text-only field cannot accept pictures, and applications may choose or strip
clipboard representations. Native output supports bold, italic, code, heading
sizes, list markers, table structure and PNG attachments; receiver preservation
must be checked separately. No universal receiver support is claimed.

Other platforms retain the browser HTML/plain-text path. If asynchronous browser
clipboard writes are unavailable, the readable fallback remains available and a
second copy after preparation can use synchronous HTML. Copy Markdown Source
remains the explicit source-preserving action. No files are uploaded to work
around destination restrictions. Non-Mermaid document images retain the existing
copy behavior and are not fetched implicitly. PlantUML conversion is outside this
change.
