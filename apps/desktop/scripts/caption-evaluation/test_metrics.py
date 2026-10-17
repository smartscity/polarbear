import unittest
from metrics import score, words


class MetricsTest(unittest.TestCase):
    def test_case_punctuation_and_apostrophes(self):
        self.assertEqual(words("It's THERE\u2014isn\u2019t it?"), ["it's", "there", "isn't", "it"])

    def test_substitution_deletion_insertion(self):
        self.assertEqual(score("one two three", "one four")['edits'], 2)
        self.assertEqual(score("one", "one two three")['wer'], 2)

    def test_empty_reference_is_not_zero_error_rate(self):
        self.assertIsNone(score("", "hallucination")['wer'])
        self.assertEqual(score("", "hallucination")['edits'], 1)

    def test_empty_hypothesis(self):
        self.assertEqual(score("one two", "")['wer'], 1)


if __name__ == "__main__":
    unittest.main()
