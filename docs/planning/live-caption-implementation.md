# Live Caption implementation evidence

Date: 2026-10-17. Baseline: `a7894ae`. Owner: [approved design](live-caption.md).
Delivery status: **PARTIAL / preview**, not a completed D0-D5 or stable release.
The design still requires Both mode with proven echo cancellation; it is not
implemented or exposed by this preview. No user audio was captured for testing.

## Implemented ownership

| Boundary | Implementation |
| --- | --- |
| Settings, panel, history and copy | `apps/desktop/src/features/caption/`; existing commands, preferences v3, EN/ZH properties and theme tokens |
| Window bootstrap | `apps/desktop/caption.html`, `src/main.tsx`; dedicated caption and translator surfaces without mounting the editor |
| Native session control | `src-tauri/src/live_caption/mod.rs`; serialized start/pause/resume/stop, close/quit cancellation, typed request routing and scoped window labels |
| Native audio | `src-tauri/native/LiveCaptionCapture.swift`; macOS 13+ ScreenCaptureKit system audio or AVAudioEngine default microphone; older editor deployment target retained |
| Recognition process | `native/caption-engine/`; direct absolute executable/argv, empty environment, bounded PCM protocol and JSON events, no shell or runtime download |
| Persistence | `live_caption/store.rs`; independent local SQLite history, atomic finalized-English/job insertion, translation leases, paging, migrations and recovery |
| Translation | `src/shared/translation/`; existing bundled Bergamot engine moved without duplicating its model. Selection translation retains its own latest-request lifecycle |
| Distribution | `scripts/build-caption.mjs`, `tauri.macos.conf.json`, release workflow; source/model hashes, static helper, bundled licenses and universal helper check |

The audio callback converts to 16 kHz mono frames. Rust bounds pending PCM to about
ten seconds and stops on overflow rather than silently dropping speech. The helper
uses Silero VAD, provisional English and finalized English. The final segment and
translation job share a SQLite transaction. The caption translator leases work;
expired/stale completion cannot replace newer work. English stays available when
translation fails. No raw audio is written to history or passed to Memory/Vocab.

Capture stops on explicit pause/stop, panel/main close, quit, reported device loss,
sleep/session lock and panel heartbeat loss. Native behavior for these transitions
still requires real OS acceptance. Acquisition is never restarted by saved settings
or history recovery. Source changes require stopping first in this preview.

## Assets and reproducibility

Pinned provenance lives in `src-tauri/resources/caption/manifest.json`:

- whisper.cpp v1.9.5, commit `d1be6fde11ac6e0407606b4e42fe72d34add8037`.
- Q5_1 English `base.en`, 59,721,011 bytes, SHA-256
  `4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f`.
- Silero VAD v6.2.0, SHA-256
  `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987`.
- Recognition source archive and both model files are vendored. Generated helper
  binaries stay ignored and are rebuilt per architecture. No Apple language pack
  is required for this translation path. English/Chinese assets already shipped by
  the reading feature are reused.
- Model, whisper.cpp and nlohmann JSON MIT notices ship with the resources.

`npm --workspace apps/desktop run caption:build` builds the host helper;
`-- --universal` builds both Apple Silicon and Intel. Tauri production builds invoke
the script automatically. CI builds both architectures and checks a fixed English
audio fixture, silence, and an invalid protocol frame before uploading artifacts.

## Persistence and copy

History path: Tauri `app_local_data_dir()/live-caption/history.sqlite3` (not the
Workspace and not `memory.db`). Unix directory/file permissions are 0700/0600.
SQLite WAL, foreign keys and FULL synchronous writes are used. Schema v2 adds
session timezone; migrations are repeatable. Interrupted sessions remain history.
There is no transcript TTL, cloud sync, automatic geolocation or audio retention.

The Copy button snapshots all committed segments, not just the 200-row visible
tail. Default output is English followed by available Chinese in source order.
English-only, Chinese-only and timestamp options persist. Partial recognition is
never copied. Pending translations are reported after successful clipboard write.
Clipboard is limited to 8 MiB, export to 64 MiB; oversize data fails explicitly.
TXT/Markdown/SRT export uses the same formatter and atomic native file writing.
OS clipboard managers may still synchronize explicitly copied text.

## Executed verification

Environment: Intel macOS 26.5.1, Xcode macOS 26 SDK, Node 26.1.0. Tests do not imply
that the currently installed `/Applications` app was replaced or tested.

