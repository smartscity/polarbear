# Mermaid Gantt rendering boundary

## Scope and ownership

This change keeps Markdown, CodeMirror state, clipboard source, and persistence bytes authoritative and unchanged. Only `mermaidRenderer.ts` consumes `prepareGanttSource()` output. Both Markdown preview and live editor widgets use that renderer; rich-copy rendering and the iOS reader also share it. No dependency upgrade, remote rendering, or telemetry is introduced.

| Problem | Pattern | Decision |
| --- | --- | --- |
| Mermaid-specific label grammar and date fallback | Adapter | A stateless Gantt-only render-source adapter owns delimiter recognition and narrow validation. It does not implement a replacement Gantt AST or scheduler. |
| Global mutable Mermaid parser state | Serialized work queue | Reuse `DiagramRenderQueue`, its bounded admission and abort semantics, and one-time initialization. |
| Repeated live widgets | Bounded shared-result cache | Reuse `DiagramRenderCache`; failure results are not cached. Clipboard export remains a separate consumer. |
| React render lifetime | Effect-owned request | One effect owns cancellation, idle scheduling, completion and explicit retry. Result/error state does not trigger another render. |
| Failure presentation | Typed error boundary | Keep source errors separate from engine failures; unexpected exceptions retain `cause` and are reported to the local console. |

## Reproduction and root cause

Resolved local dependencies: Mermaid **11.17.2**, Day.js **1.11.21**, markdown-it **14.3.3**, Playwright **1.63.0**. Both app manifests declare Mermaid `^11.12.1`; that is a range, not the installed version.

The unchanged reproduction lives in `apps/desktop/tests/fixtures/gantt-original.mmd`. Direct execution in Chromium and WebKit reproduced the failure before modification. WebKit reported:

```text
TypeError: undefined is not an object (evaluating 'rawTasks[pos].raw.startTime.type')
compileTask -> compileTasks -> getTasks -> draw
```

The chain is:

1. Preview: `splitMarkdownIntoSegments()` uses markdown-it fence tokens and supplies `token.content` to `MermaidBlock`. Live editing: `previewBlocks` extracts the code-fence source, then `MermaidPreviewWidget` requests rendering. Neither rewrites Gantt labels.
2. `renderMermaidSvg()` initializes Mermaid once with strict security and the existing theme, then renders under the serial queue. Before this fix there was no Gantt preprocessing.
3. Mermaid's Gantt lexer uses `[^:\n]+` for task text. The **first** ASCII colon ends the label, including the colon in `14:40` or `15:08`.
4. `addTask()` calls `parseData()`, which splits metadata at commas and removes leading status tags. On original line 15, the first field begins with `40 ... :milestone`, so it is not a status tag. Four metadata fields remain.
5. `parseData()` handles only one, two or three fields. Its default branch leaves `startTime` unset. Syntactic parsing alone can still succeed.
6. Drawing calls `getTasks()` and `compileTasks()`. `compileTask()` dereferences `raw.startTime.type` without checking it. Failure occurs during **task compilation before timeline layout/SVG completion**, not during Markdown extraction or date-axis formatting.
7. Both UI paths previously displayed `errorMessage(error)`, exposing the implementation exception. Retry submitted exactly the same source.

Independent probes also reproduced the same TypeError with excess metadata and **no colon in the label**. An invalid end value (`nonsense`) instead silently rendered as zero duration. Thus colon replacement alone would not address the observed failure class.

The original dates, explicit ends, Unicode, status flags, nearly 14-day overall extent, and zero-duration milestones rendered successfully once only the two label colons were escaped. Those features are not the root cause.

### Upstream assessment

