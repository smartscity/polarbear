# Polarbear

[English](README.md) | [简体中文](README-zh.md)

> A local-first Markdown editor for writers, developers, and GitHub-based knowledge workflows.

Polarbear is an open-source, local-first Markdown editor built with Rust, Tauri, and TypeScript.  
It focuses on clean writing, live preview, Mermaid and PlantUML diagrams, and GitHub/GitLab document workflows.

MVP platform targets:

- macOS desktop app
- iOS app, experimental but structurally supported from the beginning

---

## Why Polarbear?

Polarbear is designed for people who write technical documents, engineering notes, product specs, architecture diagrams, and GitHub-based knowledge bases.

It is not just another Markdown editor.  
It aims to become a local-first writing workspace with:

- Fast native experience powered by Rust and Tauri
- Clean Markdown editing and live preview
- First-class Mermaid diagram support
- Zoomable diagram viewer
- GitHub and GitLab Cloud Sync
- Clear architecture for long-term open-source maintenance

Write locally. Preview clearly. Sync with GitHub.

Polarbear is not designed as a macOS-only app. The MVP targets macOS and iOS first, using Tauri v2 with mobile compatibility in mind. Platform-specific behavior must stay behind traits or adapter modules so the Rust core remains portable.

---

## Features

### Markdown Editing

- Open local Markdown files
- Edit Markdown with a clean editor
- Live preview
- Split view: editor and preview side by side
- Preview-only mode
- Editor-only mode
- Unsaved change indicator
- Local file access designed with desktop permissions and iOS sandbox limitations in mind

### Diagram Support

- Render Mermaid code blocks inside Markdown preview
- Open Mermaid diagrams in a zoomable viewer
- Zoom in, zoom out, reset zoom
- Drag and pan large diagrams
- Copy Mermaid source
- Export SVG
- Export Mermaid and PlantUML diagrams as SVG or PNG
- Keep Mermaid rendering in the WebView layer for macOS and iOS compatibility

### Cloud Sync

- Connect to a GitHub or GitLab repository
- Browse Markdown files from a repository
- Read remote Markdown files
- Edit and commit changes back to GitHub
- Sync through provider REST APIs without requiring a local Git installation
- Use commit messages such as:

```text
docs: update {file_path}
```

### Extensibility

Mermaid, PlantUML, Cloud Sync, and export are built-in features with explicit module boundaries. Polarbear does not currently expose a runtime plugin API. A plugin system will only be considered after permissions, versioned contracts, and sandboxing are designed.

---

## Tech Stack

- Rust
- Tauri v2 with mobile compatibility
- React
- TypeScript
- Vite
- CodeMirror 6
- Mermaid
- GitHub and GitLab REST APIs

---

## Project Structure

```text
polarbear/
  Cargo.toml
  README.md
  ARCHITECTURE.md
  CONTRIBUTING.md
  LICENSE
  apps/
    desktop/
      package.json
      src/
        app/
        commands/
        features/
        shared/
      src-tauri/
        Cargo.toml
```

The `apps/desktop` package contains the React application. Its `src-tauri` directory is the only Rust application crate and the native Tauri entry point.

---

## Architecture Principles

Polarbear follows these principles:

- Local-first by default
- Feature-oriented TypeScript UI with a typed Tauri boundary
- macOS and iOS first
- Clear module boundaries
- Built-in feature modules with explicit ownership
- Thin Tauri command entry points backed by focused Rust services
- Domain models separated from DTOs
- Testable core logic
- Explicit error handling
- No token leakage in logs
- Platform-specific logic behind traits or adapter modules
- macOS-only APIs isolated in platform modules
- Small, meaningful modules
- Descriptive naming

---

## Platform Support

Polarbear targets macOS and iOS first.

MVP targets:

- macOS desktop app
- iOS app, experimental but structurally supported

Future targets:

- Windows
- Linux
- Android

Platform rules:

- Use Tauri v2 and keep mobile compatibility in mind.
- Keep UI responsive across desktop and mobile screen sizes.
- Keep macOS-only APIs isolated from portable command and service logic.
- Put platform-specific behavior behind traits or adapter modules.
- Keep Tauri commands thin and free of platform-specific business logic.
- Use GitHub REST API for sync so it can work on iOS.
- Treat local file access as capability-based because iOS runs inside an app sandbox.
- Keep Mermaid rendering in the WebView layer.
- Avoid dynamic native plugin loading for the MVP.

