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
  engine with four CPU threads, records every hypothesis and computes aggregate
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

```sh
python3 -m unittest discover -s apps/desktop/scripts/caption-evaluation -p 'test_*.py'
```

## Attribution

Recordings and reference transcripts: [LibriSpeech ASR corpus](https://www.openslr.org/12),
Vassil Panayotov, Guoguo Chen, Daniel Povey and Sanjeev Khudanpur, CC BY 4.0.
The noise condition modifies the original recordings in memory. No audio or model
weights are committed. Model sources and distribution obligations are documented
in the engine evaluation report; a model license is separate from its runtime's
license and its transitive dependencies.
