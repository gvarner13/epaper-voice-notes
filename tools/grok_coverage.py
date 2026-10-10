#!/usr/bin/env python3
"""Compare synthetic Grok output with the exact known stimulus; never grades personal audio.
Normalization permits number spelling, punctuation/case, seconds/s, and first/1st.
It never deletes/reorders substantive words, repeated passages, or checkpoint labels.
"""
import json
from pathlib import Path
import re

SMALL = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = {2: "twenty", 3: "thirty", 4: "forty", 5: "fifty", 6: "sixty"}

def number_word(n):
    return SMALL[n] if n < 20 else TENS[n // 10] + (" " + SMALL[n % 10] if n % 10 else "")

NUMBER_WORDS = {number_word(i): str(i) for i in range(61)}
NUMBER_PATTERN = "|".join(re.escape(word).replace(r"\ ", "[ -]") for word in sorted(NUMBER_WORDS, key=len, reverse=True))

def normalized(text):
    text = re.sub(r"\b1st\b", "first", text.lower())
    text = re.sub(r"checkpoint number (" + NUMBER_PATTERN + r")\b",
                  lambda match: "checkpoint number " + NUMBER_WORDS[match[1].replace("-", " ")], text)
    text = re.sub(r"(\d+)\s*(?:seconds|s)\b", r"\1 seconds", text)
    return re.findall(r"[a-z0-9]+", text)

def coverage(text, slots):
    expected = normalized(" ".join(slot["text"] for slot in slots))
    actual = normalized(text)
    checkpoints = [int(n) for n in re.findall(r"checkpoint number (\d+)", " ".join(actual))]
    return {
        "expected_tokens": len(expected), "actual_tokens": len(actual),
        "all_normalized_words_match": expected == actual,
        "checkpoints_in_order": checkpoints == list(range(1, len(slots) + 1)),
        "no_speech_text_is_empty": not text.strip() if not slots else None,
        "passed": expected == actual and checkpoints == list(range(1, len(slots) + 1)) and (bool(slots) or not text.strip()),
    }

def main():
    root = Path(__file__).resolve().parent.parent
    settings = json.loads((root / ".local/grok-validation.json").read_text())
    approved = json.loads((root / "cloud/feasibility/src/fixtures.json").read_text())
    folder = root / ".local/grok-validation-results"
    reports = {}
    for fixture, audio_path in settings["files"].items():
        manifest = json.loads(Path(audio_path).with_name("manifest.json").read_text())
        if manifest.get("synthetic") is not True:
            raise ValueError("Only synthetic manifests are supported")
        gold = next(item for item in manifest["fixtures"] if item["filename"] == approved[fixture]["filename"])
        if gold["sha256"] != approved[fixture]["sha256"]:
            raise ValueError("Gold manifest does not match the approved stimulus")
        response = json.loads((folder / (fixture + ".json")).read_text())
        if response["state"] != "Completed":
            raise ValueError("Incomplete model response")
        result = response["result"]
        report = coverage(result["text"], gold["slots"])
        report["duration_seconds"] = result["duration"]
        report["last_word_end_seconds"] = max((word["end"] for word in result.get("words", [])), default=None)
        report["passed"] = report["passed"] and result["duration"] == gold["duration_seconds"]
        reports[fixture] = report
        print(fixture + ": " + json.dumps(report))
    with (folder / "coverage.json").open("x") as output:
        json.dump(reports, output, indent=2)
        output.write("\n")
    if not all(report["passed"] for report in reports.values()):
        raise SystemExit("Synthetic coverage failed; keep production paused and inspect differences")

if __name__ == "__main__":
    main()
