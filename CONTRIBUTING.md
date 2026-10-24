# Contributing

Read [AGENTS.md](AGENTS.md) and [ARCHITECTURE.md](ARCHITECTURE.md) first.
Use English for code comments, tests, contracts, and documentation. Keep English
and Chinese UI resources synchronized in `shared/i18n/locales/*.properties`.

## Development

Install the Node.js LTS and Rust stable toolchains used by the workflows, then
run `npm ci`. Desktop development uses `npm --workspace apps/desktop run dev`; native development uses
`npm run tauri:dev`. macOS native checks require Xcode and its command-line tools.
The [iPhone guide](apps/ios/README.md) describes its separate toolchain and device
acceptance; a browser pass does not prove iOS permissions or document delivery.

## Change Discipline

- Reproduce a defect before changing production code. Add a regression test at
  the layer that owns the behavior, then run affected integration tests.
- Preserve Markdown, IPC, and persisted settings compatibility. Explain and test
  any necessary migration; do not remove fallback data silently.
- Keep native IO in feature adapters. Desktop must never access `memory.db`.
- Preserve unrelated worktree changes. Do not format the whole repository.
- Document limitations separately from verified results. Use `NOT RUN` for
  unavailable platforms, not PASS. Do not weaken assertions to make CI green.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm --workspace apps/desktop run memory-contract:check
npm --workspace apps/desktop run test:ui
npm --workspace apps/desktop run test:native-clipboard
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --no-fail-fast
node apps/desktop/scripts/architecture-graph.mjs
```

Run only one Desktop Playwright invocation at a time: invocations share the
server port and output directory. The iPhone workflow adds its own checks.
Production Rust denies `unwrap`/`expect`; fixture-only allowances are scoped to
test modules and must not cover production code or weaken test assertions.

## Review and Release

A PR should describe the root cause, ownership changes, compatibility, commands
actually run, and remaining platform checks. Include screenshots only for UI
changes and never include private documents, recordings, or credentials.

Use the [engineering verification report](docs/engineering/verification.md) for
the current evidence and release limitations. A release needs the checks for the
same commit/tag, packaged app and mounted-DMG tests, and platform acceptance;
successful compilation alone is not delivery. Do not replace an existing tag.
