"""The local profile uses the same authorized release limits as native CI."""

import unittest
from local_native_fixture import checks


class LocalFixtureTests(unittest.TestCase):
    def test_short_duration_does_not_waive_latency_or_missing_measurements(self):
        passing = {"audioSeconds": 120, "finals": 1, "firstFromVadStartP95Seconds": 5,
                   "finalAfterVadEndP95Seconds": 4.4, "sampledPeakProcessTreeRssBytes": 2 * 1024**3}
        self.assertTrue(all(checks(passing, 120).values()))
        for key, value, gate in [
            ("audioSeconds", 119, "completeFixture"), ("finals", 0, "textProduced"),
            ("firstFromVadStartP95Seconds", 5.01, "firstText"),
            ("firstFromVadStartP95Seconds", None, "firstText"),
            ("finalAfterVadEndP95Seconds", 4.41, "finalText"),
            ("sampledPeakProcessTreeRssBytes", None, "memoryPeak"),
        ]:
            self.assertFalse(checks({**passing, key: value}, 120)[gate])


if __name__ == "__main__":
    unittest.main()
