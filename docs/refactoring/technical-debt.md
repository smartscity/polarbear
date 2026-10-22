# Technical Debt Register

Locations are repository-relative; symbols anchor evidence across line movement. Priorities reflect observed impact, not size alone. OPEN does not mean safe to implement without additional tests.

| ID | Category | Location | Evidence | Impact | Priority | Action | Risk | Validation | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TD-01 | State | useContextOsSession.run / updateConfig | Delayed A save updates B config; browser regression failed | Incorrect current project state | P1 | REFACTOR | Medium | Deferred completion, concurrent actions, remount, existing settings tests | IMPLEMENTED |
| TD-02 | Lifecycle | useWorkspaceDocumentRevision.checkRevision | Missing callback after disposal reproduced by deferred promise | Stale file action/status | P1 | REFACTOR | Low | Resolve read after cleanup | IMPLEMENTED |
| TD-03 | Duplication / Resources | diagramPreviewWidgets render maps | Four maps, no eviction; failures permanently cached | Retained source/SVG growth and unrecoverable transient errors | P2 | MERGE | Medium | In-flight sharing, LRU/count/size bounds, retry, clipboard/UI regressions | IMPLEMENTED |
| TD-04 | Error handling | App -> AppShell -> Sidebar.statusMessage | Prop consumed nowhere in Sidebar render | File/clipboard failures invisible | P1 | REFACTOR | Low | Native open failure visible in sidebar | IMPLEMENTED |
| TD-05 | State | ios/reader/readingState.readPositions | Unvalidated values sorted by openedAt | One invalid record blocks position save | P1 | REFACTOR | Low | Malformed record plus valid history and new save | IMPLEMENTED |
| TD-06 | Architecture | App.tsx | File IO, tabs, zoom, commands and dialogs share component state | High regression blast radius | P1 | REFACTOR | High | File session failure/switch/unsaved-close tests before extraction | OPEN |
| TD-07 | Architecture | src-tauri/src/main.rs | Filesystem, repository and native menu in binary entrypoint | Changes require broad native review | P2 | REFACTOR | High | Extract filesystem contract only after fault/concurrency suite | OPEN |
| TD-08 | Data safety | main.rs::atomic_write / save_markdown_file_content | Read revision and rename are separate; temp inode permissions not copied | External-write race and file metadata compatibility risk | P1 | INVESTIGATE | High | Two writers plus mode/ACL and crash tests on temporary files | OPEN |
| TD-09 | Resources | commands/useNativeAppMenu.ts | New native menu/check items each effect; no close call | Possible resource accumulation, not yet measured | P2 | INVESTIGATE | Medium | Native resource counts during state changes; menu action regression | OPEN |
| TD-10 | Resources | editor/table/tableLayoutState.ts | Module-global map; no lifecycle release | Width identity/lifetime grows across documents | P2 | INVESTIGATE | Medium | Multi-document resize and undo identity tests | OPEN |
| TD-11 | Error handling | repository/useRepositorySyncProgress.ts | listen promise has no rejection handler | Subscription failure may be unhandled | P2 | REFACTOR | Low | Rejected registration and late unlisten | OPEN |
| TD-12 | Compatibility | userSettings.ts and debugSettings.ts | Legacy keys retained deliberately; canonical settings now win | Removing migrations loses preferences | P2 | KEEP | High if deleted | Existing settings migration tests | RETAINED |
| TD-13 | Build | caption research scripts/native variants | Referenced by qualification workflows and build switches | Uncertain dead-code false positives | P2 | KEEP | High if deleted | Qualification asset/manifest references | RETAINED |
| TD-14 | Test coverage | memory_admin.rs ignored Engine E2E | Requires explicit local Engine runtime/CLI | Native mock tests do not prove real Engine behavior | P1 | INVESTIGATE | Medium | Isolated Engine fixture with actual API | OPEN |
| TD-15 | Dependencies | Desktop package.json rollup and shared reader imports | Runtime/build/tooling roles differ; iOS whitelist exists | Speculative removal can change builds | P3 | INVESTIGATE | Medium | Dependency tree, lock provenance, both platform builds | OPEN |
| TD-16 | Build hygiene | .gitignore and tracked .idea files | Duplicate ignores and Markdown fences; ignored files already tracked | Noise, little product benefit | P3 | INVESTIGATE | Low | Confirm team metadata policy before removing | OPEN |
| TD-17 | Performance | Mermaid/main chunks and editor widgets | Build emits chunk-size warning, no measured typing slowdown | Possible startup/parse costs | P2 | INVESTIGATE | Medium | Reproducible document trace and cold/warm timing before change | OPEN |
| TD-18 | UI ownership | ContextWorkspace drafts | Browser regression reproduced A draft displayed under B | Draft from A must not be saved as B | P1 | REFACTOR | Medium | Keyed workspace boundary and cross-project draft test | IMPLEMENTED |
| TD-19 | Dead Code | styles/base.css plugin-list/plugin-status family | Search across app/native/test roots found CSS definitions only | Obsolete plugin UI styles | P3 | DELETE | Low | Production build and browser screenshot/regressions | REMOVED |
| TD-20 | Dependencies | desktop/package.json | Source AST scan found ten import sites missing owning package declarations | Hoisting-dependent builds | P2 | REFACTOR | Low | Workspace dependency test, lock agreement, frontend builds | IMPLEMENTED |
| TD-21 | Resources | DiagramRenderCache pending map | Active work still deduplicated but not concurrency-limited | Very large documents can enqueue many distinct renders | P2 | INVESTIGATE | Medium | Large-document workload with main-thread trace before scheduler changes | OPEN |

Path shorthand: Desktop source locations are under `apps/desktop/src`; `main.rs` and `memory_admin.rs` are under `apps/desktop/src-tauri/src`; iOS reader paths are under `apps/ios/src`. Validation results are in [the report](refactoring-report.md).

No confirmed unused public contract, model asset or production feature is deleted. No unsupported claim of an exploitable P0 or measured memory leak is made. Potential data risks remain explicit rather than being hidden in a completed checklist.
