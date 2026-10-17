# Parakeet qualification protocol

Status: PREDECLARED, 2026-10-17. Production replacement is NOT AUTHORIZED by a
screening pass. Owner: live-caption-engine-evaluation.md.

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

The native production helper has a separate one-hour gate (`native_replay.py`).
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

Predeclared acceptance: exactly 3,600 seconds; no helper overflow/timeout; at least
one final; first-text p95 <= 3 seconds from VAD start; final p95 <= 4.4 seconds from
VAD end (reserving the existing 0.6-second endpoint silence within the product's
5-second target); sampled peak <= 2 GiB; warmed median RSS growth <= 100 MiB.
These replay clocks are not ground-truth acoustic endpoints. A pass does not prove
microphone-to-UI latency, accuracy, Chinese translation or mixed-source capture.
Missing measurements cannot pass. No acceptance threshold is loosened after a run.

The release workflow calls the native short gate and this production soak on both
architectures before packaging. The independent Parakeet accuracy/replay matrix
is not run as part of a release of the unchanged Whisper model. It remains required
before any engine replacement, with its original frozen comparison policy.

## Measurement infrastructure correction

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
