# Native Workspace UI Acceptance

## Packaged Follow-up (2026-10-28)

Commit `1185b42f7e1abc04fbf9484e88987689f9dfbd2b` passed Quality
(`40459987769`), iPhone Reader Quality (`40459987858`) and Release Polarbear
(`40459987821`). The main-branch validation artifact is version 0.1.0, not a
new release tag. Artifact `12715585573` was downloaded and its ZIP SHA-256
verified as `dafdb162509b23a332dfe024f8253d877e579f55d1be56a5218a3bb0ec9a6540`.
The read-only mounted DMG contains a universal x86_64/arm64 app. Its copied
executable was verified before launch; the original installation was untouched.
It is unsigned, so signing/notarization acceptance remains unavailable.

**FAIL:** in this exact packaged app, immediate input after fullscreen exit
inserted at the document start instead of replacing the selected final line.
A later, slower attempt with diagnostics enabled succeeded. The earlier debug
bundle observations below therefore do not certify the packaged behavior.

Two test-first follow-ups address observed gaps:

- Native recovery excluded a responder already inside WKWebView, although its
  DOM selection can still need reconciliation. A new policy test failed before
  allowing that target. Host focus is reassigned; WebView focus is only notified.
  Other native controls, sheets, fullscreen windows and non-key windows remain
  excluded. This policy test alone is not native interaction acceptance.
- Turning diagnostics off crashed the packaged app with a DOM not-found error.
  A new WebKit case reproduced editor unmount. Imperative overlay cleanup was
  deleting the React-owned inline panel before React could reconcile it. Cleanup
  now removes only imperatively owned overlays. The shared browser native fixture
  also implements the previously missing event-unregistration stub, without
  suppressing page errors. All four focused WebKit cases then passed.

The follow-up was built with optimized Rust release settings and production Vite
assets as `dev.polarbear.uiacceptance`, without replacing the installed app. Its
running executable was verified under `target/release/bundle/macos`. With Debug
off, three consecutive native Control-Command-F enter/exit cycles immediately
replaced the selected final line with `Release recovery cycle one.`, `two.`, and
`three.`. Undo restored `two.`, Redo restored `three.`. A fourth cycle kept
`Architecture` input in Find without changing the document. Source mode also
passed immediate final-line replacement and Undo. Turning Debug on/off no longer
unmounted the editor. The temporary fixture was restored and saved at 1785
characters. This is local release-mode evidence, not final CI artifact evidence.

Local checks passed: typecheck, ESLint, 365 Vitest cases, 40 Node cases, strict
Clippy, Rust format, 138 Rust cases (4 existing ignored), 18 targeted WebKit
cases, and all 142 Chromium cases (5.9 minutes) on the isolated port. Final hosted checks and final-artifact repetition
must be recorded separately before acceptance.

## Native Focus Recovery Follow-up

Baseline: `64d394ae9fd05c24bbf599f55bf1aeef3769b2d5`. Its Quality
(`40452613718`) and iPhone Reader Quality (`40452613824`) runs both passed.
This does not certify the subsequent native focus correction.

The exit-focus defect is below the editor: Tao 0.35.3 restores the macOS window
style asynchronously and makes its host NSView the first responder. The DOM
selection can remain present while keyboard input no longer reaches WebKit.
`WebviewWindow::set_focus` only activates the window and is not a substitute for
restoring its WebView responder. Recreating CodeMirror would lose the wrong state.

The macOS adapter in `fullscreen_focus.rs` observes the existing window lifecycle,
detects an exit once, and queues native WebView focus restoration after the style
change. At execution it checks that the window is still key, is no longer
fullscreen, has no sheet, and has not focused another native control. The retained
view is accessed only on the main operation queue; closing its window makes the
callback a no-op. A scoped recovery event then lets the active CodeMirror editor
project its authoritative selection back into the DOM. Native testing showed
that responder recovery alone could leave WebKit at the document start while
CodeMirror still held the correct final-line selection. Merely calling
`EditorView.focus()` can also trust a stale cached DOM range.

Both source and Live Preview reuse `nativeFullscreenFocus`. Search inputs,
dialogs, nested editors and IME composition are excluded. Listener teardown is
owned by the editor plugin. No additional fullscreen command, timer loop,
document transaction, persistent selection store or dependency was added.
Other platforms do not emit this native recovery event.

