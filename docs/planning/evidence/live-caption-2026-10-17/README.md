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