| Check | Evidence / interpretation |
| --- | --- |
| Actual offline ASR | Upstream fixed 11-second JFK fixture produced three finalized segments including the expected word; empty environment, absolute helper/model paths |
| Silence / malformed PCM | Silence produced no finalized segment; oversized frame rejected with exit code 4 |
| Helper architectures | arm64 and x86_64 built and combined with lipo; arm64 compilation is not execution evidence |
| Actual offline translation | Playwright invokes the real bundled Bergamot worker with nonlocal network requests blocked; output contains Chinese |
| UI | 18 browser tests passed, including copy, bilingual ordering/pending notice, pause/resume, history export/reveal, narrow dark panel, live locale/theme changes and existing editor regressions; native IPC is mocked for capture cases |
| Storage | Idempotent segments, leases/stale result protection, interrupted recovery, deletion, query-only write failure, 450-row paging and database reopen |
| Baseline regression | Desktop typecheck/lint and Rust fmt passed; 44 Vitest files (207 tests) plus four Node tests passed |
| Rust baseline | 29 passed, one existing real Memory Engine E2E ignored; includes seven caption storage/migration tests |
| Local production bundle | Intel `.app` build passed. Both packaged ASR model hashes match the manifest; microphone usage description is present; ScreenCaptureKit is weak-linked; helper has no non-system dylib dependency |
| Packaged helper execution | The helper inside the built `.app` passed the JFK, silence and malformed-input checks with an empty environment; this does not exercise native capture or WKWebView |
| Strict Clippy | Blocked by existing `needless_return` diagnostics in `src-tauri/src/reading_native.rs`; not reported as passing |

The Intel fixture took approximately 15.8 seconds in one CPU-only run and 9.3
seconds from the packaged helper while other work was running. This is **not a real-time latency pass**, WER study,
or sustained-session performance qualification. CPU-only Intel may not keep up;
the bounded backlog then stops capture with an explicit error. Model/profile and
performance acceptance must be completed before a stable Live Caption release.
The preview checks for AVX2/FMA/F16C/BMI2 before launching its Intel helper;
unsupported processors keep editor/history access without an illegal-instruction
crash. Old macOS version availability is checked before spawning the macOS 13 helper.

The local bundle is `target/release/bundle/macos/Polarbear.app`, with preview version
`0.10.0-alpha.1`. The installed application was not replaced. Universal DMG creation
belongs to the tag-triggered release workflow; a successful local Intel `.app`
build is not proof that GitHub produced or uploaded a DMG.
The local `.app` is not distribution-signed/notarized (`codesign --verify --deep`
reports the application is unsigned); the generated helper itself is ad-hoc signed.
Packaging success does not establish Gatekeeper acceptance or a signed release.

## Release timeout follow-up (2026-10-17)

The `v0.10.0-alpha.1` release reached the offline fixture gate after building the
DMG, then exceeded 120 seconds. The old harness discarded stderr and did not print
case progress, so the historical log does not establish whether model loading,
inference or process shutdown stalled. It is not evidence of a Node version bug.
The same baseline fixture passed locally on Intel in 13.8 seconds. The release
runner (`macos-26`) is ARM; the previous helper automatically enabled Metal on ARM
but disabled it on Intel. Its CPU fallback only handled a returned initialization
failure, not a hanging call. This is an unqualified backend difference, not a
proven exact stack trace for the historical timeout.

The preview now builds and selects CPU on both architectures, including production;
there is no CI-only recognition bypass. Metal remains disabled until separately
qualified. The fixed 120-second deadline and speech/silence/malformed-input
assertions remain. The harness logs sanitized phases and ten-second heartbeats,
kills and reaps stalled children, rejects malformed/bounded protocol output, and
reports exit/signal details. Eight process-supervision regressions exercise these
paths. A separate workflow runs actual fixed-audio inference on ARM and Intel before
waiting for a full DMG build. The release gate checks the helper inside the packaged
`.app`, verifies both architecture slices, and retains its diagnostic log as an artifact.
The previous `lipo -verify_arch arm64 x86_64 <file>` invocation also failed locally:
Apple's lipo treated the trailing filename as another architecture. The release
check now puts the input file before `-verify_arch`, preventing that next failure.

This is a conservative compatibility mitigation plus diagnostic correction.
CPU real-time performance and the historical timeout's exact native stack remain
unqualified; passing a fixture is not full Live Caption acceptance.

Verification for implementation commit `cdb131b`:

