# Gantt local verification evidence

Source: the working tree implementing `docs/engineering/mermaid-gantt-rendering.md`.
This is local development evidence, not a published release or installed-app acceptance.

- `upstream-reproduction.json`: direct calls to unmodified Mermaid 11.17.2 in Chromium and WebKit, showing successful syntax parsing followed by task-compilation failure for the original source and excess fields. The invalid-end case demonstrates silent rendering. Browser-local URLs in stack traces are diagnostic references, not hosted artifacts.
- `original.svg`: the fixed shared renderer's SVG output for the unchanged original fixture.
- `original-chromium.png`, `original-webkit.png`: real preview screenshots from the original-fixture Playwright test, not reconstructed illustrations.
- `browser-tests.txt`: dedicated Chromium/WebKit Gantt and lifecycle suite output.
- `unit-tests.txt`: full Desktop Vitest and Node engineering-check output.
- `typecheck.txt`, `lint.txt`, `build.txt`: standard repository check output.
- `full-browser-tests.txt`: complete Desktop Playwright suite output.
- `full-browser-tests-first-attempt.txt`, `recent-menu-stale-server.txt`, `recent-menu-clean-server.txt`: retained diagnosis of a stale Vite HMR context mismatch; the unchanged test passed after server restart, and the final full suite passed 173/173.

Fixture: `apps/desktop/tests/fixtures/gantt-original.mmd`, UTF-8 with its final LF.
SHA-256: `ad3ae575f01b9baa08b958fcd7fe6ee4e15df0384664c725515aa6020554a2e0`.

The file-backed Save As/reopen test preserves the complete Markdown byte sequence. Its native IPC transport is simulated; the test does not certify a Tauri package or native operating-system file dialog.

## Risk-closure follow-up (2026-10-31)

- `risk-closure-typecheck.txt`, `risk-closure-lint.txt`, `risk-closure-unit-tests.txt`, `risk-closure-build.txt`: final Desktop checks; 412 Vitest tests in 69 files and 45 Node engineering checks pass.
- `risk-closure-browser-tests.txt`: 52/52 Chromium/WebKit checks on the expanded implementation.
- `calendar-combination-first-attempt.txt`: two real-engine failures revealing `until` plus excluded dates shifting an end from October 26 to October 28; the final adapter explicitly rejects that combination.
- `native-webview.txt`: six production-renderer cases pass in actual macOS WKWebView under an offline `tauri://localhost` scheme. This is native engine evidence, not an installed Tauri application.
- `performance.txt`, `gantt-latency.json`: bounded local 11/50/200-task latency characterization, one warmup plus five measurements each. Source/fixture hashes, host load and power status are retained. This is not a cross-version or capacity benchmark.
- `ios-typecheck.txt`, `ios-lint.txt`, `ios-unit-tests.txt`, `ios-build.txt`: shared-renderer consumer checks; 39 iOS unit tests pass.
- `ios-browser-first-attempt.txt`: initial reader startup/import timeouts retained for transparency. These are not counted as passing checks.

Both production builds retain the existing large-chunk advisory. The unchanged original fixture has the same SHA-256 above.

The mobile test initially attempted `fetch(blobUrl)` to inspect SVG bytes. The application CSP correctly blocks that connection; the test now captures the generated Blob and reads its bytes directly, preserving the production CSP. The diagnostic run is retained in `ios-browser-csp-diagnostic.txt`.

- `risk-closure-full-browser-tests.txt`: final complete Desktop UI suite, 178/178 PASS on a fresh Vite server (4.9 minutes).
- `ios-webkit-storage-diagnostic.txt`: direct read-only diagnostic plus an isolated import probe show macOS Playwright WebKit ephemeral contexts reject IndexedDB Blob/File writes with `UnknownError: Error preparing Blob/File data to be stored in object store`; the same production library succeeds in a disposable persistent profile.
- `ios-browser-ephemeral-storage.txt`: failing mobile run before that test-environment correction. The WebKit fixture now uses a fresh disposable persistent profile, preserves real IndexedDB storage, and deletes the profile after completion. No application storage behavior or CSP was weakened.

- `ios-browser-tests.txt`: 2/2 PASS in Chromium and WebKit, including original source, rendered labels, mobile width and real IndexedDB reopen.
- `ios-full-browser-tests.txt`: complete mobile UI suite, 12/12 PASS in its default Chromium configuration.

Saved console logs normalize trailing whitespace and blank lines at EOF; test results and diagnostic messages are retained.
