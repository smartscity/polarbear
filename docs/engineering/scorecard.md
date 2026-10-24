# Engineering Quality Scorecard

Date: 2026-10-24. Baseline `166e231c`; implementation `2747dc36`.
See [audit](audit.md) for findings and [verification](verification.md) for scope.

## Rubric

Scores below measure **evidence maturity in the audited slice**, not customer
satisfaction, defect probability, or a certified whole-product grade:

- 0: no usable evidence in this pass.
- 1: inspected and limitations documented.
- 2: targeted repeatable tests/checks exist and run locally.
- 3: layered regression plus configured blocking CI for that slice.
- 4: corresponding current-revision hosted/package/device or measured workload
  acceptance has also been demonstrated.

No aggregate score is calculated. In particular, 3/4 does not imply 7.5/10
product quality. Unmeasured performance and unverified release environments
prevent a defensible 9.5-10 claim.

| Dimension | Before | After | Evidence and remaining limit |
| --- | ---: | ---: | --- |
| Correctness | 2 | 3 | Existing units/native tests; new real editor race/lifecycle regressions and release browser gate. Installed-app acceptance remains separate. |
| Architecture | 1 | 2 | Owner extraction plus executable TS import graph. App and main responsibilities remain broad; graph is not a complete native/runtime dependency model. |
| Code quality | 1 | 2 | All-target Clippy now clean under explicit fixture policy; duplicate portal lifecycle removed. No measured duplication/complexity or complete dead-code proof. |
| Maintainability | 1 | 2 | Repository identity, table menu lifetime and path policy have separate ownership and tests. Major core decomposition remains partial. |
| Reliability | 2 | 3 | Existing save/IPC failure coverage plus stale-read and disposal regressions; CI configuration strengthened. No two-hour hardware endurance result. |
| Security | 2 | 2 | Native path/permission/contract checks rerun; no changed trust model. Credential deletion, external URL fallback and platform-specific risks remain open. No fresh advisory database scan. |
| Performance | 0 | 0 | Bundle/build observations exist, but no controlled editor latency/CPU/RSS before-after experiment. No speedup claimed. |
| Testability | 2 | 3 | 10 added browser cases, two native path cases, three Node graph/gate checks; actual translation and clipboard integration rerun. Coverage percentage unmeasured. |
| Release quality | 2 | 3 | macOS release now runs the critical checks directly. Current-revision hosted execution, new DMG and physical-device acceptance not established. |
| Open-source governance | 1 | 2 | Contribution/security/verification guidance added. Root license grant/texts and GitHub settings still require maintainer decisions. |

## Measurements

| Metric | Before | After | Interpretation |
| --- | --- | --- | --- |
| Desktop Vitest | 57 files / 288 passing tests | 57 files / 288 passing tests | New UI regressions belong in browser tests, not a fabricated unit-test increase. |
| Desktop Node tests | 27 passing | 30 passing | Dependency and workflow assertions added. |
| Desktop browser cases | 56 existing cases; no clean full baseline run claimed | 66 passing in 2.5 minutes | 10 additions; targeted old-behavior failures recorded separately. |
| Desktop native tests | 59 pass, 2 ignored | 61 pass, 2 ignored | Two added path-policy cases; child save process fixture is invoked by its parent test. |
| All-target Clippy diagnostics | 127 errors | 0 | 126 fixture unwrap/expect diagnostics and test-module placement, not 127 production defects. |
| Runtime TS cycles / forbidden reverse edges | No automated graph gate | 0 / 0 in 167 files | Current scan proves the scoped graph, not all possible dependencies. |
| Cross-feature TS edges | Not used as a deletion target | 21 | Includes legitimate diagram composition and type-only coupling. |
| Desktop App JS chunk | 1,690.44 kB / 507.26 kB gzip | 1,690.51 kB / 507.50 kB gzip | Vite output units; chunk-size warning remains. |
| Desktop production build | 18.11 s | 24.12 s | Different concurrent machine load; not a controlled performance regression or improvement measurement. |
| iOS production build | 12.72 s | No changed iOS production sources | Build passed; large Mermaid/diagram chunks still warned. |
| Real editing latency / CPU / RSS | Not measured | Not measured | Must be measured using a fixed workload before optimization claims. |
| Branch/line coverage / duplicate ratio | Not measured | Not measured | Passing tests do not imply complete coverage. |

## Acceptance Status

Local correctness gates for this slice pass. The broad governance target remains
**PARTIAL**, not achieved: composition-only core entry points, controlled
large-document performance, comprehensive security fault testing, hosted
required-check enforcement, license completion, and device/release acceptance
are outstanding. Existing product behavior has no regression observed in the
executed suites; unexecuted platforms are not covered by that statement.

## Boundary Follow-up Evidence

