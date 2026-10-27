# Native Workspace UI Acceptance

## Scope and Build Identity

Baseline: `1988263e9dfc99d08b19d26a93b246db9fe928e5` (`main`, `v0.10.11`).
The corrections and final checks belong to the commit containing this report.
Environment: Intel macOS 26.5.1 (25F80), Xcode 26.5 (17F42), Node 26.1.0.

The installed `/Applications/Polarbear.app` reports **0.10.2** in both its plist
and native About window. It does not certify the redesigned UI. During this run,
the public v0.10.11 asset listing contained source archives only; the expected
`Polarbear_0.10.11.dmg` URL returned 404. The release failure cause and hosted CI
status are not established by these observations. Authenticated GitHub checks
were not retried after the user's instruction to skip the unavailable access.

To test the current code without replacing the user's installation or changing
its file associations, a separate native bundle was built:

- Product: `Polarbear UI Acceptance`, version `0.10.11`.
- Identifier: `dev.polarbear.uiacceptance`, separate preferences and instance.
- Location: `target/debug/bundle/macos/Polarbear UI Acceptance.app`.
- Build: `tauri build --debug --bundles app` with a temporary config overriding
  product name, identifier, version and an empty file-association list.
- Actual native WKWebView with production Vite assets at `tauri://localhost`.
- Debug x86_64 bundle, not the signed/notarized universal release DMG.
- A disposable Markdown fixture under `/private/tmp/polarbear-ui-acceptance`
  exercised headings, mixed-language text, a table, long code, Mermaid and edits.
  No private document or microphone capture was used.

## Defects and Test-First Corrections

### Settings Focus Restoration

Native dismissal of Settings left focus on the HTML body. `SettingsDialog`
called `showModal()` but did not preserve/restore its return target; WebKit pointer
clicks also did not focus the status-bar trigger. Four new browser tests failed
before the fix: pointer dismissal through Escape, Close and backdrop, and keyboard
opening/dismissal with an editor selection.

The existing dialog now closes and restores a connected previous focus target on
unmount, without scrolling. The status-bar trigger explicitly focuses itself
before opening. Draft content and dirty state remain untouched. The rebuilt native
app was checked for pointer Escape/Close and keyboard return to the editor.

### Dark Code Syntax Contrast

The native dark screenshot exposed dark green strings and low-contrast keywords.
Both CodeMirror Live Preview and rendered-code CSS hardcoded the light palette.
The new test passed in light mode and failed in dark mode before the correction:
keyword contrast was **2.960:1**, below the unchanged **4.5:1** assertion.

Six syntax colors now belong to the existing theme tokens. Both highlighters use
these tokens; no extra theme system or document transformation was introduced.
The regression renders a real TypeScript block and samples all 14 syntax classes
against the editor and code backgrounds in light and dark modes. It does not
certify every Mermaid-generated SVG color or every possible nested background.

## Native Interaction Evidence

These are actual native interactions, not browser IPC mocks. Layout operations
were performed on the baseline bundle; focus was rechecked after its correction.
Final rebuilt-theme observations and automated totals are recorded below.

| Interaction | Observed result |
| --- | --- |
| Fresh profile | Workspace opens by default. |
| Native Open dialog | Disposable Markdown file opens; outline, table and Mermaid render. |
| Independent separator drag / keyboard | Left 240 to 320, then 360; right 240 to 300, then 340. |
| Narrow then wide window | At 760 logical pixels, left compresses and right hides; widening restores preferred 360/340 widths. |
| Small window / drawer | At 500 by 550, sidebars hide; File Tree opens a drawer; Escape closes it and restores trigger focus. Widening restores 240/280 preferences. |
| Draft and history | Append a sentinel in source mode, resize, undo and redo; all 34 added characters restore together. Save and reopen through Recent retains the sentinel. |
| Clean restart | With left 240 and right 280, quit and relaunch retains both widths and visibility. |
| Zoom | Minimum stays at 100%; two increments reach 120%; reset returns to 100% with top-right controls accessible. |
| Outline | Final Section navigation reaches the end of the document. |
| Settings focus | Corrected native bundle returns focus to Settings after pointer Escape/Close, and to the editor after keyboard dismissal. |
| Final theme rebuild | Actual dark strings/keywords are readable; switching to light retains readability and the diagram renders again. Settings Escape still restores focus. |
| Fullscreen | Native green button enters fullscreen; View / Toggle Full Screen exits. After animation settles, both separators retain 240/280 and top-right controls remain accessible. |

One earlier restart observation was contaminated by simultaneous user interaction
with the acceptance window. It was discarded and repeated after the user stopped
interacting. It is not counted as a regression or successful acceptance evidence.

## Validation Record

- Before production changes: 55 WebKit navigation/settings/layout cases passed.
  An earlier targeted run had one initial separator timeout with a blank root;
  the same case subsequently passed without a production change. That initial
  timeout is retained as an unresolved cold-start/test-environment observation,
  not described as a repaired startup defect.
- Focus regressions: four failures before the fix, then four passes in WebKit.
- Theme regressions: light passed and dark failed before the fix, then both passed
  in WebKit without reducing contrast requirements.

| Final local check | Result |
| --- | --- |
| `test:ui -- workspace-layout.spec.ts settings-focus.spec.ts workspace-theme.spec.ts --browser webkit` | PASS: 14 cases, 1.8 minutes. |
| Same selection, default Chromium | PASS: 14 cases, 39.9 seconds. |
| `npm --workspace apps/desktop run typecheck` | PASS. |
| `npm --workspace apps/desktop run lint` | PASS. |
| `npm --workspace apps/desktop run test` | PASS: 361 Vitest cases in 66 files and 40 Node script cases. |
| Native acceptance app rebuild | PASS: production Vite assets plus debug x86_64 Tauri bundle; launched and visually checked. Existing large-chunk warning remains. |

The full browser suite and Rust unit/Clippy suites were not rerun for these
frontend-only corrections. Native compilation did run as part of the app build.
CI now includes the new focus and theme tests in its existing WebKit selection;
this change is not evidence that hosted CI has executed successfully.

### Screenshots

- [Dark code before the syntax fix](evidence/2026-10-27/dark-before-syntax-fix.png)
- [Dark code after the syntax fix](evidence/2026-10-27/dark-after-syntax-fix.png)
- [Final light theme](evidence/2026-10-27/light-final.png)
- [Baseline native narrow window](evidence/2026-10-27/narrow-baseline.png)

## Remaining Acceptance Boundaries

**BLOCKED:** official DMG installation/upgrade and signed/notarized universal
artifact acceptance. The old installed app and the isolated current-code bundle
are different evidence, not interchangeable proof.

**NOT RUN:** Windows GUI, physical trackpad gestures, Chinese IME composition,
release-mode performance, accessibility screen-reader speech, Live Caption audio
or long-running ASR, and real external Memory/translation/Vocab integration. Those
features were not changed in this batch. Browser IPC fixtures cannot certify them.

An attempted Control-Command-F chord opened editor Find instead of exiting
fullscreen; the native menu path worked. The chord's native dispatch/keymap
contract was not established in this batch and is not counted as passing keyboard
fullscreen acceptance. No shortcut configuration was changed to conceal it.

Once a current release DMG exists, install it without replacing the test evidence,
confirm About/version and the actual running executable, then repeat sidebar
drag/restart, narrow drawer, dirty-edit undo/save, zoom reset, Settings focus, and
light/dark code readability on the installed release. Keep the user's original
preferences and documents intact during upgrade checks.
