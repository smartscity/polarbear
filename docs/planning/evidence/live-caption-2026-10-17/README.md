# Caption screening evidence

See [the evaluation report](../../live-caption-engine-evaluation.md) and
`apps/desktop/scripts/caption-evaluation/README.md` for methodology and limitations.

- `whisper-results.json`, `zipformer-results.json`, `parakeet-results.json`:
  complete local runs; each has 40 hypotheses, two aggregate conditions and a
  silence probe. Zipformer additionally includes three paced-stream event traces.
- `samples.json`: the 20 selected corpus IDs, source indices, reference text,
  speaker IDs and exact FLAC hashes. Initial dataset revision:
  `71cacbfb7e2354c4226d01e70d77d5fca3d04ba1`.
- `assets.json`: pinned canonical model URLs, byte sizes and SHA-256 digests.
  Zipformer was downloaded from those Hugging Face URLs. Parakeet ONNX/token
  files were downloaded from the sherpa-onnx maintainer's release archive and
  verified against the pinned Hugging Face publisher hashes; its README came
  from the canonical URL. URL fields express provenance, not a network trace.

No user audio was captured, read or uploaded. Only public test recordings were
used. Local inference ran inside macOS `sandbox-exec` with `deny network*`.
Downloaded models and recordings are not included in this directory.

## Dataset attribution

Reference transcripts are from the [LibriSpeech ASR corpus](https://www.openslr.org/12)
by Vassil Panayotov, Guoguo Chen, Daniel Povey and Sanjeev Khudanpur, distributed
under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Original transcripts
are retained; the scoring normalizes case/punctuation. Noise trials modify audio
in memory by adding deterministic 10 dB white noise. Hypotheses are model outputs,
not authoritative transcripts. No audio files are redistributed here.

## Measurement limitations

Twenty clips are insufficient to qualify meeting transcription. The same clips
are reused for the noise condition. RTF excludes loading and audio delivery;
it is not caption latency. In-process and subprocess RSS scopes differ. Paced
Zipformer tests use explicit EOF, not automatic endpoint detection. Timing is
single-pass on a working laptop and is not a controlled hardware benchmark.

## Initial extended qualification: incomplete

`qualification-incomplete.json` preserves the reports and downloaded artifact
SHA-256 values from [run 39034261597](https://github.com/smartscity/polarbear/actions/runs/39034261597),
commit `79a010d`. The public AMI/Earnings-22 selection contains 97.49 minutes,
308 windows and 15,851 normalized reference words. Attribution and corpus hashes
are retained inside the report. No raw recording or transcript is added here.

| Native runner / engine | Accuracy phase | Meeting strict WER | Continuous replay |
| --- | --- | ---: | --- |
| ARM / Parakeet | 308 windows completed | 35.67% | Failed at memory sampling |
| Intel / Parakeet | 308 windows completed | 35.65% | Failed at memory sampling |
| Intel / Whisper | 308 windows completed | 49.27% | Failed at memory sampling |
| ARM / Whisper | 12 windows completed | Not comparable | Not reached; inference timeout |

The three sampling failures are `ps` execution denial inside the offline sandbox.
ARM Whisper separately exceeded the unchanged 60-second response deadline during
accuracy inference; earlier 13.21-second audio took 38.91 seconds to decode. Do not
misclassify this as the same sampling fault or extrapolate it to every Apple chip.
None of these runs is a completed one-hour soak or replacement authorization.

Reference-integrity review also found 1,549 words with inferred timestamps and
1,911 overlapping-word adjacencies in the full corpus. In call 4475486's first
selected window, 546 of 626 source tokens lack their own alignment. Reference
words are retained but assigned to a later timestamp; this can produce empty
reference windows containing audible speech and misleading segment WER. It is
not valid to treat every empty reference as acoustic silence. These results are
strict diagnostic scores, not validated product accuracy or verified per-speaker
accent scores. Preserve the original evidence; do not delete difficult windows,
change thresholds, or silently re-score a different corpus to obtain a pass.

Replacement remains **NO_REPLACE**: meeting accuracy does not pass the predeclared
20% gate, ARM baseline is incomplete, reference alignment needs independent
review, and native capture/end-to-end latency still require separate acceptance.
Commit `9ae3e39` fixes only memory sampling and adds sandboxed preflight; its new
matrix is [run 39036516487](https://github.com/smartscity/polarbear/actions/runs/39036516487).

### Rerun observations, 13:48 UTC

The sandboxed libproc preflight passed. This removed the measurement fault but
did not make the engines qualify:

- ARM Whisper again exceeded the 60-second inference response timeout during
  accuracy testing (job `117407550866`, artifact `12101899230`).
- Intel Parakeet completed all 308 accuracy windows, then failed the actual-paced
  replay with two outstanding requests (job `117407550908`, artifact `12103250139`).
  Eight prefix responses completed, the last due at 16 seconds; memory sampling
  reached 20.051 seconds. The last completed decode took 1.825 seconds for a
  16-second prefix. This is an observed overload of the current prefix adapter,
  not a completed one-hour soak or proof that every Parakeet integration fails.
  The artifact ZIP SHA-256 was verified locally:
  `7bdca8d42dc4fa0984ff3c7e27c9c3e5d18d001e5439743f64b211c60ac4f5aa`.
- ARM Parakeet and Intel Whisper were still running at this checkpoint. Do not
  infer their outcome from the other runner's failure.

At the final checkpoint all four jobs had failed. ARM Parakeet completed 459
prefix responses before the same bounded-queue overload; its last sampled replay
time was 913.341 seconds (about 15.2 minutes), not an hour. The final completed
18-second prefix took 2.489 seconds to decode and arrived 3.315 seconds after its
scheduled audio boundary. Artifact `12103091408` was downloaded and verified with
SHA-256 `8fa49aa8941e230fb9c28954a32e9df9472f648f69b191cb1ce64b7565ac0c54`.
Intel Whisper also failed replay with the same two-outstanding-request limit
(job `117407550899`). The full matrix is **FAIL / NO_REPLACE**, not merely pending.

The unchanged queue bound and no-drop policy intentionally prevent masking a
non-real-time adapter by accumulating increasingly delayed captions. A candidate
integration must prove bounded incremental work or an explicit provisional-update
coalescing policy while preserving every finalized audio span. Changing such a
policy requires a new declared run; this failed run remains evidence.
