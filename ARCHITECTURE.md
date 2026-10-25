# Polarbear Architecture

## Workspace Layout and Preview Ownership

Desktop layout preferences live in the existing versioned user settings (v5).
The App-level preference hook commits user intent; the shell-level resize hook
owns temporary pointer/RAF/capture state and effective sizes. Pure constraints
preserve center space, compress sides, then temporarily hide right before left.
Only user actions persist dimensions. Editor instances, document revisions and
undo history do not belong to layout. Reset uses `view.resetLayout` in the existing
Command Registry, Settings and native menu.

Preview resource boundaries come from MarkdownIt tokens, not a second image/fence
regex. One rendered HTML tree retains list, quote and table structure; generation-
owned React portals render resource slots. Existing diagram queues, sanitized SVG,
asset resolution and explicit PlantUML network consent remain authoritative.

Polarbear is a local-first Markdown editor built with Rust, Tauri, and TypeScript. The current desktop release targets are macOS and Windows. An isolated, experimental iPhone reader lives in `apps/ios`; it is not a mobile port of the desktop editor or a published App Store application.

For the release verification baseline and remaining acceptance limits, see
[Desktop v0.9.3](docs/releases/v0.9.3.md). Feature plans and historical reports
are indexed in [the documentation guide](docs/README.md).

The architecture is designed around a simple rule:

> React features own interaction and presentation.
> Feature adapters own browser and Tauri integration.
> Rust services own native IO, secure storage, and remote synchronization.
> Tauri commands are typed entry points, not a second application architecture.

## Goals

- Provide a calm local-first Markdown writing workspace.
- Keep Markdown editing, Mermaid rendering, repository sync, export, and settings as separate capabilities.
- Make feature behavior testable without a running Tauri shell.
- Keep application state explicit and auditable.
- Keep desktop behavior stable while validating the independent iPhone reader on simulators and devices.
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
          memory/
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
          memory_admin.rs
          native_pinch.rs
          secret_store.rs
    ios/
      src/library/
      src/reader/
      src/ui/
      src-tauri/reader-plugin/ios/Sources/
      tests/
  packages/
    reader-core/src/
