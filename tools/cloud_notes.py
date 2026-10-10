#!/usr/bin/env python3
"""Authenticated cloud status, explicit retries, and no-clobber transcript downloads.
Credentials come from environment, never arguments or printed logs.
"""
import argparse
import json
import os
from pathlib import Path
import re
import tempfile
import urllib.error
import urllib.request
from urllib.parse import urlparse

ID = re.compile(r"[a-z0-9-]{1,32}_[a-f0-9]{32}\Z")

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward a bearer credential to a different origin.

class Cloud:
    def __init__(self, origin, token):
        parsed = urlparse(origin)
        if parsed.scheme != "https" or not parsed.netloc or parsed.path not in ("", "/") or parsed.query or parsed.fragment or parsed.username:
            raise ValueError("VOICE_NOTES_URL must be an HTTPS origin without credentials or a path")
        if len(token) < 32:
            raise ValueError("Set VOICE_NOTES_READER_TOKEN to the separate reader credential")
        self.origin = origin.rstrip("/")
        self.token = token
        self.opener = urllib.request.build_opener(NoRedirect)

    def request(self, path, method="GET"):
        req = urllib.request.Request(self.origin + path, method=method, headers={
            "Authorization": "Bearer " + self.token,
            "User-Agent": "VoiceNotesComputer/1.0",
        })
        with self.opener.open(req, timeout=60) as response:
            data = response.read(4 * 1024 * 1024 + 1)
            if len(data) > 4 * 1024 * 1024:
                raise ValueError("Unexpectedly large server response")
            return data

    def notes(self):
        after = ""
        while True:
            page = json.loads(self.request("/recordings" + ("?after=" + after if after else "")))
            yield page
            cursor = page.get("cursor")
            if not cursor:
                break
            if not ID.fullmatch(cursor) or cursor <= after:
                raise ValueError("Invalid or non-advancing server cursor")
            after = cursor

def publish_new(folder, recording_id, data):
    """Same-filesystem hard link provides atomic, no-replace publication even in races."""
    if not ID.fullmatch(recording_id):
        raise ValueError("Unsafe recording ID")
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    destination = folder / (recording_id + ".md")
    fd, temporary = tempfile.mkstemp(prefix=".voice-note-", suffix=".tmp", dir=folder)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(temporary, destination)
        except FileExistsError:
            return False
        return True
    finally:
        os.unlink(temporary)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    retry = sub.add_parser("retry")
    retry.add_argument("recording_id")
    download = sub.add_parser("download")
    download.add_argument("folder", type=Path)
    args = parser.parse_args()
    cloud = Cloud(os.environ.get("VOICE_NOTES_URL", ""), os.environ.get("VOICE_NOTES_READER_TOKEN", ""))
    if args.command == "retry":
        if not ID.fullmatch(args.recording_id):
            raise ValueError("Invalid recording ID")
        print(cloud.request("/recordings/" + args.recording_id + "/retry", "POST").decode())
        return
    for page in cloud.notes():
        if args.command == "status":
            print(json.dumps(page, indent=2))
        else:
            for note in page["notes"]:
                recording = note["id"]
                if not ID.fullmatch(recording):
                    raise ValueError("Unsafe recording ID from server")
                if note["state"] != "ready":
                    continue
                if (args.folder / (recording + ".md")).exists():
                    print("Skipped existing:", recording)
                    continue
                data = cloud.request("/recordings/" + recording + "/transcript")
                created = publish_new(args.folder, recording, data)
                print("Downloaded:" if created else "Skipped existing:", recording)

if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as error:
        raise SystemExit(f"Cloud request failed: HTTP {error.code}; check status/credentials (no automatic retry)")
    except (ValueError, OSError, KeyError) as error:
        raise SystemExit(str(error))
