# Polarbear Architecture

Polarbear is a local-first Markdown editor built with Rust, Tauri, and TypeScript. It targets macOS and iOS first.

The architecture is designed around a simple rule:

> React features own interaction and presentation.
> Feature adapters own browser and Tauri integration.
> Rust services own native IO, secure storage, and remote synchronization.
> Tauri commands are typed entry points, not a second application architecture.

## Goals

- Provide a calm local-first Markdown writing workspace.
- Keep Markdown editing, Mermaid rendering, GitHub sync, export, and settings as separate capabilities.
- Make feature behavior testable without a running Tauri shell.
- Keep application state explicit and auditable.
- Prepare for macOS and iOS first, with room for Windows, Linux, and Android later.
- Use Tauri v2 with mobile compatibility.
- Keep UI and command boundaries suitable for desktop and mobile screen sizes.

## Non-Goals for MVP

- Dynamic third-party plugin execution.
- Dynamic native library plugin loading.
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
  apps/
    desktop/
      package.json
      src/
        app/layout/
        commands/
        features/
          diagram/
          editor/
          preview/
          repository/
          theme/
          workspace/
          zoom/
        shared/
          commands/
          config/
          constants/
          events/
          i18n/
          settings/
          tauri/
      src-tauri/
        Cargo.toml
        src/
          app_zoom.rs
          cloud_sync_store.rs
          ipc_contracts.rs
          main.rs
          native_pinch.rs
          secret_store.rs
