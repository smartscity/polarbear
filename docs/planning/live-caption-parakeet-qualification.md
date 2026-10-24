# Parakeet qualification protocol

Status: PREDECLARED, 2026-10-17. Production replacement is NOT AUTHORIZED by a
screening pass. Owner: live-caption-engine-evaluation.md.

## Current production release exception (2026-10-20)

The user explicitly approved a temporary five-second production first-text P95
gate so a DMG can be packaged while further optimization continues. The three-second
target remains the goal, and candidate qualification is unchanged. This supersedes
only the production first-text release threshold in the historical sections below,
not their recorded outcomes, accuracy gates or other limits.

The policy is centralized in
`apps/desktop/scripts/caption-evaluation/native_latency_policy.py`. Local fixture,
short native production and optional 15-minute reports include its versioned ID
and numeric limits. The candidate path still selects the separate three-second
policy. Missing observations cannot pass either policy.

Before that authorization, a fresh local Intel two-minute AMI EN2002a replay
failed the original gate: first/final P95 3.301/1.962 seconds, 23 finals, all
3,750 frames consumed, zero overflow/timeouts and 219,643,904 bytes peak tree RSS.
Fixture SHA-256:
`7a87df1dcc217957f6bf183101ab3d01b1d4c8b67766da28d4b3af26c6a99b24`.
Helper SHA-256:
`3ddb6f69a4982b8471ff7023ec07ddf75a5ef73232dc18e79dc46e76b5787b60`.
This failure is retained, not retroactively relabeled as a pass.

A 40-second diagnostic excerpt from source seconds 75-115 reproduced the failed
three-second limit at 3.052 seconds. Sequence 5's first one-second preview took
837 ms and emitted no text; its 1.864-second retry took 1,288 ms. Each waited less
than 0.04 ms in the inference queue. These observations identify repeated prefix
inference as one actual source of delay; they do not establish that all slow
sequences have the same cause. The native diagnostic now carries sequence,
audio interval and a text-emitted boolean, without recognized content in stderr.
No decoding settings were changed by this instrumentation.

Both runs used the existing bundled model, default four-thread Intel CPU policy
and OS-level network denial. They are production PCM/VAD/ASR evidence, not microphone,
UI, translation, reference-scored accuracy or ARM acceptance. New-policy local
evidence must come from a fresh run; it cannot establish the three-second target.

### Fresh local release verification

After the explicit policy change, the same complete 120-second public fixture
was replayed again with the rebuilt Intel helper, no competing compilation or
inference, and OS-enforced network denial:

| Measurement | Result |
| --- | --- |
| Policy / result | `production-first-text-5s-2026-10-20` / PASS |
| First nonempty text P95 from VAD start | 2.086200512 seconds |
| Final text P95 after VAD end | 1.121801423 seconds |
| Delivered frames / finalized segments | 3,750 / 23 |
| Overflow / timeout | 0 / 0 |
| Maximum feed lag | 0.104456634 seconds |
| Peak process-tree RSS | 218,861,568 bytes |
| Warmed memory growth | NOT_MEASURED_SHORT_PROFILE |
| Helper SHA-256 | `96c2fd2d66695f7dfefb463c4379bc794e5f7e8acf642649a237b7e76b144548` |
| Fixture SHA-256 | `7a87df1dcc217957f6bf183101ab3d01b1d4c8b67766da28d4b3af26c6a99b24` |

All 23 finalized events, including English and positions, are identical to the
earlier two-minute run. No model, decoder settings or preview schedule changed
between them; the observed speed difference is not attributed to the policy
change or diagnostic fields. Host/run variation remains material. This run
does not overturn the earlier three-second failure or establish general accuracy.
Public audio attribution: AMI Corpus, EN2002a Array1-01, source seconds 0-120,
CC BY 4.0, University of Edinburgh AMI Corpus Mirror.

Local checks completed before commit (2026-10-20/21, Intel macOS):

| Check | Result |
| --- | --- |
| Clean native production build and CTest | PASS, 7 tests |
| Swift source clock tests in the build path | PASS |
| Actual native JFK, silence, malformed frame and packetization fixtures | PASS; 512, 100/413 and 4,096-sample packets preserve all three final events |
| Python evaluation regression suite | PASS, 71 tests; fake-model tests are not recognition accuracy evidence |
| Vitest / Node script tests | PASS, 230 / 24 tests |
| Typecheck / ESLint / Rust format | PASS |
| Cargo tests | PASS, 35; one existing real Memory Engine E2E intentionally ignored |
| Browser regression suite | PASS, 22, including the actual bundled offline translator; capture IPC is mocked |
| Vite production build | PASS; existing bundle-size warnings remain |
| Actual microphone/system-capture acceptance | NOT_RUN in this iteration |
| Native ARM, universal package and mounted DMG | Pending tagged release CI, not locally claimed |

The initial restricted-sandbox Cargo run denied two local Unix socket binds.
The full suite passed after granting local IPC permission; no code workaround or
skipped socket test was used. The only ignored test remains the separately
configured real Memory Engine E2E.

## Scope and invariants

Compare the pinned Parakeet v2 int8 candidate with the existing Whisper base.en
Q5_1, on native Intel and Apple Silicon macOS. No user microphone or private
meeting is recorded. Network is permitted only for public fixture preparation;
inference runs in a network-denied sandbox. No production setting, model or
history schema changes in this phase.

Corpus selection is frozen before inference: AMI EN2002a (naturally occurring
meeting) and ES2004a (scenario design meeting), single distant array microphone;
first 20 minutes of each, or complete recording if shorter. Earnings-22 calls
4481221 (India, Sify/technology), 4475486 (China), 4462231 (US), 4470684 (UK),
4481952 (Australia), and 2020-03-0230487MTN-Ghana-2019-Annual-Results-Call (Ghana):
minutes 2-7 and the final five minutes. This samples presentations and Q&A/tails
without selecting on ASR output. Countries are call-level metadata, NOT verified
speaker accent labels. Raw source, transcript and processed audio digests must
match across platforms. Unavailable sources are BLOCKED, not silently replaced.

AMI: CC BY 4.0, https://groups.inf.ed.ac.uk/ami/download/.
Earnings-22 text: CC BY-SA 4.0,
https://github.com/revdotcom/speech-datasets/tree/c05ab6fd8b4b627d123c922a22a39e993dd37635/earnings22.
Retain attribution and license on derived transcript artifacts; no models/audio
are added to the repository or shipped based on this evaluation.