- [Caption Engine CI run 39021113083](https://github.com/smartscity/polarbear/actions/runs/39021113083)
  passed on `macos-26` ARM and `macos-15-intel`. Both actually executed the speech,
  silence and malformed-frame cases. The complete fixture steps took 56 seconds
  and 23 seconds respectively; these include repeated model loads and are not
  end-to-end live caption latency measurements.
- [Quality run 39021113153](https://github.com/smartscity/polarbear/actions/runs/39021113153)
  passed all four jobs: frontend quality, Rust format, native tests, and desktop
  editor/clipboard browser tests.
- Locally, 207 Vitest tests and 12 Node tests passed; typecheck/lint passed.
  The universal helper compiled and passed the corrected lipo check. The Intel
  production `.app` built, and its packaged helper passed all three fixed-audio
  cases with an empty environment (11.4 seconds for the speech case).
- No live microphone/system audio was captured. No local ARM execution or
  real-time performance claim is implied by cross-compilation or CI success.

## Remaining gates and limitations

### Packaging lifecycle regression in v0.10.1

The v0.10.1 release failed after DMG creation, before inference: the workflow used
`tauri build --bundles dmg`, then tried to execute a helper in the intermediate
`.app`. Tauri intentionally removes that app when the app bundle was not requested.
This is not a missing model or a caption timeout. The previous local verification
used `--bundles app`, so it did not reproduce the release packaging lifecycle.
Native fixture tests and universal compilation were insufficient release evidence.

The original behavior was reproduced locally using `tauri bundle --bundles dmg
--ci`: packaging succeeded and logged `Cleaning .../Polarbear.app`. The new artifact
check then correctly failed with the explicit dmg-only cleanup diagnosis.

The corrected workflow requests `--bundles app,dmg`. Artifact discovery uses Cargo
metadata, the build target and configured product name, requires both the packaged
helper and exactly one DMG, and never falls back to source-tree resources or picks
an arbitrary stale image. Six regression checks cover native/universal layouts,
spaces/custom target directories, the deleted intermediate app, missing packaged
resources, missing/ambiguous DMGs, and the workflow bundle/verification ordering.

Relevant main-branch changes now run the same universal macOS build and verification
job before a tag is created. Branch runs upload a test artifact but cannot publish
a GitHub Release or start the Windows release job. Tag runs retain release behavior.
The release gate checks both retained `.app` and a read-only mounted DMG, executing
the fixed speech/silence/malformed-input tests against the resources actually in
each artifact. The DMG is detached on success or failure. Artifact upload follows
these checks; neither static workflow guards nor unit tests replace actual packaging.

Local verification on Intel macOS 26.5.1: the original dmg-only cleanup was
reproduced; `tauri build --bundles app,dmg --ci` then completed with both outputs
retained. Artifact discovery passed. Both the retained app and the read-only
mounted DMG passed actual speech, silence and malformed-frame checks (speech cases
10.1 and 11.4 seconds). The image detached successfully; the installed application
was not replaced. All 207 Vitest and 18 Node tests passed. Universal packaging and
GitHub artifact upload still require the main-branch packaging run; local Intel
packaging is not substituted for that evidence.

Remote evidence for fix `bc59c7e`:
[pre-tag universal packaging run 39022762731](https://github.com/smartscity/polarbear/actions/runs/39022762731)
successfully built both bundles, located their packaged resources, checked universal
architectures, executed the app and mounted-DMG fixture suites, detached the image,
and uploaded the macOS DMG artifact. The GitHub Release upload step was correctly
skipped on main. [Quality run 39022762704](https://github.com/smartscity/polarbear/actions/runs/39022762704)
also passed. This closes the packaging lifecycle regression; it does not close
the remaining native capture, signing/notarization or real-time performance gates.

- **NOT IMPLEMENTED:** simultaneous System + Microphone, echo cancellation and
  dual-source timestamp alignment. Do not advertise meeting Both mode as ready.
- **NOT IMPLEMENTED:** microphone picker, saved monitor-safe window geometry,
  caption font preference, Show data folder, dedicated date-range filter.
- **NOT RUN:** real browser/WeChat audio capture, microphone permission deny/revoke,
  lock/sleep/wake, device disconnect, hidden WKWebView scheduling and quit races.
- **NOT RUN:** clean installed app with networking blocked, real Apple Silicon
  capture sessions, older macOS launch, multi-monitor/full-screen/VoiceOver acceptance.
- **NOT RUN:** annotated accent/name/number WER corpus, music/non-English
  hallucination corpus, one-hour memory/latency/editor-responsiveness measurement.
- **PARTIAL:** persistence failures are tested with query-only mode, not actual
  disk-full or destructive process termination while committing.
- **PARTIAL:** metadata date search accepts YYYY-MM-DD (UTC SQL date); a complete
  local-time date range UI remains necessary.

None of QG-01 through QG-10 is globally declared PASS merely because an individual
unit, browser or build check passed. Keep this release a preview while any
mandatory gate remains open. No live audio may be captured covertly for acceptance.

## Native manual acceptance procedure

1. Use a consented prerecorded English fixture and a separate test installation.
   Block external networking and ensure no user model cache is available.
2. Open Settings. Confirm capture starts off. Open History: no capture or permission
   prompt should occur. Enable System: allow the OS permission deliberately.
3. Play the fixture from a browser and WeChat separately. Check activity, partial
   English, final English and Chinese. Verify the Markdown editor stays responsive.
4. Copy while a translation is pending, then copy again after it completes. Check
   bilingual/English/Chinese modes, timestamps, selected-text Cmd+C and exports.
5. Pause, wait, resume. Verify no audio was acquired during pause and later subtitle
   offsets retain the elapsed gap. Stop; reopen history without starting capture.
6. Repeat using Microphone with a consented room fixture. Deny/revoke permission,
   unplug the device, lock, sleep, close the panel and quit during recognition.
   Verify acquisition stops and wake/relaunch never resumes it automatically.
7. Reopen history after restart; verify both languages, search, rename/place,
   translation retry, delete, and no raw-audio files in the managed data directory.
8. Run the declared one-hour corpus on both supported hardware profiles; record
   WER, latency, RSS, queue limits and typing responsiveness. Only then decide
   whether the bundled model/profile meets the approved product requirements.

Next implementation priority remains proven AEC/Both capture, followed by device
selection and native acceptance. Do not replace these requirements with more UI.
