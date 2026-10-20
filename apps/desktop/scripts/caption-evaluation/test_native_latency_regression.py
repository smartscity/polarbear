"""Frozen short latency profile boundaries and acceptance checks."""

import unittest
from unittest.mock import patch

import numpy as np

from native_latency_regression import SECONDS, WINDOWS, acceptance, regression_audio
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


if __name__ == "__main__":
    unittest.main()