## Ownership and patterns

| Concern | Pattern | Decision |
| --- | --- | --- |
| Model implementation | Adapter | Reuse WhisperBaseline and SherpaCandidate; same pinned artifacts and four CPU threads |
| Public corpus preparation | Pipeline | Separate download/verification, timestamp parsing, deterministic segmentation and manifest publication |
| Continuous replay | Bounded worker | One inference owner; bounded queue, explicit overload failure, timed shutdown and incremental evidence |
| Scoring | Pure functions | Shared normalization/alignment; publish strict WER and supplementary entity/term recall, never rewrite references after seeing output |
| Cross-platform launch | Existing Actions matrix | Native macos-26 ARM and macos-15-intel; assert actual machine architecture; no emulation claim |

## Measurements and budget

Accuracy: all selected audio on both engines, at most 20-second annotated
segments. Segment endpoints are reference-derived and therefore oracle-assisted;
these scores cannot qualify a production VAD pipeline by themselves. Retain
overlap and disfluencies, and report their scoring limitations.
Earnings-22 unaligned reference tokens are preserved at the next known timestamp
(previous endpoint only at EOF), explicitly marked `inferredTiming`. Their
timings are not latency ground truth. Report their counts and inspect affected
segments rather than deleting difficult reference words.

Continuous replay: 60 wall-clock minutes per engine/platform, public fixtures
delivered at real time as a fixed round-robin montage across sources (no repeated
audio), partial decode every two seconds and final decode at
bounded segment boundaries. Start timing before arrival, not when a worker
dequeues. Retain first-text delay, final delay, backlog, drops, revisions and
memory samples. Reference boundaries are not actual endpoint detection: mark
microphone-to-UI latency as NOT_RUN until separately observed. Replay is a
prototype scheduling/soak experiment, not claimed native app capture acceptance.

Four platform/engine jobs may run on separate machines; never run competing
engines concurrently on one machine. Accuracy precedes the soak; cold load is
separate, first 60 replay seconds are warm-up for resource trends (not omitted
from correctness). No automatic infinite retries. Job cap: 120 minutes;
download cap: 30 minutes; inference response timeout: 60 seconds; queue cap: two
requests; overload/timeout preserves partial results and fails the run.

## Frozen replacement gates

1. Complete identical corpus on both native architectures, with all transcript
   and model checksums verified. Missing architecture results mean BLOCKED.
2. At least 10% relative aggregate WER reduction versus baseline, and no corpus
   or country subgroup regression exceeding one absolute percentage point.
   Meeting WER must be at most 20%; inspect overlap/reference artifacts separately.
3. No degradation in predeclared technical-term and numeric-entity recall.
   Strict orthographic WER counts number formatting/spelling differences; do not
   claim every edit is semantic. Human review of names/numbers/negation required.
4. Prototype first-text delay p95 <= 3 seconds; final delay p95 <= 2 seconds;
   no dropped audio, zero queue overflows/timeouts, no growing backlog. These
   thresholds do not waive the production endpoint/capture/UI delay gate.
5. Full one-hour replay without crash; warmed RSS trend increase <= 100 MiB;
   peak process-tree memory <= 2 GiB. Parent-only RSS is insufficient for Whisper.
6. Actual production capture/UI and native packaging must pass on both platforms
   before replacement. CI audio replay cannot validate microphone permissions,
   room acoustics, browser/WeChat capture, GUI responsiveness or power use.

A failed gate leads to NO_REPLACE, not a relaxed threshold. Infrastructure or
missing-evidence failures lead to INCOMPLETE/BLOCKED, not an engine accuracy claim.
The small initial LibriSpeech screen is excluded from the new qualification score.

## Production PCM soak

The native production helper has a separate production replay gate. The original
15-minute profile remains available in `native_replay.py`; the current targeted
release profile is described under "First-text scheduling regression" below.
It reuses the frozen, nonrepeating source-balanced montage above, but feeds 512
float32 samples at the real sample clock into the bundled helper. The helper owns
actual VAD, partial scheduling, final FIFO and the unchanged PCM budgets. Reference
segment boundaries select the montage only; they do not trigger inference. No
microphone or private recording is used. Sources retain their original attribution.

The supervisor verifies the empty-environment CPU handshake, ordered final IDs,
bounded pipe lag, stop acknowledgement, exit code and complete sample count. It
samples the supervisor/child process-tree RSS through the existing libproc adapter.
Failure, timeout or cancellation kills and reaps the child and keeps evidence.
It does not collect the native protocol in an unbounded in-memory event list.

Predeclared release acceptance: exactly 900 seconds; no helper overflow/timeout; at least
one final; first-text p95 <= 3 seconds from VAD start; final p95 <= 4.4 seconds from
VAD end (reserving the existing 0.6-second endpoint silence within the product's
5-second target); sampled peak <= 2 GiB; warmed median RSS growth <= 100 MiB.
These replay clocks are not ground-truth acoustic endpoints. A pass does not prove
microphone-to-UI latency, accuracy, Chinese translation or mixed-source capture.
Missing measurements cannot pass. Latency, memory and correctness thresholds remain unchanged.

The release workflow calls the native short gate and the production replay on both
architectures before packaging. The independent Parakeet accuracy/replay matrix
is not run as part of a release of the unchanged Whisper model. It remains required
before any engine replacement, with its original frozen comparison policy.

### Duration policy revision (2026-10-18)

The user explicitly requested that routine validation no longer take more than
30 minutes. That revision selected `release-15-minute-v1`: a source-balanced
900-second replay, with a 30-minute production CI job cap including setup/build.
This is a shorter-duration release check, not proof of hour-long stability.
Earlier failed hour results below remain failures; no historical report is relabeled.
The local hour run on `d79b005` was interrupted at the user's request and remains
INCOMPLETE. Its child process was stopped and reaped.

Routine pushes run the production validation through Release only, avoiding the
previous duplicate Qualification run. The independent full-corpus/one-hour engine
comparison now requires explicit manual `compare_engines=true`; do not dispatch it
without renewed long-test authorization. Default manual qualification is production
only. Parakeet remains NO_REPLACE; shortening release validation does not qualify
a replacement engine. Packaging and mounted-DMG checks remain required, and their
duration is separate from the 15-minute paced audio measurement.

## Measurement infrastructure correction

### First-text scheduling regression (in progress)

