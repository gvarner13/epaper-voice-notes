import tempfile
import unittest
from pathlib import Path
from cloud_notes import Cloud, publish_new

RECORDING = "recorder-1_" + "a" * 32
class DownloadTests(unittest.TestCase):
    def test_atomic_download_does_not_replace_edited_file(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertTrue(publish_new(folder, RECORDING, b"Original"))
            path = Path(folder) / (RECORDING + ".md")
            path.write_text("Locally edited")
            self.assertFalse(publish_new(folder, RECORDING, b"Server text"))
            self.assertEqual(path.read_text(), "Locally edited")
            self.assertEqual(list(Path(folder).glob("*.tmp")), [])
    def test_unsafe_ids_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            for name in ("../secret", "a/b", "recording", "a" * 500):
                with self.assertRaises(ValueError):
                    publish_new(folder, name, b"Text")
    def test_credentials_and_origin_fail_closed(self):
        for url in ("http://example.com", "https://user@example.com", "https://example.com/path", "https://example.com?token=value"):
            with self.assertRaises(ValueError):
                Cloud(url, "x" * 32)
        with self.assertRaises(ValueError):
            Cloud("https://example.com", "short")

if __name__ == "__main__":
    unittest.main()
