"""Prepare the predeclared public meeting corpus; never imported by the app."""

import argparse
import base64
import csv
import hashlib
import io
import json
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET
import zipfile

import soundfile as sf

REVISION = "c05ab6fd8b4b627d123c922a22a39e993dd37635"
CALLS = {
    "4481221": "India", "4475486": "China", "4462231": "United States",
    "4470684": "United Kingdom", "4481952": "Australia",
    "2020-03-0230487MTN-Ghana-2019-Annual-Results-Call": "Ghana",
}
MEETINGS = ("EN2002a", "ES2004a")
ANNOTATIONS = "https://groups.inf.ed.ac.uk/ami/AMICorpusAnnotations/ami_public_manual_1.6.2.zip"
# Frozen before evaluating hypotheses; spelling normalization is not semantic scoring.
TERMS = ("sify", "cloud", "data center", "data centers", "ebitda", "margin",
         "revenue", "semiconductor", "analog", "embedded", "liquidity", "dividend",
         "capital expenditure", "cash flow", "leverage", "bandwidth", "mtn",
         "remote control", "interface", "prototype", "design", "recognition")


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def download(url, target, expected=None):
    if not target.exists():
        temporary = target.with_suffix(target.suffix + ".partial")
        subprocess.run(["/usr/bin/curl", "-fLsS", "--connect-timeout", "20",
                        "--max-time", "1800", "--continue-at", "-", "-o", str(temporary), url],
                       check=True, timeout=1810)
        temporary.replace(target)
    actual = digest(target)
    if expected and actual != expected:
        raise ValueError(f"Source digest mismatch: {target.name}")
    return {"url": url, "file": target.name, "sha256": actual,
            "bytes": target.stat().st_size}


def github_file(relative, directory):
    target = directory / Path(relative).name
    response = target.with_suffix(target.suffix + ".github.json")
    url = f"https://api.github.com/repos/revdotcom/speech-datasets/contents/earnings22/{relative}?ref={REVISION}"
    download(url, response)
    metadata = json.loads(response.read_text())
    content = base64.b64decode(metadata["content"])
    actual = hashlib.sha1(f"blob {len(content)}\0".encode() + content).hexdigest()
    if actual != metadata["sha"]:
        raise ValueError("GitHub blob digest mismatch")
    target.write_bytes(content)
    return target, {"url": url, "file": target.name, "sha256": digest(target),
                    "gitBlob": metadata["sha"], "revision": REVISION}


def earnings_words(text):
    words = []
    rows = list(csv.DictReader(io.StringIO(text), delimiter="|"))
    for index, row in enumerate(rows):
        token = row["token"].strip()
        if not token:
            continue
        inferred = not row["ts"] or not row["endTs"]
        if inferred:
            # The publisher marks unaligned reference tokens as 'del'. Preserve
            # them at the adjacent anchor; these are not observed word timings.
            before = next((r for r in reversed(rows[:index]) if r["endTs"]), None)
            after = next((r for r in rows[index + 1:] if r["ts"]), None)
            if before is None and after is None:
                raise ValueError("Unaligned transcript has no timestamp anchor")
            start = end = float(after["ts"] if after else before["endTs"])
        else:
            start, end = float(row["ts"]), float(row["endTs"])
        if not (0 <= start <= end):
            raise ValueError(f"Invalid aligned token: {row}")
        words.append({"text": token, "start": start, "end": end,
                      "speaker": row["speaker"], "tags": row.get("tags", ""),
                      "inferredTiming": inferred})
    return sorted(words, key=lambda word: word["start"])


def ami_words(archive, meeting):
    words = []
    for name in sorted(archive.namelist()):
        if not Path(name).name.startswith(meeting + ".") or not name.endswith(".words.xml"):
            continue
        speaker = Path(name).name.split(".")[1]
        root = ET.fromstring(archive.read(name))
        for node in root.iter("w"):
            if node.get("punc") == "true" or not node.text or not node.text.strip():
                continue
            start, end = float(node.attrib["starttime"]), float(node.attrib["endtime"])
            if not (0 <= start <= end):
                raise ValueError(f"Invalid AMI word timestamp: {name}")
            words.append({"text": node.text.strip(), "start": start, "end": end,
                          "speaker": speaker, "tags": ""})
    if not words:
        raise ValueError(f"Missing AMI transcription: {meeting}")
    return sorted(words, key=lambda word: (word["start"], word["end"], word["speaker"]))


