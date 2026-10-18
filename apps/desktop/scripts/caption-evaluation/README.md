# Offline caption engine screening

This is an isolated research harness, not a new application runtime or a release
qualification suite. It never changes the production caption model. Python and
ONNX wheels are evaluation dependencies only; a shipping implementation would
need a separately qualified native runtime for both macOS architectures.

## Scope and ownership

- `prepare.py` is the only network-enabled component. It downloads pinned model
  revisions and public LibriSpeech test recordings. Model ONNX hashes are checked
  against publisher LFS SHA-256 metadata.
- `evaluate.py` accepts local assets only. It verifies recordings, runs each
  engine with the same CPU budget, records every hypothesis and computes aggregate
  word error rate (WER). Do not run multiple inference jobs concurrently.
- `whisper-baseline.cpp` exposes the existing pinned Whisper implementation as a
  persistent whole-utterance process. It intentionally excludes production VAD
  and repeated partial decoding to isolate engine accuracy and compute cost.
- `metrics.py` owns text normalization and edit distance. Punctuation and case
  are ignored, apostrophes retained; numbers are **not** expanded into words.
- `--paced` additionally delivers three clips to Zipformer in 80 ms wall-clock
  chunks, recording partial updates and finalization after EOF. It does not
  simulate microphone capture, VAD, translation, GUI rendering or persistence.

The corpus is 20 predeclared indices (`range(0, 2620, 131)`) from LibriSpeech
`test-clean`, selected before running any model. Noise trials use the same clips
plus deterministic white noise at 10 dB SNR. This small read-speech corpus is not
a meeting/conversation benchmark. Zipformer was trained on LibriSpeech, making
this an in-domain screening test, not evidence of general superiority.

The default budget matches production: at most four ASR threads, reserving one
reported CPU for ingestion and other work (minimum one ASR thread). Both adapters
receive the same explicit budget; reports record it and the host CPU count.
`--threads 4` reproduces the historical fixed-four profile for controlled sequential
comparisons. Historical results are not overwritten or reclassified. The baseline
helper acknowledges its thread budget, so an older binary cannot silently run a
different configuration. Thread budgeting changes neither the frozen corpus nor
accuracy and latency acceptance thresholds.

## Preparation

Use a scratch directory outside the checkout. The recorded run used Python
3.14.7 on Intel macOS and the versions in `requirements.txt`.

```sh
python3 -m venv /tmp/polarbear-asr-evaluation/venv
/tmp/polarbear-asr-evaluation/venv/bin/pip install -r apps/desktop/scripts/caption-evaluation/requirements.txt
/tmp/polarbear-asr-evaluation/venv/bin/python apps/desktop/scripts/caption-evaluation/prepare.py /tmp/polarbear-asr-evaluation/samples --samples
/tmp/polarbear-asr-evaluation/venv/bin/python apps/desktop/scripts/caption-evaluation/prepare.py /tmp/polarbear-asr-evaluation/models
```

The initial dataset-server responses used dataset revision
`71cacbfb7e2354c4226d01e70d77d5fca3d04ba1`. Dataset-server ordering can change:
compare the resulting IDs and SHA-256 values with the committed evidence before
comparing new measurements with this run. A complete pinned corpus manifest is
more authoritative than a later live dataset query.

The maintainer's [Parakeet release archive](https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2)
is an alternative download source. Extract only the encoder, decoder, joiner,
tokens and README into `models/parakeet`, then run `prepare.py --model parakeet`
to verify the same pinned ONNX hashes and record the local assets. The archive
name is mutable; its name alone is not an integrity guarantee.

Build the evaluation adapter against the static host libraries produced by
`caption:build`, using the commit in `src-tauri/resources/caption/manifest.json`.
For the recorded Intel run:

```sh
BASE=apps/desktop/src-tauri/target/caption-native
SOURCE="$BASE/whisper.cpp-d1be6fde11ac6e0407606b4e42fe72d34add8037"
LIB="$BASE/x86_64/whisper-build"
c++ -std=c++17 -O3 -DNDEBUG -arch x86_64 -mmacosx-version-min=13.0 \
  -I "$SOURCE/include" -I "$SOURCE/ggml/include" -I "$SOURCE/examples" \
  apps/desktop/scripts/caption-evaluation/whisper-baseline.cpp \
  "$LIB/src/libwhisper.a" "$LIB/ggml/src/libggml.a" \
  "$LIB/ggml/src/ggml-blas/libggml-blas.a" \
  "$LIB/ggml/src/libggml-cpu.a" "$LIB/ggml/src/libggml-base.a" \
  -framework Accelerate -o /tmp/polarbear-asr-evaluation/whisper-baseline
```

## Network-denied evaluation

On macOS, run each engine inside an explicit network-denying sandbox. Check that
the profile actually rejects an outbound socket before treating this as offline
evidence. Running it inside another restrictive sandbox may require launching
the outer command with permission to apply the macOS sandbox.

