# README visual assets

The PNG images were captured from the repository frontend on 2026-11-13.
They use synthetic documents and caption segments with simulated native IPC.
They do not demonstrate native filesystem operations, real audio recognition,
translation quality, or installed-device acceptance. No private documents or
recordings were used. The SVG banner is an abstract editorial illustration,
not an application screenshot.

## Reproduce

With dependencies installed, start the local frontend from the repository root:

```sh
npm --workspace apps/desktop run dev -- --port 1427
```

In a second terminal, use Node.js 26 (native TypeScript stripping is used to load
the existing browser fixture) with the installed Playwright Chromium runtime:

```sh
node docs/assets/capture-screenshots.mjs
```

The script runs the actual React interface, opens a demo document through the
existing native-menu fixture, and saves reading, split-view, and caption PNGs.
It does not change application styles or retouch the screenshots.
The demo path `/demo/Fieldnotes` is fixture metadata, not a directory to create.

Project-owned artwork and synthetic example content use the project's MIT license.
