# Whole-document copying with Mermaid

## Scope

Select the entire document, then copy it into another application. Source,
Live Preview, and Preview share the same Markdown-to-clipboard conversion.
Single-diagram toolbar actions and partial text selections are unchanged.

## Findings

- The old copy handler required a completed background HTML cache. A cold cache
  silently fell through to CodeMirror's plain-text copying.
- Clipboard conversion reused a preview segment matcher that did not recognize
  tilde fences, longer fences, or nested fenced diagrams consistently.
- Preview had no whole-document rich copy handler, and its Select All command
  was disabled with other editing commands.
- Diagram failures could be cached as source-only output without notification.

These paths were not an intentional allowlist of supported Mermaid types.

## Implementation

`richMarkdownClipboard.ts` parses the complete document with MarkdownIt and
replaces Mermaid fence tokens with locally rendered PNG images. This preserves
the surrounding list and blockquote structure. Plain text retains the original
Markdown, including diagram source. Non-Mermaid fences remain source code.

A ready cache supplies synchronous HTML. A cold cache starts a promised HTML
ClipboardItem write within the copy gesture, before waiting for rendering.
The status bar reports preparation, completion, partial diagram failure, or
clipboard failure. A later copy supersedes a pending payload. Failed renders
retain their source and are retried on the next copy.

Preview uses the same service, guarded by full-document selection. Its copy
listener is scoped by the selected preview range and removed on unmount.
Native menu Select All uses the existing editor command adapter to select the
preview contents without changing Markdown or moving the editor cursor.

## Validation

Persistent unit tests cover cold and warm caches, denied clipboard writes,
superseded copies, unavailable clipboard APIs, ordinary documents, alternate
fences, nested fences, and render failure fallback. Command-state tests cover
Select All availability in Preview.

A local Chromium integration harness exercised the actual editor components
and renderer, with a mocked clipboard sink and native APIs. Source, Live
Preview, and Preview produced HTML containing PNGs and unchanged plain-text
Markdown. A partial preview selection remained native.

A separate local browser run rendered and decoded PNGs for flowchart, state,
ER, sequence, class, gantt, pie, journey, mindmap, timeline, quadrant, sankey,
xychart, block, packet, architecture, and kanban diagrams. All 17 decoded to
nonblank pixels. One deliberately invalid diagram retained its fenced source.
These checks do not prove visual fidelity for every possible diagram.

## Manual acceptance and limitations

1. Open a document containing several Mermaid types and copy immediately after
   Select All, before background rendering finishes.
2. Wait for the copied confirmation before pasting into a rich-text destination.
3. Repeat after editing a diagram and in Source, Live Preview, and Preview.
4. Paste into a plain-text destination and verify the original Markdown.
5. Include invalid Mermaid syntax: valid diagrams should remain images and the
   failed diagram should remain source, with a partial-failure status.
6. Select a single paragraph: ordinary partial copying must remain unchanged.

Packaged macOS WebKit clipboard permission behavior and actual destination-app
pasting still require manual verification. Some destinations strip data-URL
images or prefer plain text; the application does not upload images to work
around that restriction. If asynchronous clipboard writes are unavailable,
Markdown remains available and a second copy after preparation can use the
synchronous HTML path. PlantUML conversion is outside this change.