The latest user instruction replaces repeated long runs during this repair with
targeted first-text checks. `native_latency_regression.py` reuses the production
PCM supervisor and the frozen corpus. Its 176 seconds retain the failed run's
0-60, 140-180 and 350-420 second windows, including preceding-final contention,
with one second of silence on both sides of each window. The first-text limit
remains three seconds and the final-text limit remains 4.4 seconds. This profile
does not claim sustained memory-growth coverage or microphone/UI acceptance.
Release now runs this targeted profile on native Intel and ARM, publishing
`production-latency-*` artifacts. The 900-second replay remains explicitly runnable
but is no longer a routine release dependency. Package and mounted-DMG tests are
unchanged.

The scheduling candidate preserves the first in-flight preview when the same
utterance reaches a silence boundary. Once text has been emitted, final work can
preempt subsequent previews as before. A newer utterance's final, explicit stop,
or abort still cancels the obsolete preview. The existing queue remains the sole
owner of admission, cancellation and completion state, with one model consumer;
there is no second inference pool or unbounded pending work. A completed empty
preview does not count as visible text. Tests cover these transitions and final
draining. An empty preview reports completion back to capture, which schedules a
retry on the next capture frame instead of waiting for the regular two-second
refresh. Only rejected busy admission retains its 125-millisecond backoff.
This feedback is consumed once and scoped to the current sequence;
empty results after visible text do not increase refresh frequency. Queue
admission still rejects work while inference is busy. This candidate is not a qualified release until native measurement
passes; the rejected Intel result below is not overridden by unit tests.

Local native Intel results (three inference threads, network denied, identical
frozen audio and Q5_1 model) were:

| Candidate | First-text p95 | Final-text p95 | Finals | Result |
| --- | ---: | ---: | ---: | --- |
| Existing bundled helper | 3.690 s | 1.007 s | 22 | FAIL: first text |
| Preserve first preview only | 3.632 s | 1.276 s | 22 | FAIL: first text |
| Preserve first preview and retry empty preview | 2.793 s | 1.921 s | 22 | PASS: short local profile |

All 22 final strings were identical between baseline and the final candidate.
The candidate delivered all 5,505 frames, had no overload/timeout, reached
261,709,824 bytes peak process-tree RSS and 147 ms maximum feed lag. Its helper
SHA-256 was `20e293fa94351eadc6fb1d8ef882b44b3dcca9b8ee720cb23dee9888d06f172c`.
This is one paired local regression, not a claim about all Intel hardware or
word accuracy. Final latency increased while remaining below 4.4 seconds. Native
CI and actual packaged artifact checks must still pass before tagging a release.

Native CI run `39128861762` passed the short profile on commit `2ce0d65`:
Intel first/final p95 were 2.989/1.702 seconds; ARM were 2.442/1.123 seconds.
Both delivered all 5,505 frames and 22 finals without overflow or timeout. The
Intel first-text margin was only 11 milliseconds, so completion-triggered empty
retries now remove the additional 125-millisecond wait. This is not a relaxed
threshold: busy rejection still backs off, and a fresh native result is required.
The immediate-retry candidate then passed the same local 176-second profile:
first/final p95 2.619/1.353 seconds, 22 identical final transcripts, 5,505 frames,
zero overflow/timeout, and 231,501,824 bytes peak RSS. Its helper SHA-256 was
`76756e27e7c738082c3dbe475f1a748a311fe69bddd403cc07f506c43d36ea86`.
All four native CTests passed after this adjustment. These sequential samples
do not isolate host-load variance; the eliminated scheduler delay is deterministic.

### Rejected CPU worker reuse experiment (2026-10-18)

Native run `39130349464` rejected commit `3d02a4d`: Intel first/final p95 were
5.068/3.676 seconds. The local pass did not establish native CI acceptance.

Commit `a31fa05` tested backend-owned persistent CPU pools with zero idle polling.
The local three-thread 176-second replay passed at 2.191/1.296 seconds, with all
22 final strings unchanged. Five native CTests, 16 supervisor tests and the
bundled JFK/silence/malformed-frame checks passed. However, native release run
`39132859854` rejected this candidate:

| Native host | First-text p95 | Final-text p95 | Finals | Result |
| --- | ---: | ---: | ---: | --- |
| ARM | 1.790 s | 0.829 s | 22 | PASS |
| Intel | 6.723 s | 5.116 s | 22 | FAIL: first and final text |

Both delivered 5,505 frames without overload or timeout. Intel peak RSS was
268,025,856 bytes. Its partial/final compute medians were approximately
1.669/2.033 seconds, with final queue waits up to 3.315 seconds. This does not
isolate runner variance from worker-policy cost, and it is not evidence that
reusing workers fixed the bottleneck. The production patch, manifest entry and
patch-specific test were withdrawn; no tag or DMG was released. Raw evidence is
retained in artifacts `production-latency-arm64` (12139600049) and
`production-latency-x86_64` (12139047256). The first/final thresholds remain
3.0/4.4 seconds. Further candidates need measured compute attribution or a
qualified streaming engine; repeating this candidate until it passes is excluded.

The withdrawal exposed a separate incremental-build integrity issue: extracting
the pinned archive restores old source timestamps, so objects from a removed
patch can remain newer than their sources. `build-caption.mjs` now uses
`cmake --build --clean-first` after extraction/patching. A clean native rebuild
recompiled the CPU backend and passed all four retained CTests. This fixes
source-to-binary consistency; it does not explain or resolve the Intel latency
failure on fresh CI hosts. All 38 Python evaluation tests also passed.

The evaluation-only Whisper adapter now records process CPU time and upstream
per-operation timing means. A local public JFK probe with three threads reported
1.006 seconds wall time, 3.898 CPU seconds and a 781.186 ms encoder mean. The means
must not be added together as phase totals. This single clip is not evidence of
meeting accuracy, production queue behavior or native CI acceptance.

### Bounded streaming alternative screen (2026-10-18)

The already-pinned Zipformer `2023-06-26` candidate was screened on the first
complete annotated segment from the first record of each of the eight frozen
AMI/Earnings22 sources. Selection was fixed before inference. This included
157.67 seconds, 361 reference words, two far-field meetings and six earnings-call sources.
The local native Intel run used three threads, verified existing model/audio
digests, and denied networking at OS level. Zipformer consumed 80 ms chunks at
wall-clock pace; the clean rebuilt Whisper adapter decoded the same complete
clips separately for an accuracy comparison, not a competing latency measurement.