def segments(words, start, end, maximum=20):
    """Keep every selected word, including overlap; never split a timed word."""
    selected = [w for w in words if w["start"] >= start and w["end"] <= end]
    cursor = start
    while cursor < end:
        boundary = min(cursor + maximum, end)
        crossing = [w for w in selected if w["start"] < boundary < w["end"]]
        while crossing:
            boundary = min(w["start"] for w in crossing)
            crossing = [w for w in selected if w["start"] < boundary < w["end"]]
        if boundary <= cursor:
            raise ValueError("Annotation word or overlap exceeds segment limit")
        group = [w for w in selected if cursor <= w["start"] < boundary]
        yield {"start": cursor, "end": boundary, "reference": " ".join(w["text"] for w in group),
               "words": group, "speakers": sorted({w["speaker"] for w in group}),
               "inferredTimingWords": sum(w.get("inferredTiming", False) for w in group),
               "overlappingWords": sum(a["end"] > b["start"] for a, b in zip(group, group[1:]))}
        cursor = boundary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--source", choices=("all", "earnings", "ami"), default="all")
    parser.add_argument("--merge", action="store_true")
    args = parser.parse_args()
    if args.merge:
        pieces = [json.loads((args.directory / f"corpus-{source}.json").read_text())
                  for source in ("ami", "earnings")]
        merged = {**pieces[0], "scope": "all"}
        for key in ("sources", "provenance", "records"):
            merged[key] = [item for piece in pieces for item in piece[key]]
        if set(merged["sources"]) != set(CALLS) | set(MEETINGS):
            raise ValueError("Both complete source corpora are required")
        merged["audioSeconds"] = sum(r["audioSeconds"] for r in merged["records"])
        (args.directory / "corpus-all.json").write_text(json.dumps(merged, indent=2) + "\n")
        return
    raw = args.directory / "sources"
    raw.mkdir(parents=True, exist_ok=True)
    records, provenance = [], []
    selected_ids = list(CALLS) + list(MEETINGS) if args.source == "all" else (
        list(CALLS) if args.source == "earnings" else list(MEETINGS))
    archive = None
    try:
        for identity in selected_ids:
            print(f"Preparing {identity}", flush=True)
            if identity in CALLS:
                reference, info = github_file(f"transcripts/force_aligned_nlp_references/{identity}.aligned.nlp", raw)
                provenance.append(info)
                pointer, info = github_file(f"media/{identity}.mp3", raw)
                lines = pointer.read_text().splitlines()
                expected = next(line.split("sha256:")[1] for line in lines if line.startswith("oid "))
                source = raw / (identity + "-audio.mp3")
                url = f"https://media.githubusercontent.com/media/revdotcom/speech-datasets/{REVISION}/earnings22/media/{identity}.mp3"
                provenance.append(download(url, source, expected))
                words = earnings_words(reference.read_text())
                category, country = "earnings22", CALLS[identity]
            else:
                if archive is None:
                    annotations = raw / "ami_public_manual_1.6.2.zip"
                    provenance.append(download(ANNOTATIONS, annotations))
                    archive = zipfile.ZipFile(annotations)
                source = raw / f"{identity}.Array1-01.wav"
                url = f"https://groups.inf.ed.ac.uk/ami/AMICorpusMirror/amicorpus/{identity}/audio/{source.name}"
                provenance.append(download(url, source))
                words = ami_words(archive, identity)
                category, country = "ami-far-field", "mixed/unknown"
            converted = raw / f"{identity}-16k.wav"
            if not converted.exists():
                subprocess.run(["/usr/bin/afconvert", str(source), str(converted),
                                "-f", "WAVE", "-d", "LEI16@16000", "-c", "1"], check=True, timeout=300)
            samples, rate = sf.read(converted, dtype="float32")
            if rate != 16000 or samples.ndim != 1:
                raise ValueError("Expected mono 16 kHz canonical audio")
            duration = len(samples) / rate
            windows = [(120, 420), (duration - 300, duration)] if identity in CALLS else [(0, min(1200, duration))]
            for window_index, (start, end) in enumerate(windows):
                filename = f"{identity}-{window_index}.wav"
                target = args.directory / filename
                frame_start, frame_end = round(start * rate), round(end * rate)
                sf.write(target, samples[frame_start:frame_end], rate, subtype="PCM_16")
                chunks = list(segments(words, start, end))
                for chunk in chunks:
                    chunk["start"] -= start
                    chunk["end"] -= start
                records.append({"id": f"{identity}-{window_index}", "sourceId": identity,
                                "file": filename, "sha256": digest(target), "sourceStart": start,
                                "audioSeconds": (frame_end - frame_start) / rate,
                                "category": category, "country": country, "segments": chunks})
            (args.directory / "preparation-progress.json").write_text(json.dumps({
                "status": "INCOMPLETE", "completedSources": sorted({r["sourceId"] for r in records}),
                "provenance": provenance}, indent=2) + "\n")
        report = {"schemaVersion": 1, "scope": args.source, "sources": selected_ids,
                  "provenance": provenance, "records": records, "technicalTerms": TERMS,
                  "audioSeconds": sum(r["audioSeconds"] for r in records),
                  "license": "AMI: CC BY 4.0; Earnings22 transcripts/derived text: CC BY-SA 4.0",
                  "attribution": "AMI Consortium; Rev.com Earnings-22 (Del Rio et al., 2022)"}
        (args.directory / f"corpus-{args.source}.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({"scope": args.source, "audioSeconds": report["audioSeconds"]}), flush=True)
    finally:
        if archive:
            archive.close()


if __name__ == "__main__":
    main()
