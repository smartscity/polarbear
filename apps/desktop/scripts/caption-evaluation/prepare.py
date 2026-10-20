"""Explicitly download pinned evaluation assets; never called by the application."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from urllib.parse import urlencode


MODELS = {
    "parakeet": {
        "repo": "csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8",
        "revision": "1ab9323565ddb038682214b292f588070a538ce2",
        "files": ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt", "README.md"],
    },
    "zipformer": {
        "repo": "csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26",
        "revision": "672fbf1b30579d6585301139bb363f42a0ad4a24",
        "files": [f"{part}-epoch-99-avg-1-chunk-16-left-128.int8.onnx" for part in ("encoder", "decoder", "joiner")]
        + ["tokens.txt", "README.md"],
    },
    "zipformer-gigaspeech": {
        "repo": "csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-21",
        "revision": "9a65b6ea94c311ca770c2bf895b30f456a22d703",
        "files": ["encoder-epoch-99-avg-1.int8.onnx", "decoder-epoch-99-avg-1.onnx",
                  "joiner-epoch-99-avg-1.int8.onnx", "tokens.txt", "README.md"],
    },
    "zipformer-gigaspeech-fp32": {
        "repo": "csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-21",
        "revision": "9a65b6ea94c311ca770c2bf895b30f456a22d703",
        "files": [f"{part}-epoch-99-avg-1.onnx" for part in ("encoder", "decoder", "joiner")]
        + ["tokens.txt", "README.md"],
    },
    "nemotron-streaming": {
        "repo": "csukuangfj2/sherpa-onnx-nemotron-speech-streaming-en-0.6b-560ms-int8-2026-04-25",
        "revision": "52056fdc070914a48dcd68b31b44d6a6f5b85902",
        "files": ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt", "README.md"],
        "license": "NVIDIA Open Model License; redistribution requires the agreement and attribution",
        "licenseUrl": "https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/",
    },
}

STREAMING_COMPONENTS = {
    "zipformer": {part: f"{part}-epoch-99-avg-1-chunk-16-left-128.int8.onnx"
                  for part in ("encoder", "decoder", "joiner")},
    "zipformer-gigaspeech": {
        "encoder": "encoder-epoch-99-avg-1.int8.onnx",
        "decoder": "decoder-epoch-99-avg-1.onnx",
        "joiner": "joiner-epoch-99-avg-1.int8.onnx",
    },
    "zipformer-gigaspeech-fp32": {part: f"{part}-epoch-99-avg-1.onnx"
                                 for part in ("encoder", "decoder", "joiner")},
    "nemotron-streaming": {part: f"{part}.int8.onnx" for part in ("encoder", "decoder", "joiner")},
}

MODEL_SHA256 = {
    "parakeet/encoder.int8.onnx": "a32b12d17bbbc309d0686fbbcc2987b5e9b8333a7da83fa6b089f0a2acd651ab",
    "parakeet/decoder.int8.onnx": "b6bb64963457237b900e496ee9994b59294526439fbcc1fecf705b31a15c6b4e",
    "parakeet/joiner.int8.onnx": "7946164367946e7f9f29a122407c3252b680dbae9a51343eb2488d057c3c43d2",
    "zipformer/encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx": "563fde436d16cf7607cf408cd6b30909819d03162652ef389c2450ced3f45ac1",
    "zipformer/decoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx": "98da299f471e38bb4e1a8df579b8cc9122d6039576a77e357b3c60f17dd83b02",
    "zipformer/joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx": "d944208d660d67c8d72cd2acaeac971fa5ceb8c80e76c1968148846fedd6e297",
    "zipformer-gigaspeech/encoder-epoch-99-avg-1.int8.onnx": "32c98281c7bd8b63e3e142d007251b37f120572e8fdea9a4f5a79ce22b10ec4f",
    "zipformer-gigaspeech/decoder-epoch-99-avg-1.onnx": "9da02b77cb08826756ec6a88635f35a40374e4164e7c6359121a9145958a6ceb",
    "zipformer-gigaspeech/joiner-epoch-99-avg-1.int8.onnx": "831477d390e59a61f1b6a6f763b9903e6c6366ff6034f1ddba613be82637122f",
    "zipformer-gigaspeech-fp32/encoder-epoch-99-avg-1.onnx": "b584884daad8cd4e60a5258e6da11876460089f1c4d3b5a92e19f0f104edb77a",
    "zipformer-gigaspeech-fp32/decoder-epoch-99-avg-1.onnx": "9da02b77cb08826756ec6a88635f35a40374e4164e7c6359121a9145958a6ceb",
    "zipformer-gigaspeech-fp32/joiner-epoch-99-avg-1.onnx": "bd5c26ad6a41cbd90c2cfa239c0b55b145af878ce1d79b4739d90f8be93359ba",
    "nemotron-streaming/encoder.int8.onnx": "7d932213491ad355c6e5576705dc3494731a52af87d7a1b954559340147909d8",
    "nemotron-streaming/decoder.int8.onnx": "0be9702c2f427a2b6bb241d298e0d3836a558de1f5b9fd3018f1cce6e2b3fa98",
    "nemotron-streaming/joiner.int8.onnx": "a35eac38a22ebceb04d230ed7afe0d68f446ba6914a036b97f14fece95967e23",
}
METADATA_GIT_BLOBS = {
    "parakeet/tokens.txt": "f0742785f6073e80b911964c455b05f3609bf23b",
    "parakeet/README.md": "8f4438d2a6e332f6ec5a107421451e422089d33a",
    "zipformer/tokens.txt": "b4d1bf82e68de1354f2a3f5fd51094d61d65c77c",
    "zipformer/README.md": "cb864962f371aa02e5716610cf4afc480b166a16",
    "zipformer-gigaspeech/tokens.txt": "b4d1bf82e68de1354f2a3f5fd51094d61d65c77c",
    "zipformer-gigaspeech/README.md": "86afdd83874fab34d83100550b208e7c0ceceb54",
    "zipformer-gigaspeech-fp32/tokens.txt": "b4d1bf82e68de1354f2a3f5fd51094d61d65c77c",
    "zipformer-gigaspeech-fp32/README.md": "86afdd83874fab34d83100550b208e7c0ceceb54",
    "nemotron-streaming/tokens.txt": "50918f5e313e1cf846cf77dfd5b4489c9c7f0b76",
    "nemotron-streaming/README.md": "90194c482dc9c3bca5268a9715be0087b4ddc293",
}


def verify_model(name, path):
    key = f"{name}/{path.name}"
    expected = MODEL_SHA256.get(key)
    expected_blob = METADATA_GIT_BLOBS.get(key)
    if not expected and not expected_blob:
        raise ValueError(f"Unpinned model asset: {key}")
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if expected and digest != expected:
        raise ValueError(f"Publisher SHA-256 mismatch: {name}/{path.name}")
    if expected_blob:
        data = path.read_bytes()
        blob = hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
        if blob != expected_blob:
            raise ValueError(f"Publisher Git blob mismatch: {name}/{path.name}")
    return digest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--model", choices=MODELS)
    parser.add_argument("--samples", action="store_true")
    args = parser.parse_args()
    args.directory.mkdir(parents=True, exist_ok=True)
    if args.samples:
        prepare_samples(args.directory)
        return
    manifest = args.directory / "assets.json"
    evidence = json.loads(manifest.read_text()) if manifest.exists() else []
    for name in (args.model,) if args.model else ("zipformer", "parakeet"):
        model = MODELS[name]
        directory = args.directory / name
        directory.mkdir(exist_ok=True)
        for filename in model["files"]:
            target = directory / filename
            url = f"https://huggingface.co/{model['repo']}/resolve/{model['revision']}/{filename}"
            if not target.exists():
                print(f"Downloading {name}/{filename}", flush=True)
                partial = target.with_suffix(target.suffix + ".partial")
                subprocess.run([
                    "/usr/bin/curl", "--fail", "--location", "--silent", "--show-error",
                    "--connect-timeout", "20", "--max-time", "1800", "--retry", "1", "--continue-at", "-",
                    "--output", str(partial), url,
                ], check=True, timeout=3650)
                partial.replace(target)
            digest = verify_model(name, target)
            evidence = [entry for entry in evidence if (entry["model"], entry["file"]) != (name, filename)]
            evidence.append({"model": name, "file": filename, "url": url,
                             "bytes": target.stat().st_size, "sha256": digest})
            manifest.write_text(json.dumps(evidence, indent=2) + "\n")
            print(f"Recorded download digest: {digest}; bytes={target.stat().st_size}", flush=True)


def prepare_samples(directory):
    # Predeclared, evenly spaced corpus indices; no filtering by model output.
    manifest = directory / "samples.json"
    samples = json.loads(manifest.read_text()) if manifest.exists() else []
    for index in range(0, 2620, 131):
        if any(sample["index"] == index for sample in samples):
            continue
        query = urlencode({"dataset": "openslr/librispeech_asr", "config": "clean",
                           "split": "test", "offset": index, "length": 1})
        response = subprocess.check_output([
            "/usr/bin/curl", "--fail", "--location", "--silent", "--show-error",
            "--max-time", "30", "--retry", "2", f"https://datasets-server.huggingface.co/rows?{query}",
        ], timeout=100)
        row = json.loads(response)["rows"][0]["row"]
        filename = row["id"] + ".flac"
        target = directory / filename
        subprocess.run([
            "/usr/bin/curl", "--fail", "--location", "--silent", "--show-error",
            "--max-time", "60", "--retry", "2", "--output", str(target), row["audio"][0]["src"],
        ], check=True, timeout=190)
        samples.append({"id": row["id"], "index": index, "file": filename,
                        "speaker": row["speaker_id"], "reference": row["text"],
                        "sha256": hashlib.sha256(target.read_bytes()).hexdigest()})
        (directory / "samples.json").write_text(json.dumps(samples, indent=2) + "\n")
        print(f"Sample {len(samples)}/20: {row['id']}, speaker={row['speaker_id']}", flush=True)


if __name__ == "__main__":
    main()
