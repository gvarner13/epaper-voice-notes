"""Local-only tests: python3 -m unittest discover -s tools -p 'test_*.py'."""
import hashlib
import json
import pathlib
import tempfile
import unittest
import wave
from unittest.mock import patch

import transcription_fixtures as fixtures


class FixtureTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)

    def test_complete_device_format_and_expected_slots(self):
        path = self.root / "sample.wav"
        pcm = b"\x01\x00" * fixtures.RATE
        result = fixtures.write_fixture(path, 60, render=lambda text: pcm)
        with wave.open(str(path), "rb") as wav:
            self.assertEqual((wav.getnchannels(), wav.getsampwidth(), wav.getframerate()),
                             (1, 2, 16000))
            self.assertEqual(wav.getnframes(), 60 * 16000)
            self.assertEqual(wav.readframes(16000), pcm)
            self.assertEqual(wav.readframes(29 * 16000), b"\0" * (29 * 16000 * 2))
            self.assertEqual(wav.readframes(16000), pcm)
        self.assertEqual(result["bytes"], 44 + 60 * 16000 * 2)
        self.assertEqual(result["sha256"], hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertEqual([slot["start_seconds"] for slot in result["slots"]], [0, 30])
        self.assertNotEqual(result["slots"][0]["marker"], result["slots"][1]["marker"])
        self.assertEqual(result["slots"][0]["speech_seconds"], 1)

    def test_silence_does_not_invoke_synthesizer(self):
        def unexpected(text):
            self.fail("Silent fixture must not synthesize speech")
        path = self.root / "silence.wav"
        result = fixtures.write_fixture(path, 30, render=unexpected, silent=True)
        with wave.open(str(path), "rb") as wav:
            self.assertEqual(wav.readframes(wav.getnframes()), b"\0" * (30 * 16000 * 2))
        self.assertEqual(result["slots"], [])
        self.assertEqual(result["expected_outcome"], "no-speech-model-result")

    def test_existing_file_is_not_overwritten(self):
        path = self.root / "keep.wav"
        path.write_bytes(b"keep me")
        with self.assertRaises(FileExistsError):
            fixtures.write_fixture(path, 30, silent=True)
        self.assertEqual(path.read_bytes(), b"keep me")

    def test_existing_output_directory_is_not_modified(self):
        with self.assertRaises(FileExistsError):
            fixtures.generate(self.root)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_invalid_duration_is_rejected_before_creating_file(self):
        for seconds in (0, -30, 31):
            path = self.root / f"invalid-{seconds}.wav"
            with self.assertRaises(ValueError):
                fixtures.write_fixture(path, seconds, silent=True)
            self.assertFalse(path.exists())

    def test_speech_is_never_silently_truncated(self):
        pcm = b"\0" * (30 * 16000 * 2 + 2)
        with self.assertRaisesRegex(ValueError, "refusing to truncate"):
            fixtures.write_fixture(self.root / "long.wav", 30, render=lambda text: pcm)

    def test_empty_or_incomplete_pcm_is_rejected(self):
        for index, pcm in enumerate((b"", b"\0")):
            with self.assertRaisesRegex(ValueError, "incomplete PCM"):
                fixtures.write_fixture(self.root / f"invalid-{index}.wav", 30,
                                       render=lambda text: pcm)

    def test_manifest_is_published_only_after_all_fixtures_succeed(self):
        output = self.root / "failed"
        def failing(text):
            raise RuntimeError("synthesis failed")
        with self.assertRaises(RuntimeError):
            fixtures.generate(output, render=failing)
        self.assertFalse((output / "manifest.json").exists())

    def test_generation_caches_speech_and_includes_full_duration_ladder(self):
        output = self.root / "generated"
        calls = []
        def render(text):
            calls.append(text)
            return b"\x01\x00" * fixtures.RATE
        result = fixtures.generate(output, render=render)
        self.assertEqual(len(calls), 60)
        self.assertEqual(len(set(calls)), 60)
        self.assertEqual([item["duration_seconds"] for item in result["fixtures"]],
                         [30, 300, 900, 1800, 30])
        self.assertEqual(result, json.loads((output / "manifest.json").read_text()))
        self.assertTrue(result["synthetic"])
        self.assertFalse(result["uploaded"])
        for item in result["fixtures"]:
            with wave.open(str(output / item["filename"]), "rb") as wav:
                self.assertEqual(wav.getnframes(), item["duration_seconds"] * 16000)


if __name__ == "__main__":
    unittest.main()
