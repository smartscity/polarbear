# Live Caption Engine Evaluation

Date: 2026-10-17. Status: research screening; not a production engine migration.

## Decision boundary

The requested product is English speech recognition plus English-to-Chinese
translation, entirely local after installation, with model assets included in
the installer. Recognition and translation are separate models with separate
licenses. Free use in Chrome is not permission to redistribute Chrome's engine
or language packs inside another product.

This evaluation does not assume Whisper will remain the selected engine. It
does not replace the production helper, change existing recordings, or add
runtime network access. Full meeting accuracy and release qualification remain
separate from this deliberately small, reproducible screening experiment.

## Chrome investigation

| Component | Verified evidence | Eligibility for Polarbear |
| --- | --- | --- |
| SODA recognition | Chromium's current `DEPS` references `chrome_internal/third_party/soda` and `soda-mac64`, guarded by internal checkout conditions. Chromium developers identify these packages as Google-proprietary and say SODA is unsupported in public Chromium builds. | Not eligible as an ordinary open-source bundled SDK. A separate Google distribution agreement would need to be established first. Do not extract Chrome binaries or API keys. |
| Chromium caption integration | Public C++ integration loads the external SODA library and receives asynchronous partial/final recognition events. | Architecture reference, not the missing recognition implementation or model license. |
| Chrome Live Translate | The public help page describes sending captions to Google for translation. Current Chromium source also contains an on-device path and online fallback, so behavior depends on version/configuration. | Cannot label the entire Chrome caption-and-translation product strictly offline. |
| Translator API / TranslateKit | Chrome exposes browser-local translation with separately downloaded language packs. Its public component installer loads a separate TranslateKit binary. | No standalone redistribution grant for that binary and its language packs was established in this review. A website API is not a native SDK for a Tauri WebKit application. Not approved for bundling. |

Primary sources, checked on the date above:

