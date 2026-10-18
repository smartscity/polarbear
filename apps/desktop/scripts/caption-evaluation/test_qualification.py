"""Regression checks for corpus integrity and qualification accounting."""

import io
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import Mock, patch
import zipfile

import numpy as np
import soundfile as sf

from evaluate import inference_threads, SherpaCandidate, WhisperBaseline
from qualification_corpus import earnings_words, ami_words, segments
from qualify import audio_segments, recall_counts, replay_events


class QualificationTests(unittest.TestCase):
    def test_streamed_windows_preserve_samples_without_retaining_the_recording(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            samples = np.arange(16000 * 10, dtype="float32") / (16000 * 10)
            sf.write(path / "fixture.wav", samples, 16000, subtype="FLOAT")
            windows = [{"start": .032, "end": 1.125}, {"start": 4.25, "end": 5.7}]
            corpus = {"records": [{"id": "fixture", "file": "fixture.wav", "segments": windows}]}
            stream = audio_segments(corpus, path)
            with patch("qualify.sf.read", side_effect=AssertionError("Full-file read")):
                for index, (_, segment, identity, audio) in enumerate(stream):
                    np.testing.assert_array_equal(audio, samples[round(segment["start"] * 16000):round(segment["end"] * 16000)])
                    self.assertEqual(identity, f"fixture:{index}")
                    self.assertTrue(audio.flags.owndata)
                    self.assertIsNone(audio.base)
            corpus["records"][0]["segments"] = [{"start": 9, "end": 11}]
            with self.assertRaisesRegex(ValueError, "beyond"):
                list(audio_segments(corpus, path))

    def test_budget_matches_production_and_never_oversubscribes_small_hosts(self):
        for cpus, expected in ((0, 1), (1, 1), (2, 1), (3, 2), (4, 3), (8, 4)):
            self.assertEqual(inference_threads(cpus), expected)
        with patch("evaluate.os.cpu_count", return_value=None):
            self.assertEqual(inference_threads(), 1)

    def test_candidate_adapters_receive_the_same_explicit_budget(self):
        offline, online = Mock(), Mock()
        module = SimpleNamespace(__version__="fixture", OfflineRecognizer=offline, OnlineRecognizer=online)
        with patch.dict("sys.modules", {"sherpa_onnx": module}), patch("evaluate.verify_model"):
            for kind in ("parakeet", "zipformer"):
                candidate = SherpaCandidate(kind, Path("/fixture"), 2)
                self.assertEqual(candidate.threads, 2)
        self.assertEqual(offline.from_transducer.call_args.kwargs["num_threads"], 2)
        self.assertEqual(online.from_transducer.call_args.kwargs["num_threads"], 2)

    def test_baseline_acknowledges_the_requested_budget_and_reaps_mismatch(self):
        for acknowledged in (2, 4):
            process = Mock(stdin=io.BytesIO(), stdout=io.BytesIO(
                ('{"threads":%d,"loadSeconds":0.1}\n' % acknowledged).encode()))
            with patch("evaluate.subprocess.Popen", return_value=process) as launch:
                if acknowledged == 2:
                    engine = WhisperBaseline("/fixture/helper", "/fixture/model", 2)
                    self.assertEqual(engine.threads, 2)
                    engine.close()
                else:
                    with self.assertRaisesRegex(ValueError, "thread budget"):
                        WhisperBaseline("/fixture/helper", "/fixture/model", 2)
                self.assertEqual(launch.call_args.args[0], ["/fixture/helper", "/fixture/model", "2"])
                self.assertEqual(launch.call_args.kwargs["env"], {})
                self.assertTrue(process.stdin.closed)
                process.wait.assert_called_once()

    def test_missing_timestamps_fail_instead_of_dropping_words(self):
        with self.assertRaises(ValueError):
            earnings_words("token|speaker|ts|endTs\nhello|0||1\n")

    def test_earnings_preserves_country_independent_speaker_and_tags(self):
        words = earnings_words("token|speaker|ts|endTs|tags\nSify|1|1|1.2|[]\n")
        self.assertEqual(words[0]["text"], "Sify")
        self.assertEqual(words[0]["speaker"], "1")

    def test_unaligned_reference_is_retained_and_marked_not_silently_deleted(self):
        words = earnings_words("token|speaker|ts|endTs\nnot|0||\nyes|0|1|2\n")
        self.assertEqual([w["text"] for w in words], ["not", "yes"])
        self.assertTrue(words[0]["inferredTiming"])

    def test_overlap_chain_is_not_split_or_omitted(self):
        words = [{"text": str(i), "start": start, "end": end, "speaker": str(i)}
                 for i, (start, end) in enumerate([(18, 19.5), (19, 20.5), (21, 22)])]
        chunks = list(segments(words, 0, 30))
        self.assertEqual(chunks[0]["end"], 18)
        self.assertEqual([w for chunk in chunks for w in chunk["words"]], words)
        self.assertTrue(all(c["end"] - c["start"] <= 20 for c in chunks))

    def test_no_speech_windows_are_retained_for_hallucination_scoring(self):
        self.assertEqual([c["reference"] for c in segments([], 0, 40)], ["", ""])

    def test_ami_merges_speakers_and_excludes_punctuation(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("words/EN2002a.A.words.xml", '<root><w starttime="1" endtime="2">hello</w><w punc="true">.</w></root>')
            archive.writestr("words/EN2002a.B.words.xml", '<root><w starttime="1.5" endtime="2.5">yes</w></root>')
        with zipfile.ZipFile(buffer) as archive:
            words = ami_words(archive, "EN2002a")
        self.assertEqual([w["text"] for w in words], ["hello", "yes"])
        self.assertEqual(list(segments(words, 0, 5))[0]["overlappingWords"], 1)

    def test_term_recall_counts_repeated_mentions_and_whole_words(self):
        self.assertEqual(recall_counts("cloud cloud", "cloud cloudy", ["cloud"]),
                         {"expected": 2, "matched": 1})

    def test_short_corpus_cannot_be_looped_to_claim_hour_soak(self):
        with self.assertRaisesRegex(ValueError, "shorter"):
            list(replay_events({"sources": [], "records": []}, None, 3600))


if __name__ == "__main__":
    unittest.main()
