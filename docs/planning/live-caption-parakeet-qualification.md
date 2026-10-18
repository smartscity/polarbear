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
