# Documentation index

Start with [the project overview](../README.md) and
[v0.9.3 implementation and verification](releases/v0.9.3.md). The latter records
the state verified on 2026-10-14 against commit `66eec710`, including successful
CI/package builds, the intentional draft release, current platform boundaries
and checks without a recorded acceptance pass.

## Current implementation guides

| Document | Purpose |
| --- | --- |
| [Architecture](../ARCHITECTURE.md) | Desktop/mobile ownership, native boundaries and current gaps |
| [Desktop vocabulary and reading](planning/desktop-vocab-reading.md) | Bundled offline Desktop translation, local Vocab protocol, favorites and verification |
| [Rich document copy](planning/desktop-rich-document-copy.md) | Readable copy, explicit Markdown source, native table/images and receiver acceptance |
| [iPhone reader](../apps/ios/README.md) | Development commands, immutable imports, reading capabilities and device limits |
| [iPhone reading assistant](planning/iphone-reading-assistant.md) | Separate Apple translation/speech, system dictionary and explicit capture-file transfer |
| [Bundled model notices](../apps/desktop/public/models/en-zh/README.md) | Model/engine provenance, integrity and third-party licenses |
| [Locale resources](../apps/desktop/src/shared/i18n/locales/README.md) | UI translation-resource maintenance |

Desktop's language-pack dependency is superseded by bundled Bergamot. The iPhone
reader has a separate installed-only Apple translation path; do not apply either
platform's setup or verification claims to the other.

## Plans and feature-specific acceptance

These documents describe staged work and its own rollout gates. Their uncompleted
items are not automatically release-wide blockers, and successful Desktop
packaging does not establish their completion.

| Document | Scope and status |
| --- | --- |
| [Live Caption design](planning/live-caption.md) | Partial preview exists; scoped clock/lifecycle repair authorized with local tests required before commit. Streaming engine replacement remains unqualified. |
| [Apple linked editing and iCloud plan](planning/icloud-markdown-sync.md) | Native foundation exists; user-facing linked editing/sync is not feature-complete |
| [Apple document-store package](../packages/apple-document-store/README.md) | Shared native foundation and validation; not an enabled cross-device editing workflow |
| [Memory/context design](planning/desktop-memory-context-design.md) | M1 technical slice; rollout constrained by the recorded evaluation |
| [Memory implementation plan](planning/desktop-memory-implementation-plan.md) | Implementation checkpoints and proposed later work |
| [Memory M1 validation plan](planning/desktop-memory-m1-validation-plan.md) | Evaluation method and feature-specific gates |
| [Memory M1 automated report](planning/desktop-memory-m1-automated-report.md) | Recorded development PASS, held-out FAIL, decision REVISE |
| [Memory M1 pilot kit](planning/desktop-memory-m1-pilot-kit.md) | Human pilot procedure; a kit is not a completed pilot |
| [Memory M1 report template](planning/desktop-memory-m1-report-template.md) | Blank reporting format, not verification evidence |
| [Memory M1 fixtures](../apps/desktop/fixtures/long-memory-m1/README.md) | Fixture and evaluator usage |

## Historical evidence

- [Markdown Reading P0 verification](planning/markdown-reading-p0-verification.md)
  preserves prior Mermaid, native clipboard, selection and iPhone progress checks.
  Its Apple translation failures and language-setup instructions are historical
  for Desktop, not current v0.9.3 requirements.
- Earlier sections of the Desktop reading and iPhone reader guides retain their
  original test counts and environments. Read their scope labels before using a
  result as evidence for a later artifact.

## Updating documentation

Follow [the engineering guidelines](../AGENTS.md). Keep implementation facts,
automated test results, manual acceptance and proposed work distinct. Preserve
historical failures rather than rewriting them as passes; point superseded
records to the current owner. A missing record does not prove a check was never
performed. Repository documentation changes do not require a version bump,
tag change or release publication.