Implementation `e1fd7c08b0bd8102e97c0b57764a9f17869b2cf2` closes the reproduced
credential deletion acknowledgement and external-navigation fallback defects.
The original scorecard above remains its dated baseline, not rewritten history.

| Metric | Before follow-up | After follow-up |
| --- | --- | --- |
| Desktop Vitest | 288 tests / 57 files | 304 tests / 59 files, PASS |
| Desktop browser | 66 tests | 69 tests, PASS |
| Native Rust | 61 passed / 2 ignored | 67 passed / 2 ignored |
| Code/contract gates | Passing | Typecheck, lint, fmt, Clippy, Node graph/contract checks still pass |
| Security boundary evidence | Suspected URL impact and inspected deletion bug | Reproduced negative tests plus guarded implementation and actual-App browser regression |

The security dimension remains 2: these targeted checks do not establish whole-
application security or real Windows/Keychain acceptance. No overall numerical
quality increase or performance improvement is asserted. Remaining scope is
explicit in [verification](verification.md#boundary-hardening-follow-up).

## Restart Recovery Follow-up Evidence

The slice based on `4fe099f` adds durable cleanup intent, distinct read failures,
native identity ownership and UI retry after restart. It closes the scoped
restart gap; it does not complete overall architectural governance.

| Metric | Previous slice | Current local result |
| --- | --- | --- |
| Desktop Vitest / Node | 304 / 30 | 308 / 30, PASS |
| Desktop browser | 69 | 71, PASS after correcting a new-test absent-node assertion |
| Native Rust | 67 passed / 2 ignored | 78 passed / 3 ignored; two child helpers actually invoked by parent tests |
| Restart evidence | Same-session deletion retry only | New subprocess consumes persisted intent after partial fake-credential deletion; browser reload retains the retry command |
| Permission evidence | Injected fallback failure | Real inaccessible-directory fixture reproduces and prevents false deletion acknowledgement |
| Core decomposition | Identity persistence in main | Account DTO, provider normalization, credential access, persistence and recovery in `repository_identity.rs`; provider HTTP and sync remain in main |

Typecheck, lint, fmt, all-target/all-feature Clippy, build and Memory contract
checks pass. Security score remains 2; real Keychain/Windows/installed-app and
power-loss acceptance are not inferred from local fixtures. Debug fallback
creation permissions and broader core decomposition remain open. Detailed
limits and commands are in [verification](verification.md#credential-restart-recovery-follow-up).

## Credential Publication and Repository Ownership Follow-up

Based on `358d0b2`; current-run results are in
[verification](verification.md#credential-publication-and-native-repository-extraction).

| Metric | Previous slice | Current local result |
| --- | --- | --- |
| Desktop Vitest / Node | 308 / 30 | 310 / 32, PASS |
| Desktop browser | 71 | 71, PASS on the final source |
| Native tests | 78 passed / 3 ignored entries | 92 passed / 3 ignored entries; existing child-process helpers still executed |
| Credential publication | Write first, chmod later; follows links | Private exclusive staging before content, macOS ACL removal, atomic replacement, symlink rejection and crash-staging cleanup |
| Native core ownership | Repository HTTP/DTO/sync in main | Explicit repository command/model/policy/provider/store/progress owners; main 3,449 to 1,446 lines |
| Previous branch CI | Not established | API confirmed zero runs for `358d0b2`; Quality trigger now includes engineering branches |

Scores remain unchanged: source decomposition and local security fault tests do
not establish whole-product security, Windows acceptance, measured performance,
or hosted success. App/editor ownership, pending-render pressure, multi-window
settings contention, licensing decisions and physical-device acceptance remain
open. No overall completion or speedup is inferred from fewer lines in main.

## App and Editor Ownership Follow-up

Based on `aa936d2`; detailed evidence is in
[verification](verification.md#app-and-live-editor-ownership-follow-up).

| Metric | Previous verified slice | Current local result |
| --- | --- | --- |
| Desktop Vitest / Node | 310 / 33 | 321 / 34, PASS |
| Desktop browser | 71 | 76, PASS |
| Native tests | 92 passed / 3 ignored entries | Same suite rerun: 92 passed / 3 ignored entries |
| App ownership | Repository workflow and dialogs inline | Feature workflow/dialog host; document save/reload callbacks stay with App |
| Live editor ownership | 3,122-line React/scanner/DOM implementation | 383-line React host with separate pure scanner, decoration policy and feature widgets |
| Confirmed regressions | Not previously covered | Fenced Markdown examples remain code; old-workspace status reads cannot reopen dialogs |
| Hosted baseline | Fresh-job prerequisite fix pending | `aa936d2` Quality run passed all four jobs; new commit CI checked separately |

Scores remain unchanged. This slice establishes tested responsibilities, not a
complete App document-session extraction, whole-product acceptance or measured
performance improvement. No second store, event bus or command system was added.
