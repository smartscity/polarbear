"""Regression checks for corpus integrity and qualification accounting."""

import io
import unittest
import zipfile

from qualification_corpus import earnings_words, ami_words, segments
from qualify import recall_counts, replay_events


class QualificationTests(unittest.TestCase):
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