```

`apps/desktop` is the desktop React application. Its Rust crate remains the only member of the root Cargo workspace. `apps/ios/src-tauri` owns a separate Cargo workspace, lockfile and mobile entry point so mobile dependencies do not enter the desktop native build. Root npm scripts still target Desktop. Earlier unused `polarbear-core` and `polarbear-tauri` prototype crates remain removed.

## Module Responsibilities

| Module | Responsibility |
|---|---|
| `apps/desktop` | React and TypeScript user interface plus Tauri and frontend scripts |
| `apps/desktop/src/features` | Feature-owned UI, models, hooks, configuration, and adapters |
| `apps/desktop/src/shared` | Stable cross-feature contracts: i18n, settings, events, constants, and Tauri invocation |
| `apps/desktop/src/shared/commands` | Stable command IDs and execution payload contracts |
| `apps/desktop/src/commands` | Command metadata, native menus, global shortcuts, and keybinding resolution |
| `apps/desktop/src-tauri` | Native shell plus filesystem, secure storage, export, Cloud Sync, and the versioned Memory Engine Admin API adapter |
| `apps/ios` | Read-only mobile library, reader UI, settings and platform adapters |
| `apps/ios/src-tauri/reader-plugin` | Security-scoped iOS document import, immutable snapshots and confined local resource reads |
| `packages/reader-core` | Pure Markdown presentation model and collection-relative path validation |

## iPhone Reader Boundary

The reader imports snapshots rather than linking to arbitrary desktop paths. Markdown and
supported images are copied into a private native collection after size, encoding and path
validation. Publication is atomic, and the bridge exposes no source-file write operation.
The browser preview uses an IndexedDB adapter to exercise the same read-only UI contract.

The mobile shell reuses the existing property-file i18n provider, command labels, logo and
pure Mermaid rendering modules. It does not import the desktop App, CodeMirror editor,
clipboard implementation, Git services or Memory Engine. Further sharing must extract
tested, platform-neutral code rather than importing additional desktop services.

Remote images and PlantUML rendering are disabled. iCloud may download a file only through
an explicit user action in the native Files picker. No new synchronization service, Node
runtime, direct Memory database access or mobile background daemon is introduced.

The iOS target registers Markdown document Open In support through its own plist.
OS-delivered URLs go directly to the native reader plugin's coordinated snapshot
import, not through a WebView arbitrary-path API. An acknowledged native inbox bridges
cold-start and warm-open delivery to the reader UI. This does not add a Share Extension
or change desktop file associations.

See [the iPhone reader implementation guide](apps/ios/README.md) for startup, limits,
verification and deferred capabilities. Mobile milestones use `ios-v*` tags and a separate
quality workflow; the desktop release workflow is unchanged.

## Reading Tools Boundary

Desktop selection translation uses the bundled BrowserMT Bergamot engine and
English-to-Chinese model in a local worker. It does not depend on Apple Translation,
installed Apple language packs, a running Vocab app, or a first-run model download.
Vocab remains the owner of dictionary senses, pronunciation data, and vocabulary
membership through its existing IPC boundary. Native installed-voice speech is
separate from translation. See [Desktop Vocabulary Capture](docs/planning/desktop-vocab-reading.md)
for packaging, cancellation, integrity checks, and terminology limits.

The standalone iPhone reader has a different native implementation: installed-only
Apple Translation on iOS 26+, installed-voice speech, the system dictionary, and
an explicit file export/import handoff for pending Vocab captures. Older supported
iOS versions retain the other reading tools but cannot run that translation API.
The Desktop bundled-engine change does not replace this iPhone boundary. See
[the iPhone Reading Assistant](docs/planning/iphone-reading-assistant.md).

## Platform Targets

Current release targets:

- macOS desktop app.
- Windows desktop app.

Planned targets:

- iOS distribution, after physical-device validation and signing; the reader target is initialized.
- Linux.
- Android.

Platform rules:

- Use Tauri v2 and preserve portable boundaries where practical.
- Keep UI responsive for desktop and mobile screen sizes.
- Keep macOS-only APIs isolated in platform modules such as `native_pinch.rs`.
- Put platform-specific frontend behavior behind feature adapters.
- Keep GitHub and GitLab sync on authenticated provider APIs so it does not require a local Git executable.
- Treat local file access as an adapter capability; the iPhone reader uses sandboxed document access.
- Keep Mermaid rendering in the WebView layer; the iPhone reader reuses the pure rendering modules.
- Do not use dynamic native library loading for MVP plugins.
- Keep Tauri commands thin and free of platform-specific business logic.

## Rust Backend

The Rust backend owns native capabilities that cannot or should not run in the WebView: filesystem access, file watching, secure token storage, native dialogs, diagram file export, Cloud Sync persistence, remote provider requests, and authenticated access to the local Memory Engine Admin API. Desktop must never read or write Memory Engine storage directly. Platform-neutral logic should be extracted into focused modules inside `apps/desktop/src-tauri/src` only when the running application uses it.

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
- Contain repository sync business logic.
- Print secrets or tokens.
- Bypass `secret_store` for repository credentials.
- Depend on macOS-only behavior when the command contract should remain portable to a future iOS target.

## Frontend Layer

The frontend owns interaction and presentation. It should remain responsive across desktop and mobile layouts, and focused on:

- Markdown editing views.
- Live preview and preview modes.
- Mermaid diagram viewer interactions.
- GitHub and GitLab settings screens.
- Workspace and Cloud Sync settings screens.
- Context and Memory administration screens backed by the versioned Admin API.

The first app shell uses React, TypeScript, Vite, CodeMirror 6, and Mermaid through Tauri WebView. Mermaid rendering stays in the WebView layer to preserve portability to a future iOS target.

## Extension Model

Polarbear does not currently expose a runtime plugin API. Mermaid, PlantUML, repository sync, and export are built-in features with explicit adapters. A plugin system should not be introduced until permissions, versioned contracts, and sandboxing are designed; empty registries or metadata-only plugin layers are not acceptable substitutes.

## Mermaid Rendering Flow

1. Live Edit or Markdown preview detects fenced `mermaid` code blocks.
2. The frontend requests rendering through the Mermaid renderer capability.
3. The rendered diagram appears inline in the preview.
4. The user can open a diagram in a zoomable viewer.
5. The viewer supports zoom, pan, source copy, and SVG or PNG export.
6. SVG and PNG export reuse the sanitized rendered diagram.

Mermaid rendering should remain in the WebView layer rather than platform-native drawing code so it can be reused by a future iOS target.

## Repository Sync Flow

1. The user configures a GitHub or GitLab repository and branch.
2. Polarbear reads the provider token through the Rust `secret_store` module.
3. Freeze the remote commit and enumerate content at that commit.
4. `sync_plan` compares the common baseline, fresh local manifest and frozen remote
   snapshot, including deletions. Divergent paths stop ordinary sync before writes.
5. Downloads compare the planned local digest under the document IO/coordination
   lock before replacing or deleting a file.
6. GitHub uses GraphQL `createCommitOnBranch.expectedHeadOid` for a conditional
   multi-file commit. GitLab uses a batch commit with affected files' `last_commit_id`
   read at the frozen commit. This is a file-level guard, not whole-branch CAS.
7. Only acknowledged bytes advance the baseline. Unknown responses leave the old
   baseline intact; retry compares snapshots rather than blindly uploading. Each
   successful download is checkpointed independently.

`sync_coordinator` owns these rules; `SyncIo` separates provider/storage effects.
Native repository admission serializes operations because persistence/progress
currently has one active run and whole-binding writes. Busy requests fail explicitly.
Neither provider force-updates a branch or fetches a fresh version to bypass conflict.

Digests use `sha256:v1:<64 lowercase hex digits>`. Legacy baselines migrate from
their encoded original bytes in one transaction, never from current local/remote
content. Derived caches may be invalidated; outbox entries are retained. This is
not secure erasure of SQLite pages/WAL. Local scans hash file bytes and prune
excluded directories before descent. Performance is a separate measurement gate;
publication memory remains proportional to changed content and API size limits
can reject a large batch without advancing its baseline.

Provider contracts: [GitHub conditional commit](https://docs.github.com/en/graphql/reference/commits#createcommitonbranchinput),
[GitLab batch commit](https://docs.gitlab.com/api/commits/#create-a-commit).
Local protocol tests do not establish actual hosted-service acceptance.

## Memory Engine Boundary

Polarbear Desktop integrates with Polarbear Memory only through the versioned local Memory Engine Admin API. `memory_admin.rs` discovers or starts the managed runtime, authenticates the local request, binds it to the current Git workspace, and returns UI-safe responses. Desktop must not depend on Memory database schemas or access `memory.db` directly.

## Local File Access

Local-first behavior must account for both desktop file systems and iOS sandbox rules.

- macOS can use file picker and direct document access through Tauri adapters.
- A future iOS target must use sandbox-aware document access and app-scoped storage.
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
- Repository-provider authentication errors.
- GitHub and GitLab API errors.
- Memory Engine availability, authorization, and contract errors.
- Repository configuration errors.
- Secret access errors.
- File system errors.

## Testing Strategy

- Unit test command/keybinding/settings and pure feature logic.
- Test Cloud Sync diff and persistence logic without real token leakage.
- Add frontend interaction tests around editor and workspace regressions.
- Add integration tests around Tauri commands after command boundaries stabilize.

## Linked Apple Document Foundation

`packages/apple-document-store` is the shared Foundation persistence foundation
for planned iCloud folder editing. Desktop's native build and the iOS plugin
include the same bookmark, coordinated access, revision, session, and draft code.
It is not yet connected to either application's editing UI. Existing Desktop
saves and immutable Reader imports remain separate and unchanged.

See [the implementation TRD](docs/planning/icloud-markdown-sync.md) for the
remaining adapter, mobile editor, recovery, provider lifecycle, and physical-device
acceptance gates. A successful coordinated local save is not cloud synchronization.

## Current Architecture Gaps

- The iOS Reader builds and has simulator coverage; physical-device iCloud editing
  and distribution are not yet validated.
- Complete-document PDF and HTML export are not implemented.
- Native command integration and release packaging need broader automated coverage.
- `App.tsx`, `TyporaLiveEditor.tsx`, and the Tauri `main.rs` still contain responsibilities that should move into focused feature services incrementally.

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

### Desktop Navigation and Settings Ownership

- Every new main window starts in Workspace. Context is an explicit navigation
  destination, not a saved launch preference. A selected Context tab must not
  cause the next launch to bypass the editor.
- `shared/settings/userSettings.ts` owns application preferences. The canonical
  settings document takes precedence over legacy per-key preferences, including
  explicit `system` values. Initialization applies preferences without writing
  resolved defaults back. Storage and local change notifications synchronize
  mounted views; system theme changes are resolved without changing preference.
- Context project configuration is read and saved only through `projects.config`
  and `projects.config_update` in the Memory Engine Admin API. The UI draft is
  not authoritative: unloaded settings cannot be saved, refresh cannot discard
  a dirty draft, and an earlier refresh cannot overwrite a newer saved response.
  Confirmed saves are reloaded on Context remount. No Desktop database access or
  new project-settings migration is introduced.
- `features/workspace/recentDocuments.ts` owns a bounded, versioned history of
  the 20 most recently opened Markdown paths and access times. Successful native
  opens and loaded tab activations record metadata, not content or permissions.
  Reopening uses the existing workspace adapter; stale paths stay removable and
  show an access error. Pinning and automatic relocation are deferred.
- `shared/ui/SettingsSection.tsx` supplies layout only. Translation preferences
  remain in the settings store; caption capture state remains native runtime
  state. Settings never restores an active recording at launch. Audio source
  and presentation preferences persist independently of recording lifecycle.
- The current Desktop file-access implementation does not provide security-scoped
  bookmarks. Recent history does not simulate grants: sandboxed distribution and
  file relocation require a future native bookmark adapter, not path-based bypasses.

Validation: `navigation-settings.spec.ts` exercises the real App shell and feature
components with mocked native IPC, including reload, remount, failed writes,
cross-window preference updates, and narrow light/dark layouts. It does not prove
native Memory Engine disk durability or macOS permission behavior.

### Next Migration Gates

1. Add regression coverage around file open/save, tab close with unsaved changes, Cloud Sync, editor input, and global zoom before splitting `App.tsx` or `TyporaLiveEditor.tsx`.
2. Replace unstructured Tauri string errors with stable error codes and typed payloads behind feature adapters.
3. Resolve the plaintext repository-token fallback with a migration that preserves existing Keychain users and never exposes a token to the WebView.
4. Keep the existing restrictive Content Security Policy and continue hardening remote diagram SVG handling before enabling broader remote content.
5. Move workspace, repository sync, and export business logic out of `src-tauri/src/main.rs` incrementally; do not create parallel unused implementations.

Large-file splits must be behavior-preserving and vertical. Do not rewrite the editor, Cloud Sync, zoom, or workspace subsystems in one change.

