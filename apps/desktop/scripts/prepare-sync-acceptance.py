#!/usr/bin/env python3
"""Create owned, deterministic sync fixtures; never reads user notes or credentials."""
import argparse
import binascii
import hashlib
import json
from pathlib import Path
import struct
import uuid
import zlib

parser = argparse.ArgumentParser()
parser.add_argument("output", type=Path)
args = parser.parse_args()
root = args.output.resolve()
root.mkdir(parents=True, exist_ok=False)
workspace = root / "workspace"
workspace.mkdir()
versions = root / "remote-versions"
versions.mkdir()
run_id = "polarbear-acceptance-" + uuid.uuid4().hex
files = {"a.md": b"# a0\n", "b.md": b"# b0\n", "large.md": b"# Large generated Markdown\n" + b"Generated acceptance data.\n" * 50000}
def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", binascii.crc32(kind + data) & 0xffffffff)
pixels = bytes((n * 73 + n // 251) % 256 for n in range(1024 * 1024 * 3))
rows = b"".join(b"\0" + pixels[n:n + 3072] for n in range(0, len(pixels), 3072))
files["attachment.png"] = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1024, 1024, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows, 0)) + chunk(b"IEND", b"")
for name, data in files.items():
    (workspace / name).write_bytes(data)
for name, data in {"a1.md": b"# a1\n", "b1.md": b"# b1\n", "b-late.md": b"# Local unconfirmed edit\n"}.items():
    (versions / name).write_bytes(data)
manifest = {"runId": run_id, "workspace": str(workspace), "remoteBranch": run_id, "remotePath": run_id, "ownership": "Only this generated directory and the explicitly created matching branch belong to this run.", "files": {name: {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()} for name, data in files.items()}}
(root / "ownership.json").write_text(json.dumps(manifest, indent=2) + "\n")
(root / "README.md").write_text("# Polarbear generated sync acceptance\n\nUse only an authorized private sandbox repository and the branch recorded in ownership.json. The remote-versions directory is outside the sync workspace. Keep this ownership record until branch cleanup is confirmed.\n")
print(json.dumps(manifest, indent=2))
