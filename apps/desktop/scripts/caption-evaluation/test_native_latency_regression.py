"""Frozen short latency profile boundaries and acceptance checks."""

import unittest
import json
import os
from contextlib import ExitStack
from pathlib import Path
import tempfile
from unittest.mock import AsyncMock, patch

import numpy as np

from native_latency_regression import SECONDS, WINDOWS, acceptance, main, regression_audio
from native_latency_policy import latency_policy


class NativeLatencyRegressionTests(unittest.TestCase):
    def test_preserves_windows_and_silence_boundaries(self):
        samples = np.arange(420 * 16000, dtype="float32")
        with patch("native_latency_regression.montage", return_value=iter([samples])):
            audio = list(regression_audio({}, None))
        self.assertEqual(SECONDS, 176)
        self.assertEqual(sum(len(part) for part in audio), SECONDS * 16000)
        for index, (start, end) in enumerate(WINDOWS):
            np.testing.assert_array_equal(audio[index * 3], np.zeros(16000))
            np.testing.assert_array_equal(audio[index * 3 + 1], samples[start * 16000:end * 16000])
            np.testing.assert_array_equal(audio[index * 3 + 2], np.zeros(16000))

    def test_temporary_release_limit_does_not_waive_other_gates(self):
        result = {"audioSeconds": SECONDS, "finals": 1,
                  "firstFromVadStartP95Seconds": 5, "finalAfterVadEndP95Seconds": 4.4,
                  "sampledPeakProcessTreeRssBytes": 2 * 1024**3}
        self.assertTrue(all(acceptance(result).values()))
        self.assertNotIn("memoryGrowth", acceptance(result))
        for field, value, check in (
            ("audioSeconds", SECONDS - 1, "completeRegression"),
            ("finals", 0, "textProduced"),
            ("firstFromVadStartP95Seconds", 5.01, "firstText"),
            ("finalAfterVadEndP95Seconds", 4.41, "finalText"),
            ("sampledPeakProcessTreeRssBytes", 2 * 1024**3 + 1, "memoryPeak"),
            ("firstFromVadStartP95Seconds", None, "firstText"),
        ):
            self.assertFalse(acceptance({**result, field: value})[check])

    def test_candidate_qualification_stays_at_three_seconds(self):
        result = {"audioSeconds": SECONDS, "finals": 1,
                  "firstFromVadStartP95Seconds": 3.01, "finalAfterVadEndP95Seconds": 2,
                  "sampledPeakProcessTreeRssBytes": 200_000_000}
        self.assertTrue(acceptance(result)["firstText"])
        self.assertFalse(acceptance(result, candidate=True)["firstText"])
        self.assertTrue(acceptance({**result, "firstFromVadStartP95Seconds": 3}, candidate=True)["firstText"])
        self.assertNotEqual(latency_policy()["id"], latency_policy(candidate=True)["id"])
        self.assertEqual(latency_policy()["firstTextOptimizationTargetSeconds"], 3)

    def test_cli_records_failed_measurements_and_only_waives_alpha_first_text(self):
        measured = {"audioSeconds": SECONDS, "finals": 10,
                    "firstFromVadStartP95Seconds": 6.2, "finalAfterVadEndP95Seconds": 2,
                    "sampledPeakProcessTreeRssBytes": 200_000_000}
        for tag, result, allowed in (
            ("v0.10.10-alpha.2", measured, True),
            ("v0.10.10", measured, False),
            ("v0.10.10-alpha.2", {**measured, "finalAfterVadEndP95Seconds": 5}, False),
            ("v0.10.10-alpha.2", {**measured, "firstFromVadStartP95Seconds": None}, False),
            ("v0.10.10-alpha.2", RuntimeError("Helper failure: audioBacklog"), False),
        ):
            with self.subTest(tag=tag, result=result), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "manifest.json").write_text('{"models": []}')
                output, summary = root / "report.json", root / "summary.md"
                argv = ["native_latency_regression.py", str(root / "corpus.json"), str(output),
                        "--assets", directory, "--helper", str(root / "helper"),
                        "--expect-arch", "x86_64", "--release-tag", tag]
                replay = (AsyncMock(side_effect=result) if isinstance(result, Exception)
                          else AsyncMock(return_value=result))
                with ExitStack() as stack:
                    stack.enter_context(patch("sys.argv", argv))
                    stack.enter_context(patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": str(summary)}))
                    for name, value in (("validate_native_arch", None),
                                        ("validate_corpus", {"license": "test", "attribution": "test"}),
                                        ("digest", "fixture-hash"), ("offline_control", "test"),
                                        ("regression_audio", iter(()))):
                        stack.enter_context(patch("native_latency_regression." + name, return_value=value))
                    stack.enter_context(patch("native_latency_regression.replay", replay))
                    if allowed:
                        main()
                    else:
                        with self.assertRaises(RuntimeError):
                            main()
                report = json.loads(output.read_text())
                if isinstance(result, Exception):
                    self.assertEqual(report["status"], "INCOMPLETE")
                    self.assertNotIn("releaseDecision", report)
                else:
                    self.assertEqual(report["status"], "FAIL")
                    self.assertFalse(report["checks"]["firstText"])
                    self.assertEqual(report["releaseDecision"]["allowed"], allowed)
                self.assertIn(report["status"], summary.read_text())


if __name__ == "__main__":
    unittest.main()
