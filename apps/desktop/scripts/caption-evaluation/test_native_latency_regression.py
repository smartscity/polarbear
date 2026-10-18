"""Frozen short latency profile boundaries and acceptance checks."""

import unittest
from unittest.mock import patch

import numpy as np

from native_latency_regression import SECONDS, WINDOWS, acceptance, regression_audio


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

    def test_keeps_latency_limits_and_does_not_claim_unmeasured_growth(self):
        result = {"audioSeconds": SECONDS, "finals": 1,
                  "firstFromVadStartP95Seconds": 3, "finalAfterVadEndP95Seconds": 4.4,
                  "sampledPeakProcessTreeRssBytes": 2 * 1024**3}
        self.assertTrue(all(acceptance(result).values()))
        self.assertNotIn("memoryGrowth", acceptance(result))
        for field, value, check in (
            ("audioSeconds", SECONDS - 1, "completeRegression"),
            ("finals", 0, "textProduced"),
            ("firstFromVadStartP95Seconds", 3.01, "firstText"),
            ("finalAfterVadEndP95Seconds", 4.41, "finalText"),
            ("sampledPeakProcessTreeRssBytes", 2 * 1024**3 + 1, "memoryPeak"),
            ("firstFromVadStartP95Seconds", None, "firstText"),
        ):
            self.assertFalse(acceptance({**result, field: value})[check])


if __name__ == "__main__":
    unittest.main()
