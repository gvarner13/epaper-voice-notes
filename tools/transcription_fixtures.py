#!/usr/bin/env python3
"""Generate synthetic transcription fixtures locally. Never uploads any audio.

Requires macOS `say` and ffmpeg. Output must be a new directory. Each spoken
30-second slot has a distinct marker and known text; remaining time is silence.
These fixtures test coverage, not real-microphone speech quality.
"""
import argparse
import hashlib
import json
import pathlib
import shutil
import subprocess
import tempfile
import wave

RATE = 16000
SAMPLE_BYTES = 2
SLOT_SECONDS = 30
FIXTURES = (("short", 30), ("five-minute", 300), ("fifteen-minute", 900),
            ("thirty-minute", 1800), ("silence", 30))
TOPICS = (
    "The garden needs a little more shade. I would like to plant a tree near the bench, "
    "but first I need to check where the water pipes run. There is no reason to rush the decision.",
    "For the next project, I want to begin with a small working example. It should be easy "
    "to explain and simple to test. After that, I can decide which features are actually worth adding.",
    "The reading group meets on Thursday. I should bring my notebook and write down the "
    "questions I still have about the final chapter. I am more interested in the discussion than in reaching a quick answer.",
    "On Saturday, I plan to walk to the library and return two books. If the weather is good, "
    "I will take the longer route beside the river. Otherwise, I can stop for coffee along the way.",
)


def slot_text(index):
    """Known, nonpersonal speech; markers deliberately differ across the file."""
    marker = f"Checkpoint number {index + 1}"
    text = f"{marker}. Elapsed time is {index * SLOT_SECONDS} seconds. {TOPICS[index % len(TOPICS)]}"
    return marker, text


def synthesize(text):
    """Return mono signed 16-bit little-endian PCM, synthesized only on this Mac."""
    with tempfile.TemporaryDirectory(prefix="voice-note-speech-") as temporary:
        audio = pathlib.Path(temporary) / "speech.aiff"
        subprocess.run(["say", "-r", "170", "-o", str(audio), text], check=True)
        return subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", "-i", str(audio),
             "-ac", "1", "-ar", str(RATE), "-f", "s16le", "-c:a", "pcm_s16le", "-"],
            check=True, stdout=subprocess.PIPE,
        ).stdout


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(65536), b""):
            digest.update(block)
    return digest.hexdigest()


def write_fixture(path, seconds, render=synthesize, silent=False):
    """Write a complete WAV with bounded memory and refuse to overwrite a file."""
    if seconds <= 0 or seconds % SLOT_SECONDS:
        raise ValueError("Duration must be a positive multiple of 30 seconds")
    expected = []
    slot_bytes = SLOT_SECONDS * RATE * SAMPLE_BYTES
    # Exclusive creation also rejects symlinks and pre-existing partial outputs.
    with path.open("xb") as output, wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(SAMPLE_BYTES)
        wav.setframerate(RATE)
        for index in range(seconds // SLOT_SECONDS):
            pcm = b""
            if not silent:
                marker, text = slot_text(index)
                pcm = render(text)
                if not pcm or len(pcm) % SAMPLE_BYTES:
                    raise ValueError("Synthesizer returned empty or incomplete PCM samples")
                if len(pcm) > slot_bytes:
                    raise ValueError(f"Speech exceeds slot {index + 1}; refusing to truncate")
                expected.append({
                    "start_seconds": index * SLOT_SECONDS,
                    "speech_seconds": len(pcm) / (RATE * SAMPLE_BYTES),
                    "marker": marker,
                    "text": text,
                })
            wav.writeframesraw(pcm)
            wav.writeframesraw(b"\0" * (slot_bytes - len(pcm)))
    return {
        "filename": path.name,
        "duration_seconds": seconds,
        "bytes": path.stat().st_size,
        "sha256": file_sha256(path),
        "expected_outcome": "no-speech-model-result" if silent else "transcript",
        "slots": expected,
    }


def generate(output, render=synthesize):
    output.mkdir(parents=True, exist_ok=False)
    # Reuse synthesized slots across the duration ladder; at most 30 s per block
    # in memory. The disk cache is removed even if synthesis fails.
    with tempfile.TemporaryDirectory(prefix="voice-note-fixtures-") as temporary:
        cache = pathlib.Path(temporary)

        def cached_render(text):
            path = cache / hashlib.sha256(text.encode()).hexdigest()
            if not path.exists():
                path.write_bytes(render(text))
            return path.read_bytes()

        fixtures = []
        for name, seconds in FIXTURES:
            fixtures.append(write_fixture(
                output / f"{name}.wav", seconds, cached_render, silent=name == "silence",
            ))
    manifest = {
        "synthetic": True,
        "uploaded": False,
        "format": {"encoding": "PCM signed 16-bit", "channels": 1, "sample_rate": RATE},
        "limitations": "Synthetic speech with silence between slots; not a real-device quality test. "
                        "No speech is expected in silence.wav, but model behavior must be measured.",
        "fixtures": fixtures,
    }
    with (output / "manifest.json").open("x") as destination:
        json.dump(manifest, destination, indent=2)
        destination.write("\n")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=pathlib.Path,
                        help="new directory, preferably outside the repository")
    args = parser.parse_args()
    for tool in ("say", "ffmpeg"):
        if not shutil.which(tool):
            parser.error(f"Required local tool not found: {tool}")
    generate(args.output)
    print(f"Saved synthetic WAVs and expected text to {args.output}; nothing uploaded.")


if __name__ == "__main__":
    main()
