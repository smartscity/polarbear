# Polarbear

## Project Name

```text
Polarbear
```

## 中文名称

```text
北极熊
```

## Main Slogan

```text
Polarbear — A local-first Markdown editor for writers, developers, and GitHub-based knowledge workflows.
```

## 中文 Slogan

```text
北极熊 Polarbear —— 一个本地优先、面向开发者的 Markdown 编辑与 GitHub 知识管理工具。
```

## Short Description

```text
Polarbear is an open-source, local-first Markdown editor built with Rust, Tauri, and TypeScript. It focuses on clean writing, live preview, Mermaid diagrams, plugin-based extensibility, and GitHub-powered document workflows.
```

## 中文简介

```text
Polarbear 是一个使用 Rust、Tauri 和 TypeScript 构建的开源、本地优先 Markdown 编辑器。它专注于清爽写作、实时预览、Mermaid 图表、插件化扩展，以及基于 GitHub 的文档工作流。
```

> A local-first Markdown editor for writers, developers, and GitHub-based knowledge workflows.

Polarbear is an open-source, local-first Markdown editor built with Rust, Tauri, and TypeScript.  
It focuses on clean writing, live preview, Mermaid diagrams, plugin-based extensibility, and GitHub-powered document workflows.

中文名称：**北极熊**

---

## Why Polarbear?

Polarbear is designed for people who write technical documents, engineering notes, product specs, architecture diagrams, and GitHub-based knowledge bases.

It is not just another Markdown editor.  
It aims to become a local-first writing workspace with:

- Fast native experience powered by Rust and Tauri
- Clean Markdown editing and live preview
- First-class Mermaid diagram support
- Zoomable diagram viewer
- GitHub repository integration
- Plugin-based extensibility
- Clear architecture for long-term open-source maintenance

Write locally. Preview clearly. Sync with GitHub.

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

### Mermaid Diagram Support

- Render Mermaid code blocks inside Markdown preview
- Open Mermaid diagrams in a zoomable viewer
- Zoom in, zoom out, reset zoom
- Drag and pan large diagrams
- Copy Mermaid source
- Export SVG
- Reserve export PNG capability for future versions

### GitHub Workflow

- Connect to a GitHub repository
- Browse Markdown files from a repository
- Read remote Markdown files
- Edit and commit changes back to GitHub
- Use commit messages such as:

```text
docs: update {file_path}
```

### Plugin System

Polarbear uses a plugin-oriented architecture from the beginning.

Built-in plugins:

- `markdown-preview`
- `mermaid-renderer`
- `github-sync`

Initial plugin capabilities:

- `MarkdownRenderer`
- `DiagramRenderer`
- `RepositorySync`
- `Exporter`

The first version uses built-in plugins and metadata-based plugin management.
Dynamic third-party plugin loading will be considered after the security model is mature.

---

## Tech Stack

- Rust
- Tauri v2
- React
- TypeScript
- Vite
- CodeMirror 6
- Mermaid
- GitHub REST API

---

## Project Structure

```text
polarbear/
  Cargo.toml
  README.md
  ARCHITECTURE.md
  CONTRIBUTING.md
  LICENSE
  crates/
    polarbear-core/
    polarbear-tauri/
  apps/
    desktop/
      src/
      src-tauri/
```

---

## Architecture Principles

Polarbear follows these principles:

- Local-first by default
- Rust core, TypeScript UI
- Clear module boundaries
- Plugin-oriented design
- No business logic inside Tauri commands
- Domain models separated from DTOs
- Testable core logic
- Explicit error handling
- No token leakage in logs
- Small, meaningful modules
- Descriptive naming

---

## Rust Code Style

Rust code should follow idiomatic naming conventions:

- Types, traits, and enums use `UpperCamelCase`
- Functions, methods, variables, and modules use `snake_case`
- Constants use `SCREAMING_SNAKE_CASE`
- Avoid unclear names such as `handle`, `process`, `data`, `info`, `manager`
- Prefer meaningful names such as:

  - `GitHubSyncService`
  - `MarkdownDocument`
  - `PluginRegistry`
  - `SecretStore`
  - `MermaidRendererPlugin`

Do not use `unwrap()` or `expect()` in production code.
Use explicit error types and return meaningful errors.

---

## Development

### Prerequisites

- Rust stable
- Node.js LTS
- pnpm or npm
- Tauri prerequisites for macOS
- Xcode for iOS development

### Install Dependencies

```bash
npm install
```

This installs frontend workspace dependencies. Rust dependencies are resolved by Cargo when you run Rust commands.

### Run Frontend Scaffold

```bash
npm run build
```

The current scaffold writes a static desktop preview bundle to:

```text
apps/desktop/dist/
```

### Run Desktop App

```bash
npm run tauri dev
```

This starts the Tauri desktop app in development mode after the desktop Tauri package is fully wired.

### Run Rust Binary

```bash
cargo run -p polarbear-tauri --bin polarbear
```

This runs the current Rust binary entry point for Polarbear.

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

### Build Desktop Frontend

```bash
npm run build
```

The frontend bundle is generated under:

```text
apps/desktop/dist/
```

### Package Desktop App

```bash
npm run tauri build
```

This creates native desktop packages through Tauri after the desktop shell is fully wired.

Expected package outputs are generated under the Tauri target directory, commonly:

```text
apps/desktop/src-tauri/target/release/bundle/
```

For macOS, expected artifacts may include `.app` and `.dmg` packages depending on the Tauri bundler configuration.

### Install Locally

For development, run the app directly:

```bash
npm run tauri dev
```

For local installation on macOS after packaging:

1. Build the app with `npm run tauri build`.
2. Open the generated `.dmg` or `.app` from the bundle output directory.
3. Move `Polarbear.app` to `/Applications`.

### Mobile Targets

Polarbear targets macOS and iOS in the first stage. iOS support requires Tauri mobile setup and Xcode.

Future target platforms:

- Windows
- Linux
- Android

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

## GitHub Token

Polarbear uses a GitHub token to read and update Markdown files in a repository.

Security rules:

- Do not store tokens in plain text configuration files
- Do not print tokens in logs
- Token access must go through the `SecretStore` abstraction
- macOS should use Keychain in the future
- iOS should use Keychain in the future
- The first MVP may use an in-memory implementation with a clear TODO

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
- Built-in plugin registry
- GitHub settings page
- GitHub file read and update skeleton

### Next

- GitHub branch switcher
- Local Git repository support
- Markdown search
- Document outline
- Export PDF
- Export HTML
- Export PNG for diagrams
- More plugin capabilities

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
