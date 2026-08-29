# Polarbear Engineering Guidelines

## Language policy

All newly written or substantially revised documentation, architecture text, code comments, TSDoc/JSDoc, test descriptions, commit messages, and public contract descriptions must be written in English.

Localized end-user resource files are the only exception. Keep every supported locale synchronized and do not replace translated UI copy with English-only text.

## Workspace discipline

- Preserve unrelated user changes and never reset or overwrite them.
- Keep Polarbear Desktop independent from Polarbear Memory storage internals. Desktop must use the versioned Memory Engine Admin API and must never read or write `memory.db` directly.
- Treat generated contracts as build artifacts of their canonical vendored contract source; update the contract source first.
- Do not add remote rendering, telemetry, or implicit network access.