Test-first evidence: the transition tests failed twice before implementation.
The transition and focus-guard tests subsequently passed. Actual native testing
rejected synchronous restoration, outer-view-only restoration, and retaining the
native responder alone. The two-stage implementation addresses native input
routing and DOM selection separately. The new WebKit regression failed with an
empty DOM range instead of the selected `d`, then passed after registration of
the reconciliation extension; a separate case protects Find focus and content.

An unrelated worktree occupied port 1422 during several intermediate browser
runs. Those runs are not current-source evidence. The failure and success above
were rerun on port 1437 with a temporary config pointing explicitly at this
checkout and `reuseExistingServer: false`.

### Final Native Interaction Evidence

The final isolated x86_64 app was rebuilt with production Vite assets and launched
as `dev.polarbear.uiacceptance` on Intel macOS 26.5.1. Three consecutive actual
Control-Command-F enter/exit cycles preserved the selected final line. Immediate
input replaced that line with `Final recovery cycle one.`, `two.`, then `three.`
without clicking the editor again. CodeMirror's debug state remained on line 40,
not the document start. Undo restored cycle two and Redo restored cycle three.
With Find focused, another fullscreen cycle kept subsequent `Architecture` input
in Find and left the document unchanged. The disposable fixture was restored to
its original sentinel, saved, debug display disabled, and the app quit.

This supersedes the unresolved first-responder observation in the earlier
Fullscreen Follow-up section. It does not turn the older DMG into evidence for
this fix. Chinese IME, Windows GUI, and release-artifact repetition remain
separate, unverified boundaries. Policy tests and browser fixtures alone do not
certify native fullscreen behavior.

The broader WebKit runs also encountered intermittent five-second startup
timeouts before sidebar interaction began. The failed compressed-sidebar case
subsequently passed unchanged, while two other cases timed out at the same
initial readiness assertion during native compilation. No assertion or timeout
was weakened, and these failed runs are not described as passing suites.
After compilation completed, the unchanged 17-case WebKit selection passed
serially in 1.1 minutes, including all three previously timed-out sidebar cases.

| Final-source local check | Result |
| --- | --- |
| Desktop typecheck / ESLint | PASS. |
| Desktop unit / script suites | PASS: 365 Vitest cases and 40 Node cases. |
| Rust format / Clippy, all targets and features with warnings denied | PASS. |
| Rust tests, all features, locked dependencies | PASS: 137 passed, 4 existing ignored cases; ignored cases are not claimed as independently run. |
| WebKit fullscreen / layout / Settings / theme | PASS: 17 cases on the isolated port after native compilation. Earlier startup failures are retained above. |
| Full Chromium behavior suite | PASS: 141 cases, 3.7 minutes, isolated current-checkout server. |
| Production frontend and native acceptance app build | PASS; existing Vite large-chunk warnings remain. |
| Actual native fullscreen continuation | PASS: three cycles, final-line replacement, Undo/Redo, and Find focus. |

Hosted checks must be evaluated against the final pushed commit separately.
No release tag is created or moved by this correction.

The official v0.10.11 ZIP was subsequently downloaded completely and matched the
SHA-256 recorded below. Its DMG mounted read-only and contained a universal
`x86_64 arm64` application reporting version 0.10.11. A copy under
`/private/tmp/polarbear-release-acceptance` launched to Workspace; the original
`/Applications/Polarbear.app` was not replaced. `codesign --verify --deep --strict`
reported that this application is not signed. Native automation timed out after
Open, so remaining interactions on this older artifact are NOT VERIFIED. A
one-second process sample showed its main thread in the AppKit run loop, not
evidence of a confirmed application deadlock. The isolated process was closed
without modifying documents and the DMG was ejected. This artifact predates the
fullscreen fixes and cannot certify them.

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

## Fullscreen Follow-up

Follow-up baseline: `480bfe1080d4c032c8374e45fe4c30c1af5e3a2f` on `main`.
The command resolver accepted extra modifiers: Control-Command-F matched
Command-F and consumed the native fullscreen accelerator. The existing Tauri
predefined Fullscreen menu already owns Control-Command-F on macOS. Command
matching now requires the exact primary-modifier pair; gesture modifier handling
is unchanged. No second fullscreen command or window service was introduced.

