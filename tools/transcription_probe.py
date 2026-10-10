#!/usr/bin/env python3
"""Operate the isolated synthetic transcription test, not the production pipeline.

No automatic retries. Credentials are read from ignored local files and never
printed. Uploads are streamed only after matching the Worker's fixture allowlist.
"""
import argparse
import hashlib
import http.client
import json
import os
import pathlib
import re
import ssl
import sys
import time
import urllib.parse
import wave

ROOT = pathlib.Path(__file__).resolve().parent.parent
AGENT = "VoiceNotesFeasibility/1.0"  # Default urllib UA receives Cloudflare 1010.


class Probe:
    def __init__(self):
        deployment = json.loads((ROOT / ".local/feasibility-deployment.json").read_text())
        url = urllib.parse.urlsplit(deployment["url"])
        name = deployment["name"]
        if url.scheme != "https" or url.port or url.username or url.password or url.query or url.fragment \
                or url.path not in ("", "/") or not re.fullmatch(
                    re.escape(name) + r"\.[a-z0-9-]+\.workers\.dev", url.hostname or ""):
            raise ValueError("Expected the deployed test Worker's HTTPS workers.dev URL")
        self.host = url.hostname
        self.token = json.loads((ROOT / ".local/feasibility-secrets.json").read_text())["TEST_TOKEN"]
        if not isinstance(self.token, str) or len(self.token) < 32:
            raise ValueError("Invalid local test credential")

    def request(self, method, path, body=None, headers=None):
        request_headers = {"Authorization": "Bearer " + self.token, "User-Agent": AGENT}
        request_headers.update(headers or {})
        connection = http.client.HTTPSConnection(self.host, timeout=120, context=ssl.create_default_context())
        try:
            connection.request(method, path, body=body, headers=request_headers)
            response = connection.getresponse()
            data = response.read(10 * 1024 * 1024 + 1)
            if len(data) > 10 * 1024 * 1024:
                raise ValueError("Probe response exceeds 10 MB")
            if response.status >= 300:
                # Never follow redirects with a credential or print request headers.
                raise RuntimeError(f"HTTP {response.status}: {data[:500].decode(errors='replace')}")
            return json.loads(data)
        finally:
            connection.close()

    def upload(self, fixture_name, fixture_root):
        state = self.request("GET", "/state")
        fixture = state["fixtures"].get(fixture_name)
        if not fixture or not re.fullmatch(r"[a-z0-9-]+\.wav", fixture["filename"]):
            raise ValueError("Unknown or unsafe synthetic fixture")
        path = fixture_root / fixture["filename"]
        if path.stat().st_size != fixture["bytes"]:
            raise ValueError("Local fixture size differs from the allowlist")
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for block in iter(lambda: source.read(65536), b""):
                digest.update(block)
        if digest.hexdigest() != fixture["sha256"]:
            raise ValueError("Local fixture checksum differs from the allowlist; no audio sent")
        with wave.open(str(path), "rb") as wav:
            if (wav.getnchannels(), wav.getframerate(), wav.getsampwidth(), wav.getcomptype()) \
                    != (1, 16000, 2, "NONE") or wav.getnframes() != fixture["duration_seconds"] * 16000:
                raise ValueError("Fixture is not the expected complete device-format WAV")
        with path.open("rb") as source:
            return self.request("PUT", "/fixtures/" + fixture_name, source, {
                "Content-Type": "audio/wav", "Content-Length": str(fixture["bytes"]),
            })

    def start(self, run_id, fixture, vad_filter):
        body = json.dumps({"fixture": fixture, "vad_filter": vad_filter}).encode()
        return self.request("POST", "/runs/" + run_id, body, {
            "Content-Type": "application/json", "Content-Length": str(len(body)),
        })

    def wait(self, run_id, timeout):
        deadline = time.monotonic() + timeout
        previous = None
        while True:
            run = self.request("GET", "/runs/" + run_id)
            if run["state"] != previous:
                print(run_id + ": " + run["state"], flush=True)
                previous = run["state"]
            if run["state"] in ("complete", "failed"):
                return run
            if time.monotonic() >= deadline:
                raise TimeoutError("Still uncertain; inspect state. Do not automatically start another attempt.")
            time.sleep(2)

    def result(self, run_id, output):
        partial = output.with_name(output.name + ".partial")
        if output.exists() or partial.exists():
            raise FileExistsError("Refusing to overwrite result or partial file")
        result = self.request("GET", "/runs/" + run_id + "/result")
        if result.get("run_id") != run_id or not isinstance(result.get("response", {}).get("text"), str):
            raise ValueError("Invalid completed result evidence")
        output.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as destination:
            json.dump(result, destination, indent=2)
            destination.write("\n")
            destination.flush()
            os.fsync(destination.fileno())
        # Unlike rename(), link() cannot clobber an output created during download.
        os.link(partial, output)
        partial.unlink()
        return {"saved": str(output), "outcome": result["outcome"],
                "latency_ms": result["latency_ms"], "characters": len(result["response"]["text"])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["state", "upload", "run", "wait", "result"])
    parser.add_argument("--fixture")
    parser.add_argument("--fixture-root", type=pathlib.Path)
    parser.add_argument("--run-id")
    parser.add_argument("--vad-filter", action="store_true")
    parser.add_argument("--timeout", type=int, default=1000)
    parser.add_argument("--output", type=pathlib.Path)
    args = parser.parse_args()
    if args.command in ("run", "wait", "result") and not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", args.run_id or ""):
        parser.error("This command requires a safe --run-id")
    if args.command in ("upload", "run") and not re.fullmatch(r"[a-z0-9-]+", args.fixture or ""):
        parser.error("This command requires --fixture")
    if args.command == "upload" and not args.fixture_root:
        parser.error("upload requires --fixture-root")
    if args.command == "result" and not args.output:
        parser.error("result requires a new --output file")
    if not 1 <= args.timeout <= 1200:
        parser.error("--timeout must be between 1 and 1200 seconds")
    probe = Probe()
    if args.command == "state":
        result = probe.request("GET", "/state")
    elif args.command == "upload":
        result = probe.upload(args.fixture, args.fixture_root)
    elif args.command == "run":
        result = probe.start(args.run_id, args.fixture, args.vad_filter)
    elif args.command == "wait":
        result = probe.wait(args.run_id, args.timeout)
    else:
        result = probe.result(args.run_id, args.output)
    print(json.dumps(result, indent=2))
    if args.command == "wait" and result["state"] == "failed":
        return 2
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, TimeoutError, http.client.HTTPException) as error:
        sys.exit(str(error))
