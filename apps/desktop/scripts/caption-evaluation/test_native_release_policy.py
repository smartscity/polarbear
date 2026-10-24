"""Only measured first-text overruns may be advisory in alpha previews."""

import unittest

from native_latency_policy import release_decision


class NativeReleasePolicyTests(unittest.TestCase):
    def setUp(self):
        self.checks = dict.fromkeys(
            ("completeRegression", "textProduced", "firstText", "finalText", "memoryPeak"), True)

    def test_success_needs_no_exception(self):
        result = release_decision(self.checks, 4.0)
        self.assertTrue(result["allowed"])
        self.assertEqual(result["advisoryChecks"], [])

    def test_alpha_preserves_failed_measurement_but_allows_packaging(self):
        self.checks["firstText"] = False
        result = release_decision(self.checks, 6.2, "v0.10.10-alpha.2")
        self.assertTrue(result["allowed"])
        self.assertEqual(result["advisoryChecks"], ["firstText"])
        self.assertEqual(result["blockingChecks"], [])
        self.assertFalse(self.checks["firstText"])

    def test_stable_candidate_and_other_prereleases_remain_blocking(self):
        self.checks["firstText"] = False
        for tag in ("", "v0.10.10", "v0.10.10-rc.1", "v0.10.10-beta.1",
                    "v0.10.10-alpha", "v0.10.10-alpha.01", "v00.10.10-alpha.1",
                    "refs/tags/v0.10.10-alpha.1", "v0.10.10-alpha.1\n"):
            with self.subTest(tag=tag):
                self.assertFalse(release_decision(self.checks, 6.2, tag)["allowed"])
        self.assertFalse(release_decision(
            self.checks, 6.2, "v0.10.10-alpha.2", candidate=True)["allowed"])

    def test_missing_invalid_or_non_overrun_measurements_cannot_be_waived(self):
        self.checks["firstText"] = False
        for value in (None, float("nan"), float("inf"), -1, 0, 5, "6", True):
            with self.subTest(value=value):
                self.assertFalse(release_decision(
                    self.checks, value, "v0.10.10-alpha.2")["allowed"])

    def test_every_other_failure_still_blocks_alpha(self):
        self.checks["firstText"] = False
        for check in self.checks.keys() - {"firstText"}:
            with self.subTest(check=check):
                checks = {**self.checks, check: False}
                result = release_decision(checks, 6.2, "v0.10.10-alpha.2")
                self.assertFalse(result["allowed"])
                self.assertIn(check, result["blockingChecks"])

    def test_incomplete_or_unexpected_report_fails_closed(self):
        for checks in ({}, {"firstText": False}, {**self.checks, "unknown": False},
                       {**self.checks, "memoryPeak": None}):
            with self.subTest(checks=checks):
                self.assertFalse(release_decision(checks, 6.2, "v0.10.10-alpha.2")["allowed"])


if __name__ == "__main__":
    unittest.main()
