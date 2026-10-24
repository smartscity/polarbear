"""Build an explicitly opt-in native candidate; never modify packaged assets."""

import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import subprocess
import urllib.request

SHERPA_COMMIT = "11afbd009a7f8c08f4bcf2fc1b265d0df4670fbf"
HEADER_SHA256 = "2a1b95084be8fd1deb3228fcad2fd3f7f0258b64582f7402281ec174c7b7f4ce"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("build", type=Path)
    args = parser.parse_args()
    if platform.system() != "Darwin" or platform.machine() not in ("x86_64", "arm64"):
        parser.error("A native macOS qualification host is required")
    if importlib.metadata.version("sherpa-onnx") != "1.13.8":
        raise ValueError("The pinned candidate runtime is required")
    import sherpa_onnx

    native = Path(sherpa_onnx.__file__).parent / "lib"
    library = native / "libsherpa-onnx-c-api.dylib"
    if not library.is_file():
        raise FileNotFoundError(library)
    header = args.build / "include/sherpa-onnx/c-api/c-api.h"
    header.parent.mkdir(parents=True, exist_ok=True)
    url = f"https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/{SHERPA_COMMIT}/sherpa-onnx/c-api/c-api.h"
    with urllib.request.urlopen(url, timeout=30) as response:
        source = response.read(256 * 1024)
    if hashlib.sha256(source).hexdigest() != HEADER_SHA256:
        raise ValueError("Pinned Sherpa C API header checksum mismatch")
    header.write_bytes(source)
    tauri = Path(__file__).resolve().parents[2] / "src-tauri"
    manifest = json.loads((tauri / "resources/caption/manifest.json").read_text())
    whisper = tauri / f"target/caption-native/whisper.cpp-{manifest['engine']['commit']}"
    subprocess.run([
        "cmake", "-S", str(tauri / "native/caption-engine"), "-B", str(args.build),
        f"-DWHISPER_SOURCE={whisper}", "-DCMAKE_BUILD_TYPE=Release",
        f"-DCMAKE_OSX_ARCHITECTURES={platform.machine()}", "-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0",
        f"-DSHERPA_ONNX_INCLUDE_DIR={header.parents[2]}", f"-DSHERPA_ONNX_C_API_LIBRARY={library}",
        f"-DCMAKE_BUILD_RPATH={native}",
    ], check=True, timeout=60)
    subprocess.run(["cmake", "--build", str(args.build), "-j", "3"], check=True, timeout=180)
    subprocess.run(["ctest", "--test-dir", str(args.build), "--output-on-failure"], check=True, timeout=90)
    provenance = {
        "status": "BUILT_NOT_QUALIFIED", "sherpaCommit": SHERPA_COMMIT, "headerSha256": HEADER_SHA256,
        "architecture": platform.machine(),
        "libraries": {file.name: hashlib.sha256(file.read_bytes()).hexdigest()
                      for file in sorted(native.glob("*.dylib"))},
        "scope": "Native C API candidate linked to evaluation wheel libraries; not a distributable bundle",
    }
    (args.build / "streaming-native-provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")


if __name__ == "__main__":
    main()