```sh
sandbox-exec -p '(version 1)(allow default)(deny network*)' \
  /tmp/polarbear-asr-evaluation/venv/bin/python apps/desktop/scripts/caption-evaluation/evaluate.py \
  whisper /tmp/polarbear-asr-evaluation \
  --baseline /tmp/polarbear-asr-evaluation/whisper-baseline \
  --whisper-model "$PWD/apps/desktop/src-tauri/resources/caption/ggml-base.en-q5_1.bin"
sandbox-exec -p '(version 1)(allow default)(deny network*)' \
  /tmp/polarbear-asr-evaluation/venv/bin/python apps/desktop/scripts/caption-evaluation/evaluate.py \
  zipformer /tmp/polarbear-asr-evaluation --paced
sandbox-exec -p '(version 1)(allow default)(deny network*)' \
  /tmp/polarbear-asr-evaluation/venv/bin/python apps/desktop/scripts/caption-evaluation/evaluate.py \
  parakeet /tmp/polarbear-asr-evaluation
```

Results are `<engine>-results.json` in the scratch directory. An interrupted
file without `summary` is **incomplete**, not a passing run. Runtime failures
must not be scored as successful empty transcripts. Times are single-pass
screening measurements, not controlled multi-run performance claims. Load time
is separate; compute/audio ratio is not first-caption or end-to-end latency.
RSS fields have different scopes for subprocess and in-process engines and must
not be compared directly.

The macOS production build now links the system Accelerate BLAS backend while
keeping GPU inference disabled. The evaluation adapter must link that same static
BLAS wrapper, as shown above. The selected GGML thread budget is not a guarantee
about the system library's internal worker pool. Record the build snapshot when
comparing measurements; do not merge pre-BLAS and BLAS timings. The wrapper uses
the legacy Accelerate ABI to retain the helper's macOS 13.0 deployment target.

```sh
python3 -m unittest discover -s apps/desktop/scripts/caption-evaluation -p 'test_*.py'
```

## Extended meeting qualification

`qualification_corpus.py` prepares the frozen AMI/Earnings-22 corpus described in
`docs/planning/live-caption-parakeet-qualification.md`. It is network-enabled
research tooling, not application code. `qualify.py` reuses the same engine
adapters behind a supervised process and performs full-corpus accuracy plus a
one-hour real-time, source-balanced prefix-replay montage without repeated audio.
The worker has a two-request bound and a 60-second response timeout. It fails on
overload instead of silently skipping audio. Partial JSONL evidence survives a
failure; only `status: MEASURED` means the requested measurement completed, and
even that does **not** authorize production replacement.

The `Caption Qualification` workflow prepares identical canonical WAV fixtures
once, then runs four independent native macOS jobs (Intel/ARM x Whisper/Parakeet).
Its artifact retention is bounded; copy reviewed measurements into the evidence
directory before expiry. The workflow never releases or changes the application.

```sh
python qualification_corpus.py /tmp/caption-corpus --source all
sandbox-exec -p '(version 1)(allow default)(deny network*)' python qualify.py \
  parakeet /tmp/caption-corpus/corpus-all.json /tmp/parakeet-qualification.json \
  --models /tmp/polarbear-asr-evaluation/models --expect-arch x86_64
```

Use `--phase accuracy` or `--phase replay` for a bounded diagnostic, but neither
alone completes qualification. `--soak-seconds` is for harness tests only; runs
shorter than 3600 seconds cannot pass the one-hour stability gate. Do not compare
parent-only memory with the new sampled process-tree memory or equate oracle
window latency with real VAD/capture/GUI latency. These corpora contain public
conversation; country groups are not verified per-speaker accent annotations.

## Production scheduling regression

The production helper now accepts PCM/VAD independently of inference and drops
only superseded provisional work, never accepted final audio. The frozen
qualification adapter still measures its originally declared prefix schedule;
its failed runs remain failed and cannot be reclassified using this change.

`../test-caption-engine.mjs <upstream-jfk.wav> [assets] --realtime` repeats the
11-second packaging fixture for 99 seconds at the sample clock. Both native CI
architectures run it. This is a queue/ordering regression, not accuracy or long
meeting qualification. `../replay-caption-audio.mjs <wav> <assets>` reuses the
same supervisor for a consented 16 kHz mono PCM16 recording of up to ten minutes,
without repetition. It reports hashes, write lag and final latency, not speech
content. Run old/new helpers sequentially on the same host and model, retain
failures, and distinguish these diagnostics from a one-hour acceptance run.

## Attribution

Recordings and reference transcripts: [LibriSpeech ASR corpus](https://www.openslr.org/12),
Vassil Panayotov, Guoguo Chen, Daniel Povey and Sanjeev Khudanpur, CC BY 4.0.
The noise condition modifies the original recordings in memory. No audio or model
weights are committed. Model sources and distribution obligations are documented
in the engine evaluation report; a model license is separate from its runtime's
license and its transitive dependencies.
