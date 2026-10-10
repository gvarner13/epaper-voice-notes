import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import grok_validation

class ValidationSafetyTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.local = self.root / ".local"
        self.local.mkdir()
        self.audio = self.root / "short.wav"
        self.audio.write_bytes(b"synthetic fixture")
        fixtures = self.root / "cloud/feasibility/src/fixtures.json"
        fixtures.parent.mkdir(parents=True)
        fixtures.write_text(json.dumps({"short": {"filename": "short.wav", "bytes": self.audio.stat().st_size,
            "sha256": hashlib.sha256(self.audio.read_bytes()).hexdigest(), "duration_seconds": 30}}))
        self.settings = self.local / "settings.json"
        self.secrets = self.local / "secrets.json"
        self.data = {"url": "https://epaper-grok-validation.example.com", "files": {"short": str(self.audio)}, "runs": {}}
        self.secrets.write_text(json.dumps({"DEVICE_TOKEN": "d" * 40, "READER_TOKEN": "r" * 40}))

    def invoke(self):
        self.settings.write_text(json.dumps(self.data))
        with patch.object(grok_validation, "ROOT", self.root), patch.object(grok_validation, "SETTINGS", self.settings), \
             patch.object(grok_validation, "SECRETS", self.secrets), patch("sys.argv", ["grok_validation", "upload", "short"]), \
             patch.object(grok_validation.http.client, "HTTPSConnection") as connection:
            with self.assertRaises(ValueError):
                grok_validation.main()
            connection.assert_not_called()

    def test_existing_run_never_submits_another_paid_attempt(self):
        self.data["runs"]["short"] = "grok-validation_" + "a" * 32
        self.invoke()

    def test_same_size_but_different_audio_is_rejected(self):
        data = self.audio.read_bytes()
        self.audio.write_bytes(b"X" + data[1:])
        self.invoke()
        self.assertEqual(json.loads(self.settings.read_text())["runs"], {})

    def test_production_origin_is_rejected_before_any_network_call(self):
        self.data["url"] = "https://epaper-voice-notes.example.com"
        self.invoke()

if __name__ == "__main__":
    unittest.main()
