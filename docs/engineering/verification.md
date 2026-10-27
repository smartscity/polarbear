# Engineering Verification

## Native Fullscreen Input Recovery: 2026-10-27

Baseline: `64d394ae9fd05c24bbf599f55bf1aeef3769b2d5`; its Quality and iPhone
Reader Quality runs passed. The [native focus follow-up](native-ui-acceptance-2026-10-27.md#native-focus-recovery-follow-up)
records a separate responder defect after the shortcut ownership correction.
Tao's asynchronous macOS style restoration focuses the outer host view, not the
WebView. The macOS window adapter queues guarded responder restoration, then the
active editor projects its existing selection back into WebKit's DOM. This fixes
the separate stale-DOM-range failure without changing document state or history.

Transition tests failed before implementation. Native testing also rejected an
initial synchronous attempt and responder-only approaches. A new browser
regression failed before selection reconciliation and passed afterward on an
isolated current-source server. Native interactions remain a separate gate.
The rebuilt native app passed three actual enter/exit cycles with immediate
final-line replacement, Undo/Redo and a separate Find-focus check. The linked
report records the discarded intermediate attempts and startup timeouts rather
than counting them as successful validation. Exact-source local and installer
results are maintained there.

Final local checks passed: typecheck, ESLint, 365 Vitest and 40 Node cases,
137 Rust tests (4 existing ignored cases), strict Clippy, Rust format,
17 targeted WebKit cases and all 141 Chromium cases. The final WebKit run was
serial; earlier startup timeouts during compilation remain documented.

The official v0.10.11 artifact download subsequently completed with its expected
SHA-256. Its universal DMG mounted and the copied app launched, but it is unsigned
and predates the fixes. Remaining interactions timed out in native automation;
that is not a confirmed application deadlock or completed release acceptance.

## Native Fullscreen Shortcut Follow-up: 2026-10-27

Baseline: `480bfe1080d4c032c8374e45fe4c30c1af5e3a2f` on `main`.
The [acceptance follow-up](native-ui-acceptance-2026-10-27.md#fullscreen-follow-up)
records the test-first primary-modifier fix, actual native fullscreen enter/exit,
and the remaining first-responder and official-DMG installation boundaries.
The native Tauri menu retains fullscreen ownership; application shortcuts no
longer accept extra Control/Command modifiers. Gesture modifiers are unchanged.

Local typecheck, lint, 365 unit tests, 40 script tests, 15 selected WebKit cases,
139 Chromium cases and the isolated native bundle build passed. The baseline
hosted Quality run failed the favorite reselection case despite its other gates
passing; it must not be described as all green. The favorite test now collapses
the Escape-restored range before a fresh pointer selection and polls fixture
delivery instead of sleeping. This is test hardening, not a Vocab production fix.

The v0.10.11 release workflow succeeded and uploaded a DMG to a draft release.
That artifact predates these fixes. Local download retries timed out, so release
installation/upgrade acceptance is still blocked. No tag or release was changed.

## Native Workspace UI Acceptance: 2026-10-27

Baseline: `1988263e9dfc99d08b19d26a93b246db9fe928e5`, `main` / `v0.10.11`.
[Native acceptance report](native-ui-acceptance-2026-10-27.md) records actual
macOS interactions, separate installed/build identities, screenshots, red/green
regressions, and unverified release/platform boundaries.

Two reproduced defects were corrected after failing tests: Settings dismissal
lost keyboard focus, and code highlighters used light-only colors in dark mode.
The existing dialog lifecycle and theme tokens now own these behaviors. No
workspace layout algorithm, native persistence, or document format was changed.

Final local results: 14 focused browser cases each in WebKit and Chromium,
361 Vitest cases, 40 script cases, typecheck, ESLint, and the isolated native app
build all passed. The final native bundle was launched with production frontend
assets, with Settings focus, code contrast and fullscreen layout checked again.
The installed app remains 0.10.2; official v0.10.11 DMG installation/upgrade and
Windows GUI acceptance remain unverified, not inferred from the local debug app.
No release tag was created or moved. The user's unrelated IDE change is excluded.

## Feedback Entry: 2026-10-25

Baseline: `fb174d67a80704522b9c81e9908880dfed73b511` on `main`.
This batch completes the previously uncommitted Feedback UI. The activity rail
exposes a localized, keyboard-accessible GitHub Issues button on both surfaces.
It uses the existing external-link adapter, product URL configuration and Lucide
icon library. Opening is explicit; no document content is attached or uploaded.
Native failures use the existing localized dialog without navigating the editor.

Three new browser regressions cover keyboard activation, both surfaces, dirty
draft retention, live locale changes, native launch rejection, safe browser target
options, and narrow light/dark layouts. The initial run passed two cases and exposed
a missing native event cleanup hook in the test fixture. The fixture now provides
the Tauri hook; the zero-unhandled-error assertion was retained.

| Local check | Result |
| --- | --- |
| Feedback Chromium / WebKit | PASS: 3 cases each; narrow screenshots visually inspected. |
| Desktop typecheck / ESLint | PASS. |
| Desktop unit / Node tests | PASS: 361 tests in 66 files, plus 40 script tests. |
| Production frontend build | PASS; existing large-chunk warning remains. |

The browser tests stub native launch/dialog IPC and browser navigation. They do
not certify an installed application's OS browser launch or GitHub availability.
Native suites and the full browser suite were not rerun for this frontend-only
entry. Hosted CI remains a separate exact-commit check. The existing `v0.10.10`
tag is unchanged and does not include this batch. IDE-generated `.idea/vcs.xml`
changes are unrelated and excluded.

## Response Bounds and Settings Merge: 2026-10-25

Baseline: `f68680d37f4f470ffdb6b641cb4a6fed87fc0217`, branch
`codex/engineering-workspace-quality`. Local checks retain the six pre-existing
Feedback edits, which are excluded from this commit. Exact pushed-SHA CI is a
separate delivery gate; previous green runs do not qualify this source.

### Red / Green Evidence

- Before production edits, three settings unit cases failed: nested patches lost
  previous fields, writes read outside arbitration, and missing lock support still
  wrote. A real two-window browser case also failed while the origin lock was held.
- Three native provider cases failed against old code: a chunked JSON body over
  16 MiB was accepted, oversized declared file content only produced a decoding
  error, and oversized error bodies had no size diagnostic. An initial fixture
  field typo was corrected and all three behavioral failures reconfirmed before
  the reader implementation changed.
- Additional coverage checks empty/exact/oversized responses with Content-Length,
  chunked and EOF framing; truncated streams; invalid JSON; base64 padding and
  decoded limits; cumulative enumeration bytes/pages/entries; non-advancing pages;
  oversized commit acknowledgments retaining unknown-outcome semantics; rejected
  downloads preserving local bytes and checkpoints.
- Settings tests cover nested merges, default-binding restoration, disabled
  bindings, same-key ordering, immutable submitted intent, failed reads/writes,
  missing locking, actual lock timeout, closed-owner recovery, two-window reload,
  and capture not restarting after failed source persistence.

### Executed Locally

Intel macOS 26.5.1, Node 26.1.0, Rust 1.96.0. No production provider credentials
or user document/audio content is used by these fixtures.

| Check | Result | Scope |
| --- | --- | --- |
| Desktop typecheck / lint / contract check | PASS | Existing strict rules and generated Memory Admin contract. |
| Desktop test | PASS | 361 Vitest tests in 66 files; 40 Node script tests. |
| Desktop test:ui | PASS | Complete final run: 129 cases, 3.4 minutes. |
| Settings/layout test:ui --browser webkit | PASS | 12 cases including atomic import, failure, hydration, merge/reload, timeout/owner-close recovery and drawer focus. |
| `npm --workspace apps/desktop run test:native-settings` | PASS | Three successful independent runs of production transactions in real WKWebViews under `tauri://localhost`, 200 contended writes each plus a newly opened observer in isolated nonpersistent storage. Not installed-app GUI acceptance. |
| Cargo test --locked | PASS | 134 passed; four existing opt-in fixtures ignored, not counted as PASS. |
| Cargo fmt --all -- --check | PASS | Repository formatting unchanged outside scoped files. |
| macOS Clippy --all-targets --all-features --locked -- -D warnings | PASS | Production and test configurations. |
| cargo xwin clippy for x86_64-pc-windows-msvc, same flags | PASS | Real Windows target compilation; not local Windows execution. |
| Desktop build | PASS | Existing large-chunk warning remains. |
| Bundled offline translation --webkit | PASS | Actual Chromium/WebKit model inference and cancellation with production CSP. |
| Native clipboard with generated Mermaid fixture | PASS | Three real diagram attachments, surrounding text and stale-copy protection. |

The first full browser run exposed three synchronous checkbox-action assumptions
after writes became asynchronous. The tests now click and explicitly await the
acknowledged state; reload and actual feature assertions remain. All three focused
cases passed before the final full run. Test-only Rust lint findings were repaired;
production warning gates were not relaxed.
After the transactional import landed, the legacy-installation fixture also had
to seed old values before startup, not after the new database already existed.
Its system-preference and cross-window assertions were retained; the focused case
passed before repeating the complete 129-case suite successfully.

The initial Web-Lock/localStorage repair passed browser tests but failed repeated
native WKWebView contention: a fresh observer also read 99 + 99 after 200 updates.
This was not notification latency. Persistence now uses an IndexedDB transaction,
with a one-time legacy import; the native fixture bundles the actual production
module. It checks both writers and a fresh observer with bounded read-only
convergence, never repeats a write or repairs a failed count, and requires exact
100 + 100 results. It does not assert control over OS renderer allocation.
Expanded WebKit layout coverage also exposed focus restoration depending on
pointer clicks focusing buttons. The drawer now restores its explicit trigger;
the original assertion remains unchanged.

### Boundaries and Manual Acceptance

- Installed-app multi-window settings/upgrade and Windows GUI remain NOT RUN;
  Windows native execution is delegated to exact-SHA hosted Quality, not inferred
  from local cross-compilation. Separate storage partitions and older versions
  bypassing the new write protocol are not covered.
- Actual authorized GitHub/GitLab account transfers are NOT RUN. Local HTTP tests
  prove response handling, not a provider's live service limits or availability.
- Open two app windows, change audio source in one and translation/layout in the
  other, then reopen both: all distinct settings must remain. Repeat with storage
  denied: the error must remain visible and capture must not start implicitly.
- Large-file hashing performance, scoped dependency advisories and partial
  recursive-copy/delete recovery remain separate audit items. No merge, tag,
  release or >9 score is implied by this delivery.

## Entry Completion Follow-up: 2026-10-25

Baseline: `3c39b338e74a04947bdae766cf7bf423418065d3`, branch
`codex/engineering-workspace-quality`. Tests below apply to the source committed
with this section, with the pre-existing Feedback UI edits still present locally
and excluded from this commit. Hosted CI must separately verify the exact pushed
SHA; the previous green run is not evidence for this change.

### Reproduced Before Fixing

- Nine browser lifecycle cases failed against old production: create/duplicate
  replaced newer selection/tree state, deletion dropped another root's new tab,
  and acknowledged operations remained absent from the cached tree after refresh
  failure. The initial dialog fixture used an obsolete command; it was corrected
  to the installed plugin's `message` / `Yes` contract before recording all nine
  behavioral failures. Fixture failure is not counted as a product defect.
- A tenth browser regression wrote the unrelated active document's content during
  deleted-document recovery. It now saves the affected ID through `saveTab`.
- The staged-save test failed with `entry mutation bypassed an in-flight save`
  after extracting the existing IO path, before adding lifecycle exclusion.
- The parent-creation regression failed with `creation changed the tree before
  acquiring lifecycle access`. Admission now precedes path resolution and mkdir.

### Local Final Validation

Environment: Intel macOS 26.5.1, Node 26.1.0, Rust 1.96.0. Commands run from the
repository root, using the installed Node/Cargo/LLVM paths where necessary.

| Check | Actual result |
| --- | --- |
| Desktop typecheck / ESLint | PASS |
| `npm --workspace apps/desktop run test` | PASS: 354 Vitest cases in 66 files and 40 Node script cases |
| `npm --workspace apps/desktop run test:ui` | PASS: 124 cases in the full run (4.5 minutes), plus the subsequently added active-delete workspace-transition case in a focused run; 15 new entry-lifecycle cases total |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked` | PASS: 124 native cases; 4 existing opt-in fixtures ignored, not counted as executed acceptance |
| `cargo fmt --all -- --check` | PASS |
| macOS `cargo clippy --all-targets --all-features --locked -- -D warnings` | PASS |
| `cargo xwin clippy --target x86_64-pc-windows-msvc --all-targets --all-features --locked -- -D warnings` with Desktop manifest | PASS: actual Windows SDK/CRT target, production and test configurations; not Windows runtime execution |
| Desktop Vite production build | PASS, existing large-chunk warning remains |
| Native clipboard receiver with browser-generated Mermaid fixture | PASS: three actual image attachments, surrounding text and stale-copy protection |
| Bundled offline translation / production CSP | PASS in Chromium and WebKit, including cancellation |
| Memory Admin generated contract check | PASS |

An initial all-feature Clippy overlapped the frontend build's output-directory
replacement and failed on a missing translation asset. It was rerun successfully
only after the build completed; no assertion or compiler warning was suppressed.
The native nested-copy/delete contract test was added last, followed by a complete
native-suite rerun and final Windows compilation.

### Acceptance Boundaries

The browser tests execute the real React document session with deferred native
IPC fixtures. Native tests use real temporary files, staged saves, private file
permissions and failure callbacks. Installed macOS/Windows GUI interactions,
provider-account writes, power failure, hostile concurrent external processes and
recursive IO partial-failure recovery are NOT VERIFIED by this slice. No model,
ASR performance, DMG, tag, release or mainline merge is part of this delivery.
The current default branch is `main`, not `master`; merge remains a separate action.

## Engineering and Workspace UI Follow-up: 2026-10-25

This section supersedes earlier stage counts, not their historical results.
Baseline: `dc5e11e3c78283b55f6b004d73df8f4df2883c98`. The implementation is
the commit containing this section on `codex/engineering-workspace-quality`;
hosted execution is checked separately against the pushed SHA.
Environment: Intel macOS 26.5.1, Node 26.1.0, Rust 1.96.0, Chromium supplied by
the installed Playwright. Pre-existing Feedback UI edits are excluded from commits.

### Behavioral Regressions and Ownership

- Five parser assertions failed against old production: images inside ordinary
  fences/inline code and nested fenced resources did not retain Markdown structure.
  The shared markdown-it render rules now determine resource boundaries; portals
  occupy parser-produced slots without re-parsing strings with an image regex.
- The compressed opposite sidebar jumped from 180 to 280 px after releasing the
  other separator. The failing browser assertion now passes with a transient
  effective-width hold, without overwriting either preferred width.
- A denied localStorage write followed by an unrelated settings event reset the
  displayed sidebar from 304 to 240 px. The failing assertion now passes: only an
  actual persisted layout change replaces the local usable preference.
- An oversized publication previously succeeded in the real coordinator fixture.
  The new assertion failed before the fix, then passed with a 64 MiB/10,000-change
  atomic batch limit and bounded production reads. No partial batch is published
  to evade the atomic commit contract.
- Partial download checkpoints no longer mark the entire remote head synchronized.
  The coordinator test requires incomplete/complete checkpoints in that order.
  Upload reads also acquire workspace path-lifecycle admission before resolution.
- Inline image dialogs render through the existing body overlay, not a block
  element nested inside a Markdown paragraph. A real browser test opens/closes
  the viewer and checks that following paragraph content remains intact.

The first complete browser attempt had 100 passing cases and one failed new
selector assertion matching two legitimate code blocks. The selector was narrowed
to the intended text fence; the content assertion was retained. Later tests add
four-state sidebars, mixed resources and inline image portal acceptance. Test
fixture corrections are not counted as repaired product defects. The final mixed-
resource layout fixture additionally uses the existing 128 px application image
and verifies its decoded width. Two intermediate selector attempts targeted a
nonexistent Mermaid class and then included toolbar SVG icons; the final selector
requires the actual rendered flowchart. All eight layout cases passed afterwards.

### Dependency Audit

Fresh reports, checked 2026-10-25, are retained under
[evidence/2026-10-25](evidence/2026-10-25). Full baseline npm audit:
1 Critical, 10 High, 4 Moderate, 1 Low. Current full and production audits:
0 Critical/High/Moderate, 2 Low (one underlying KaTeX advisory and its Mermaid
parent). Audit exits nonzero for the remaining Low findings. Only existing
compatible ranges were updated; no `audit fix --force` or major framework
migration was used. Raw reports contain installed paths, ranges and advisory
details; package.json grants/ranges are unchanged.

| Package / locked version (before -> after) | Baseline severity | Advisory | Scope, trigger and disposition |
| --- | --- | --- | --- |
| @vitest/mocker 4.1.10 -> 4.1.12 | moderate | [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9), [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8) | Vitest -> mocker; test server. Untrusted mock registrations can traverse files or inject code; upgraded, not exempted as dev-only. |
| baseline-browser-mapping 2.10.34 -> 2.11.32 | moderate | [GHSA-w5vr-8v7q-w6rv](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv) | Vite -> Babel -> browserslist; build. Invalid query input can terminate the process; upgraded. |
| brace-expansion 5.0.7 -> 5.0.12 | high | [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg), [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895), [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr), [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7), [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) | ESLint -> minimatch; tooling. Crafted glob expansion can exhaust CPU/memory/stack; upgraded. |
| browserslist 4.28.2 -> 4.29.4 | high | [GHSA-c83g-rgw3-j3cx](https://github.com/advisories/GHSA-c83g-rgw3-j3cx), [GHSA-73wf-gq98-2v4g](https://github.com/advisories/GHSA-73wf-gq98-2v4g) | Vite -> Babel; build. Untrusted stats/query sets can write prototypes or grow caches; upgraded. |
| dompurify 3.4.12 -> 3.4.17 | critical | [GHSA-55q2-fjhq-7xh7](https://github.com/advisories/GHSA-55q2-fjhq-7xh7), [GHSA-6688-9rhm-gjv2](https://github.com/advisories/GHSA-6688-9rhm-gjv2), [GHSA-cg2g-xh64-v4q7](https://github.com/advisories/GHSA-cg2g-xh64-v4q7), [GHSA-mrv2-3pqr-j5jr](https://github.com/advisories/GHSA-mrv2-3pqr-j5jr), [GHSA-c6gr-qvv4-5v3f](https://github.com/advisories/GHSA-c6gr-qvv4-5v3f) | Desktop/iOS and Mermaid; production sanitizer. Reported IN_PLACE/hooks/template/XML modes are not all enabled here, but hostile SVG/HTML is reachable; upgraded and preview/clipboard regressions rerun. |
| katex 0.16.47 -> 0.16.47 | low | [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7) | Mermaid -> KaTeX; production math labels. Requires existing prototype pollution; scoped exception below, not declared unreachable. |
| linkify-it 5.0.1 -> 5.0.2 | high | [GHSA-v245-v573-v5vm](https://github.com/advisories/GHSA-v245-v573-v5vm) | markdown-it -> linkify-it; production text. Crafted mailto text can monopolize parsing; upgraded. |
| markdown-it 14.2.0 -> 14.3.3 | high | [GHSA-r7fv-28h4-cvq7](https://github.com/advisories/GHSA-r7fv-28h4-cvq7), [GHSA-vfgh-jcmw-g37q](https://github.com/advisories/GHSA-vfgh-jcmw-g37q), [GHSA-gfr2-rv44-r23c](https://github.com/advisories/GHSA-gfr2-rv44-r23c), [GHSA-253c-mchw-3w2r](https://github.com/advisories/GHSA-253c-mchw-3w2r) | Desktop/reader-core; production Markdown. Reference definitions, linkification and quotes are reachable; raw HTML is disabled in preview but does not exclude other DoS paths; upgraded. |
| mermaid 11.15.0 -> 11.17.2 | moderate | [GHSA-c4c3-pg64-4m4v](https://github.com/advisories/GHSA-c4c3-pg64-4m4v), [GHSA-6x64-9x62-f2gx](https://github.com/advisories/GHSA-6x64-9x62-f2gx), [GHSA-3rrr-jr9j-h3q3](https://github.com/advisories/GHSA-3rrr-jr9j-h3q3), [GHSA-2v8p-3f2j-5mp7](https://github.com/advisories/GHSA-2v8p-3f2j-5mp7), [GHSA-rhh3-jpg6-66xh](https://github.com/advisories/GHSA-rhh3-jpg6-66xh), katex | Desktop/iOS; production diagrams. Configuration/architecture prototype pollution and chart loops are relevant to untrusted diagrams; upgraded within 11.x. KaTeX Low remains. |
| nanoid 3.3.12 -> 3.3.20 | high | [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv), [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) | Vite -> PostCSS -> nanoid; build. Invalid custom sizes can loop; no direct product generator API, still upgraded. |
| postcss 8.5.15 -> 8.5.31 | high | [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp), [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) | Vite -> PostCSS; build. Untrusted CSS sourceMappingURL can disclose files; upgraded. |
| rollup 4.52.5 -> 4.65.0 | high | [GHSA-mw96-cpmx-2vgc](https://github.com/advisories/GHSA-mw96-cpmx-2vgc) | Desktop/Vite -> Rollup; build. Crafted paths can write outside output; upgraded and production builds rerun. |
| source-map-js 1.2.1 -> 1.2.2 | high | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) | PostCSS -> source-map-js; build. Crafted indexed offsets can block the event loop; upgraded. |
| vite 6.4.3 -> 6.4.5 | high | [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv), [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw), [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm), [GHSA-9jrq-w75r-8gcw](https://github.com/advisories/GHSA-9jrq-w75r-8gcw), [GHSA-rq7h-c2jc-7f22](https://github.com/advisories/GHSA-rq7h-c2jc-7f22) | Desktop/iOS dev server and build. Host/path middleware and editor launch attacks affect local files and tooling credentials; upgraded, dev use is not a waiver. |
| vitest 4.1.10 -> 4.1.12 | moderate | @vitest/mocker, [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) | Desktop/iOS -> Vitest/mocker; tests. File disclosure via mock redirects; upgraded together with mocker. |
| zod 4.4.3 -> 4.6.7 | high | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | ESLint React hooks -> Zod; tooling. Oversized constrained collections can exhaust memory; upgraded. |

KaTeX exception: [upstream advisory](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-238p-pmpm-9mq7)
requires pre-existing prototype pollution to bypass trust. Mermaid remains strict
and rendered SVG/HTML is sanitized before insertion. The affected library is not
declared generally safe or unreachable. Maintainers must review by **2026-11-24**,
or sooner on any new prototype-pollution finding, renderer configuration change
or compatible upstream patch. Moving to Mermaid 12/KaTeX 0.18 is a separate
compatibility change, not an untested forced upgrade.

Rust advisory scan was initially **BLOCKED** by crates.io tool-download timeouts.
It subsequently ran using the official cargo-audit 0.22.2 macOS binary, verified
against release SHA-256 `847831323de932155b226ab60ee4a180e13e5d007a019f0d4b7b4d89a6de2ab2`.
Its built-in database fetch stalled and was terminated; a separate shallow clone
of the official RustSec database succeeded at
`21d909e4c8bd4e14c7aea58bf980c881a0053ab1` (2026-10-24).
Reproduction: `cargo audit --db PATH_TO_THAT_CHECKOUT --no-fetch --no-yanked --json`.
The JSON database timestamp fields are null in no-fetch mode; the database commit
above supplies provenance. Yanked-package checking is **NOT RUN**, not clean.
`cargo-baseline.json` records eight vulnerability findings and twelve warnings.
Targeted updates within existing Cargo.toml constraints produce zero vulnerability
findings and ten remaining warnings in `cargo-current.json`; the default command
exits zero but a deny-warnings policy would still fail. No advisory was ignored.
The updated Cargo.lock SHA-256 is
`bcdc4899cd18e93f750d65ef54b871c1bf4ebbf6001d201b9535601db9378a34`.

| Locked package (before -> after) | RustSec advisory | Scope, trigger and disposition |
| --- | --- | --- |
| h2 0.4.14 -> 0.4.20 | 2026-0258 | reqwest/hyper HTTP/2; an untrusted peer can queue empty DATA frames. Production repository HTTP is reachable; upgraded. |
| plist 1.9.0 -> 1.10.3; quick-xml 0.39.4 -> 0.42.0 | 2026-0194, 2026-0195 | Tauri/codegen/utils -> plist; XML namespace allocation and duplicate-attribute CPU exhaustion. The inspected plist reader uses plain Reader, not NsReader, and no direct application XML parser was found. Upgraded through plist rather than forcing an incompatible transitive version. |
| rustls 0.23.40 -> 0.23.46 | 2026-0285, 2026-0346, 2026-0348, 2026-0349 | reqwest optional rustls transport in the all-platform lock: encryption-boundary validation, session Debug secret exposure, Brotli allocation and key-exchange downgrade. Current macOS/Windows default cargo trees do not activate rustls; future TLS features must not inherit vulnerable versions. Upgraded all four. |
| rustls-webpki 0.103.13 -> 0.103.16 | 2026-0382 | rustls certificate verification may accept distrusted intermediates; same feature-dependent scope, upgraded. |
| anyhow 1.0.102 -> 1.0.104 | 2026-0190 (unsound) | Tauri/build error handling; context plus downcast_mut can violate borrow rules. No application call found, upgraded rather than relying on that absence. |
| tokio 1.52.3 -> 1.54.1 | 2026-0386 (unsound) | Tauri/reqwest runtime; Unix AsyncFd constructors permit invalid/closed descriptors. No direct application AsyncFd use found; upgraded because dependencies also use the runtime. |

Remaining warnings are retained, not suppressed: proc-macro-error 1.0.4
(2024-0370, GTK macro tooling), unic-char-property/range/common/ucd-ident/ucd-version
0.9.0 (2025-0081/0075/0080/0100/0098, Tauri-utils -> urlpattern), and
zbus_names 4.3.4, zvariant/derive 5.15.0 (2026-0371/0370/0372, Linux single-instance
D-Bus dependencies) are unmaintained. glib 0.18.5 has 2024-0429 unsound
VariantStrIter handling in the Linux GTK/WebKit dependency graph. These are not
all harmless tooling: URL matching is runtime infrastructure, and Linux GLib
needs upstream-compatible remediation and native acceptance before Linux release.
Do not force GTK or D-Bus major versions into Tauri's current graph. Maintainers
must review these scoped deferrals by **2026-11-24**, or earlier on a supported
Linux release, Tauri upgrade or newly reachable affected API. This is not a
whole-product security approval.

### Performance Evidence and Reproduction

The retained native performance runs precede the final advisory-driven Cargo
lockfile update. The hash/scan/save implementation is unchanged, but these runs
are not a final-lockfile performance certification. The observed hash regression
remains open; do not treat a dependency rebuild or functional test as a new timing
measurement. Browser production source and npm lockfile are unchanged by that
native follow-up.

The browser runner is `apps/desktop/scripts/measure-editor.mjs ROOT OUTPUT LABEL`.
The baseline was an isolated git archive of the baseline SHA with its original
lockfile installed offline; production source was not modified. The final runner
uses actual Editor/Preview components and browser/mock IPC, not installed Tauri.
Only the test harness's localStorage document mirroring is disabled to avoid
the 10 MiB fixture exceeding localStorage quota. Each workload has one warmup and
five measured rounds. P95 below is the maximum of these five observations, not a
statistically strong long-tail claim. CPU is Chromium task time, RSS is the summed
browser process tree, and neither describes native application CPU/RSS.

| Fixture | Initial baseline -> current P95 open / edit / preview, ms | Investigation |
| --- | --- | --- |
| 4 KiB ordinary text | 15.7 -> 15.1 / 30.3 -> 33.0 / 33.8 -> 33.5 | No threshold crossing. |
| 1 MiB fenced text | 54.1 -> 36.9 / 126.2 -> 51.7 / 525.0 -> 261.8 | Variable host timings; no speedup claim. |
| 10 MiB fenced text | 211.6 -> 242.2 / 247.3 -> 560.2 / 2753.3 -> 3322.9 | Threshold crossed; paired repetition below. |
| Eight diagrams | 16.5 -> 16.4 / 33.2 -> 34.1 / 35.6 -> 37.6 | All-SVG readiness 522.6 -> 687.6 crossed threshold; repeated. |

Paired repeat without competing heavy work: 10 MiB open 167.5 -> 173.1,
edit 258.4 -> 250.7, preview 3196.4 -> 2087.6 ms; all-eight-diagram readiness
505.2 -> 506.9 ms. No repeatable threshold regression was established, but
10 MiB editing/preview remains visibly expensive and is not described as optimized.
First-pair large-document peak observed RSS was 778728 -> 842012 KiB (below 15%);
repeat was 946312 -> 829836 KiB. Closing the repeated large fixture released the
browser tree to 136084/99388 KiB respectively. This is resource-return evidence,
not proof of a flat stable RSS curve or two-hour leak freedom.

Retained files: `editor-baseline-retry.json`, `editor-current.json`,
`editor-baseline-repeat.json`, `editor-current-repeat.json`.
The earlier `editor-baseline.json` is an incomplete harness-readiness failure,
excluded from comparisons but not deleted. Initial reports' `source` field
identified the runner checkout rather than the baseline root; labels/archive
provenance identify the baseline. Repeat reports correct this with explicit
source and lockfile fingerprints.

Native observations use the same test-only instrumentation on both snapshots:
`POLARBEAR_PERF_OUTPUT=<absolute-json> cargo test --workspace
native_io_observations -- --ignored --exact
engineering_performance::native_io_observations --nocapture`.
Six rounds exercise actual atomic saves plus scan/hash of a document and attachment,
with 2,000 excluded files. No network or SQLite timing is inferred. Debug results
are retained as `native-baseline.json` and `native-current.json`: new digests
consume exactly 148 bytes for two files, versus 10,938 / 2,796,224 / 27,962,050
bytes at 4 KiB / 1 MiB / 10 MiB. The old encoding embeds whole content.
Debug SHA-256 scan/hash is slower for large files. Optimized-build measurements
(`native-baseline-release.json`, `native-current-release.json`) confirm the cost:

| Two-file size | Save P95 baseline -> current, ms | Scan/hash P95 baseline -> current, ms |
| --- | --- | --- |
| 4 KiB each | 43.07 -> 42.07 | 15.58 -> 0.45 |
| 1 MiB each | 47.65 -> 45.48 | 16.70 -> 12.86 |
| 10 MiB each | 88.48 -> 91.50 | 44.85 -> 194.99 |

The 10 MiB scan crosses the investigation threshold. The old baseline performs
reversible Base64 encoding, not a strong content hash; removing excluded-directory
descent helps smaller workspaces but does not offset hashing larger attachments.
An experiment reused already-locked ring 0.17.14 for identical SHA-256 output.
Boundary/reference tests passed; observed large scan P95 was 151.85 ms and 105.27 ms
on repeat, still above baseline and inconsistent with a defensible general
improvement. The added dependency edge and backend change were **discarded**.
The experiment's raw files retain `ring` in their names and are not final-source
evidence. Its repeat overlapped the tail of a native compilation and had unusual
filesystem latency; it is not a controlled speedup claim.

**Residual regression:** large-attachment scan/hash CPU latency is higher. It runs
on the existing blocking worker, with 64 KiB streaming storage and no unbounded
retry or weakened revision checks. Further optimization requires a representative
optimized CPU profile; metadata-only cache reuse would miss same-size/same-mtime
edits and is not accepted. Correctness and fixed storage are not speed claims.

### Local Acceptance Matrix

Commands run from the repository root unless stated otherwise. Each row describes
the current implementation, not an installed/released version. Raw performance
and dependency reports plus representative screenshots are retained above.

| Check | Result | Command / evidence scope |
| --- | --- | --- |
| Desktop typecheck / ESLint | PASS | `npm --workspace apps/desktop run typecheck` / `run lint`. |
| Desktop unit / architecture / fixture tests | PASS | `npm --workspace apps/desktop test`: 352 Vitest tests in 65 files and 39 Node tests; zero runtime import cycles or forbidden reverse edges. |
| Desktop browser | PASS | `npm --workspace apps/desktop run test:ui`: 106 cases; eight layout cases rerun after the final real-image fixture/flowchart selector corrections. Actual React/CodeMirror, controlled IPC. |
| Native filesystem / controlled HTTP | PASS | `cargo test --workspace --offline`: 115 passed, four ignored entries (benchmark, real Engine integration and subprocess helpers); subprocess parents invoke their helpers. Benchmark executed separately. |
| Native formatting / lint | PASS | `cargo fmt --all -- --check`; `cargo clippy --workspace --all-targets --all-features --offline -- -D warnings`. |
| Memory contract | PASS | `npm --workspace apps/desktop run memory-contract:check`. No direct Memory storage access introduced. |
| Native clipboard | PASS | `npm --workspace apps/desktop run test:native-clipboard -- test-results/real-mermaid-clipboard.json`: AppKit receives all three actual PNG attachments, text order, Unicode, alternate formats and stale-copy handling. Not Word/Lark acceptance. |
| Offline translation | PASS | `npm --workspace apps/desktop run test:offline-translation -- --webkit`: actual bundled sentence/paragraph inference and cancellation under production CSP, Chromium and WebKit. |
| Desktop build | PASS | `npm --workspace apps/desktop run build`; App chunk 1789.71 kB, gzip 538.65 kB. Existing large-chunk warning retained; build duration under competing compilation is not a performance result. |
| Affected iOS frontend | PASS | iOS `typecheck`, `lint`, `test` (39), `test:ui` (11), `build`. Not a physical iPhone run or iOS native build. |
| Browser performance thresholds | PASS | Repeated matched fixtures did not reproduce initial threshold spikes; small sample and host variability remain explicit. No speedup claimed. |
| Native scan/hash performance threshold | FAIL | Confirmed optimized 10 MiB attachment scan regression; raw data and rejected backend experiment retained. Correctness/security checks were not weakened. |
| Full / production npm audit | FAIL | Command returns nonzero for two Low entries (one underlying scoped KaTeX advisory plus parent). Zero High/Critical/Moderate; all findings analyzed above. |
| RustSec advisory scan | PASS with warnings | Fresh pinned database: eight vulnerability findings repaired; ten unmaintained/unsound warnings retained and analyzed. Default audit exits zero; deny-warnings would fail. Yanked check NOT RUN. |
| Hosted macOS / Windows CI | NOT RUN at record creation | Must query the exact final pushed SHA; local checks and YAML changes do not count as hosted execution. |
| Installed Tauri / real provider / native Windows GUI | NOT RUN | Requires available GUI automation/manual acceptance and authorized disposable provider repository. |

### Platform and Governance Boundaries

Quality now runs native tests and all-target/all-feature Clippy on both macOS
and Windows. Windows AppKit clipboard parity is not implied; that job remains
macOS-only. Browser tests cover actual React/CodeMirror with controlled native
responses. Native tests use real temporary filesystem operations and controlled
HTTP provider servers, not authorized GitHub/GitLab account writes.

The first hosted run at `9e3ca529` ([40180534462](https://github.com/smartscity/polarbear/actions/runs/40180534462))
passed frontend, macOS native, browser/clipboard and formatting jobs. Windows
Clippy failed on Unix-only Memory transport imports/helpers and macOS-only audio
callbacks/pinch events; its native tests did not execute. The follow-up compiles
these implementations only on their actual platforms while retaining portable
capture queue tests and explicit unsupported-platform errors. It does not disable
Windows or relax warnings. Local Clippy and 115 native tests passed both before
and after the dependency update; 352 Vitest and 39 Node checks passed again.
A sandboxed test attempt failed because sockets and macOS file
coordination were denied; the authorized OS-capable rerun passed, without changing
assertions. The final pushed SHA must still be checked after these changes.
The next run at `3ff6bf6d` exposed one remaining macOS-only `Mutex` import in
Windows Clippy. It is now gated with the capture singleton; the same 115 native
tests, formatting and all-target Clippy passed locally again. This intermediate
failure is retained rather than presented as a passing Windows run.

### Windows Path Contract Follow-up

Baseline: `d79de09b22da40c0b8aaff3d0cfd99ab98241ede`, run
[40182592844](https://github.com/smartscity/polarbear/actions/runs/40182592844).
Its Windows Clippy passed, but native execution had **82 passed, 2 failed,
2 ignored**. Other jobs passed. The two failures have different owners:

- `system_open::tests::extracts_markdown_files_from_gui_launch_arguments` used
  a Unix-only file URL on Windows. Only its fixture changes: native absolute
  paths are converted with `Url::from_file_path` and compared as `PathBuf`.
  Production parsing is unchanged; invalid URLs do not fall back to filenames.
  Additional cases cover spaces, Unicode, `%`, `#`, case-insensitive extensions,
  non-Markdown inputs, flags and malformed URLs. Drive/UNC coverage is compiled
  on Windows and must actually execute there before being called verified.
- `workspace_commands_rename_files_and_directories` exposed a production protocol
  defect: Windows serialized `docs\\world.md` where the frontend requires
  `docs/world.md`. The assertion is retained. A single boundary helper now
  serializes logical relative paths for rename/move/tree/duplicate/open/assets;
  validated old input and new save/delete outbox keys use the same convention.
  Root/absolute paths and the file URL parser are not normalized by this helper.

Local test-first evidence: the extracted pre-fix serializer failed the explicit
Windows-separator assertion (`docs\\world.md` versus `docs/world.md`), then
passed after conversion. A shared JSON fixture is checked by Rust serialization
and consumed as canonical wire values by the real React document-session browser
tests. The browser does not invent its own replacement algorithm. Four new cases
cover nested directory rename/move with successful/failed tree refresh, stable
tab IDs, revisions, edits made while mutation is pending, dirty state, selection,
tree descendants and recent records. Native tests use real temporary files and
compare nested mutation responses, tree IDs and sync keys.

Before this follow-up, the old `3ff6bf6d` snapshot was archived into an isolated
temporary directory and compiled locally for `x86_64-pc-windows-msvc`; it failed
with the exact CI `unused import: Mutex` diagnostic. `d79de09b` passed that same
target check. `check:native:windows` now builds embedded frontend assets and runs
`cargo xwin clippy --all-targets --all-features --locked -- -D warnings`. Its
configuration guard failed before the script existed and passed afterwards.
This is real target compilation, not a spoofed `cfg(windows)` on a macOS standard
library. It is not Windows binary execution. Local tools: Intel macOS 26.5.1,
Rust 1.96.0, cargo-xwin, LLVM and cached Windows SDK/CRT; Node 26.1.0.

Intermediate attempts remain explicit: one unqualified `--exact` test filter ran
zero tests and was replaced with the fully qualified name before claiming RED;
macOS coordination was sandbox-denied and rerun with OS access; the first native
fixture used `target`, an intentionally excluded sync directory, and was corrected
to `archive`; Playwright required the JSON import attribute; local Windows Clippy
caught new fixture `expect()` calls, which now propagate errors instead of adding
lint exemptions. None of these intermediate failures was pushed as a new CI trial.

No persistent-data migration is performed. Sync scanning already emits slash
keys; existing session projections reload from the corrected native boundary and
recent-document parsing already accepts Windows input. Historical outbox entries
are not rewritten. General Unix literal-backslash filename support remains outside
this certification. Traversal/symlink/exclusive-rename/save-race checks are retained.
Final hosted results must be associated with the commit containing this follow-up;
the failed baseline is not evidence for its replacement. Windows native GUI
rename/move of dirty open documents remains **NOT RUN**.

| Follow-up local gate | Result | Scope |
| --- | --- | --- |
| macOS native tests | PASS | 119 passed, 4 existing ignored entries; includes both original failing cases and new path fixtures. |
| macOS Clippy / Rust format | PASS | All targets/features, warnings denied; no new lint exemptions. |
| Windows target pre-push command | PASS | Frontend production build plus all-target/all-feature MSVC Clippy; Rust 1.96.0, not Windows execution. |
| Desktop unit / Node tests | PASS | 352 Vitest cases and 40 Node cases, including the pre-push command contract. |
| Workspace mutation browser tests | PASS | 9 cases, including four new Windows wire-path scenarios; native IO is mocked. |
| Desktop TypeScript / ESLint | PASS | Existing rules unchanged. |
| Final-SHA Windows execution | PENDING | Must query the follow-up branch run after push; baseline Windows runtime failed. |

The production frontend build retains its pre-existing large-chunk warning.
No new performance, installed-app or provider-write acceptance is claimed here.

**NOT RUN:** installed-app open/edit/save/close/reopen/quit smoke; actual remote
provider writes; native Windows GUI/permissions acceptance; physical iPhone/IME/
trackpad; new DMG; ASR accuracy/endurance. Native CUA is unavailable in this
environment. No installation or user document was replaced for this audit.

Read-only GitHub API inspection found main `protected:false`, required status
enforcement off and repository rulesets `[]`. No permission change was made.
Maintainer action: require Frontend quality, Rust format, Native tests on both
matrix platforms, Desktop editor and clipboard, and affected iPhone Reader
checks in the branch rule. Workflow existence alone is not enforcement.

The existing MIT OR Apache-2.0 declaration now has both corresponding license
texts. README no longer says contribution guidance/license texts are missing,
or describes conditional GitHub GraphQL publication as REST-only.



## Conditional Sync Stage: 2026-10-25

On the Intel/macOS toolchain below, `cargo test -p polarbear-desktop` passed
**113 tests**, with **3 ignored environment fixtures**. Native Clippy with
`--all-targets -- -D warnings` passed. Only changed Rust files were formatted.

The repository subset covers 22 planner/coordinator/digest/HTTP tests: divergent
real files, edit during download, conditional creation/deletion, checkpoint failure,
lost response, later remote edits after an unknown response, mixed transfers,
operation overlap, frozen GitHub head, GitLab per-file versions, authentication,
digest conversion/rollback/restart, Unicode, empty/large content and excluded paths.
Local HTTP tests initially lacked sandbox loopback access, then passed with that
capability. No actual provider repository was modified.

Two digest/migration assertions failed on old production before the digest change.
New coordinator tests exercise production effects but are not claimed as old-version
failing tests. Temporary filesystem tests do not prove safety against uncooperative
external ancestor replacement between system calls. Windows and hosted-provider
write acceptance are NOT RUN. The overall fixed score gate remains open.

## Document Completion Stage: 2026-10-25

Baseline `dc5e11e3c78283b55f6b004d73df8f4df2883c98`; Intel macOS, Node 26.1.0,
Rust 1.96.0. Existing Feedback changes were present before this stage and are
excluded from its commit. Initial lockfile SHA256 values:

- package-lock: `1ad58d74b4d20ffa83920d7c58d5882d8e06f8606c366294efd92941638ca00e`
- Cargo.lock: `49a061d97ee17d29eb9f8040f0f34739b2f39d73e608931bd582650b0dc5342a`
- iOS Cargo.lock: `9f242c5b7374458430559f9172cbbd5ad35ce345ef96565f1f2176fa1f9edea3`

Three new real-App/mock-IPC browser regressions failed behavioral assertions on
old production: committed Save As stayed Untitled, Cancel removed a dirty tab,
and quit reached native IO after an earlier document was edited during another
save. No missing-import or compilation failure is counted as reproduction.

After the implementation, desktop typecheck and ESLint passed; `npm --workspace
apps/desktop run test` passed 340 Vitest and 39 Node tests; the complete
`navigation-settings.spec.ts` passed 47 browser cases. These cover ordinary and
Save As concurrent typing, rejected saves, external conflicts, newer tabs,
new edits during quit, repeated quit, explicit discard/cancel and tree failures.
An intermediate test used the status bar instead of the existing workspace
status region; its selector was corrected without removing the warning assertion.
An initially incorrect npm argument forwarded Vitest file names to the later
Node runner and failed; the unmodified full command was rerun successfully.

This is browser/native-adapter-boundary evidence, not installed Tauri or Windows
acceptance. Native IO, final-checkout CI, dependency audit and controlled
performance remain separate gates for the overall task. No tag or release is made.

## Intel Preview Admission Regression

Base: `b10d736`. Release `40103182055` failed first-text P95 at 5.232 seconds
against the unchanged five-second gate. A short utterance started a preview
while already accumulating trailing silence, consuming inference capacity just
before its final and the following utterance's final. `PreviewSchedule` now
defers that redundant preview without changing VAD, finalization, decoder,
thread allocation, model, queue bounds or release policy.

Local test-first evidence and paired 120-second public meeting results are in
[the qualification record](../planning/live-caption-parakeet-qualification.md#intel-admission-follow-up-2026-10-24).
The retained three-thread candidate passed local latency/memory/completion gates
and preserved all 23 finalized texts and positions. It did not outperform the
local baseline overall; hosted Intel/ARM validation remains required before
claiming the release failure resolved. Native CTest 7/7, Python native tests
25/25, Node tests 38/38 and the real helper protocol fixture passed. No additional
full frontend or physical-device acceptance is claimed for this native-only change.

The first branch push also exposed a workflow-selection defect: the historical
`codex/caption-streaming` name selected candidate research and skipped production
validation, even when a reusable release caller requested `production_only`.
A test-first workflow guard now requires explicit research opt-in and gives
`production_only` precedence. Ordinary pushes select production verification.
This changes which engine is tested, not acceptance thresholds; the old research
run is not presented as production evidence. Node script coverage is now 39 tests.

## Release Browser Readiness Follow-up

Base: `86d2aa4b614bdc28652cfa4a6f3211fd7954531c`. Main Quality passed all four
jobs, and the release's Intel/Apple Silicon production first-text regressions
also passed. Its independent desktop behavior gate then failed at
`caption.spec.ts`: the test expected a translation claim after advancing the
virtual clock by one second without establishing that the lazy
`CaptionTranslator` module and its effect were ready. The observed zero claims
do not distinguish delayed module loading from delayed React scheduling; the
controlled delayed-mount case covers this missing readiness boundary. A virtual
timer deadline is not a React/module readiness signal. No native translation or
ASR implementation change is indicated by this assertion.

The test now waits for observed claim activity while advancing its clock, then
proves polling becomes and remains idle after opt-out. A second case explicitly
holds the lazy module response through opt-in, proves there are no claims before
mount, releases it, and verifies the same enable/disable contract. Both cases
passed five repetitions locally before the full suite was rerun. This preserves
the assertions instead of merely retrying the failed CI job or increasing a
fixed sleep.

Manual release validation also accepts an empty tag so a selected branch can be
checked without inventing or publishing a version. The workflow regression
failed before making that input optional. Nonempty release tags retain their
existing validation and publication conditions. Branch verification retains
strict production gates; existing prerelease exceptions are unchanged. This
supports future verification before tagging and does not add a tag in this task.

Local results: the final full desktop browser run passed 90/90 in 6.2 minutes;
the full unit command passed 338 Vitest tests in 63 files and 38 Node tests.
The normal/delayed-mount focused run passed 10/10 (five repetitions each).
The native clipboard receiver accepted all three real Mermaid attachments from
this final run, surrounding text, Unicode, single-image copy and stale-copy checks.
Production source is unchanged from the preceding verified build/native slice.

## Release Prerequisite Follow-up

Base: `8074fd7de4c1aef5525aac7bfd5647a086497bf7`, the verified merge of PR #2.
Its branch and PR Quality, iPhone Reader Quality and both Caption Engine jobs
passed before merge. Main also starts the release workflow without a tag.

Inspecting that independent job exposed the same prerequisite previously fixed
only in Quality: direct all-feature Cargo checks embed `frontendDist`, but run
before Tauri's `beforeBuildCommand`. Browser tests use Vite development assets;
the offline translation probe builds into a temporary directory. Neither
produces `apps/desktop/dist` for the release Cargo gate.

A new workflow regression failed before adding an explicit production frontend
build ahead of native validation. This is a job-order fix, not a relaxation of
caption gates or a new release tag. The preceding slice already verified the
exact build-then-Clippy sequence locally; application sources are unchanged by
this follow-up. The updated full unit command passed before commit: 338 Vitest
tests in 63 files and 37 Node tests. Hosted results are verified for the new
pushed/merged SHAs rather than the older run.

## Workspace Mutation and Diagram Admission Follow-up

Date: 2026-10-24. Base `a2e0b32a899a1fffe73827166687bdeff6abd59e`.
This is current-checkout evidence on macOS 26.5.1, Intel x86_64, Node 26.1.0.
The implementation and ownership decisions are in
[the refactoring report](refactoring.md#workspace-mutation-and-diagram-admission-follow-up).

### Test-first Findings

- Delayed rename/move allowed saves to the old path; a repeated path operation
  reached native IO while the first was unresolved. Three initial browser cases
  reproduced those failures before the session admission fix.
- Cancellation tests timed out against the old diagram cache. New queue and
  tree-generation APIs initially failed import/member checks; these specify new
  contracts rather than prove independently reproduced old races.
- A real-App rename regression found two identity consumers missed by internal
  session tests: the dirty marker disappeared and image paste sent the opaque ID
  `/test::Original.md` instead of the current path `Renamed.md`.
- Native regressions exercise concurrent no-replace publication, existing empty
  directory/dangling-symlink targets, lifecycle exclusion, and an actual save
  paused before publication while a rename waits. The old revision-aware path
  cannot recreate the file after the rename.
- Browser and unit fixtures cover edits during pending mutations, same-path documents in
  different roots, failed post-commit refresh, stale polling, repeated commands,
  failure/retry, dirty documents and in-flight saves. Real Mermaid tests cover an
  80-request cancellation burst and shared consumers surviving widget disposal.

An intermediate tree fixture returned the renamed file for every workspace and
was corrected. A missing App destructuring field was caught by typecheck and
the real-App regression, then fixed. An existing Node caption-fixture test twice
hit its synthetic three-second process-start deadline, including a final suite
run. A deterministic fake-clock regression reproduced the false failure before
the test-only budget was corrected. Healthy protocol fixtures now allow fifteen
seconds for host process startup and completion; dedicated stall tests still
advance their explicit one-second deadlines and prove kill/reap behavior.
Production engine timeouts, first-text latency thresholds and release gates are
unchanged. The complete unit/Node command then passed. These attempts are not
hidden as a clean first run or treated as ASR performance evidence.

### Verification Boundary

No Markdown, IPC or settings schema migration is needed. Move/rename updates
root-qualified path metadata while document IDs own buffers and history.
Diagram admission is bounded and cancellation-aware, but a running Mermaid
call is not interruptible and has not moved to a Worker. No controlled speedup
or memory benchmark is claimed.

NOT RUN: Windows/Linux native execution, installed-app upgrade, hostile
cross-process directory replacement, real hardware gestures, physical IME,
audio/ASR accuracy or endurance, and release packaging. Full asynchronous
create/delete/duplicate projection qualification, repository sync races and
multi-window settings arbitration remain documented debt. Unrelated Feedback
edits are excluded from the commit. Hosted CI must be checked for the pushed
and merged SHAs, not inferred from this local result.

### Local Gates for This Slice

| Check | Result | Evidence |
| --- | --- | --- |
| Desktop Vitest / Node | PASS | 338 tests in 63 files; 36 Node tests, including the deterministic host-startup regression. |
| Full Desktop Playwright | PASS | 89 tests in 4.4 minutes on the final executable source, including eight new browser cases. |
| Native clipboard receiver | PASS | All three Mermaid attachments from this browser run and surrounding text; Unicode, four clipboard formats, single-image copy and stale-copy protection. AppKit receiver, not Word/Lark acceptance. |
| Bundled offline translation | PASS | Chromium and WebKit production CSP, actual sentence/paragraph inference and cancellation; external requests denied and none attempted. |
| Desktop typecheck / lint | PASS | Final source passes without TypeScript or ESLint errors. |
| Production frontend build | PASS | 36.53 seconds; App chunk 1,701.58 kB, gzip 511.66 kB. Existing large-chunk warning remains; timing is not a benchmark. |
| Native Cargo tests | PASS | 96 passed, 3 ignored entries; subprocess fixtures remain exercised by their parent tests. |
| All-target/all-feature Clippy | PASS | Warnings denied; rerun after the final production frontend build. |
| Rust format / Memory contract | PASS | No contract generation drift or Rust formatting differences. |
| Dependency graph | PASS | 183 production TypeScript files; no runtime cycles, forbidden reverse dependencies, unresolved or computed imports. 25 cross-feature edges remain explicit. |

Date: 2026-10-24. Baseline `166e231c61dc568876aab8dbebdb6636a2c281ae`;
implementation `2747dc36d2a0cb559ba7e33415118597c711b96f`.

## Environment and Evidence Identity

Local macOS 26.5.1 (25F80), Intel x86_64, Node 26.1.0, installed Rust/Xcode
toolchains. Commands ran from the repository unless their manifest or workspace
selects another root. Node was selected using:

```sh
env PATH=/Users/liyunlong/.nvm/versions/node/v26.1.0/bin:$PATH npm ...
```

This is a development-machine command, not runtime-manager discovery code.
CI independently uses its configured LTS Node and macOS runners.

The checks below ran on the working sources subsequently committed as
`2747dc36`, with six pre-existing Feedback edits retained in App, ActivityRail,
product config, both locales and memory.css. Those edits were excluded from the
commit. Thus the local UI build is **not an artifact built from a pristine
checkout** of that commit. Pure/native changes and their evidence map to the
commit; hosted clean-checkout validation remains required. No new signed app or
DMG was produced by this audit. Prior alpha artifacts are historical evidence
for their own commit only.

## Executed Checks

| Command | Result | Scope |
| --- | --- | --- |
| `npm --workspace apps/desktop run typecheck` | PASS | Final TypeScript source check. |
| `npm --workspace apps/desktop run lint` | PASS, zero warnings | Source ESLint; browser harnesses are outside this lint scope. |
| `npm --workspace apps/desktop run test` | PASS: 57 Vitest files, 288 tests; 30 Node tests | Final complete unit/script invocation. |
| `npm --workspace apps/desktop run test:ui` | PASS: 66 tests, 2.5 minutes | Serial Chromium browser suite; native/Admin IPC fixtures are mocked where the harness declares them. Not packaged Tauri E2E. |
| `npm --workspace apps/desktop run build` | PASS, 24.12 s | Final production frontend build; >500 kB chunk warnings remain. |
| `npm --workspace apps/desktop run memory-contract:check` | PASS | Canonical vendored contract/generation consistency, not live Engine acceptance. |
| `node apps/desktop/scripts/architecture-graph.mjs` | PASS scoped scan | 167 production TS files, zero runtime cycles/reverse edges/unresolved relative imports/computed imports; 21 cross-feature edges reported. |
| `cargo fmt --all -- --check` | PASS | Root Rust workspace. |
| `cargo clippy --all-targets --all-features -- -D warnings` | PASS | Final all-target lint including test fixtures; production policy unchanged. |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-fail-fast` | PASS: 61 passed, 2 ignored | Real local native tests, including cooperative process saves, permissions/ACL/xattrs, Admin socket fixtures and caption runtime logic. |
| `npm --workspace apps/desktop run test:native-clipboard` | PASS | Synthetic two-image rich document plus single-image/stale-copy behavior in native receiver. |
| `npm --workspace apps/desktop run test:native-clipboard -- test-results/real-mermaid-clipboard.json` | PASS | Three actual browser-rendered Mermaid PNGs plus surrounding rich text in native receiver. No claim for Lark/Word acceptance. |
| `npm --workspace apps/desktop run test:offline-translation -- --webkit` | PASS | Actual bundled model inference/cancellation in Chromium and WebKit with production CSP. Not a mocked translation response. |
| `npm --workspace apps/ios run typecheck` | PASS | Independent Reader TS source. |
| `npm --workspace apps/ios run lint` | PASS | Reader source. |
| `npm --workspace apps/ios run test` | PASS: 5 files, 39 tests | Reader unit tests. |
| `npm --workspace apps/ios run test:ui` | PASS: 11 tests, 16.1 s | Browser Reader behavior, including reading-position persistence. |
| `npm --workspace apps/ios run build` | PASS, 12.72 s | Reader frontend; large diagram chunk warnings remain. |
| `npm --workspace apps/ios run test:storage` | PASS | Native storage fixtures: capture/transfer, OS-open validation, Unicode paths, source protection, traversal/atomic failure, limits and deletion. |
| `cargo fmt --manifest-path apps/ios/src-tauri/Cargo.toml --all -- --check` | PASS | Separate Reader native workspace. |
| `cargo test --manifest-path apps/ios/src-tauri/Cargo.toml -p tauri-plugin-reader --locked` | PASS: 1 test | Native plugin contract logic, not an iPhone installation. |
| `swift test --package-path packages/apple-document-store` | PASS: 29 tests, 37.1 s | Shared Apple document-store native package. |
| `python -m unittest discover -s apps/desktop/scripts/caption-evaluation -p 'test_*.py'` | PASS: 78 tests, 8.36 s | Temporary `/private/tmp/polarbear-release-policy-venv/bin/python` with fixture dependencies. Fake recognizer/scorer tests are NOT measured ASR accuracy. |
| PyYAML parse of `.github/workflows/*.yml` | PASS: 5 files | YAML syntax only; not GitHub workflow execution. |
| `git diff --check` and `git diff --cached --check` | PASS | Whitespace/patch consistency. |

## Failures and Re-runs

1. Baseline Clippy failed with 127 diagnostics: fixture unwrap/expect usage and
   placement of a test module before production items. Fixed with test-only
   allowances and relocation of unchanged fixtures. Assertions were retained.
2. The initial sandboxed native invocation failed in 20 cases requiring native
   coordination/filesystem/socket capabilities. An approved native run passed
   59 baseline tests; the final native run passed 61 after two additions. The
   restricted run is not evidence of 20 product defects.
3. New Memory typing and table RAF/listener tests failed against old behavior,
   then passed after the fixes. Closed-source and portal mode-switch cases were
   additional regression protection, not new reproduced defects.
4. A first concurrent Desktop browser invocation reported 62 passes and one
   artifact `ENOENT` collision. Desktop invocations share server/output paths;
   that run is INVALID evidence. Targeted cases were rerun separately, then all
   66 cases passed in one serial invocation. The contribution guide documents
   this constraint; the failed run was not relabeled PASS.
5. Repository extraction initially had a hook dependency warning; ownership was
   made explicit in the scope object and final lint is clean. Tests authored
   before the new module existed initially failed to import it; that is not a
   reproduction of the old refresh race.

The two native ignored entries are an isolated process fixture (actually
executed by the parent cross-process save test) and opt-in real Memory Engine
integration requiring built Engine/runtime paths. The latter was NOT RUN.

## Performance and Platform Limits

Build/bundle observations are in [the scorecard](scorecard.md). No controlled
editor input/open/preview CPU/RSS benchmark was run. Build times taken under
different concurrent workloads cannot support a speedup or regression claim.

NOT RUN in this pass: live provider push/pull/auth-expiry/rate-limit acceptance;
real installed Memory Engine; physical iPhone/iPad; Windows/Linux; Apple Silicon
hardware; real microphone recognition quality/WER; 30-minute, one-hour or
two-hour caption endurance; signed-app launch, notarization and mounted-DMG
checks for the new revision; Lark/Word paste; fresh external vulnerability feed
or penetration testing. Synthetic IME tests do not prove all physical IME paths.

## CI and Release Rules

`quality.yml` now runs all-target Clippy in Native tests. The macOS release job
directly blocks on Desktop browser behavior, bundled Chromium/WebKit translation,
actual Mermaid native paste, native tests/Clippy and Memory contracts in addition
to its existing checks. Browser failure artifacts are retained. Static tests
assert command presence; they do not prove workflow ordering or hosted success.

The existing caption alpha exception remains narrowly scoped: only measured
first-text latency may be advisory for an alpha release. No new exception was
introduced; stable releases and all other safety/correctness checks retain
their existing rules. A failed safety or packaging check is still blocking.

Repository administrators must configure branch rules requiring the actual
successful check contexts, including Quality's `Frontend quality`, `Rust format`,
`Native tests`, and `Desktop editor and clipboard`, plus the applicable iPhone
workflow checks. Verify their exact names in GitHub before selecting them. These
YAML edits do not enable branch protection or private vulnerability reporting.
The iPhone workflow has path filters: do not require a permanently pending check
on unrelated PRs. An always-running aggregate or an adjusted trigger policy is
needed before making a filtered workflow unconditionally required.
Independent research results are not production qualification; a replacement
model requires its own acceptance before changing the shipping engine.

## Manual Acceptance Still Required

1. On a clean-checkout build, edit an open document while opening its Memory
   source: edits remain, and an explicit reload conflict is offered. Close it
   before completion and confirm it does not reopen.
2. Switch repositories A-B-A during a delayed lookup and disconnect during a
   refresh: no previous binding/account or error reappears. Separately verify
   real push/pull cancellation and keychain deletion errors.
3. Open/escape each table menu immediately, switch Live/Preview, resize a column,
   undo/redo and close the document: no orphan portal, focus jump or width leak.
4. Save from two native instances and exercise permissions/external modification
   on representative real filesystems; preserve an independent test copy.
5. Verify settings restart, navigation, translation, captions and iPhone opening
   on actual supported devices. No new persistence migration is expected.
6. Before release, require clean hosted checks and inspect the packaged app and
   mounted DMG from the exact tag. Record artifact/version/OS facts; do not reuse
   a previous alpha's PASS for this implementation.

## Boundary Hardening Follow-up

Date: 2026-10-24. Base: `ad33ca4`; implementation:
`e1fd7c08b0bd8102e97c0b57764a9f17869b2cf2`. Same local Intel/macOS environment.
The six existing Feedback edits were preserved in the worktree and excluded
from this commit, including selective staging of the new locale messages.
These remain local worktree checks, not pristine hosted or installed-app proof.

### Failure Reproduction Before Correction

- External-navigation unit tests: 11 of 12 initially failed against the old
  helper. Native rejection invoked `window.open`, browser mode still invoked
  native IPC, unsafe URLs reached the launcher, and failure feedback was absent.
- Credential tests: extracted the old deletion sequence unchanged behind the
  existing `SecretStore` interface, then injected failures. Both tests failed:
  keychain errors returned success, and fallback errors exposed private paths.
- Native URL tests: both initially failed against the original prefix-only
  policy. Additional malformed authority input (`https:example.com://path`)
  caught a parser-normalization ambiguity before the final policy was accepted.
- Native launcher regression: an actual harmless child process exiting with
  status 7 was incorrectly accepted by the old status-ignoring sequence.
- Repository adapter test: deletion error was not localized before the mapping.

### Final Local Results

| Command | Result | Scope |
| --- | --- | --- |
| `npm --workspace apps/desktop run typecheck` | PASS | Final source and unit-test types. |
| `npm --workspace apps/desktop run lint` | PASS | Final source ESLint, no diagnostics. |
| `npm --workspace apps/desktop run test` | PASS: 59 files / 304 Vitest tests, 30 Node tests | Adds 14 external-navigation and two repository-adapter tests. |
| `npm --workspace apps/desktop run test:ui` | PASS: 69 tests, 3.4 minutes | Adds three actual-App browser tests: native rejection preserves unsaved text and localized feedback, blocked popup preserves page, disconnect failure remains retryable and success clears state. IPC is mocked. |
| `npm --workspace apps/desktop run build` | PASS, 31.41 s | App chunk 1,691.18 kB / 507.72 kB gzip; large-chunk warnings retained. Not a controlled performance measurement. |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-fail-fast` | PASS: 67 passed / 2 existing ignored | Adds two credential and four URL/launcher cases. Ignored entries have the same meaning as the preceding report. |
| `cargo clippy --all-targets --all-features -- -D warnings` | PASS | Final native source and tests. |
| `cargo fmt --all -- --check` | PASS | No repository-wide formatting rewrite. |
| `npm --workspace apps/desktop run memory-contract:check` | PASS | No Memory contract changes. |
| `git diff --check`, staged whitespace and documentation links | PASS | Only this task's source, tests, messages and reports staged. |

### Acceptance and Limits

- PASS: keychain failure cannot be acknowledged as successful disconnect; both
  providers and fallback cleanup are attempted even after partial failure.
- PASS: retries are idempotent in the isolated store; failed disconnect keeps
  the real App command available during the current session. No real user
  credentials were created, read, or removed by these tests.
- PASS: native launcher rejection cannot cross into browser fallback or replace
  the current editor page; safe error feedback does not include the rejected
  URL, OS diagnostic or private path.
- PASS: valid HTTP(S) queries/fragments remain usable and normalization is
  tested. Invalid schemes, authority syntax, control characters, backslashes
  and embedded credentials are rejected before launch.
- NOT RUN: real Keychain denial/prompt UI, OS default-browser dispatch, Windows
  compilation and handler acceptance, Linux desktop handler acceptance, new
  packaged DMG, hosted clean-checkout CI, and iPhone suites in this follow-up.
  The Windows result-code unit test on macOS is not Windows integration proof.
- OPEN: cleanup is not atomic across keychains and fallback storage. Successfully
  removed entries are never recreated. Recovery after partial deletion followed
  by application restart requires a separate test/design; debug fallback file
  creation permissions are unchanged. A hung OS handler also has no new timeout
  in this slice. Broader App decomposition/performance work remains incomplete.

No caption model, latency gate, document format, database schema, dependency or
public command name/argument changed. No tag or DMG is implied by these commits.

## Credential Restart Recovery Follow-up

Date: 2026-10-24. Base: `4fe099f`. Implementation and this report are committed
together. Local Intel/macOS verification only; six unrelated Feedback edits
remain in the checkout and are excluded from staging.

### Test-first Evidence

- Extracted the previous cleanup sequence into the new lifecycle boundary,
  without recovery behavior. Five fault tests failed: no durable intent before
  destructive work, no retained intent after partial failure or metadata failure,
  and no recovery after metadata removal. This tested the old sequence in an
  isolated boundary, not a real Keychain interruption.
- Command-state regression failed because a pending cleanup without an account
  had no enabled/visible disconnect action.
- Browser projection regression failed after reload because pending cleanup was
  absent. The first sandbox attempt could not bind port 1422; the permitted local
  server run reproduced the behavioral failure.
- A real temporary directory with mode 000 reproduced fallback deletion falsely
  succeeding through `Path::exists()`. Permissions were restored and the fixture
  removed; no user credential file was accessed.
- Added a parent regression that starts two independent child processes: the
  first removes a fake GitHub credential and fails GitLab deletion, the second
  recovers the persisted intent and removes the remaining fixture and metadata.
  This is real process recreation with fake credentials, not installed-app or
  system-Keychain acceptance.

### Scope and Manual Acceptance

- Pending cleanup blocks native credential acquisition and reconnect persistence;
  the UI treats it as unauthenticated but retains the existing disconnect command
  in the native menu. Failed cleanup never restores a credential.
- Read failures preserve metadata and use a distinct localized error. Existing
  account/binding formats and command names remain compatible. The secret-free
  intent marker is new; rollback guidance is in [refactoring](refactoring.md#restart-safe-credential-cleanup).
- NOT RUN: real Keychain denial/prompt interaction, Windows/Linux native builds,
  power-loss durability, installed application restart, live provider requests,
  new hosted CI/DMG and iPhone acceptance. No benchmark or ASR endurance was run.
- Remaining limits: debug fallback creation-time permissions; legacy orphaned
  credentials with neither account metadata nor intent; in-flight HTTP requests
  already holding credentials; independent binaries sharing one config directory.

On a disposable test account, deny one Keychain deletion, restart, and confirm
the localized failure plus Cloud Sync disconnect retry remain available. Allow
access and retry: metadata and intent should disappear only after all credential
stores clear. Restart again and confirm no authenticated account or recovery
warning remains. Repeat with the debug fallback directory inaccessible, restoring
permissions before retry. Do not use production credentials for this exercise.

### Final Local Results

| Check | Result | Scope |
| --- | --- | --- |
| Desktop typecheck and lint | PASS | Source and unit-test contracts; no new lint errors. |
| Desktop unit / Node suites | PASS: 308 tests in 59 files; 30 Node tests | Recovery command policy, native menu retry, error-code localization, existing graph and release guards. |
| Desktop browser suite | PASS: 71 tests, 2.7 minutes | Includes projection reload and actual-App retry after reload. Native credential IPC is mocked; bundled translator tests use real assets. |
| Native workspace tests | PASS: 78 passed, 3 ignored entries | Two ignored helpers are executed by their parent tests (save coordination and credential restart). The installed Memory Engine opt-in test remains NOT RUN. |
| `cargo clippy --all-targets --all-features -- -D warnings` | PASS | Native source and tests. |
| `cargo fmt --all -- --check` | PASS | Only touched Rust files were formatted. |
| Desktop production build | PASS: 30.01 s | App chunk 1,692.12 kB / 507.95 kB gzip; existing large-chunk warning retained. Not a benchmark or native DMG build. |
| Memory contract check | PASS | No contract source changes. |
| Whitespace and local documentation links | PASS | Task-only staging; unrelated Feedback work retained. |

The first full browser run had 70 passes and one new-test assertion failure:
successful cleanup removes the status node, so a negative text assertion still
waiting for that node was invalid. The assertion now checks that the loaded
editor has no status node. The complete suite above was rerun, not reported from
the failed run. No product guard or acceptance threshold was relaxed.

## Credential Publication and Native Repository Extraction

Date: 2026-10-24. Base: `358d0b20b37f8bbb199e6b4dc6e35442baa13ecc`.
Implementation and this report are committed together. Environment: Intel
macOS 26.5.1, Node 26.1.0, existing locked dependencies. The six pre-existing
Feedback changes remain in the tested checkout but are excluded from the commit.
No real credential file or system Keychain entry was read, written or deleted
by the regression fixtures.

### Test-first Evidence

1. Two new tests ran against the previous `fs::write` + chmod implementation:
   the symlink write succeeded and the hard-linked alias received the new token.
   Both failed before private atomic publication and pass after it.
2. A new crash-staging cleanup test failed after introducing atomic publication:
   disconnect removed the final file but left the unpublished credential copy.
   Cleanup now removes only UUID-named staging files, attempts every entry after
   a failure, retains unrelated files and supports idempotent retry.
3. The permissions fixture inspects the actual open descriptor before any
   content is written, injects a partial write failure, and checks old content
   and absence of staging leftovers. A separate child process runs it with
   umask 000. The parent process never changes its global umask.
4. A macOS fixture installs an inherited read ACL, verifies a control file really
   inherits it, then checks the staging file has no ACL entries before content.
   Its first assertion incorrectly assumed account lookup prints `everyone`;
   this machine prints its UUID. The corrected test checks the inherited grant
   and then the absence of all ACL entries, not a relaxed permissions policy.
5. Five repository characterization tests passed before and after extraction:
   provider path encoding/scoping, JSON/legacy defaults, manifest changes, local
   scan exclusions/symlinks, and loopback HTTP authentication/permission errors.
   No live GitHub/GitLab token or remote mutation is used.
6. The engineering-branch CI trigger test failed against the old main-only push
   list. The new trigger passes. A native boundary/registration assertion also
   protects all ten existing command identifiers and model ownership.
7. The connection adapter test reproduced a private native diagnostic being
   exposed instead of a localized secure-write failure. Both locale resources
   and the existing error mapping now cover `repository.secretWriteFailed`;
   successful connections and unrelated errors retain their original behavior.

### Final Local Checks

| Command / check | Result | Scope |
| --- | --- | --- |
| `npm --workspace apps/desktop run test` | PASS: 310 Vitest tests / 59 files; 32 Node tests | Includes connection errors, native boundary registration and branch trigger. |
| `npm --workspace apps/desktop run typecheck` | PASS | Final TS source and tests. |
| `npm --workspace apps/desktop run lint` | PASS | No new lint errors. |
| `npm --workspace apps/desktop run test:ui` | PASS: 71 browser cases | Complete final suite rerun after localized connection mapping; native credential IPC mocked, bundled translation uses actual local assets. |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-fail-fast` | PASS: 92 passed, 3 ignored entries | Two child helpers are invoked by their parent regressions; the real installed Memory Engine opt-in test is NOT RUN. |
| `cargo clippy --all-targets --all-features -- -D warnings` | PASS | Final native source and tests. |
| `cargo fmt --all -- --check` | PASS | Formatting restricted to changed files; no repository-wide autoformat. |
| `npm --workspace apps/desktop run build` | PASS: 28.83 seconds | App chunk 1,692.18 kB / 507.92 kB gzip; existing large-chunk warning remains. Not a DMG build or performance benchmark. |
| `npm --workspace apps/desktop run memory-contract:check` | PASS | Canonical contract unchanged. |

During extraction, the initial compile found six missing imports in the remaining
workspace commands; these were restored explicitly. The initial fmt check also
found one moved config-path call needing wrapping. Full native tests, all-target
Clippy and fmt were rerun after correction. No gate was skipped or threshold
weakened. Moving functions is not performance evidence: main shrank from 3,449
to 1,446 physical lines, but the provider and sync algorithms are unchanged.

### Hosted CI and Remaining Acceptance

The GitHub Actions API returned **zero runs**, not success, for the previous
commit `358d0b2`. The repository's Quality workflow listened only to main pushes
and PRs. It now also listens to `codex/**` pushes; actual post-push run status is
reported separately and must not be inferred from this local report. No tag,
DMG, branch-protection change or new release qualification is claimed.

NOT RUN: actual system-Keychain denial prompts, Windows/Linux execution, real
provider synchronization, installed-app upgrade/restart, power-loss durability,
iPhone suites, ASR accuracy/endurance and a controlled editor performance study.
The newly hardened file path is a Unix debug fallback; release storage remains
system-Keychain only, and non-Unix debug builds now also require that store.
Legacy files are made private on replacement; previously leaked copies cannot
be revoked. In-flight requests already holding tokens and hostile same-user
processes are outside this file-publication guarantee.

For manual acceptance on a disposable debug profile: deny Keychain storage,
connect with a test credential, verify the fallback is private, reconnect and
disconnect, then restart and confirm no account, intent, final fallback or UUID
staging files remain. Deny configuration-directory write access and confirm the
localized connection failure does not report success. Restore permissions before
cleanup. Use a release build separately to confirm Keychain denial never creates
a plaintext fallback. Do not use production credentials for these exercises.

### Clean-Job CI Prerequisite Follow-up

The first branch run for `0609fb2355265a15afae460c43faba1bd22bbce8`,
[Quality 40084576906](https://github.com/smartscity/polarbear/actions/runs/40084576906),
finished with Frontend quality, Rust format, and Desktop editor and clipboard
passing. Native tests failed at all-feature Clippy: Tauri's `generate_context!`
requires `../dist` when `custom-protocol` is enabled, but this independent job
never built the frontend. Local validation had an existing production build;
that did not prove fresh-job prerequisites were complete.

The workflow-order regression failed before the fix. Native CI now installs
the locked Node dependencies and builds the real frontend before Clippy, while
retaining `--all-targets --all-features -- -D warnings`. A command-scoped local
`TAURI_CONFIG` override pointing `frontendDist` to a nonexistent temporary path
reproduced the exact macro failure (exit 101), without moving user assets or
changing committed configuration. Desktop tests were rerun after the fix:
310 Vitest tests and 33 Node tests passed. This check does not pretend that a
local dependency cache is a fresh `npm ci` installation; the hosted job is the
independent-checkout verification.

After removing the command-scoped override, the real production frontend build
passed (46.51 seconds), followed by normal all-target/all-feature Clippy (74
seconds), Rust formatting and `git diff --check`. The existing large frontend
chunk warning remains. This CI-only follow-up changes no runtime source; the
92 native and 71 browser cases above are from the preceding implementation
verification, not a claim that those suites were rerun for a YAML-only edit.

## App and Live Editor Ownership Follow-up

Baseline: `aa936d28540c7bf8c8195cc34d9557b205bd1049`. Its hosted
[Quality run](https://github.com/smartscity/polarbear/actions/runs/40085277162)
passed all four jobs. The following evidence is from this implementation run on
macOS 26.5.1, Intel x86_64, with Node 26.1.0; it is not release or device evidence.

### Test-first Findings

- The fenced-code browser regression failed before the scanner fix: a Markdown
  table inside an ordinary code fence produced one interactive table widget
  instead of zero. Images and callouts shared the same scanning problem.
- Three characterization cases passed before extraction: connection failure and
  retry, status failure and retry, and mixed-block source/menu lifetime. Initial
  fixture mistakes (a guessed menu class and connecting an already-connected
  account) were corrected against the existing UI, not by weakening behavior.
- A subsequent delayed-status regression failed before its fix: a response for
  workspace A reopened the status dialog after opening B. The workspace-lifetime
  guard now rejects that completion and releases only its stale read projection.
  A selector matching both Settings and Sync was corrected to the exact Sync
  action. Native mutations are not claimed to be cancelled by this guard.
- Eleven pure scanner cases cover raw/range preservation, aliases, ordinary and
  unfinished fences, frontmatter, and deterministic identities. An architecture
  check protects the new App/workflow and React/scanner/widget boundaries.

### Local Gates

| Check | Result | Evidence |
| --- | --- | --- |
| Desktop Vitest | PASS | 321 tests in 60 files. |
| Desktop Node tests | PASS | 34 tests, including dependency/ownership guards. |
| Full Desktop Playwright | PASS | 76 tests, 5.1 minutes; includes save races, external reload, Context persistence, table width/history and real multi-diagram clipboard generation. |
| Native clipboard receiver | PASS | Actual generated fixture: all three Mermaid image attachments and surrounding text; Unicode, four pasteboard representations, single-image copy and stale-copy protection also pass. This is an AppKit receiver, not Word/Lark acceptance. |
| Bundled offline translation | PASS | Chromium and WebKit production CSP, sentence/paragraph inference and request cancellation. |
| Desktop typecheck / lint | PASS | Final source, no lint warnings. |
| Desktop build | PASS | 28.47 seconds; existing large-chunk warning remains (App chunk 1,693.87 kB, gzip 509.03 kB). |
| Native Cargo tests | PASS | 92 passed, 3 ignored entries; two child helpers are invoked by parent tests, installed Memory integration remains opt-in. |
| Clippy | PASS | All targets and all features with warnings denied. |
| Rust format / Memory contract | PASS | No native contract changes. |

App is reduced from 4,328 committed lines to 3,917 for this slice, and the live
React editor host from 3,122 to 383. These are ownership measurements, not latency
or maintainability scores. Unrelated pre-existing Feedback UI edits are excluded
from this commit. No new dependency, persisted format or migration is introduced.

NOT RUN: installed-app upgrade/restart, real provider account synchronization,
Windows/Linux/iPhone acceptance, ASR accuracy/endurance and a controlled editor
performance study. Browser repository tests use the existing Tauri test boundary;
they do not prove remote provider behavior. Document-session/zoom extraction,
table widget internal decomposition and other audit items remain explicitly open.
The post-push CI result must be checked against this commit, not inferred from
the passing baseline or local cache.

## Document Session, Zoom and Table Ownership Follow-up

Baseline: `aac3e472e6836e153c38dfe99584449d418a97de`. GitHub independently
confirmed that its [Quality run](https://github.com/smartscity/polarbear/actions/runs/40087173802)
passed. The following local evidence is from macOS 26.5.1, Intel x86_64, Node
26.1.0. It is not installed-app, release, hardware gesture or performance evidence.

### Test-first Findings

- Delayed Save As failed before its fix: finishing the save after switching to
  another workspace activated the renamed source document. The session now
  updates inactive document identity without taking over the current workspace.
- Delayed close failed before its fix: closing the original tab after a new tab
  was opened discarded the new tab. Completion now reads the current tab list.
- Reset versus a queued gesture failed before its fix: the canvas returned to a
  scale of approximately 1.43333 instead of `none`. Reset now cancels queued
  frames and settle/unlock timers before committing its transform.
- A dual-editor Table insertion failed before its fix: the second editor inserted
  a column but focused the first editor's same-offset table. Focus lookup and
  delayed restoration now belong to the originating EditorView/document.
- Three adapter lifecycle tests initially failed because the explicit subscription
  API did not exist. Two additional fault tests reproduced uncontained asynchronous
  unlisten rejection, including a registration arriving after disposal. The
  adapter now releases each registration once, ignores disposed events, reports
  active registration errors and logs cleanup failure without updating a closed UI.
- The first complete browser pass found a locale-dependent regression introduced
  during extraction: switching language repeated the native zoom baseline and
  subscription. A strengthened assertion records both calls. Stable error
  callbacks preserve current translation without reinitializing the subscription.
- The extra cross-workspace close characterization passes without another
  production fix. Its initial empty-tree failure came from an incomplete fixture
  returning no files on refresh; that was corrected, not counted as a product
  defect. One intermediate attempt was invalidated by development-server HMR and
  rerun after source changes stopped. Other initial fixture corrections included
  waiting for App mount and using the actual ReactDOM module export.

### Scope and Remaining Risk

`App` delegates session and zoom ownership; Table composition delegates input,
menus, sizing, clipboard and transactions. Cell edits and structural edits now
share the same transaction bridge while retaining their existing user-event
annotations. Existing Markdown, IPC, settings and history formats remain intact.

The staged App is 946 lines, down from 3,917; the Table widget is 217 lines,
down from 1,214. The session (1,685 lines) and zoom hook (1,228 lines) remain large
owners internally. Those measurements establish separation, not a speedup or
proof that every asynchronous filesystem mutation is safe.

NOT RUN: real trackpad/native-window gesture acceptance, installed-app upgrade,
physical IME, Windows/Linux/iPhone acceptance, remote repository sync faults,
ASR accuracy/endurance and a controlled performance benchmark. Rename/move/delete
completion races, pending diagram admission, multi-window settings contention and
maintainer licensing decisions remain in the audit. No tag or DMG is produced by
this engineering-only batch. Pre-existing Feedback UI edits remain unstaged.

### Local Gates

| Check | Result | Evidence |
| --- | --- | --- |
| Desktop Vitest | PASS | 326 tests in 61 files, including five native pinch subscription lifetime tests. |
| Desktop Node tests | PASS | 35 tests, including App/session/zoom/Table boundary guards. |
| Full Desktop Playwright | PASS | 81 tests, 6.3 minutes, after correcting the locale regression and fixtures. |
| Native clipboard receiver | PASS | This run's generated payload: all three real Mermaid attachments and surrounding text; Unicode, four clipboard formats, single-image copy and stale-copy protection. AppKit receiver only, not Word/Lark acceptance. |
| Bundled offline translation | PASS | Chromium and WebKit production CSP, sentence/paragraph inference and cancellation. |
| Desktop typecheck / lint | PASS | No TypeScript errors or lint warnings. |
| Production frontend build | PASS | 56.98 seconds on the loaded local machine; App chunk 1,697.02 kB, gzip 509.84 kB. Existing large-chunk warning remains; timing is not a benchmark. |
| Native Cargo tests | PASS | 92 passed, 3 ignored entries; subprocess helpers are invoked by parent tests, installed Memory integration remains opt-in. |
| All-target/all-feature Clippy | PASS | Warnings denied; rerun after the final frontend asset build. |
| Rust format / Memory contract | PASS | No native contract or schema change. |
| Dependency graph | PASS | 181 production TypeScript files; zero runtime cycles, forbidden reverse dependencies, unresolved or computed imports. 24 cross-feature edges are recorded, not claimed eliminated. |

Only trailing blank lines were removed from three new files after these runtime
checks; executable statements are unchanged. The staged commit excludes the
pre-existing Feedback additions. Hosted CI must be checked for the pushed SHA;
the baseline result and local cache are not substitutes for that result.
