import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from prepare import MODELS, MODEL_SHA256, METADATA_GIT_BLOBS, STREAMING_COMPONENTS, verify_model


class IntegrityTest(unittest.TestCase):
    def test_every_declared_asset_has_a_publisher_digest(self):
        for name, model in MODELS.items():
            self.assertEqual(len(model["revision"]), 40)
            for filename in model["files"]:
                key = f"{name}/{filename}"
                self.assertTrue(key in MODEL_SHA256 or key in METADATA_GIT_BLOBS, key)

    def test_streaming_components_only_reference_pinned_assets(self):
        self.assertNotIn("parakeet", STREAMING_COMPONENTS)
        for name, components in STREAMING_COMPONENTS.items():
            self.assertEqual(set(components), {"encoder", "decoder", "joiner"})
            for filename in components.values():
                self.assertIn(filename, MODELS[name]["files"])
                self.assertIn(f"{name}/{filename}", MODEL_SHA256)

    def test_unknown_asset_is_not_silently_trusted(self):
        with self.assertRaisesRegex(ValueError, "Unpinned model asset"):
            verify_model("zipformer-gigaspeech", Path("unverified.onnx"))

    def test_pinned_model_digest(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "encoder.int8.onnx"
            path.write_bytes(b"fixture")
            digest = hashlib.sha256(b"fixture").hexdigest()
            with patch.dict(MODEL_SHA256, {"parakeet/encoder.int8.onnx": digest}):
                self.assertEqual(verify_model("parakeet", path), digest)

    def test_corrupt_model_is_rejected_before_inference(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "encoder.int8.onnx"
            path.write_bytes(b"not the published model")
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                verify_model("parakeet", path)

    def test_token_table_uses_publisher_git_blob(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "tokens.txt"
            path.write_bytes(b"fixture")
            blob = hashlib.sha1(b"blob 7\0fixture").hexdigest()
            with patch.dict(METADATA_GIT_BLOBS, {"zipformer/tokens.txt": blob}):
                verify_model("zipformer", path)
                path.write_bytes(b"changed")
                with self.assertRaisesRegex(ValueError, "Git blob mismatch"):
                    verify_model("zipformer", path)


if __name__ == "__main__":
    unittest.main()
