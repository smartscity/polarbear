# Polarbear iPhone Reader

An isolated, read-only iPhone companion. The Desktop application keeps its existing
entry point, Cargo workspace, styles, commands, and release workflow.

Scope reviewed for [Desktop v0.9.3](../../docs/releases/v0.9.3.md) (`66eec710`)
on 2026-10-14. Desktop release evidence and iPhone device acceptance are separate;
this reader is not a published App Store application.

## Available functionality

- Import a Markdown document or a folder using the native iOS Files picker.
- Receive `.md` and `.markdown` documents through iOS Open In and open the imported copy automatically.
- Keep an immutable local copy, including supported relative image assets.
- Browse/search document names, follow links within a collection, and open a heading outline.
- Read tables, task lists, code, local images and lazily rendered Mermaid diagrams.
- View images/diagrams full screen with a zoom slider and scrolling.
- Restore the heading-relative reading position after reopening a document.
- Change font size, line spacing, appearance and language; default to system preferences.
- Remove an imported collection without touching its original files.
- Select English text for installed-only local translation on iOS 26+, speech and the system dictionary.
- Save pending Vocab captures locally and export them for an explicit import in Vocab.

The web preview uses IndexedDB for imported files. The iOS application uses a
private native library. The preview is not a PWA or a substitute for iPhone testing.

## Reading tools

The reader uses Apple TranslationSession with already installed models on iOS 26+.
Its deployment minimum remains iOS 16; older supported systems retain speech,
dictionary and captures with an unsupported-translation message. Missing models
require system language setup; the reader initiates no model download or remote
translation fallback. Desktop instead bundles Bergamot and its English-to-Chinese
model, so Desktop does not share this Apple language-pack requirement.

Speech uses an installed English voice. The system dictionary supplies dictionary
entries; inline translation does not invent dictionary senses or IPA. Pending
captures remain local until the user exports a file and imports it in Vocab.
Export is not an acknowledged background delivery. See [the iPhone Reading Assistant](../../docs/planning/iphone-reading-assistant.md)
for the persistence contract and signed-device acceptance requirements.

## Run

From the repository root:

```sh
npm ci
npm --workspace apps/ios run dev
npm --workspace apps/ios run ios:init -- --ci
npm --workspace apps/ios run ios:dev
```

The browser preview is at `http://127.0.0.1:1430`. Desktop stays on port 1420.
The iOS target requires Xcode, the Tauri iOS prerequisites, and an appropriate
Rust target. Select a development team locally for a physical device; generated
Xcode files and signing credentials are not committed. The deployment minimum is iOS 16.
`ios:init` applies the existing Polarbear icon assets to the generated Xcode project.

If the preview server is already running:

```sh
npm --workspace apps/ios run ios:dev -- "iPhone 17" --no-watch --config '{"build":{"beforeDevCommand":""}}'
```

If the CLI builds the simulator target successfully but subsequently attempts an
incompatible device archive, use `ios:dev -- --open` and run the simulator target
from Xcode. This was observed with the Intel-host/Xcode 26.5 CLI path; it is not a
successful device archive or a signed distribution. Do not change Desktop build
settings to work around it.

For a bundled-assets simulator check, build the frontend first, then run:

```sh
npm --workspace apps/ios run build
npm --workspace apps/ios run ios:dev -- "iPhone 17" --no-watch --no-dev-server --features custom-protocol --config '{"build":{"devUrl":null,"beforeDevCommand":""}}'
```

## Verify

```sh
npm --workspace apps/ios run typecheck
npm --workspace apps/ios run lint
npm --workspace apps/ios run test
npm --workspace apps/ios run build
npm --workspace apps/ios run test:storage
npm exec --workspace apps/ios -- playwright install chromium
npm --workspace apps/ios run test:ui
cargo fmt --manifest-path apps/ios/src-tauri/Cargo.toml --all -- --check
cargo test --manifest-path apps/ios/src-tauri/reader-plugin/Cargo.toml --locked
```

`test:storage` uses the macOS Swift compiler to exercise the same Foundation
storage implementation used by the iOS plugin. Browser tests do not replace
native Files-provider, security-scope or device backgrounding tests.

The current release checkpoint's [iPhone Reader Quality run](https://github.com/smartscity/polarbear/actions/runs/38588952736)
passed. This automated result does not establish signed-device language inference,
audible playback, Files-provider behavior, or cross-app export/import acceptance.

### Historical implementation checkpoints

The counts below describe the initial Reader and Open In increments, not a fresh
verification of every current reading feature.

The initial implementation passed 26 reader unit/boundary tests, six browser
integration tests, the native Foundation storage regression executable, TypeScript,
ESLint, production frontend builds, native Rust check/Clippy and rustfmt. Desktop
typecheck, lint, 178 Vitest tests, four asset tests and its frontend build also passed.
The native simulator target compiled and its library screen was inspected with the
frontend development server stopped and bundled assets enabled. Cold startup was
slow on the Intel-host iOS 26.5 simulator; physical-device startup performance is
not established by this check. Physical
iPhone import, iCloud-provider permissions, background restoration and signed-device
distribution remain separate release gates.

