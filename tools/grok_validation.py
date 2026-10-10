#!/usr/bin/env python3
"""Synthetic-only, no-retry operator for the isolated Grok validation deployment.
Never reads device recordings. Exact inputs must match the preserved allowlist.
Settings/secrets are ignored .local files; every fixture gets one durable run ID.
"""
import argparse
import hashlib
import http.client
import json
from pathlib import Path
import time
from urllib.parse import urlparse
import uuid
from cloud_notes import Cloud

ROOT = Path(__file__).resolve().parent.parent
SETTINGS = ROOT / ".local/grok-validation.json"
SECRETS = ROOT / ".local/grok-validation-secrets.json"
FIXTURES = ("short", "silence", "five-minute", "thirty-minute", "thirty-minute-dense")

def persist(settings):
    temporary = SETTINGS.with_suffix(".tmp")
    temporary.touch(mode=0o600, exist_ok=False)
    try:
        temporary.write_text(json.dumps(settings, indent=2) + "\n")
        temporary.replace(SETTINGS)
    finally:
        temporary.unlink(missing_ok=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("state")
    for command in ("upload", "wait"):
        p = sub.add_parser(command)
        p.add_argument("fixture", choices=FIXTURES)
        if command == "wait":
            p.add_argument("--timeout", type=int, default=900)
    args = parser.parse_args()
    settings, secrets = json.loads(SETTINGS.read_text()), json.loads(SECRETS.read_text())
    cloud = Cloud(settings["url"], secrets["READER_TOKEN"])
    if not urlparse(cloud.origin).hostname.startswith("epaper-grok-validation."):
        raise ValueError("Only the isolated validation origin is supported")
    if args.command == "state":
        for page in cloud.notes():
            print(json.dumps(page, indent=2))
        return
    fixture = args.fixture
    metadata = json.loads((ROOT / "cloud/feasibility/src/fixtures.json").read_text())[fixture]
    if args.command == "upload":
        if fixture in settings["runs"]:
            raise ValueError("Fixture already has a run ID; inspect/wait instead of automatically retrying paid inference")
        path = Path(settings["files"][fixture])
        if path.name != metadata["filename"] or path.stat().st_size != metadata["bytes"]:
            raise ValueError("Not the exact approved synthetic WAV")
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(65536), b""):
                digest.update(chunk)
        if digest.hexdigest() != metadata["sha256"]:
            raise ValueError("Synthetic fixture checksum mismatch")
        recording = "grok-validation_" + uuid.uuid4().hex
        settings["runs"][fixture] = recording
        persist(settings)  # Persist before transfer; a lost acknowledgment never creates a new paid run automatically.
        connection = http.client.HTTPSConnection(urlparse(cloud.origin).hostname, timeout=120)
        try:
            connection.putrequest("PUT", "/recordings/" + recording)
            for key, value in {
                "Authorization": "Bearer " + secrets["DEVICE_TOKEN"], "User-Agent": "VoiceNotesComputer/1.0",
                "Content-Type": "audio/wav", "Content-Length": str(metadata["bytes"]),
                "X-Audio-SHA256": metadata["sha256"], "X-Original-Filename": f"VN{900001 + FIXTURES.index(fixture):06}.WAV",
            }.items():
                connection.putheader(key, value)
            connection.endheaders()
            with path.open("rb") as source:
                for chunk in iter(lambda: source.read(65536), b""):
                    connection.send(chunk)
            response = connection.getresponse()
            body = response.read(8192)
            if response.status != 201:
                raise RuntimeError(f"Synthetic upload HTTP {response.status}; inspect this run, no automatic retry")
            result = json.loads(body)
            if result.get("id") != recording or result.get("sha256") != metadata["sha256"]:
                raise ValueError("Unexpected upload acknowledgment")
            print(f"Uploaded approved {fixture}: {metadata['duration_seconds']} s; state={result['state']}")
        finally:
            connection.close()
        return
    recording = settings["runs"][fixture]
    deadline = time.monotonic() + args.timeout
    previous = None
    while time.monotonic() < deadline:
        note = json.loads(cloud.request("/recordings/" + recording))
        if note["state"] != previous:
            print(f"{fixture}: {note['state']}", flush=True)
            previous = note["state"]
        if note["state"] == "ready":
            data = cloud.request("/recordings/" + recording + "/transcript")
            folder = ROOT / ".local/grok-validation-results"
            folder.mkdir(mode=0o700, exist_ok=True)
            path = folder / (fixture + ".md")
            with path.open("xb") as output:
                output.write(data)
            print(f"Completed synthetic result saved to {path.relative_to(ROOT)}")
            return
        if note["state"] in ("failed", "uncertain", "paused"):
            raise RuntimeError(f"Validation stopped: {note['state']}; {note.get('error', 'inspect state')}")
        time.sleep(3)
    raise TimeoutError("Validation wait timed out; inspect the existing run, never automatically submit another")

if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, KeyError) as error:
        raise SystemExit(str(error))
