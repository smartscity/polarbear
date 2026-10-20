import unittest
from unittest.mock import patch

import numpy as np

from evaluate import SherpaCandidate


class Stream:
    def __init__(self):
        self.chunks = []
        self.finished = False

    def accept_waveform(self, rate, samples):
        assert rate == 16000
        self.chunks.append(samples.copy())

    def input_finished(self):
        self.finished = True


class Recognizer:
    def create_stream(self):
        self.stream = Stream()
        return self.stream

    def is_ready(self, stream):
        return False

    def get_result(self, stream):
        return "test"


class StreamingDecodeTests(unittest.TestCase):
    def test_accelerated_and_paced_paths_deliver_identical_chunks_and_eof_padding(self):
        candidate = object.__new__(SherpaCandidate)
        candidate.kind = "zipformer-gigaspeech"
        candidate.recognizer = Recognizer()
        samples = np.arange(3001, dtype=np.float32) / 3001
        candidate.transcribe(samples)
        accelerated = candidate.recognizer.stream
        with patch("evaluate.time.sleep"):
            candidate.paced_probe(samples)
        paced = candidate.recognizer.stream
        self.assertTrue(accelerated.finished and paced.finished)
        self.assertEqual([len(chunk) for chunk in accelerated.chunks], [1280, 1280, 441, 10560])
        for first, second in zip(accelerated.chunks, paced.chunks, strict=True):
            np.testing.assert_array_equal(first, second)
        np.testing.assert_array_equal(np.concatenate(accelerated.chunks[:-1]), samples)
        self.assertTrue(np.all(accelerated.chunks[-1] == 0))


if __name__ == "__main__":
    unittest.main()
