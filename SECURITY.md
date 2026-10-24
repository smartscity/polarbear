# Security Reporting

Do not post tokens, private Markdown, recordings, database files, or exploitable
payloads in public issues. Reproduce problems with synthetic data where possible.

Use GitHub private vulnerability reporting for `smartscity/polarbear` if the
repository has enabled it. Otherwise contact a repository maintainer to arrange
a private channel before sharing sensitive details. There is no published
security response SLA or LTS support guarantee; do not assume one.

Include the affected version/commit, OS and architecture, entry point, minimal
reproduction, impact, and whether data left the machine. Keep originals private;
redact paths and document content from logs.

## Trust Boundaries

- Markdown and SVG are untrusted input. Rendering must retain sanitization.
- Native filesystem requests must enforce workspace containment and revision
  checks; string prefix checks are not sufficient for paths or symlinks.
- Cloud sync is explicit. Production credentials belong in the OS credential
  store; never add tokens or user content to diagnostics.
- The Memory Engine is a separate authenticated API boundary, not a database
  shared with Desktop. Keep its versioned contract checks.
- Captions and translation are local. Diagnostic audio recording is opt-in;
  do not automatically upload recordings or download alternate models.

The [engineering audit](docs/engineering/audit.md) records open risks. This file
does not claim an independent security certification or a completed penetration
test. Repository administrators must enable private reporting and protected
branch checks in GitHub; adding this document does not enable those settings.
