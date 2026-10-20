import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

from evaluate import SherpaCandidate
from native_latency_regression import native_command


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
    def test_nemotron_uses_the_existing_cpu_online_api_and_pinned_components(self):
        calls = []
        api = SimpleNamespace(__version__="test", OnlineRecognizer=SimpleNamespace(
            from_transducer=lambda **kwargs: calls.append(kwargs)))
        with patch.dict("sys.modules", {"sherpa_onnx": api}), patch("evaluate.verify_model") as verify:
            SherpaCandidate("nemotron-streaming", Path("/models with spaces"), 3)
        self.assertEqual(verify.call_count, 5)
        self.assertEqual(calls[0], {
            "encoder": "/models with spaces/encoder.int8.onnx",
            "decoder": "/models with spaces/decoder.int8.onnx",
            "joiner": "/models with spaces/joiner.int8.onnx",
            "tokens": "/models with spaces/tokens.txt", "num_threads": 3,
            "enable_endpoint_detection": False, "provider": "cpu",
        })

    def test_native_command_passes_paths_as_arguments_without_shell_interpretation(self):
        helper, assets, models = (Path("/engine with spaces/helper"), Path("/assets"), Path("/models"))
        self.assertEqual(native_command(helper, assets, "nemotron-streaming", models, 2), [
            str(helper), "/models/encoder.int8.onnx", "/models/decoder.int8.onnx",
            "/models/joiner.int8.onnx", "/models/tokens.txt", "/assets/ggml-silero-v6.2.0.bin",
            "--diagnostics", "--threads=2",
        ])
        self.assertEqual(native_command(helper, assets), [
            str(helper), "/assets/ggml-base.en-q5_1.bin", "/assets/ggml-silero-v6.2.0.bin", "--diagnostics"])
        with self.assertRaises(ValueError):
            native_command(helper, assets, "nemotron-streaming")

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
