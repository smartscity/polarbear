"""Deterministic screening tests; no models, network access, or performance runs."""

import copy
import errno
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import numpy as np
import soundfile as sf

import streaming_screen as screen


def corpus_fixture(count=7):
    records = []
    for source in screen.SOURCES:
        segments = [{"start": index * 20, "end": (index + 1) * 20,
                     "reference": "cloud revenue", "words": [],
                     "overlappingWords": 0, "inferredTimingWords": 0} for index in range(count)]
        records.append({"id": source + "-0", "sourceId": source,
                        "category": "earnings22" if source in screen.CALLS else "ami-far-field",
                        "country": "fixture", "sourceStart": 100,
                        "file": source + ".wav", "sha256": "fixture", "segments": segments})
    return {"scope": "all", "sources": list(reversed(screen.SOURCES)), "records": records,
            "technicalTerms": ["cloud"], "license": "fixture", "attribution": "fixture"}


def accuracy_fixture(hypothesis="cloud revenue"):
    corpus = corpus_fixture()
    return [screen.accuracy_row(clip, {"text": hypothesis, "decodeSeconds": .01},
                                corpus["technicalTerms"], 20) for clip in screen.select_clips(corpus)]


def paced_fixture():
    return [{"id": source, "text": "cloud", "audioSeconds": 20, "wallSeconds": 20.1,
             "updates": [{"text": "", "wallSeconds": .2}, {"text": "cloud", "wallSeconds": 1.5}]}
            for source in screen.SOURCES]


class SelectionTests(unittest.TestCase):
    def test_fixed_first_middle_last_first_record_all_sources(self):
        corpus = corpus_fixture()
        later = copy.deepcopy(corpus["records"][0])
        later["id"] = "later-record"
        corpus["records"].append(later)
        original = copy.deepcopy(corpus)
        clips = screen.select_clips(corpus)
        self.assertEqual(corpus, original)
        self.assertEqual(len(clips), 24)
        self.assertEqual([clip["sourceId"] for clip in clips[::3]], list(screen.SOURCES))
        self.assertEqual([clip["segmentIndex"] for clip in clips], [0, 3, 6] * 8)
        self.assertEqual([clip["position"] for clip in clips], ["first", "middle", "last"] * 8)
        self.assertNotIn("later-record", [clip["recordId"] for clip in clips])
        self.assertEqual(sum(clip["segment"]["end"] - clip["segment"]["start"] for clip in clips), 480)
        self.assertEqual(sum(clip["segment"]["end"] - clip["segment"]["start"]
                             for clip in clips if clip["position"] == "first"), 160)

    def test_annotation_only_selection_uses_upper_middle_for_even_count(self):
        corpus = corpus_fixture(6)
        for record in corpus["records"]:
            record["segments"][0]["reference"] = ""
            record["segments"][3]["reference"] = "..."
        self.assertEqual([clip["segmentIndex"] for clip in screen.select_clips(corpus)], [1, 4, 5] * 8)

    def test_missing_sources_and_insufficient_first_record_fail_without_fallback(self):
        for mutation in (lambda c: c["sources"].pop(), lambda c: c["records"].pop(),
                         lambda c: c.update(scope="earnings")):
            corpus = corpus_fixture()
            mutation(corpus)
            with self.assertRaisesRegex(ValueError, "eight"):
                screen.select_clips(corpus)
        corpus = corpus_fixture()
        corpus["records"].append(copy.deepcopy(corpus["records"][0]))
        corpus["records"][0]["segments"] = corpus["records"][0]["segments"][:2]
        with self.assertRaisesRegex(ValueError, "three annotated"):
            screen.select_clips(corpus)

    def test_invalid_selected_duration_fails_without_trimming_or_substitution(self):
        for start, end in ((0, 20.001), (-1, 10), (5, 5), (0, float("nan")), (0, float("inf"))):
            corpus = corpus_fixture()
            corpus["records"][0]["segments"][3].update(start=start, end=end)
            with self.assertRaisesRegex(ValueError, "20-second"):
                screen.select_clips(corpus)

    def test_reads_only_selected_samples_with_original_identity(self):
        clip = screen.select_clips(corpus_fixture())[1]
        clip["segment"] = {**clip["segment"], "start": .125, "end": .25}
        clip["sampleCount"] = 2000
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            samples = np.arange(16000, dtype="float32") / 16000
            sf.write(path / clip["file"], samples, 16000, subtype="FLOAT")
            rows = list(screen.selected_audio([clip], path))
        self.assertEqual(rows[0][0]["id"], clip["recordId"] + ":3")
        np.testing.assert_array_equal(rows[0][1], samples[2000:4000])

    def test_decimal_annotation_roundoff_does_not_reject_twenty_seconds(self):
        corpus = corpus_fixture()
        corpus["records"][0]["segments"][3].update(start=100.3, end=120.30000000000006)
        clips = screen.select_clips(corpus)
        self.assertEqual(len(clips), 24)
        self.assertEqual(clips[1]["sampleCount"], 320000)
        self.assertEqual(sum(clip["sampleCount"] for clip in clips), 480 * 16000)
        corpus["records"][0]["segments"][3]["end"] += 1 / 16000
        with self.assertRaisesRegex(ValueError, "20-second"):
            screen.select_clips(corpus)


