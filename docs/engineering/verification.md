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
