#!/usr/bin/env python3
"""Generate one dense 30-minute synthetic WAV locally; never uploads audio.

Two known topics per 30-second slot, with speech time-adjusted to approximately
29 seconds. This stresses transcript volume as well as full-file duration.
"""
import argparse
import json
import pathlib
import subprocess

import transcription_fixtures as fixtures


def generate(output):
    output.mkdir(parents=True, exist_ok=False)
    texts = []

    def render(base_text):
        index = len(texts)
        text = base_text + " " + fixtures.TOPICS[(index + 1) % len(fixtures.TOPICS)]
        texts.append(text)
        pcm = fixtures.synthesize(text)
        speech_seconds = len(pcm) / (fixtures.RATE * fixtures.SAMPLE_BYTES)
        # Local synthetic stimulus construction, not transcription segmentation.
        # atempo changes speaking speed while retaining pitch and all spoken words.
        adjusted = subprocess.run([
            "ffmpeg", "-nostdin", "-v", "error", "-f", "s16le", "-ar", "16000", "-ac", "1",
            "-i", "pipe:0", "-af", f"atempo={speech_seconds / 29:.8f}",
            "-f", "s16le", "-c:a", "pcm_s16le", "pipe:1",
        ], input=pcm, stdout=subprocess.PIPE, check=True).stdout
        seconds = len(adjusted) / (fixtures.RATE * fixtures.SAMPLE_BYTES)
        if not 28 <= seconds <= 30:
            raise ValueError("Dense speech did not fit its slot without truncation")
        return adjusted

    result = fixtures.write_fixture(output / "thirty-minute-dense.wav", 1800, render=render)
    for slot, text in zip(result["slots"], texts, strict=True):
        slot["text"] = text
    speech_seconds = sum(slot["speech_seconds"] for slot in result["slots"])
    manifest = {
        "synthetic": True, "uploaded": False,
        "construction": "Two known topics per slot; local atempo adjustment to approximately 29 s speech per 30 s slot.",
        "speech_seconds": speech_seconds,
        "speech_fraction": speech_seconds / 1800,
        "fixtures": [result],
    }
    with (output / "manifest.json").open("x") as destination:
        json.dump(manifest, destination, indent=2)
        destination.write("\n")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=pathlib.Path, required=True, help="new directory")
    args = parser.parse_args()
    manifest = generate(args.output)
    print(f"Generated dense synthetic WAV in {args.output}; {manifest['speech_fraction']:.1%} speech; nothing uploaded.")


if __name__ == "__main__":
    main()