Before changing production code, four platform cases failed (Mac, iPad, Windows,
Linux), and the real-editor WebKit regression failed because the event was
prevented. Both passed after the correction. The regression also checks normal
Find, non-primary F2, dirty content, selection and editor focus. The browser case
tests event ownership, not OS fullscreen transitions.

The isolated native bundle was rebuilt from the follow-up source. Actual
Control-Command-F entered fullscreen and the same chord exited it, without opening
Find. The window returned to 1200 by 800 logical pixels with 240/280 sidebar
preferences. Command-F still opened Find. A 23-character disposable draft survived
another enter/exit cycle, and Command-Z removed the insertion in one operation.
The fixture was restored and saved; the acceptance app was quit.

- [Native shortcut entering fullscreen](evidence/2026-10-27/fullscreen-shortcut-enter.png)
- [Native shortcut exiting fullscreen](evidence/2026-10-27/fullscreen-shortcut-exit.png)

**Remaining focus observation:** after the native transition, accessibility
reported the window as focused and an immediate paste did not insert text.
Native Find and Undo still worked. Automatic first-responder restoration after
the OS transition is not certified by the browser focus assertion and remains
unresolved; this report does not claim all fullscreen editing acceptance passed.

### Hosted Evidence Correction

Authenticated checks supersede the earlier public-URL-only observation:

- [v0.10.11 Release run](https://github.com/smartscity/polarbear/actions/runs/40199865735)
  completed successfully at source `1988263e9dfc99d08b19d26a93b246db9fe928e5`.
  macOS DMG build, mounted-DMG verification and upload succeeded; Windows build
  also succeeded. This artifact does not contain either follow-up UI correction.
- Artifact `12601554865`, `Polarbear-macOS-0.10.11`, is a 149,091,595-byte ZIP,
  SHA-256 `5cf471d486a4dd3c1b9e735d639d79619397ea88f945bd23e743c7b689b6a0e0`.
  The release job created a draft release and uploaded `Polarbear_0.10.11.dmg`.
  Missing public download availability is not a failed DMG build.
- [Baseline Quality run](https://github.com/smartscity/polarbear/actions/runs/40450575631)
  passed frontend quality, Rust format and both native platforms, but failed one
  of 138 Chromium cases: reselecting the saved word after closing its card timed
  out. All 18 selected WebKit cases passed. This run is not all green.

The failing favorite test passed three consecutive local runs before any change.
Its CI screenshot retained the old selection without a card. The test now waits
for actual fixture delivery rather than an 800 ms sleep, asserts Escape restored
the selection, collapses it through a real pointer click, and then reselects and
asserts the exact word. This avoids attempting a native text drag from an existing
range. Favorite persistence assertions remain unchanged. This is test-gesture
hardening, not a claimed production Vocab fix.

### Follow-up Local Verification

| Check | Result |
| --- | --- |
| Desktop typecheck and ESLint | PASS. |
| Desktop unit and script suites | PASS: 365 Vitest cases and 40 Node cases. |
| WebKit fullscreen/layout/settings/theme selection | PASS: 15 cases. |
| Full Chromium suite | PASS: 139 cases, five minutes. The favorite gesture was hardened while this run was in progress, so its final source is checked separately below. |
| Final favorite gesture, three repetitions per engine | PASS: 3 Chromium and 3 WebKit cases. The `--browser=all` command exited 1 because all 3 Firefox launches failed: Firefox 1543 is not installed. Firefox behavior is NOT RUN, not passing. |
| Native app build | PASS: production Vite build and debug x86_64 bundle. |
| Native fullscreen shortcut | PASS for enter/exit, normal Find and draft Undo; first-responder continuation remains unresolved as noted above. |
| Official DMG local install/upgrade | BLOCKED: artifact transfer timed out after 120 seconds; a resumed transfer also timed out after 480 seconds. The partial ZIP was not installed or treated as verified. |

Hosted CI for the follow-up commit is a separate status check after pushing. No
tag was created, moved or published, and the draft release was not published.