| Measure | Zipformer | Whisper base.en Q5_1 |
| --- | ---: | ---: |
| Aggregate word error rate | 73.13% | 43.21% |
| Empty completed clips | 3 of 8 | 0 of 8 |
| Technical terms matched | 1 of 2 | 1 of 2 |

The five nonempty Zipformer clips had first-text-from-clip-start p95 of 2.689
seconds. Excluding the three empty clips cannot establish success, and clip-start
timing is not comparable to the production VAD-based gate. An initial diagnostic
incorrectly mixed source-relative annotation timestamps with clip-relative audio;
those annotation-relative latency fields were discarded, not used for acceptance.
Only the existing raw wall-clock event times support the clip-start statistic.

A separate offline check used the publisher's documented mixed-precision
configuration (int8 encoder/joiner and fp32 decoder). The fp32 decoder at the same
pinned revision has SHA-256
`7bf787f90b194b307e5a4ad6a34fadb4e748304c35f78a8d66358a05b13ee6ef`.
It also produced three empty clips and 73.13% aggregate WER. Six final hypotheses
matched exactly; two differed. This follow-up used full-clip feeding rather than
paced chunks, so it does not isolate decoder precision as the cause of individual
text changes. The documented configuration did not resolve these omissions. See the upstream
[model recipe](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-transducer/zipformer-transducer-models.html#csukuangfj-sherpa-onnx-streaming-zipformer-en-2023-06-26-english).

This is a rejection screen, not an overall model ranking: the sample is small,
includes overlapping speech, and has only two technical-term occurrences. It
does not justify replacing the production recognizer. No candidate was packaged,
no ARM candidate run was claimed, and no microphone/translation/DMG acceptance
was performed. A future streaming candidate must preserve useful meeting
recognition as well as reduce latency; first-text speed alone is insufficient.

### Streaming implementation boundary and short candidate gate

#### Local-first redesign checkpoint (2026-10-20)

The subsequent user instruction initially paused implementation for design review.
[Live Caption section 0](live-caption.md#0-streaming-redesign-review) owns the
domain/state/lifecycle semantics. After reviewing T1-r1, the user explicitly
authorized implementation and required local tests before commit. Section 0.6
limits the first repair to clocks, admission and draining. This checkpoint retains
evidence and earlier recommendations; it is not a model promotion or release pass.

The latest instruction supersedes the candidate-push trial loop: inspect and
redesign the recognition/testing boundary, then establish local functional and
performance evidence before another CI push. Do not create a release tag or use
CI as the first execution of a model candidate. Runs already submitted remain
diagnostic evidence, not permission to replace the production engine.

The existing results identify two distinct problems:

1. The production buffered recognizer repeats prefix work and competes with
   finalization. The opt-in adapter eliminates that duplicated inference, but
   passing its queue/unit tests does not demonstrate recognition quality.
2. The current short screen has not established a trusted accuracy oracle.
   `4475486-0:7` contains 20 seconds of audio but only three reference tokens
   (`o v i`); this requires listening and annotation review, not automatic
   correction from either model's hypothesis. `4481952-0:0` has 59 inferred word
   timings out of 70. AMI clips include simultaneous speakers. The screen has
   only four technical-term occurrences. These facts prevent a general
   accuracy or terminology-quality claim from its aggregate WER. Native replay
   separately reports `accuracy: NOT_SCORED`, so it does not close this gap.

Do not delete difficult samples, rewrite references from candidate output or
relax thresholds to obtain a pass. Preserve the original reports. Separate a
reviewed, immutable acceptance set from the existing diagnostic/stress set.
Reference review status must be explicit; an unreviewed set is **INCONCLUSIVE**
for accuracy qualification, even if a model happens to score better.

| Boundary | Revised ownership and acceptance |
| --- | --- |
| Capture | Existing Swift capture and framed PCM; preserve sample counts, timestamps, permission errors and explicit overload handling |
| Streaming ASR | One persistent native model and one decoder owner; process new PCM once, keep bounded cached state and make utterance/stream reset semantics explicit |
| VAD and finalization | Detect boundaries without losing onset/EOF audio; verify final text as well as timing after pauses and maximum-length splits |
| Display | Existing partial/final protocol; continuous provisional text must not be mistaken for committed history |
| Translation/history | Existing asynchronous consumers of committed text; do not let translation block English recognition |
| Accuracy set | Approximately 3-6 minutes of public or explicitly authorized meeting speech with reviewed text/timings, source hashes, accents and declared terminology; baseline and candidate receive identical PCM |
| Stress set | Existing overlapping/noisy/inferred-alignment cases remain visible separately; never silently promote their scores into acceptance evidence |
| Latency | Report model load, speech onset, first displayed nonempty partial, first stable text, finalization, queue delay and compute separately; clip-start delay is not VAD-start delay |
| Native functional coverage | Speech, silence, short phrases, consecutive utterances, EOF tail, stop/cancel, invalid frames, no duplicated/dropped accepted PCM and no stale partial after finalization |
| Local performance | Sequential baseline/candidate runs on the same host, fixed thread budget, deny-network sandbox, cold and warm short runs, actual native executable/model fingerprints |
| CI | Cross-architecture replication of locally verified inputs and executables, followed by packaged-resource verification; not model discovery |

Before any further candidate push:

1. Finish the design review of stream/reset, endpoint and sample-accounting
   behavior; record concrete failures rather than adding another model by default.
2. Review and freeze the small acceptance corpus independently of model output.
   Unknown word timing, incomplete reference coverage and overlap must be
   disclosed and resolved or retained as diagnostic-only evidence.
3. Run the actual native helper locally. Unit tests, mocked C APIs, a successful
   compiler, Python-only inference and a single public speech fixture cannot
   substitute for paired native meeting accuracy and latency.
4. Persist reproducible commands, host/CPU/thread facts, hashes, full public
   fixture transcripts, per-utterance timing, errors and `NOT_RUN` scopes.
5. Only after those local gates pass, push for native Intel/ARM verification.
   Missing local hardware must be declared; never describe an Intel result as an
   ARM test or a hosted result as a local test.

The 3.0-second first-text and 4.4-second finalization thresholds remain unchanged.
Any new scoring protocol requires an explicit version and independent reference
review, not retroactive relabeling of failed runs. Full microphone-to-UI,
translation, saved history and installed-DMG acceptance remain separate checks.

The local source review identified additional integration defects that block
promotion of the candidate, irrespective of model scores:

| Finding | Evidence and required correction |
| --- | --- |
| Fragmented PCM timestamp regression | Locally reproduced against `13b9aff`: ten 512-sample packets, then `100 @ 320 ms` and `413 @ 326 ms`, produce job ends `352, 351, 351 ms`. `pcm_frames.h` and `streaming_input.h` round offsets independently. Establish one anchored cumulative sample clock; verify every packet split and the one-sample EOF tail. |
| Capture clock mismatch | `LiveCaptionCapture.swift` timestamps callback execution after conversion, while `pcm_frames.h` assumes a nearly exact sample clock. Hardware sample position, delivered sample count and wall-clock/session placement must have explicit ownership; increasing jitter tolerance is not a substitute. |
| Discontinuity after capture overflow | `runtime.rs::on_audio` marks failure but can admit later callbacks before cancellation; aligned-frame gaps bypass the current partial-frame check. Close admission on the first drop and never concatenate audio across a known missing interval. This source finding still needs a deterministic callback/queue test. |
| Accepted-final loss on overload | `streaming_runtime.cpp` suppresses output and clears the queue after admission failure, potentially losing previously admitted completed sequences. Distinguish admission stop from decoder failure and specify bounded final draining. Source finding, not yet reproduced. |
| Stale provisional text | An empty finalized result can close a stream without clearing a prior visible partial. Use the existing nonpersistent partial-clear semantics, not an empty durable final. Source finding, not yet reproduced. |

These issues require a focused boundary redesign, not a replacement GUI, event
bus, history store or translation service. The capture adapter owns original
sample continuity; the PCM layer owns one exact integer sample position; VAD owns
utterance boundaries; the decoder owns model/cache state; the lifecycle controller
owns admission, final draining and terminal failure. Keep those responsibilities
testable separately and together.

Local baseline evidence on 2026-10-20:

- Rebuilt the default CPU helper from the verified pinned archive; six default
  native CTest cases passed. The seven-test opt-in configuration had passed
  separately, including the fake-C-API adapter test.
- Ran the actual helper with network denied: public JFK speech, silence and
  malformed-frame tests passed. This is functional smoke evidence only.
- Ran the 11-second public JFK sample three times at real-time pace, in separate
  helper processes, with a fixed three-thread budget on an Intel i7-9750H
  (12 logical CPUs, 16 GiB RAM). First-from-VAD P95 was `1.701 / 1.684 / 1.804 s`;
  final-after-VAD P95 was `0.713 / 0.713 / 0.729 s`. Each run produced three finals,
  no queue overflow and no timeout. This does **not** reproduce the failing
  meeting cases or qualify the candidate.
- Local helper SHA-256:
  `308dccfa28c01b33e1562c21b67b3159dd985c4241a1d02632c0b3759102fac5`.
  JFK WAV SHA-256:
  `59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e`.
- Reviewed meeting accuracy, candidate local native latency, physical microphone
  capture, ARM local execution, Chinese translation and installed-DMG acceptance
  remain **NOT_RUN** in this local checkpoint. No new commit, push or tag is
  justified by these smoke results.

The approved next direction is cached incremental recognition, without reducing
meeting accuracy to obtain earlier text. The next pinned screening candidate is
the English LibriSpeech/GigaSpeech streaming model at revision
`9a65b6ea94c311ca770c2bf895b30f456a22d703`. Its publisher declares Apache-2.0.
It is an evaluation candidate, not a replacement selected by publication claims.
Model/token files must match publisher digests before inference; an unpinned
filename now fails verification rather than being accepted without a checksum.

| Concern | Pattern decision | Ownership and constraint |
| --- | --- | --- |
| Incremental model state | Reuse the recognizer adapter boundary | One decoder owns one stream per utterance; no Python runtime in the shipped application |
| PCM admission | Evolve the existing bounded producer/consumer queue | Every accepted incremental sample is delivered once in order; preview-dropping rules cannot discard streaming audio |
| Capture and end detection | Reuse the existing pipeline | Swift capture, PCM framing, Silero VAD and sequence timestamps remain authoritative |
| Finalization and shutdown | Explicit stream lifecycle | Finish, drain and emit final before destroying the stream; preserve overload errors and bounded stop behavior |
| Accuracy correction | No simultaneous dual-engine pipeline | Do not hide a second CPU-heavy recognizer behind a fast partial or reintroduce final/partial contention |
| UI, translation and history | Reuse protocol-1 events | No new event bus, storage format, translation service or caption UI |

`streaming_screen.py` freezes first/middle/last annotated segments from the first
record of each of the eight existing sources. Its 24 clips total at most 480
seconds of audio, decoded faster than wall time sequentially by the two engines.
Optional first-clip paced probes total at most 160 seconds. The overall inference
deadline is five minutes, with per-request deadlines and process-group cleanup.
There is no hour-long replay in this screen. It rejects worse overall/category
WER, increased empty clips, lower measured technical-term recall, and missing or
late paced partials. Source-level results remain visible. A small screen is not
proof of general non-regression or the production VAD/UI latency contract.

The existing qualification workflow has an isolated `codex/caption-streaming`
branch trigger and an explicit `streaming_candidate` dispatch input. Only these
paths run the short candidate screen on native Intel and ARM; normal release
validation retains its existing production gate. This prevents candidate research
from being treated as a release pass. Local model transfers hit bounded download
limits; partial archives were not treated as valid models. Native CI measurements
and subsequent production integration remain required before a release tag.

#### Measured candidate rejection and native adapter (2026-10-20)

Run [39426069719](https://github.com/smartscity/polarbear/actions/runs/39426069719)
at `450d94f` completed the same 24-clip screen on native Intel and ARM with
OS-enforced network denial. Each engine received 371.995 seconds of fixed audio;
eight paced probes added 157.67 seconds, not an hour-long replay.

| Measurement | Intel | ARM |
| --- | ---: | ---: |
| Whisper strict WER | 49.46% | 49.22% |
| GigaSpeech int8 strict WER | 50.90% | 50.90% |
| Whisper / candidate empty clips | 0 / 2 | 0 / 2 |
| Candidate first partial P95 from clip start | 8.876 s | 8.817 s |
| Replacement decision | NO_REPLACE | NO_REPLACE |

The candidate improves aggregate far-field WER but worsens earnings-call WER.
Do not claim a general accuracy improvement. The raw clip-start latency includes
initial nonlexical speech/silence and is not the production VAD-based metric.
Source references contain overlapping speech and inferred timings; these strict
scores are a paired diagnostic, not a consumer accuracy percentage.

The controlled run at `09f7544` uses the publisher's 660 ms EOF lookahead instead of the
prototype's 300 ms and feeds accelerated accuracy clips in the same 80 ms chunks
as paced inference. A full-precision model from the same pinned revision is added
to distinguish quantization loss; neither change is presumed to improve results.

The opt-in native candidate now has an executable input path, not just a Python
wrapper: protocol-1 PCM -> validated frames -> existing Silero VAD -> bounded
incremental FIFO -> one C API stream -> existing partial/final events. It retains
short EOF tails, exact-once samples across the 15-second boundary, bounded queue
admission, explicit failure/abort and stream-before-model destruction. The
unchanged GUI, translation and history consume the same protocol. The candidate
is not selected by the application or copied into release resources.

`build_streaming_candidate.py` verifies the pinned C header and builds against the
evaluation runtime's native libraries. This is an evaluation link, not the final
redistributable SDK/bundle. Production packaging still requires pinned native
library provenance, licenses, signing and architecture verification. Native
176-second PCM/VAD regression uses the unchanged 3.0/4.4-second latency gates and
an eight-second drain deadline. Accuracy rejection still blocks a release even
if the native latency gate passes.

#### Cache-aware NeMo candidate

Run [39429191978](https://github.com/smartscity/polarbear/actions/runs/39429191978)
has rejected the full-precision GigaSpeech candidate on ARM: strict WER was
51.26% versus Whisper's 49.22%, with two empty clips versus zero. Its native
176-second replay also failed the unchanged first-text gate. Removing
quantization and correcting EOF lookahead did not resolve the model's losses;
this is not a reason to relax the release thresholds.

The next bounded screen evaluates the English-only
[Nemotron cache-aware streaming model](https://huggingface.co/nvidia/nemotron-speech-streaming-en-0.6b)
using the publisher's
[560 ms ONNX export](https://k2-fsa.github.io/sherpa/onnx/nemo/nemotron-streaming.html).
This is not the previously rejected offline Parakeet TDT checkpoint. The export
revision is `52056fdc070914a48dcd68b31b44d6a6f5b85902`; all five model/token/metadata
files are verified against publisher SHA-256 or Git-blob digests. The same frozen
24 clips, paired baseline, eight paced probes and 176-second native regression
apply. No candidate-dependent trimming, reference editing or threshold relaxation
is permitted.

The candidate reuses the existing online C API, incremental FIFO, PCM/VAD path and
protocol-1 events. Encoder/decoder/joiner/token paths are explicit native argv,
owned by the pinned evaluation model catalog rather than hardcoded GigaSpeech
filenames. The pinned upstream NeMo recognizer selects its feature dimension and
normalization from the model metadata; the adapter does not emulate those
features. Production resources and the default recognizer remain unchanged.

The upstream model is governed by the
[NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/),
not Apache-2.0. Its redistribution terms require the agreement and attribution,
alongside compliance with its other conditions and component notices. This
evaluation does not establish a redistributable bundle: model provenance, native
library licensing, signing and offline installed-app acceptance must still be
verified before inclusion in a DMG. Publisher performance claims are not local
or CI measurements.

Run 39034261597 on commit 79a010d completed the ARM Parakeet full accuracy pass
before failing at the first replay RSS sample. Its raw job log identifies
`PermissionError: Operation not permitted: /bin/ps`, not an inference exception.
That run is INCOMPLETE and cannot pass the sustained-session gate.

Memory sampling now uses the macOS libproc API directly, including all descendant
processes. The supervisor owns the sampler; no production capture/runtime code is
changed. Measurement failures still fail the run rather than returning zero.
The network-denying sandbox and frozen thresholds remain unchanged. A preflight
runs the harness regression suite inside that exact sandbox before loading models;
the real child-process test checks allocation accounting and release. All 18
regressions passed locally under network denial on Intel macOS. This is harness
evidence only; a new complete native matrix is required.

## Matched CPU-budget profile

The production helper's CPU budget correction exposed a comparison mismatch:
both research adapters still forced four ASR threads, even on three-CPU ARM hosts.
The corrected comparison gives both engines the same explicit budget, capped at
four and reserving one reported CPU (minimum one ASR thread). Reports include the
host CPU count and selected budget; the persistent baseline acknowledges its
budget at startup and rejects invalid arguments. `--threads 4` retains the old
profile for sequential diagnostic comparisons. Historical failures remain failed;
new results must be identified as CPU-budgeted, not merged with fixed-four timing.

On local Intel, the rebuilt baseline acknowledged two threads and rejected speech
on a two-second silence fixture; the pinned Parakeet candidate recognized the public
JFK fixture with the same two-thread setting. All 34 evaluation regressions passed
under OS-level network denial. These checks establish argument propagation and
runtime compatibility, not full accuracy, sustained latency or replacement approval.
The frozen corpus, prefix schedule, queue limits, model hashes, WER and latency
thresholds are unchanged. A complete native comparison on both architectures is
still required before proposing an engine replacement.

## Production follow-up: 2026-10-18

Release run [39108056378](https://github.com/smartscity/polarbear/actions/runs/39108056378)
tested commit `6ccdc251228c613f5d8cb2ce01c403f52d8c0ffc`. Both native helpers
consumed all 3,600 seconds with zero queue overflows/timeouts. This fixes the
observed early queue failure in that replay, but **does not pass release acceptance**:

| Native host | First-text p95 | Final-after-VAD p95 | Warmed tree RSS growth | Overall |
| --- | ---: | ---: | ---: | --- |
| ARM | 4.275 s | 2.006 s | 162,283,520 bytes | FAIL: first text, memory growth |
| Intel | 8.752 s | 4.609 s | 97,406,976 bytes | FAIL: first text, final text |

No microphone-to-UI, Chinese translation, or recognition accuracy claim follows
from this replay. Raw evidence is in the run's `production-soak-*` artifacts.
No release tag is authorized by these results.

### Rejected local scheduling experiments

The following sequential Intel experiments used the same public EN2002a recording,
pinned model and OS network denial. They are diagnostics, not replacement gates.

- Reducing only the provisional audio context was faster but substantially worse:
  on 84 common completed prefix windows (1,467 reference words), strict prefix WER
  rose from 49.15% to 70.48%. A shared decoder state also changed six of 23 final
  outputs in a 120-second trial. Isolating preview state removed the observed final
  drift but not the accuracy loss. The experiment was removed.
- Starting previews at one second and retrying empty results after 125 ms preserved
  all 188 final events in a full 1,200-second replay, but first-text p95 worsened
  from 4.372 to 5.648 seconds; final p95 worsened from 2.202 to 3.057 seconds. A
  separate 120-second run had a retained 11.185-second inference outlier. The
  feedback experiment was removed; it is not part of the production scheduler.

### Bounded corpus reading

The source-balanced montage previously kept each source's full float32 recording
alive while yielding small windows. A local sampler-only pass rose from roughly
306 MB after the first source cycle to 402 MB after later recordings, without
an inference engine. This contaminated process-tree growth measurements; it does
not establish that every observed native growth was a harness artifact.

`audio_segments` now seeks and reads only the requested canonical window. All
308 frozen windows were compared byte-for-byte with the previous full-file slices
and were identical. In the same sampler-only pass, sampled RSS remained around
64-72 MB. Thirty-five harness regressions passed under OS network denial. These
are bounded-ownership checks, not a one-hour inference result. The original failed
reports remain failed; the memory sampler, complete sample count, source order,
model checksums and release thresholds are unchanged. A fresh native soak is still
required to evaluate the corrected measurement path.

### Reference-alignment limitation found during result inspection

The matched-budget run `39108755820` completed all 308 accuracy windows for Intel
Parakeet and both Whisper hosts before those prototype replays hit the unchanged
two-outstanding-request bound. Intel Parakeet's aggregate strict WER was 34.82%
versus 44.46% for Intel Whisper; AMI-only values were 35.65% versus 50.13%.
These numbers are recorded measurements, **not accepted product accuracy**.

Inspection found severe timing disagreement in some forced-aligned Earnings-22
references, beyond number-formatting differences. For example, `4475486-0:3`
assigns only the word `third` to source seconds 180-200 while the hypothesis
contains multiple sentences. The preceding windows also show a progressive
reference lag. `4481952-0:1` and `:2` have empty references while the hypotheses
contain continuous speech; a later window concentrates 141 inferred-timing words.
The corpus records preserve these original annotations and uncertainty flags.

Do not describe these windows as verified silence/hallucination tests or use their
scores to decide the replacement. Do not repair references with candidate output,
delete difficult windows, or silently reinterpret earlier scores. A separately
versioned, manually checked timing/reference set is required for reliable subgroup
accuracy claims. The existing frozen run remains available, AMI's absolute
replacement gate is still unmet, and the candidate remains NO_REPLACE. Native
production-queue replay uses the same audio samples irrespective of reference text;
its latency/overflow results are separate from this accuracy limitation.

### CPU acceleration candidate and capture transport

The macOS helper now builds the pinned library's CPU Accelerate BLAS backend.
Metal remains disabled; model files, VAD thresholds, decoder parameters, preview
schedule and queue budgets are unchanged. The BLAS wrapper explicitly uses the
legacy Accelerate ABI, avoiding an accidental macOS 13.3 requirement in a helper
targeting 13.0. Evaluation builds link the same wrapper. System BLAS may use its
own worker pool, so the GGML thread setting is not a total process-thread limit.

A complete 1,200-second EN2002a real-time replay on local Intel produced 189 final
events, zero overflows/timeouts, 2.899-second first-text p95 and 1.342-second final
p95 (previous CPU path: 4.372/2.202 seconds). Max pipe lag was 0.203 seconds. The
comparison retained all audio and used OS network denial. Final transcripts are
not byte-identical: 153 of the 188 prior final events were identical, and one
additional utterance produced text. Whole-record strict WER against all 4,439 AMI
reference words was 47.89% before and 48.03% after; four predeclared term occurrences
had three matches in both. This is not an accuracy improvement claim. Inspection
of two changed negations found that the reference supports the accelerated output,
but this does not substitute for complete accuracy and native release gates.

Desktop capture additionally encoded each float as a separate pipe write. It now
encodes the unchanged timestamp/count/float32 frame into one bounded stack buffer
and calls `write_all` once. Tests check byte identity, one ordinary write, partial
writes, invalid lengths and broken-pipe propagation. All 11 caption Rust tests
passed, including durable bilingual history and storage failure behavior. The
Python PCM replay was already frame-batched and therefore cannot prove a measured
end-to-end speedup from this Rust transport change.

The rebuilt Intel helper passed all four native CTests, including cancellation
inside a real model graph followed by successful reuse. Typecheck, formatting and
the bounded-corpus tests are separate checks. The 20-minute candidate result does
not waive the one-hour Intel/ARM release gates, actual microphone/UI acceptance,
or the independent Parakeet replacement decision. No release is claimed here.

### Completed CPU-accelerated native hours

Commit `4eeaef9fd21168aa76072cb4d80b9030e81493e5` completed the frozen
production replay on both architectures. The independent release job also
completed an Intel hour. None of these runs recorded a microphone or exercised
the app's capture, translation or GUI boundary.

| Run / native host | Audio seconds | First-text p95 | Final-after-VAD p95 | Warmed RSS growth | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| [39114531964](https://github.com/smartscity/polarbear/actions/runs/39114531964), ARM | 3,600 | 2.307 s | 0.856 s | 27,582,464 bytes | PASS |
| Same run, Intel | 3,600 | 4.192 s | 2.358 s | 13,914,112 bytes | FAIL: first text |
| [39114531968](https://github.com/smartscity/polarbear/actions/runs/39114531968), Intel | 3,600 | 3.250 s | 1.544 s | 13,907,968 bytes | FAIL: first text |

All three had zero helper overflows/timeouts and sampled process-tree peaks below
253 MB. The two Intel measurements both fail the unchanged three-second threshold;
the faster result is not rounded down or selected to authorize a release.
Artifacts are named `production-soak-arm64` and `production-soak-x86_64` in the
corresponding runs. No new tag or DMG is authorized by this evidence.

### Full local accuracy comparison

Sequential Intel evaluations used all 308 frozen windows (5,849.355 audio seconds),
the same four-thread budget, pinned weights, and OS-level network denial. These
are whole-utterance adapter measurements, not live-caption latency.

| Group | Previous CPU WER | Accelerated CPU WER |
| --- | ---: | ---: |
| Aggregate | 44.010% | 44.521% |
| AMI | 49.267% | 50.056% |
| AMI EN2002a | 50.755% | 50.822% |
| AMI ES2004a | 46.777% | 48.775% |
| Earnings-22 | 39.753% | 40.039% |

Aggregate compute/audio ratio decreased from 0.1147 to 0.0703. Technical-term
recall remained 79/98 and numeric-entity recall changed from 12/188 to 14/188.
No aggregate accuracy improvement is claimed. In particular, ES2004a regressed by
approximately two absolute WER points; do not hide this source-level regression
behind the broader AMI category. The reference-alignment limitations above remain.

### Parakeet decision after complete ARM replay

Matched-budget run `39108755820` completed Parakeet's ARM accuracy pass and an
actual one-hour prototype replay: first-text p95 4.282 s, final p95 1.628 s,
zero dropped requests/overflows/timeouts, and one spoken window without text.
Intel completed accuracy but overflowed the unchanged two-request prototype
bound. ARM aggregate/AMI WER were 34.957%/35.674%; Intel 34.824%/35.646%.

The independent ARM repeat in run `39114531964` again completed all 308 windows
and 3,600 replay seconds: first p95 4.315 s, final p95 1.688 s, peak sampled
process-tree RSS 1,333,526,528 bytes, warmed growth 18,038,784 bytes, and zero
overflows/drops/timeouts. Its aggregate technical/numeric recall was 83/98 and
61/188. These are measured results, not product qualification. Intel again failed
the prototype outstanding-request bound. The candidate remains **NO_REPLACE**:
the first-text and absolute meeting-accuracy gates are unmet, Intel sustained
replay did not finish, and native candidate capture/packaging is not implemented.

### Further local diagnostics and translation coverage

A one-second initial **and recurring** preview experiment on the first 600 seconds
of the frozen source-balanced montage produced first/final p95 4.987/2.683 s.
A sequential repeat of the unchanged 1.5-second initial/two-second recurring
baseline produced 3.375/1.259 s. Both used three threads and produced 73 finals.
An earlier baseline attempt failed with audio backlog before completing 600
seconds and remains failed. Local variability prevents a controlled speedup claim;
the more frequent preview experiment did not establish improvement and was removed.

The subsequent isolated candidate changes only the initial preview from 1.5 to
one second; the two-second repeat interval, 125 ms busy retry, final priority,
model and decoder parameters are unchanged. On the same 600-second montage and
three-thread profile it produced first/final p95 2.745/1.244 s, zero overflows or
timeouts, and 73 finals. All 73 final texts exactly matched the sequential baseline
repeat. This bounded diagnostic supports running the candidate's full native
matrix, not declaring qualification or creating a release tag. The original
baseline failure remains part of the evidence rather than being erased by repeats.

A separate public JFK CPU-kernel diagnostic compared Flash Attention on/off/on
sequentially with three threads. Encoder work dominated the measured calls;
disabling Flash Attention did not establish a consistent improvement. The
diagnostic adapter changes were removed, and production kernel selection remains
unchanged. This diagnostic does not count as the subsequently approved 15-minute
release profile or a native one-hour result.

The hidden native WKWebView translation probe now checks three consecutive leased
jobs, preserves their separate timings, and verifies translated content and order.
It still waits 330 seconds while hidden before offering the first job. The retained
loader uses native gzip streaming where supported, keeps the existing worker
fallback, verifies both compressed and decoded hashes, and propagates cancellation.
No model, remote service, download, or durable-history schema changes were made.

The retained path completed that hidden-window run at 2.592 s for the first job
and 0.060/0.064 s for the following jobs. Earlier diagnostics varied considerably:
the prior loader's first jobs took 27-58 s, and an immediate diagnostic of the new
path took 15 s. These are availability/correctness measurements with uncontrolled
OS caches and host load, not a reproducible cold-start SLA or a claimed speedup
factor. Chromium and WebKit real bundled inference/CSP/cancellation tests passed,
as did nine caption browser tests, including actual leased offline translation.
None of these tests establishes new microphone-to-Chinese acceptance.

### Bounded release result: 90a0ceb (2026-10-18)

[Release run 39124619651](https://github.com/smartscity/polarbear/actions/runs/39124619651)
completed the new 900-second profile on both native architectures. Both reports
retain corpus SHA-256 `9b2ba557594ea095eb4d6aee1e60f499a6f29590cf0fd88087ce73de34ddb5fe`
and verified OS network denial. This candidate is **NOT ACCEPTED** for release.

| Host | First-text p95 | Final-after-VAD p95 | Warmed RSS growth | Finals | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| ARM | 1.759 s | 0.538 s | 9,363,456 bytes | 124 | PASS |
| Intel | 6.649 s | 3.529 s | 10,579,968 bytes | 124 | FAIL: first text |

Both completed all 28,139 PCM frames without helper overflow or timeout. Peak
process-tree RSS was 264,765,440 bytes on ARM and 253,579,264 bytes on Intel.
Artifacts `production-soak-arm64` (12136466096) and `production-soak-x86_64`
(12135697996) contain the original JSON and event/diagnostic evidence. The earlier
local 600-second result is not sufficient to override this native Intel failure.

Intel diagnostics include long final inference occupying the single model owner
while subsequent utterances arrive, and provisional inference canceled when its
final arrives. For example, sequence 20 waited approximately 4.04 s before a
1.61 s final inference. This identifies queue ownership and compute as contributors;
it does not prove a universal hardware or scheduler root cause.

Bounded local diagnostic follow-ups were not promoted to production:

- One-to-four inference-thread screening on public JFK did not establish a reason
  to reduce the current CPU budget. This local host is not the CI machine.
- LLAMAFILE kernels with Accelerate showed no consistent improvement in a short
  sequential baseline/candidate/baseline screen. LLAMAFILE without the BLAS backend
  was slower (roughly 1.68-1.93 s versus 0.99-1.38 s in that screen).
- Fourteen short/full windows from seven observed sequences each invoked the
  encoder exactly once. Single-segment decoding preserved their text but offered
  no consistent speedup. The diagnostic adapter edits were reverted.
- A pinned unquantized-model download hit its 180-second network deadline before
  completion. The partial file was not a valid model and supplies no comparison
  evidence. Neither the bundled model nor its manifest was changed.

Desktop browser regressions passed locally (22/22). CI Quality's initial Mermaid
reset assertion failed; three local repeats passed, and the rerun of that CI job
passed without source changes. Treat this as residual test timing instability,
not a product correction. No new microphone acceptance, tag, or DMG release is
claimed. Further work must improve measured inference/scheduling or explicitly
qualify a different streaming approach, rather than relax the latency threshold,
drop audio, or repeatedly rerun the same candidate until a favorable host passes.