---

## Rust Code Style

Rust code should follow idiomatic naming conventions:

- Types, traits, and enums use `UpperCamelCase`
- Functions, methods, variables, and modules use `snake_case`
- Constants use `SCREAMING_SNAKE_CASE`
- Avoid unclear names such as `handle`, `process`, `data`, `info`, `manager`
- Prefer meaningful names such as:

  - `CloudSyncStore`
  - `RepositorySettings`
  - `SecretStoreError`
  - `WorkspaceFile`

Do not use `unwrap()` or `expect()` in production code.
Use explicit error types and return meaningful errors.

---

## Development

### Prerequisites

- Rust stable
- Node.js LTS
- pnpm or npm
- Tauri v2 prerequisites for macOS and iOS
- Xcode for iOS development

### Install Dependencies

```bash
npm install
```

This installs frontend workspace dependencies. Rust dependencies are resolved by Cargo when you run Rust commands.

### Run macOS App

```bash
npm run tauri -- dev
```

This starts the Tauri macOS app in development mode after the Tauri package is fully wired.

You can also run the workspace script directly:

```bash
npm --workspace apps/desktop run tauri:dev
```

### Run iOS App

```bash
npm run tauri -- ios dev
```

This starts the experimental iOS target after Tauri mobile setup is complete and Xcode is configured.

### Run Rust Application

```bash
npm --workspace apps/desktop run tauri -- dev
```

This starts the React development server and the `polarbear-desktop` Tauri crate.

### Build Rust Workspace

```bash
cargo build --workspace
```

### Build Release Binary

```bash
cargo build --workspace --release
```

The release binary is generated under:

```text
target/release/
```

### Build Shared Frontend

```bash
npm run build
```

The frontend bundle is generated under:

```text
apps/desktop/dist/
```

### Package macOS App

```bash
npm run tauri -- build
```

This creates native macOS packages through Tauri after the app shell is fully wired.

Expected package outputs are generated under the Tauri target directory, commonly:

```text
apps/desktop/src-tauri/target/release/bundle/
```

For macOS, expected artifacts may include `.app` and `.dmg` packages depending on the Tauri bundler configuration.

### Build iOS App

```bash
npm run tauri -- ios build
```

This builds the experimental iOS app after Tauri mobile setup is complete. The iOS target should share Rust core capabilities and WebView UI behavior with the macOS app.

### Install Locally

For development, run the app directly:

```bash
npm run tauri -- dev
```

For local installation on macOS after packaging:

1. Build the app with `npm run tauri -- build`.
2. Open the generated `.dmg` or `.app` from the bundle output directory.
3. Move `Polarbear.app` to `/Applications`.

### Mobile Notes

iOS support requires Tauri mobile setup and Xcode. The app must account for iOS sandboxed file access, iOS Keychain-backed secrets, responsive layouts, and WebView-based Mermaid rendering.

### Run Rust Checks

```bash
cargo fmt
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all
```

### Run Frontend Checks

```bash
npm run lint
npm run typecheck
npm run build
```

---

## Cloud Sync Token

Polarbear uses a GitHub or GitLab personal access token to synchronize workspace files.

Security rules:

- Do not store tokens in plain text configuration files
- Do not print tokens in logs
- Token access must go through the Rust `secret_store` module
- Release builds require the platform Keychain
- Plaintext fallback storage is limited to debug builds

---

## Mermaid Example

```mermaid
graph TD
    A[Write Markdown] --> B[Live Preview]
    B --> C[Render Mermaid]
    C --> D[Zoom Diagram]
    D --> E[Commit to GitHub]
```

---

## Roadmap

### MVP

- Local Markdown open and save
- Markdown live preview
- Mermaid rendering
- Mermaid zoom viewer
- GitHub and GitLab Cloud Sync settings
- Incremental upload, download, conflict detection, and deletion sync
- macOS desktop app
- Experimental iOS app structure

### Next

- GitHub branch switcher
- Local Git repository support
- Markdown search
- Document outline
- Export PDF
- Export HTML
- Export PNG for diagrams
- Local knowledge indexing foundations

### Future

- AI-assisted writing
- GitHub Pull Request editing
- Team knowledge base mode
- Document publishing
- Custom plugin marketplace

---

## License

MIT or Apache-2.0.
Please keep the license decision explicit before publishing the first release.