class ScoringTests(unittest.TestCase):
    def test_empty_outputs_are_scored_in_all_category_and_source_groups(self):
        rows = accuracy_fixture("")
        summary = screen.summarize_accuracy(rows)
        self.assertEqual(summary["all"]["wer"], 1)
        self.assertEqual(summary["all"]["emptyClips"], 24)
        self.assertEqual(summary["category:earnings22"]["emptyClips"], 18)
        self.assertEqual(summary["category:ami-far-field"]["emptyClips"], 6)
        self.assertEqual(summary["source:" + screen.SOURCES[0]]["emptyClips"], 3)
        self.assertEqual(summary["all"]["terms"], {"expected": 24, "matched": 0, "recall": 0})

    def test_aggregate_wer_is_word_weighted_not_mean_of_clip_wer(self):
        rows = accuracy_fixture()
        rows[0].update(referenceWords=10, edits=5, wer=.5)
        summary = screen.summarize_accuracy(rows)
        self.assertEqual(summary["all"]["referenceWords"], 56)
        self.assertAlmostEqual(summary["all"]["wer"], 5 / 56)

    def test_identical_accuracy_only_allows_further_evaluation_not_product_pass(self):
        summary = screen.summarize_accuracy(accuracy_fixture())
        result = screen.screening_decision(summary, copy.deepcopy(summary))
        self.assertEqual(result["recommendation"], "FURTHER_EVALUATION_ONLY")
        self.assertEqual(result["replacement"], "NOT_AUTHORIZED")
        self.assertNotIn("PASS", json.dumps(result))

    def test_each_quality_regression_independently_prohibits_replacement(self):
        baseline = screen.summarize_accuracy(accuracy_fixture())
        for group, key, value, reason in (
            ("all", "wer", .01, "wer:all"),
            ("category:ami-far-field", "wer", .01, "wer:category:ami-far-field"),
            ("all", "emptyClips", 1, "emptyClips:all"),
            ("category:earnings22", "emptyClips", 1, "emptyClips:category:earnings22"),
        ):
            candidate = copy.deepcopy(baseline)
            candidate[group][key] = value
            decision = screen.screening_decision(baseline, candidate)
            self.assertEqual(decision["recommendation"], "NO_REPLACE")
            self.assertIn(reason, decision["reasons"])
        for group in ("all", "category:ami-far-field"):
            candidate = copy.deepcopy(baseline)
            candidate[group]["terms"]["matched"] -= 1
            self.assertIn("termRecall:" + group, screen.screening_decision(baseline, candidate)["reasons"])

    def test_missing_groups_clips_and_nonfinite_wer_cannot_pass(self):
        baseline = screen.summarize_accuracy(accuracy_fixture())
        for mutate in (lambda c: c.pop("category:ami-far-field"),
                       lambda c: c["all"].update(segments=23),
                       lambda c: c["all"].update(wer=float("nan")),
                       lambda c: c["all"]["terms"].update(expected=1)):
            candidate = copy.deepcopy(baseline)
            mutate(candidate)
            self.assertEqual(screen.screening_decision(baseline, candidate)["recommendation"], "NO_REPLACE")

    def test_absent_terms_are_unmeasured_not_perfect_recall(self):
        rows = accuracy_fixture()
        for row in rows:
            row["terms"] = {"expected": 0, "matched": 0}
        summary = screen.summarize_accuracy(rows)
        self.assertIsNone(summary["all"]["terms"]["recall"])
        self.assertNotIn("termRecall:all", screen.screening_decision(summary, summary)["checks"])


