"""Host-side checks for firmware's upload eligibility/identity validation."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

class DeviceFormatTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("c++"), "C++ compiler required")
    def test_wav_integrity_and_persistent_identity_format(self):
        root = Path(__file__).resolve().parent.parent
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "test.cpp"
            source.write_text('''
#include "sync_format.h"
#include "wav.h"
#include <cassert>
int main() {
  uint8_t header[44]; makeWavHeader(header, 32000);
  assert(syncValidWav(header, 44, 32044));
  assert(!syncValidWav(header, 43, 32044));
  assert(!syncValidWav(header, 44, 32043));
  assert(!syncValidWav(header, 44, 32046)); // checkpoint with unsynced tail
  header[20] = 3; assert(!syncValidWav(header, 44, 32044));
  makeWavHeader(header, 0); assert(!syncValidWav(header, 44, 44));
  assert(syncValidId("0123456789abcdef0123456789abcdef"));
  assert(!syncValidId("0123456789abcdef0123456789abcdeg"));
  assert(!syncValidId("../VN000001.WAV"));
}
''')
            binary = Path(folder) / "test"
            subprocess.run(["c++", "-std=c++17", "-I", str(root / "device/VoiceNotes"), str(source), "-o", str(binary)], check=True)
            subprocess.run([str(binary)], check=True)

if __name__ == "__main__":
    unittest.main()
