# iPhone Reading Assistant

## Scope and current delivery

Scope reviewed on 2026-10-14 against [Desktop v0.9.3](../releases/v0.9.3.md)
(`66eec710`). This document describes the standalone iPhone implementation;
Desktop release verification does not establish signed-iPhone acceptance.

The standalone `apps/ios` reader now supports selection-based local translation,
English speech, the installed system dictionary, and durable pending Vocab captures.
Desktop editing and its private Unix-socket Vocab bridge are unchanged. The existing
reader Sheet, design tokens and shared `.properties` locale resources are reused.

This release delivers an offline file handoff, **not background cross-app sync**.
The two apps currently have no jointly provisioned App Group or authenticated mobile
request/receipt channel. Inventing one in JavaScript would not cross iOS sandboxes.

## Interaction

- Select English text to see a compact non-modal reading card. It docks at the bottom,
  or above lower-screen selections. It does not focus an input or scroll the article.
- Translation begins after selection settles. Speech is an explicit speaker action
  with a stop state. Dictionary opens the system's installed dictionary entry.
- Expand for the word/phrase field, source opt-out and pending records. A sentence is
  reading context; the user specifies the word to collect rather than saving it as a word.
- The header Reading tools button offers manual lookup without requiring long press.
- Changing document, closing the reading tools or backgrounding the app stops speech.
  Translation requests have a timeout and ignore obsolete results.
- Controls have 44px targets, accessible labels and English/Chinese resources.

## Local capabilities

`ReaderLanguage` uses AVSpeechSynthesizer and an installed English voice. Translation
uses Apple TranslationSession's installed-only initializer on iOS 26+. The reader
continues to support iOS 16: older systems retain speech, dictionary and captures,
with a clear unsupported-translation message. No remote fallback or model download
is initiated. Missing models direct the user to system language settings.

This Apple language-pack requirement applies to iPhone only. Desktop uses its
[bundled Bergamot engine and English-to-Chinese model](desktop-vocab-reading.md)
without Apple Translation or system language setup; that engine has not replaced
the native iPhone implementation.

The inline Chinese result is a translation, not a Vocab dictionary sense. IPA is not
fabricated or inferred from speech. Available pronunciation details remain in the
system dictionary; inline Vocab dictionary lookup is not delivered in this release.

## Capture persistence and handoff

`ReadingCaptureStore` owns a private Application Support `ReadingCaptures` directory.
The versioned JSON queue is atomically replaced on a serial native queue, is bounded
to 100 records and has no TTL. Corruption is reported and never silently overwritten.
Storage errors do not produce a successful save state. IDs are UUIDs; identical
retries are idempotent, and changed payloads under the same ID are rejected.

The UI says **Saved · pending import**, never **Added to Vocab**, because it has no
receiver acknowledgement. Export uses the native share sheet and leaves the queue
intact even after sharing succeeds. The user can save the file to Files and import
it from Vocab's My Vocabulary / Import reading words. Records can be explicitly
removed from the pending list after checking Vocab. Deleting a pending record does
not delete anything from Vocab.

Version 1 contract (maximum 100 captures, 2 MiB at the receiver):

```json
{
  "schemaVersion": 1,
  "captures": [{
    "requestId": "752f06c9-b070-4b43-a72a-42d15d052649",
    "selectedText": "resilient",
    "senseUid": null,
    "sentence": "A resilient team.",
    "title": "Reading.md",
    "heading": "Teams",
    "filePath": null,
    "line": null
  }]
}
```

Nullable fields may be omitted. Terms are limited to 80 characters; sentences to
2,000; title and heading to 300. Source opt-out clears sentence, title and heading.
Full documents and sandbox paths are never included. Export is an explicit user
action; choosing a third-party share destination is not an implicit upload.

Vocab validates the whole envelope before writing and calls its existing ReadingService.
Unknown/ambiguous captures remain in Saved for later until the user chooses a sense;
resolution adds existing My Vocabulary membership. No new dictionary dataset is
created. Storage failure during a batch can leave earlier records saved; the same
file can safely be retried using existing request/fingerprint idempotency.

## Validation and remaining acceptance

Automated checks cover selection validation, source opt-out, stale translation
responses, speech controls, bilingual light/dark UI, export state, atomic queue
persistence, corrupt storage, bounds, Vocab import validation and retry semantics.
Browser native APIs are mocked; they do not prove real voice output or model inference.

The [iPhone Reader Quality run for the v0.9.3 checkpoint](https://github.com/smartscity/polarbear/actions/runs/38588952736)
passed; it does not replace the following native acceptance.

Before a signed-device release, verify installed language packs, audible playback,
native selection handles, VoiceOver, and Files export/import between both signed apps.
App Group background delivery, authenticated receipts, inline IPA and lookup against
Vocab's iOS dictionary are follow-up work, not features claimed by this release.