- [Chromium developer discussion, February-March 2024](https://groups.google.com/a/chromium.org/g/chromium-dev/c/-Npd3blErMU).
- [Current Chromium dependency declarations](https://github.com/chromium/chromium/blob/main/DEPS).
- [SODA client integration](https://github.com/chromium/chromium/blob/main/chrome/services/speech/soda/soda_client_impl.cc).
- [Chrome caption and translation help](https://support.google.com/chrome/answer/10538231?hl=en).
- [Live Translate controller](https://github.com/chromium/chromium/blob/main/components/live_caption/live_translate_controller.cc).
- [Translator API documentation](https://developer.chrome.com/docs/ai/translator-api).
- [TranslateKit component installer](https://github.com/chromium/chromium/blob/main/chrome/browser/component_updater/translate_kit_component_installer.cc).

Useful ideas to adopt are incremental decoding, explicit partial/final events,
separation of recognition and translation, process isolation and stable caption
updates. None requires copying proprietary Google model assets.

## Candidates and distribution

| Candidate | Engine/model terms | Streaming and deployment considerations |
| --- | --- | --- |
| Existing Whisper base.en Q5_1 | whisper.cpp and Whisper model: MIT; existing product manifest pins provenance. | CPU baseline only. The selected model is not a cached streaming transducer. |
| English Zipformer, 2023-06-26, int8 | sherpa-onnx runtime: Apache-2.0; model card: Apache-2.0. Native runtime and ONNX Runtime dependency notices must be included. | Genuine incremental streaming. Approximately 69.3 MiB of selected model files, excluding runtime. This older LibriSpeech-trained model is a lightweight screening candidate, not assumed state of the art. |
| NVIDIA Parakeet TDT 0.6B v2, int8 | NVIDIA weights: CC BY 4.0; sherpa-onnx conversion retains that license. Include attribution, license link and conversion/quantization notice; independently satisfy runtime licenses. | English-specific quality candidate. Approximately 630.6 MiB of model files, excluding runtime. The evaluated full-utterance configuration is not a native streaming decoder. |
| Moonshine Streaming Small/Medium | English streaming model cards list MIT; runtime licensing is a separate check. | Worth a subsequent native streaming trial. Publisher benchmark claims are not local measurements; not tested here. |
| NVIDIA Nemotron Speech Streaming EN 0.6B | NVIDIA Open Model License, **not** the Parakeet CC BY 4.0 license. | Cache-aware streaming candidate. Requires its own redistribution review, native CPU/Apple backend assessment and measured comparison; not tested here. |

Model and runtime sources:

- [Whisper model license](https://github.com/openai/whisper/blob/main/LICENSE).
- [sherpa-onnx license](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE).
- [Zipformer conversion](https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26), [original training model](https://huggingface.co/Zengwei/icefall-asr-librispeech-streaming-zipformer-2023-05-17).
- [NVIDIA Parakeet v2](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2), [int8 conversion](https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8), [CC BY 4.0 conditions](https://creativecommons.org/licenses/by/4.0/).
- [Moonshine Streaming Small](https://huggingface.co/moonshine-ai/moonshine-streaming-small).
- [Nemotron Speech Streaming EN](https://huggingface.co/nvidia/nemotron-speech-streaming-en-0.6b).

An upstream permission to redistribute is necessary but not sufficient for
shipping: transitive notices, pinned artifacts, architecture support, signing,
package integrity and actual offline startup must also pass. Evaluation Python
wheels will not be added to the application installer.

## Measured experiment

Host: Intel Core i7-9750H, six physical cores, 16 GB RAM, macOS 26.5.1, x86_64.
Each recognizer uses four CPU threads and runs separately. sherpa-onnx is 1.13.8;
the Whisper baseline links the existing pinned v1.9.5 native libraries.

Corpus: 20 predeclared evenly spaced LibriSpeech `test-clean` items, 20 distinct
speakers, 181.675 seconds and 481 reference words. Each item is also evaluated
with deterministic white noise at 10 dB SNR. These are the same 20 utterances,
not 40 independent speakers. All inference is launched with macOS
`sandbox-exec` and `deny network*`; public asset preparation happens separately.

Scoring ignores case and punctuation, retains apostrophes and does not expand
numbers. WER is aggregate edit distance divided by reference words, not an
average of per-clip percentages. Compute/audio ratio (RTF) excludes model load
and does **not** measure first-caption latency. Timing is a single pass on a
non-dedicated laptop; cache, thermal and background-work effects remain.

| Engine | Clean WER | Noise WER | Clean RTF | Noise RTF |
| --- | ---: | ---: | ---: | ---: |
| Whisper base.en Q5_1 | 3.95% | 8.11% | 0.204 | 0.166 |
| Streaming Zipformer int8 | 3.33% | 6.24% | 0.098 | 0.095 |
| Parakeet TDT v2 int8 | 1.87% | 1.87% | 0.078 | 0.077 |

The respective edit counts are 19/39 for Whisper, 16/30 for Zipformer and 9/9
for Parakeet (clean/noise, each out of 481 reference words). All three engines
returned an empty transcript for the five-second
digital-silence probe. This is not a hallucination guarantee for music or noise.
Zipformer also completed three wall-clock-paced clips with incremental output;
their detailed event records are retained, including incomplete subwords. The
application would need a stable display/commit policy rather than displaying
every subword as finalized text.

| Additional measurement | Result | Scope |
| --- | --- | --- |
| Zipformer first nonempty partial | 0.824-1.473 seconds | Three clips; measured from clip start, includes initial silence, not word-aligned semantic latency |
| Zipformer EOF finalization | 21-33 ms | Explicit EOF plus synthetic tail, not VAD endpoint detection or GUI latency |
| Cold instance load | Whisper 0.221 s; Zipformer 3.913 s; Parakeet 3.501 s | Single run, OS file cache uncontrolled |
| Zipformer peak RSS | 200.2 MiB | Python plus native runtime |
| Parakeet peak RSS | 1112.6 MiB | Python plus native runtime; no GPU |

Whisper RSS is deliberately not compared: it ran in a child process and the
recorded Python RSS excludes that child. The baseline model hash is
`4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f`.

### Selection from this screening

**Promote Parakeet TDT v2 int8 to the accuracy-first replacement prototype. Do
not treat Whisper as the default selection merely because it is integrated.**
Parakeet had fewer edits in both conditions and lower whole-utterance CPU time
in this run. This is a prototype decision, not a claim of production superiority
or permission to skip latency qualification.

Keep Zipformer as the native-streaming comparator. Its genuine incremental
state and much smaller footprint are meaningful advantages. Do not ship both
engines as an unmeasured two-stage pipeline: that adds memory, scheduling and
caption-revision complexity. First determine whether the Parakeet prototype can
meet bounded live-caption delay without replaying ever-growing prefixes. If it
cannot, compare current streaming candidates (including Moonshine/Nemotron)
rather than assuming a quality-first utterance model is sufficient.

One concrete failure remains across all three engines: the French place name
in sample `3729-6852-0043` is misrecognized. Parakeet's aggregate improvement
does not solve specialist names. Strict scoring also counts spelling variants
such as `skilful` versus `skillful`, and `Dr.` versus `doctor`; inspect the saved
hypotheses before interpreting every edit as a semantic failure.

### Interpretation limits

- The Zipformer/Whisper clean difference is only three word edits out of 481.
  It is not statistically sufficient to establish a general accuracy ranking.
- LibriSpeech is read speech and is Zipformer's training domain. White noise
  does not substitute for overlapping speakers, room echo or meeting audio.
- No Chrome SODA WER measurement was performed; no claim of outperforming Chrome
  is supported. The Chrome conclusion is about integration and distribution.
- ARM64, battery use, long sessions, system-audio capture, accents, technical
  names, numbers, negation and real EN-to-ZH caption quality are not qualified.
- The Whisper adapter uses one decode per complete utterance. It does not hide
  the additional cost of the product's current repeated-prefix implementation.

## Existing integration finding

`apps/desktop/src-tauri/native/caption-engine/main.cpp` calls `whisper_full` on
the growing speech buffer roughly every two seconds, synchronously in the PCM
read loop, then again at finalization. Consequently, decode work can delay
reading new audio, and the same prefix is processed repeatedly. Selecting a
more accurate utterance model alone will not fix that architectural cost.

Any replacement must preserve the existing helper protocol, ownership of
finalized history and asynchronous translation. Audio ingestion must remain
bounded and independent of expensive inference; incremental engine state or a
measured bounded-window policy must replace unbounded prefix reprocessing.
Do not introduce a second caption UI or history store.

## Translation is a separate decision

The current checkout already bundles BrowserMT Bergamot and Mozilla English-to-
Chinese model assets under MPL-2.0, rather than depending on Apple language packs
or Chrome downloads. Provenance and hashes live in
`apps/desktop/public/models/en-zh/README.md` and
`apps/desktop/src/shared/translation/modelManifest.json`.

That implementation can remain a local translation **candidate**, not a proven
accuracy winner. Its existing smoke tests establish inference and cancellation,
not semantic adequacy for technical meetings. ASR WER must not be reported as
translation quality. Evaluate translations both from gold transcripts and from
ASR output, with human checks for negation, numbers, names and omissions.

The existing `test-bundled-translation.mjs --webkit` smoke test was rerun in
Chromium and WebKit. Both passed production-CSP loading, cancellation and local
inference with all non-loopback browser requests blocked. However, both
translated the isolated acronym `OEMS` as `制造商`. The existing test only requires
a nonempty output for that case; **it is a functional pass, not a semantic
accuracy pass**. Do not label this acronym translation correct. Translation
model quality has not been comparatively benchmarked in this ASR screening.

## Qualification gates before replacing the release engine

1. Select the next prototype from measured accuracy, genuine streaming behavior,
   resource use and redistribution terms, not engine familiarity.
2. Freeze a consented/public meeting and technical-speech corpus, including
   accents, distant microphones, echo, overlap, silence and background media.
3. Measure WER, named-term/number errors, first stable caption delay, finalization
   delay and revision churn on both Intel and Apple Silicon. Repeat timing runs.
4. Validate bounded capture queues, stop/resume, 30-minute sessions, lost-device
   recovery and English/Chinese history ordering without dropping audio.
5. Verify the signed installer on a clean network-disabled machine, with all
   model assets and notices included. No first-launch downloads or hidden cloud
   fallback are acceptable.

Evidence scripts are in `apps/desktop/scripts/caption-evaluation/`. This report
does not authorize a release tag or claim the production engine was replaced.

## Evidence and checks

- [Raw results and asset manifests](evidence/live-caption-2026-10-17/README.md)
  retain every reference, hypothesis, time and checksum; models/audio remain in
  scratch storage and are not committed.
- Seven scoring/integrity unit tests passed. Both candidate models and their
  token tables passed pinned publisher hash verification.
- The existing translation smoke test passed in Chromium and WebKit; the
  acronym quality failure described above remains unresolved.
- All three recognition runs completed with network access denied. A separate
  outbound-socket probe verified the sandbox rejects networking.
- Production UI, signed DMG, ARM64 inference and meeting acceptance were not
  run by this research harness. Existing release checks are not substituted for
  these missing engine-qualification measurements.