class PacedTests(unittest.TestCase):
    def test_missing_partial_is_not_replaced_by_final_or_dropped_from_p95(self):
        rows = paced_fixture()
        rows[0]["updates"] = [{"text": "  ", "wallSeconds": 1}]
        result = screen.summarize_paced(rows, screen.SOURCES)
        self.assertEqual(result["missingPartials"], [screen.SOURCES[0]])
        self.assertEqual(result["observedOnlyFirstPartialP95Seconds"], 1.5)
        self.assertIsNone(result["firstPartialFromClipStartP95Seconds"])
        self.assertFalse(result["firstPartialWithin3Seconds"])
        summary = screen.summarize_accuracy(accuracy_fixture())
        self.assertIn("pacedFirstPartial", screen.screening_decision(summary, summary, result)["reasons"])

    def test_first_partial_limit_is_inclusive_and_empty_finals_reject(self):
        for seconds, final, expected in ((3, "cloud", True), (3.01, "cloud", False), (1, "", False)):
            rows = paced_fixture()
            for row in rows:
                row.update(text=final, updates=[{"text": "cloud", "wallSeconds": seconds}])
            self.assertEqual(screen.summarize_paced(rows, screen.SOURCES)["firstPartialWithin3Seconds"], expected)

    def test_incomplete_duplicate_and_invalid_paced_results_fail(self):
        for mutate in (lambda rows: rows.pop(), lambda rows: rows.append(rows[0]),
                       lambda rows: rows[0]["updates"][0].update(wallSeconds=-1)):
            rows = paced_fixture()
            mutate(rows)
            with self.assertRaises(ValueError):
                screen.summarize_paced(rows, screen.SOURCES)