The Open In increment passed 33 reader unit/boundary tests, seven browser integration
tests, the Foundation storage regression executable, one Rust inbox test, TypeScript,
ESLint, rustfmt, Clippy with warnings denied, and the frontend production build.
The native simulator target built successfully with the document associations in its
installed Info.plist. OS delivery of a `.md` file was verified both after terminating
the app and while it was running; both imports opened directly in the reader.
These checks do not establish physical-device or third-party file-provider behavior.

## Boundaries and storage

- `src/library`: a read-only library interface, native IPC adapter and browser preview adapter.
- `src/reader`: rendering, media lifecycle, progress and display settings.
- `src-tauri/reader-plugin`: native document picker, coordinated reads, bounded import,
  atomic snapshot publication and confined asset access.
- `packages/reader-core`: platform-neutral Markdown parsing and relative-path policy.
- Existing Desktop i18n resources/provider, command labels, logo and pure Mermaid renderer
  are reused. No Desktop editor, window bootstrap, filesystem adapter or Memory client is loaded.

Each import creates `Application Support/ReaderLibrary/<UUID>/content` plus a
manifest. Native paths and permissions never come from Markdown. A temporary
import directory is renamed only after validation and successful copying.
Limits are 5 MB/document, 20 MB/image, 100 MB/collection and 2,000 directory entries.
Hidden files, packages and symlinks are not traversed. Documents must be UTF-8.
Only Markdown and supported images are copied. No source write command exists.

Reading preferences and positions are versioned WebView-local settings. They are
not written to Markdown and are not synchronized with the desktop. Deleting the
app removes these local copies and settings.

## Privacy and current limits

The app does not fetch remote images, run PlantUML remotely, start a Memory Engine,
read a Memory database or synchronize files. HTML is escaped except compatible
`<br>` cell breaks; rendered markup and SVG are sanitized. The production CSP
blocks external network resources. An explicit Files-picker import may cause the
selected file provider, such as iCloud Drive, to download a user-selected file.

PlantUML shows its source; import a pre-rendered SVG/PNG as an attachment for offline
viewing. Mermaid runs in the WebView with lazy loading and a source-size guard,
not in a cancellable worker; pathological diagrams still need device profiling.

Not included: linked-folder refresh/sync, Share Extension or generic document
share-sheet import actions, editing, PDF export, in-document full-text search,
external-link launching, or automatic background Vocab delivery. The explicit
reading-capture export uses the native share sheet.
Documents received by AirDrop can be saved to Files and opened with Polarbear Reader
through the system document-opening interface or imported through the picker.
Signed-device distribution and TestFlight/App Store publication remain separate
acceptance and release work.

The separate `iPhone Reader Quality` workflow runs reader checks. `ios-v*` tags
identify reader milestones and do not trigger the existing `v*` desktop release workflow.

## Open In document delivery

`src-tauri/Info.ios.plist` imports the standard Markdown type for `.md` and
`.markdown` and registers a read-only, alternate viewer. It does not claim ownership
of Markdown, associate all plain-text files, or enable editing in place. Rebuild and
reinstall the native app after changing this metadata; refreshing Vite is insufficient.

An OS `RunEvent::Opened` is routed through the existing reader plugin to a coordinated,
security-scoped snapshot import. The arbitrary-URL native method is not allowed from
the WebView. Only imported collection identifiers and relative paths reach React.
The native inbox retains completed imports and localized error codes until the UI
acknowledges them. The UI subscribes before reading that inbox, also checks on resume,
and opens a successful import directly. Repeated wake-up notifications do not reimport
the file. Relaunching a document intentionally creates another immutable snapshot.

A single received Markdown file does not grant access to sibling images. Use folder
import when those attachments are required. Source files are never modified or removed.
This is document Open In support, not an iOS Share Extension: apps that offer only their
own private sharing UI may not list it. Save to Files and use the document-opening menu
in that case. Actual menu wording and placement depend on the sending app and iOS.

Manual device acceptance:

1. Install the rebuilt app, then use Files or another document app to open `sample.md`
   with Polarbear Reader. Confirm direct navigation to its content and a library copy.
2. Terminate Polarbear and repeat to exercise cold-start delivery.
3. Repeat with a Unicode/space filename and `.markdown`; open a second document while
   a first document or settings sheet is visible.
4. Try invalid UTF-8 and oversized documents. Confirm a localized error, then verify a
   subsequent valid document still opens and the original remains unchanged.
5. Test AirDrop, an iCloud-backed file, and the actual messaging app used to send files
   on a physical iPhone. Simulator and unit checks do not establish those providers' UI.

Platform reference: [Tauri mobile file associations](https://tauri.app/learn/mobile-file-associations/).

