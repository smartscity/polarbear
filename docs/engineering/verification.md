# Engineering Verification

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