class LifecycleTests(unittest.TestCase):
    def test_offline_control_rejects_network_availability_and_outage(self):
        with patch.object(screen.socket, "socket") as socket:
            connect = socket.return_value.__enter__.return_value.connect
            connect.side_effect = PermissionError(errno.EPERM, "fixture")
            self.assertTrue(screen.require_offline().startswith("EPERM:"))
            for code in (errno.ENETUNREACH, errno.EACCES, errno.ETIMEDOUT):
                connect.side_effect = OSError(code, "fixture")
                with self.assertRaisesRegex(RuntimeError, "EPERM"):
                    screen.require_offline()
            connect.side_effect = None
            with self.assertRaisesRegex(RuntimeError, "Network is available"):
                screen.require_offline()

    def test_worker_requires_offline_before_constructing_model(self):
        replies = Mock()
        with patch.object(screen.os, "setsid"), patch.object(screen, "require_offline", side_effect=RuntimeError("not offline")), \
                patch.object(screen, "SherpaCandidate") as candidate:
            screen.screen_worker({"engine": "zipformer-gigaspeech"}, Mock(), replies)
        candidate.assert_not_called()
        self.assertIn("not offline", replies.put.call_args.args[0]["error"])

    def test_worker_reuses_candidate_for_accuracy_then_paced_and_closes(self):
        engine = Mock(threads=2, load_seconds=.1, version="fixture")
        engine.transcribe.return_value = {"text": "cloud", "decodeSeconds": .1}
        engine.paced_probe.return_value = {"text": "cloud", "updates": []}
        requests = Mock()
        requests.get.side_effect = [("accuracy", "a", []), ("paced", "b", []), None]
        replies = Mock()
        config = {"engine": "zipformer-gigaspeech", "models": "/fixture", "threads": 2}
        with patch.object(screen.os, "setsid"), patch.object(screen, "require_offline", return_value="EPERM: fixture"), \
                patch.object(screen, "SherpaCandidate", return_value=engine) as candidate:
            screen.screen_worker(config, requests, replies)
        candidate.assert_called_once_with("zipformer-gigaspeech", Path("/fixture/zipformer-gigaspeech"), 2)
        self.assertEqual([call.args[0].get("id") for call in replies.put.call_args_list], [None, "a", "b"])
        engine.close.assert_called_once()

    def test_accuracy_failure_closes_worker_without_scoring_empty_success(self):
        worker = Mock(ready={"ready": True})
        worker.request.side_effect = TimeoutError("fixture deadline")
        clip = screen.select_clips(corpus_fixture())[0]
        with patch.object(screen, "ScreenWorker", return_value=worker), \
                patch.object(screen, "selected_audio", return_value=iter([(clip, np.zeros(16000))])):
            with self.assertRaises(TimeoutError):
                screen.run_engine({"engine": "whisper"}, [clip], corpus_fixture(), Path("/fixture"), 1, Mock())
        worker.close.assert_called_once()

    def test_deadline_and_response_identity_are_enforced(self):
        worker = object.__new__(screen.ScreenWorker)
        worker.deadline = 100
        worker.requests = Mock()
        worker.receive = Mock(return_value={"id": "wrong"})
        with patch.object(screen.time, "monotonic", return_value=90):
            self.assertEqual(worker.remaining(), 10)
            with self.assertRaisesRegex(RuntimeError, "Mismatched"):
                worker.request("accuracy", "expected", [])
        with patch.object(screen.time, "monotonic", return_value=101):
            with self.assertRaisesRegex(TimeoutError, "deadline"):
                worker.remaining()

    def test_startup_timeout_uses_existing_process_group_cleanup(self):
        context = Mock()
        with patch.object(screen.mp, "get_context", return_value=context), \
                patch.object(screen.ScreenWorker, "receive", side_effect=TimeoutError("startup")), \
                patch.object(screen.ScreenWorker, "close") as close:
            with self.assertRaises(TimeoutError):
                screen.ScreenWorker({"threads": 2}, float("inf"))
        close.assert_called_once()
        self.assertIs(screen.ScreenWorker.close, screen.EngineWorker.close)

    def test_main_runs_engines_sequentially_and_never_reports_product_pass(self):
        summary = screen.summarize_accuracy(accuracy_fixture())
        calls = []
        def run(config, clips, corpus, directory, deadline, emit, paced=False):
            calls.append((config["engine"], paced))
            return {"accuracy": summary, "paced": {"status": "NOT_RUN"}}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "report.json"
            argv = ["streaming_screen.py", "/fixture/corpus.json", str(output), "--models", "/fixture/models",
                    "--baseline", "/fixture/helper", "--whisper-model", "/fixture/model",
                    "--corpus-sha256", "corpus", "--baseline-sha256", "helper", "--threads", "2",
                    "--expect-arch", "x86_64"]
            with patch("sys.argv", argv), patch.object(screen, "require_offline", return_value="EPERM: fixture"), \
                    patch.object(screen, "validate_native_arch") as validate_arch, \
                    patch.object(screen, "verify_inputs", return_value=(corpus_fixture(), {})), \
                    patch.object(screen, "run_engine", side_effect=run):
                self.assertEqual(screen.main(), 0)
            report = json.loads(output.read_text())
        validate_arch.assert_called_once_with("x86_64")
        self.assertEqual(calls, [("whisper", False), ("zipformer-gigaspeech", False)])
        self.assertEqual(report["status"], "MEASURED")
        for field in ("productionGate", "nativeCaptionHelper", "microphoneToUi", "armQualification"):
            self.assertEqual(report[field], "NOT_RUN")
        self.assertNotIn("PASS", json.dumps(report))

    def test_rejected_candidate_returns_nonzero_and_preserves_measured_report(self):
        baseline = screen.summarize_accuracy(accuracy_fixture())
        candidate = screen.summarize_accuracy(accuracy_fixture(""))
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "report.json"
            argv = ["streaming_screen.py", "/fixture/corpus.json", str(output), "--models", "/fixture/models",
                    "--baseline", "/fixture/helper", "--whisper-model", "/fixture/model",
                    "--corpus-sha256", "corpus", "--baseline-sha256", "helper", "--expect-arch", "x86_64"]
            with patch("sys.argv", argv), patch.object(screen, "require_offline", return_value="EPERM: fixture"), \
                    patch.object(screen, "validate_native_arch"), \
                    patch.object(screen, "verify_inputs", return_value=(corpus_fixture(), {})), \
                    patch.object(screen, "run_engine", side_effect=[{"accuracy": baseline}, {"accuracy": candidate}]):
                self.assertEqual(screen.main(), 1)
            report = json.loads(output.read_text())
        self.assertEqual(report["status"], "MEASURED")
        self.assertEqual(report["screeningDecision"]["recommendation"], "NO_REPLACE")
        self.assertEqual(report["productionGate"], "NOT_RUN")
        self.assertNotIn("error", report)
        self.assertNotIn("PASS", json.dumps(report))

    def test_pin_mismatch_fails_before_loading_corpus_or_models(self):
        args = SimpleNamespace(corpus=Path("/fixture/corpus"), corpus_sha256="expected")
        with patch.object(screen, "digest", return_value="changed"), patch.object(screen, "validate_corpus") as validate:
            with self.assertRaisesRegex(ValueError, "corpus checksum"):
                screen.verify_inputs(args)
        validate.assert_not_called()


if __name__ == "__main__":
    unittest.main()