- [Gantt syntax](https://mermaid.js.org/syntax/gantt.html) defines colon-separated labels and comma-separated metadata.
- [Official entity encoding documentation](https://mermaid.js.org/syntax/flowchart.html#entity-codes-to-escape-characters) documents decimal entity codes. The common Mermaid preprocessing/serialization path supports `#58;`; actual Chromium/WebKit Gantt execution confirms that it displays the original ASCII colon.
- [Gantt lexer](https://github.com/mermaid-js/mermaid/blob/develop/packages/mermaid/src/diagrams/gantt/parser/gantt.jison) still separates labels at the first colon.
- [12.2.0 Gantt database source](https://github.com/mermaid-js/mermaid/blob/mermaid%4012.2.0/packages/mermaid/src/diagrams/gantt/ganttDb.js) retains both the unhandled metadata-count branch and the `raw.startTime.type` dereference. The [release notes](https://github.com/mermaid-js/mermaid/releases) include warnings for invalid end values and missing references, not a fix for this delimiter failure.

A major upgrade is therefore not a demonstrated fix. Resolved packages remain unchanged. Both application manifests now explicitly declare the already-resolved Day.js 1.11.21 dependency, because the shared adapter imports its strict parser directly; the workspace entries in the lockfile reflect those declarations. The newer version was inspected, not installed or runtime-qualified.

## Compatibility policy

- Recognize Gantt after leading comments, init directives, or frontmatter. Leave every other diagram type untouched.
- Skip title, section, configuration, accessibility and click statements. Preserve line count and CRLF in adapter output.
- Identify metadata candidates using strict Day.js parsing with the same `customParseFormat` and `advancedFormat` plugins as Mermaid, supported leading tags, one-to-three fields, durations and dependency expressions. Prefer the native first delimiter when valid; otherwise repair only one unambiguous candidate. Never normalize an invalid date to infer intent.
- Encode colons only in the label as `#58;`. Keep IDs, status flags, dates, duration values and the original metadata suffix unchanged. Existing entities remain unchanged.
- Strictly validate dates and explicit end-before-start errors for custom formats as well as the three original calendar formats. Chromium/WebKit cover `DD/MM/YYYY HH:mm`, `YYYY/MM/DD HH:mm:ss` and `HH:mm` in addition to date-only, minute and second formats. Reject excess/missing metadata and a first task with an implicit start before Mermaid compiles incomplete task data.
- Reject unknown references, duplicate/reserved IDs, cycles and dependency order requiring more than the engine's ten forward-resolution passes. Keep actual task scheduling in Mermaid. Reference lists use the engine's ASCII identifier and space-separated syntax.
- Validate calendar exclusions/inclusions. Reject all weekdays excluded and combinations whose native semantics shift declared ends: with exclusions, only durations or canonical `YYYY-MM-DD` end dates are accepted. Mermaid 11.17.2's `manualEndTime` check only recognizes that date format; `until` or datetime ends can otherwise be extended again by excluded days. An actual dual-engine test exposed an `until` end of October 26 moving to October 28. This is now a localized `calendar` error, not an accepted wrong timeline.
- Bound synchronous work before entering the engine: 50,000 source code units, 200 tasks, 128 colon candidates per task, a conservative 100-year span, 100,000 estimated calendar steps, an exclusion-extension estimate below the upstream 10,000-day cap, and 2,000 estimated explicit axis ticks. Bounds include inclusive end dates. Timelines may be conservatively rejected; these are responsiveness limits, not a wall-clock guarantee. Put `tickInterval` in the Gantt body so it can be validated; explicit configuration declarations are rejected.
- Reject ambiguous delimiters instead of making a semantic guess. Reject epoch-second `dateFormat X`, because this version interprets numeric starts as milliseconds and ends as seconds. Comma-containing dates cannot bypass Gantt's metadata separator. Strict custom format parsing follows [Day.js strict parsing](https://day.js.org/docs/en/parse/string-format/).
- Lines reported by the adapter are one-based **Mermaid block** lines. Upstream parser positions can refer to preprocessed text (frontmatter removal and entities), so the boundary does not invent a Markdown document line or an inaccurate column.

For the original fixture and supported colon cases, the rendered ASCII characters are preserved. This is not a general claim of lossless support for every Mermaid label: HTML-like text, entity-looking literals and reserved keywords retain upstream behavior; ambiguous custom syntax may be rejected.

## Rendering and failure lifecycle

`renderMermaidSvg()` creates a full-width, hidden temporary container and removes it in `finally`, including parse/layout/serialization failure. Each invocation uses a unique internal SVG ID, avoiding collision with an existing displayed SVG. `suppressErrorRendering` prevents an extra upstream error SVG. Sanitization remains mandatory.

The preview pane participates in the workspace's flex layout, and the SVG wrapper occupies available width; otherwise a percentage-sized Gantt SVG can fall back to a 300-pixel intrinsic width inside the centered grid. Browser checks cover the displayed width as well as SVG existence.

`MermaidBlock` admits a visible block once, disconnects its observer, and owns each render in one effect. Source changes, unmount and retry cancel the previous consumer. A late completion cannot update a cancelled effect. The earlier observer watched a target replaced by error UI, and result/error-dependent effects could race with retry; both mechanisms are removed. There is no automatic failure retry. Live widgets retain their existing abort owner and cache subscriber isolation.

Known source errors display localized syntax/date/dependency/calendar/limit messages and an accurate block line when available. Both error surfaces expose the original source. Engine defects display a distinct message, preserve the underlying exception as `cause`, and log locally. No network diagnostics are sent.

No separate `mermaid.parse()` call was added before `render()`. Paste validation still has its own explicit parse API. Render initialization remains once per module; the adapter is stateless, and completed live SVG retention remains bounded by the existing cache. A running synchronous third-party render cannot be preempted by an AbortSignal; cancellation prevents obsolete delivery and bounds queued work, not arbitrary engine CPU time.

## Changed files

Paths below are relative to `apps/desktop/` unless stated otherwise.

| Files | Responsibility |
| --- | --- |
| `src/features/diagram/ganttSourceAdapter.ts`, `ganttDatePolicy.ts`, `ganttScheduleValidation.ts` | Gantt identification, delimiter adaptation, strict calendar parsing, graph validation and bounded work |
| `src/features/diagram/mermaidRenderError.ts` | Typed source/engine failures and localized presentation |
| `src/features/diagram/mermaidRenderer.ts`, `mermaidDiagramConfig.ts` | Shared adapter integration, one-time initialization, unique IDs and temporary DOM ownership |
| `src/features/diagram/MermaidBlock.tsx` | Effect-owned render lifecycle, manual retry and error UI |
| `src/features/editor/widgets/diagramPreviewWidgets.ts` | Live-editor error formatting and original-source disclosure |
| `src/styles/base.css`, `src/styles/live-codemirror.css` | SVG wrapper and preview pane width ownership |
| `src/shared/i18n/locales/en.properties`, `zh-CN.properties` | Synchronized localized source, calendar, dependency, work-limit and engine diagnostics |
| `src/features/diagram/ganttSourceAdapter.test.ts`, `mermaidRenderError.test.ts` | Adapter semantics and retained unexpected-error diagnostics |
| `tests/fixtures/gantt-original.mmd` | Original reproduction, unchanged inside the fixture |
| `tests/browser/gantt.spec.ts`, `gantt-save.spec.ts`, `playwright.gantt.config.ts` | Real rendering, lifecycle, task data, clipboard and file-backed application round-trip checks |
| `scripts/test-gantt-webview.*`, `tests/browser/nativeGanttProbe.ts` | Production renderer in an isolated native macOS WKWebView with offline CSP |
| `tests/performance/gantt.spec.ts`, `playwright.gantt-performance.config.ts` | Opt-in bounded local latency measurement through Markdown extraction and real SVG rendering |
| `apps/ios/tests/browser/gantt.spec.ts`, `apps/ios/playwright.gantt.config.ts` (repository paths) | Mobile reader import, SVG, source and reopen regression in two browser engines |
| Both app manifests and repository `package-lock.json` | Declare the existing Day.js runtime dependency explicitly, with no resolved version changes |
| Repository `docs/README.md`, this report and `docs/engineering/evidence/2026-10-30-gantt/` | Discoverable implementation explanation and local evidence |

## Verification

Commands (using the installed Node toolchain):

```sh
npm run typecheck
npm run lint
npm test
npm run test:ui --workspace apps/desktop -- --config playwright.gantt.config.ts
npm run test:ui --workspace apps/desktop
npm run build
```

The dedicated browser configuration runs the same existing Playwright infrastructure in Chromium and WebKit. It includes the original fixture, all eleven compiled timestamps and flags, SVG milestone positioning, long-duration width, source copy, live and preview rendering, error/retry recovery, rapid edits, queue admission/cancellation, disposed subscribers, and ten non-Gantt diagram families.

`gantt-save.spec.ts` runs the real App open/Save As/close/reopen flow. Its Tauri transport is replaced by a file-backed test bridge, which writes and rereads real test-output files and checks exact Markdown bytes. This proves frontend persistence payload integrity and file round-trip behavior, not a packaged Tauri binary or native permission dialog.

Initial implementation results (before the risk-closure follow-up):

| Check | Result |
| --- | --- |
| TypeScript | PASS (`npm run typecheck`) |
| ESLint | PASS (`npm run lint`) |
| Unit tests | PASS: 393 tests in 69 files |
| Node engineering checks | PASS: 45 tests |
| Real-render integration and browser checks | PASS: 42 Chromium/WebKit cases, including compiled task timestamps, SVG geometry and file-backed Save As/reopen |
| Complete Desktop Playwright suite | PASS: 173/173 on a fresh Vite server, 5.6 minutes; the first stale-server attempt is retained separately |
| Production build | PASS: Vite production bundle; existing large-chunk warning remains |
| Native installed-package acceptance | NOT RUN; browser/WebKit and file-backed IPC evidence must not be promoted to a native package result |

Evidence is retained in [2026-10-30-gantt](evidence/2026-10-30-gantt/README.md), including the [actual WebKit preview](evidence/2026-10-30-gantt/original-webkit.png) and [fixed SVG](evidence/2026-10-30-gantt/original.svg).

The first full desktop UI run had 172 passes and one recent-menu test failure. Its dynamic test imports used an unversioned `I18nProvider.tsx`, while Vite's existing HMR graph supplied the hook with a timestamped provider module. The trace showed `useI18n must be used inside I18nProvider`, followed by zero observed subscriptions. An isolated rerun on the stale server reproduced it; after shutting down that owned server, the unchanged recent-menu suite passed 4/4 on a fresh server. No product or test assertion was changed to address this environment condition. The initial and diagnostic rerun outputs are retained alongside the final clean-server full-suite result.

## Risk-closure verification

The follow-up expands the adapter to strict custom formats, graph integrity and bounded rendering work, and adds native WebView, mobile reader and performance evidence. `calendar-combination-first-attempt.txt` retains the two failing tests that revealed the upstream exclusion/end-time interaction; the regression now rejects that unsafe combination and separately verifies correct duration-based scheduling, explicit canonical ends, implicit tasks and `until` without exclusions.

Additional commands:

```sh
npm run test:native-gantt --workspace apps/desktop
npm run test:gantt:performance --workspace apps/desktop
npm run test:ui --workspace apps/ios -- --config playwright.gantt.config.ts
npm run typecheck --workspace apps/ios
npm run lint --workspace apps/ios
npm run test --workspace apps/ios
npm run build --workspace apps/ios
```

Final results, with command outputs in the evidence directory:

| Check | Final result |
| --- | --- |
| Desktop TypeScript / ESLint / production build | PASS |
| Desktop unit and engineering checks | PASS: 412 Vitest + 45 Node tests |
| Desktop complete UI suite | PASS: 178/178 |
| Desktop Gantt/lifecycle Chromium and WebKit | PASS: 52/52 |
| Native macOS WKWebView | PASS: 6 cases |
| Mobile TypeScript / ESLint / production build | PASS |
| Mobile unit tests | PASS: 39/39 |
| Mobile complete UI suite (Chromium) | PASS: 12/12 |
| Mobile Gantt Chromium and WebKit | PASS: 2/2 |
| Bounded local performance characterization | PASS: 11/50/200-task fixtures |
| Installed packages / Windows / physical iOS devices | NOT RUN |

The mobile WebKit check uses a disposable persistent browser profile because a direct diagnostic confirmed this macOS Playwright build's ephemeral contexts reject IndexedDB Blob/File writes. The same production library succeeds with a persistent profile; all profiles are deleted after each test. SVG bytes are inspected directly from the generated Blob, without weakening the reader's CSP to allow test fetches.

The native harness bundles the production renderer and runs six cases in real macOS WKWebView under `tauri://localhost`, with network access disabled by CSP, native timeout, source integrity, error recovery and temporary-node cleanup assertions. It is independent of the user's installed app and does not certify an installed Tauri package.

### Bounded performance characterization

One Chromium worker measures Markdown extraction, adapter validation, Mermaid SVG generation and sanitization. Each fixture gets one warmup and five measured runs, with a broad 5-second responsiveness assertion. The JSON report retains source and fixture hashes, OS/CPU/browser versions, host load and macOS power/thermal status. On the final local run:

| Tasks | Warm median | Maximum of five measured runs |
| --- | --- | --- |
| 11, original fixture | 18.7 ms | 20.6 ms |
| 50 | 28.2 ms | 28.7 ms |
| 200 | 85.7 ms | 86.2 ms |

These are local absolute measurements on an Intel i7-9750H, not a before/after comparison, capacity benchmark or device SLA. No thermal/performance warning was recorded; CPU speed limit was 100%, and concurrent host activity is recorded in the load samples. The renderer still runs synchronously within each admitted job; bounds reduce known runaway inputs, while cancellation prevents obsolete delivery rather than interrupting arbitrary third-party code.

## Remaining limits

- Ambiguous delimiters, comma-containing dates, epoch seconds `X`, unsafe calendar/end combinations, excessive work and unsupported dependency order are deliberately rejected with source-visible errors. This preserves semantics by avoiding silent engine fallback. No document bytes are rewritten.
- Custom formats use strict local-time Day.js semantics. DST ambiguity, locale-specific date tokens and upstream layout placement remain dependency behavior; the adapter does not introduce a timezone or scheduling engine.
- Explicit tick intervals in init/frontmatter configuration must move to the Gantt body. The bounds are input validation, not a sandbox for arbitrary third-party configuration or a hard real-time CPU quota.
- Native macOS WKWebView is exercised, but an installed macOS/Windows application and physical iOS devices are not acceptance targets in this run. Available iOS simulators were inventoried; no simulator application was launched. Mobile browser evidence is explicitly identified as such.
- Dense charts retain Mermaid's label placement and scaling. This change does not add timeline zoom or collision-free label layout.

## Engineering assessment

These are implementation-review scores out of 10, not benchmark or certification claims.

| Dimension | Score | Remaining deduction |
| --- | --- | --- |
| Correctness | 9 | Original timestamps and flags plus representative dependency/exclusion schedules are verified; ambiguous upstream semantics are rejected. Arbitrary schedules are not exhaustively qualified. |
| Compatibility | 9 | Strict custom formats and both shared consumers are covered; known unsafe combinations intentionally fail with diagnostics. |
| Stability | 9 | Dual browser engines, native WKWebView, retry/cancellation and bounded work are covered; synchronous engine work cannot be forcibly interrupted. |
| Performance | 9 | Bounded local 11/50/200-task measurements pass; no portable SLA or cross-version speed claim is established. |
| Maintainability | 9 | Adapter, date policy, graph/work validation and error presentation have separate ownership; dependency upgrades still require grammar qualification. |
| Test coverage | 9 | Unit, real rendering, native WebView, task data, mobile reader and file round-trip coverage are present; installed-package and physical-device acceptance remain unclaimed. |
