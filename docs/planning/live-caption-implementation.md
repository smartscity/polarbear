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

## Remaining gates and limitations

- **NOT IMPLEMENTED:** simultaneous System + Microphone, echo cancellation and
  dual-source timestamp alignment. Do not advertise meeting Both mode as ready.
- **NOT IMPLEMENTED:** microphone picker, saved monitor-safe window geometry,
  caption font preference, Show data folder, dedicated date-range filter.
- **NOT RUN:** real browser/WeChat audio capture, microphone permission deny/revoke,
  lock/sleep/wake, device disconnect, hidden WKWebView scheduling and quit races.
- **NOT RUN:** clean installed app with networking blocked, actual Apple Silicon
  inference, older macOS launch, multi-monitor/full-screen/VoiceOver acceptance.
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