```

`apps/desktop` is the React application. `apps/desktop/src-tauri` is the only Rust application crate and packages the WebView UI. Earlier unused `polarbear-core` and `polarbear-tauri` prototype crates were removed because they duplicated the documented architecture without participating in the running product.

## Module Responsibilities

| Module | Responsibility |
|---|---|
| `apps/desktop` | React and TypeScript user interface plus desktop/mobile app scripts |
| `apps/desktop/src/features` | Feature-owned UI, models, hooks, configuration, and adapters |
| `apps/desktop/src/shared` | Stable cross-feature contracts: i18n, settings, events, constants, and Tauri invocation |
| `apps/desktop/src/shared/commands` | Stable command IDs and execution payload contracts |
| `apps/desktop/src/commands` | Command metadata, native menus, global shortcuts, and keybinding resolution |
| `apps/desktop/src-tauri` | Native shell plus filesystem, secure storage, export, and Cloud Sync services |

## Platform Targets

MVP targets:

- macOS desktop app.
- iOS app, experimental but structurally supported.

Future targets:

- Windows.
- Linux.
- Android.

Platform rules:

- Use Tauri v2 and keep mobile compatibility in every app-shell decision.
- Keep UI responsive for desktop and mobile screen sizes.
- Keep macOS-only APIs isolated in platform modules such as `native_pinch.rs`.
- Put platform-specific frontend behavior behind feature adapters.
- Keep GitHub sync on the GitHub REST API so it can run on iOS.
- Treat local file access as an adapter capability because iOS uses sandboxed document access.
- Keep Mermaid rendering in the WebView layer so it works on macOS and iOS.
- Do not use dynamic native library loading for MVP plugins.
- Keep Tauri commands thin and free of platform-specific business logic.

## Rust Backend

The Rust backend owns native capabilities that cannot or should not run in the WebView: filesystem access, file watching, secure token storage, native dialogs, diagram file export, Cloud Sync persistence, and remote provider requests. Platform-neutral logic should be extracted into focused modules inside `apps/desktop/src-tauri/src` only when the running application uses it.

Production Rust code should avoid `unwrap()` and `expect()`. New command contracts should use serializable request/response structures and stable error codes; existing string errors are migrated incrementally behind frontend feature adapters.

## Tauri Command Boundary

The Tauri command layer adapts typed frontend requests into Rust services.

Tauri commands should:

- Validate and map DTOs.
- Call focused backend services.
- Convert service errors into UI-safe responses.
- Own application state wiring.
- Delegate platform-specific work to adapter modules.

Tauri commands should not:

- Contain Markdown parsing logic.
- Contain GitHub sync business logic.
- Print secrets or tokens.
- Bypass `secret_store` for repository credentials.
- Depend on macOS-only behavior when the command contract should also work on iOS.

## Frontend Layer

The frontend owns interaction and presentation. It should remain responsive across desktop and mobile layouts, and focused on:

- Markdown editing views.
- Live preview and preview modes.
- Mermaid diagram viewer interactions.
- GitHub settings screens.
- Workspace and Cloud Sync settings screens.

The first app shell uses React, TypeScript, Vite, CodeMirror 6, and Mermaid through Tauri WebView. Mermaid rendering stays in the WebView layer for macOS and iOS compatibility.

## Extension Model

Polarbear does not currently expose a runtime plugin API. Mermaid, PlantUML, repository sync, and export are built-in features with explicit adapters. A plugin system should not be introduced until permissions, versioned contracts, and sandboxing are designed; empty registries or metadata-only plugin layers are not acceptable substitutes.

## Mermaid Rendering Flow

1. The Markdown preview detects fenced `mermaid` code blocks.
2. The frontend requests rendering through the Mermaid renderer capability.
3. The rendered diagram appears inline in the preview.
4. The user can open a diagram in a zoomable viewer.
5. The viewer supports zoom, pan, source copy, and SVG export.
6. SVG and PNG export reuse the sanitized rendered diagram.

Mermaid rendering should remain in the WebView layer rather than platform-native drawing code, so the same behavior can run on macOS and iOS.

## GitHub Sync Flow

1. The user configures a GitHub repository and branch.
2. Polarbear reads the provider token through the Rust `secret_store` module.
3. The sync service lists Markdown files through the GitHub REST API.
4. The user opens and edits a Markdown document.
5. Polarbear prepares an update request with a commit message such as `docs: update {file_path}`.
6. The sync service commits the update back to GitHub.
7. Errors are returned as structured, UI-safe messages.

The sync flow should avoid shelling out to local Git for MVP because GitHub REST API access is portable to iOS.

## Local File Access

Local-first behavior must account for both desktop file systems and iOS sandbox rules.

- macOS can use file picker and direct document access through Tauri adapters.
- iOS must use sandbox-aware document access and app-scoped storage.
- Frontend workspace features depend on `tauriWorkspaceAdapter`, not raw `invoke` calls.
- Tauri commands adapt platform file access into document operations.
- Shared Markdown logic must not assume arbitrary absolute paths are available on every target.

## Secret Management

Secrets must be isolated behind `secret_store`.

Rules:

- Do not store tokens in plain text configuration files.
- Do not print tokens in logs.
- Do not pass token values into frontend logs or analytics.
- Release builds require the platform Keychain.
- A plaintext fallback is permitted only in debug builds and must never be exposed to the WebView.

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

- Unit test command/keybinding/settings and pure feature logic.
- Test Cloud Sync diff and persistence logic without real token leakage.
- Add frontend interaction tests around editor and workspace regressions.
- Add integration tests around Tauri commands after command boundaries stabilize.

## Roadmap

### MVP

- Local Markdown open and save.
- Markdown live preview.
- Mermaid rendering.
- Mermaid zoom viewer.
- GitHub and GitLab Cloud Sync.

### Next

- GitHub branch switcher.
- Local Git repository support.
- Markdown search.
- Document outline.
- Export PDF.
- Export HTML.
- Export PNG for diagrams.
- Knowledge indexing foundations.

### Future

- AI-assisted writing.
- GitHub Pull Request editing.
- Team knowledge base mode.
- Document publishing.
- Custom plugin marketplace.

## Engineering Governance Baseline

The target boundaries above are directional. The current implementation is still being migrated from a large application shell and a large Tauri entry point; new work must not assume that every target boundary is already enforced.

The following frontend modules are the current sources of truth:

- `src/shared/commands/appCommandIds.ts`: application command identifiers.
- `src/shared/commands/appCommandTypes.ts`: command execution contracts.
- `src/commands/appCommandRegistry.ts`: default accelerators and shortcut metadata.
- `src/shared/i18n/locales`: user-visible language resources and message keys.
- `src/shared/tauri/commandIds.ts`: frontend Tauri command identifiers.
- `src/shared/events/appEvents.ts`: cross-module and Tauri event identifiers.
- `src/shared/constants/storageKeys.ts`: browser storage keys.
- `src/shared/config/productConfig.ts`: product identity and links.
- `src/features/*/*Config.ts`: feature-owned defaults that are not user settings.

Dependency direction for new frontend work is:

```text
app shell -> feature UI/hooks -> feature service/adapter -> shared Tauri boundary
                         \-> feature model/config
shared must not import a feature
```

ESLint enforces that `shared` cannot import `features` or `app`, and that a feature cannot import the application composition layer.

Configuration and state are deliberately separate:

- Build metadata belongs in Cargo, Tauri, Vite, or package configuration.
- Application defaults belong in typed TypeScript or Rust configuration near the owning feature.
- User settings belong in a validated, versioned settings store.
- Workspace settings, when introduced, must be explicit and portable.
- Current document, selection, scroll position, zoom gesture state, and open dialogs are runtime state, not configuration.

### Next Migration Gates

1. Add regression coverage around file open/save, tab close with unsaved changes, Cloud Sync, editor input, and global zoom before splitting `App.tsx` or `TyporaLiveEditor.tsx`.
2. Replace unstructured Tauri string errors with stable error codes and typed payloads behind feature adapters.
3. Resolve the plaintext repository-token fallback with a migration that preserves existing Keychain users and never exposes a token to the WebView.
4. Add a restrictive Content Security Policy and sanitize remote diagram SVG before enabling broader remote content.
5. Move workspace, repository sync, and export business logic out of `src-tauri/src/main.rs` incrementally; do not create parallel unused implementations.

Large-file splits must be behavior-preserving and vertical. Do not rewrite the editor, Cloud Sync, zoom, or workspace subsystems in one change.
