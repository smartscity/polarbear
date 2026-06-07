# Polarbear Architecture

Polarbear is a local-first Markdown editor built with Rust, Tauri, and TypeScript.

The architecture is designed around a simple rule:

> The Rust core owns application capabilities.  
> The TypeScript UI owns interaction and presentation.  
> Tauri commands only adapt between them.

## Goals

- Provide a calm local-first Markdown writing workspace.
- Keep Markdown editing, Mermaid rendering, GitHub sync, export, and settings as separate capabilities.
- Make core behavior testable without a running desktop shell.
- Keep application state explicit and auditable.
- Prepare for macOS and iOS first, with room for Windows, Linux, and Android later.

## Non-Goals for MVP

- Dynamic third-party plugin execution.
- Full Git client replacement.
- Collaborative editing.
- Cloud-hosted document storage.
- Publishing and team knowledge base features.
- AI-assisted writing.

## Workspace Layout

```text
polarbear/
  Cargo.toml
  README.md
  ARCHITECTURE.md
  crates/
    polarbear-core/
    polarbear-tauri/
  apps/
    desktop/
      package.json
      src/
```

## Module Responsibilities

| Module | Responsibility |
|---|---|
| `polarbear-core` | Domain logic for Markdown, plugins, settings, sync, and secrets |
| `polarbear-tauri` | Tauri command adapters and application state |
| `apps/desktop` | React and TypeScript user interface |
| `markdown` | Markdown document model and parsing abstraction |
| `plugin` | Plugin metadata, registry, capability filtering |
| `sync` | GitHub sync request and sync service |
| `secret` | Token and secret storage abstraction |
| `settings` | User settings and repository configuration |

## Rust Core

The Rust core owns domain models and application capabilities. It should not depend on UI frameworks or Tauri command types.

Core modules include:

- `markdown`: Markdown document model, dirty state, parsing abstraction, and future file IO boundaries.
- `plugin`: Built-in plugin metadata, registry, and capability filtering.
- `sync`: GitHub repository configuration, sync requests, and update workflow boundaries.
- `secret`: `SecretStore` trait and token retrieval behavior.
- `settings`: user settings and repository configuration.

Production Rust code should avoid `unwrap()` and `expect()`. Errors should be represented with explicit error types.

## Tauri Adapter Layer

The Tauri layer adapts desktop and mobile shell events into calls against `polarbear-core`.

Tauri commands should:

- Validate and map DTOs.
- Call core services.
- Convert core errors into UI-safe responses.
- Own application state wiring.

Tauri commands should not:

- Contain Markdown parsing logic.
- Contain GitHub sync business logic.
- Print secrets or tokens.
- Bypass the `SecretStore` abstraction.

## Frontend Layer

The frontend owns interaction and presentation. It should remain focused on:

- Markdown editing views.
- Live preview and preview modes.
- Mermaid diagram viewer interactions.
- GitHub settings screens.
- Plugin management screens.

The first desktop app uses React, TypeScript, Vite, CodeMirror 6, and Mermaid.

## Plugin Model

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

The MVP uses built-in plugins and metadata-based plugin management. Dynamic third-party plugin loading should wait until the security model, permission model, and sandbox boundaries are mature.

## Mermaid Rendering Flow

1. The Markdown preview detects fenced `mermaid` code blocks.
2. The frontend requests rendering through the Mermaid renderer capability.
3. The rendered diagram appears inline in the preview.
4. The user can open a diagram in a zoomable viewer.
5. The viewer supports zoom, pan, source copy, and SVG export.
6. PNG export remains reserved for a future version.

## GitHub Sync Flow

1. The user configures a GitHub repository and branch.
2. Polarbear reads the GitHub token through `SecretStore`.
3. The sync service lists Markdown files through the GitHub REST API.
4. The user opens and edits a Markdown document.
5. Polarbear prepares an update request with a commit message such as `docs: update {file_path}`.
6. The sync service commits the update back to GitHub.
7. Errors are returned as structured, UI-safe messages.

## Secret Management

Secrets must be isolated behind the `SecretStore` abstraction.

Rules:

- Do not store tokens in plain text configuration files.
- Do not print tokens in logs.
- Do not pass token values into frontend logs or analytics.
- macOS should use Keychain in the future.
- iOS should use Keychain in the future.
- The first MVP may use an in-memory implementation with a clear TODO.

## Error Handling

Polarbear should use explicit error types for core logic. Error messages returned to the UI should be useful without leaking sensitive information.

Error boundaries should distinguish:

- Markdown parsing errors.
- Mermaid rendering errors.
- GitHub authentication errors.
- GitHub API errors.
- Repository configuration errors.
- Secret access errors.
- File system errors.

## Testing Strategy

- Unit test Rust core domain logic.
- Test plugin registry capability filtering.
- Test settings validation.
- Test sync request construction without real token leakage.
- Add frontend component tests once the UI stack is fully wired.
- Add integration tests around Tauri commands after command boundaries stabilize.

## Roadmap

### MVP

- Local Markdown open and save.
- Markdown live preview.
- Mermaid rendering.
- Mermaid zoom viewer.
- Built-in plugin registry.
- GitHub settings page.
- GitHub file read and update skeleton.

### Next

- GitHub branch switcher.
- Local Git repository support.
- Markdown search.
- Document outline.
- Export PDF.
- Export HTML.
- Export PNG for diagrams.
- More plugin capabilities.

### Future

- AI-assisted writing.
- GitHub Pull Request editing.
- Team knowledge base mode.
- Document publishing.
- Custom plugin marketplace.
