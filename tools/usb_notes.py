#!/usr/bin/env python3
"""Access local voice notes over USB (pip install pyserial). No files are deleted."""
import argparse
import pathlib
import re
import sys
import time

import serial


def response(port, starts, ends=None, seconds=10):
    end = time.monotonic() + seconds
    seen = False
    while time.monotonic() < end:
        raw = port.readline()
        line = raw.decode(errors="replace").strip()
        if not line:
            continue
        if line.startswith(("NOT_READY", "BUSY", "GET_ERROR", "CREATE_ERROR", "MIC_READ_ERROR")):
            raise RuntimeError(line)
        if line.startswith(starts):
            seen = True
        if seen:
            print(line)
            if ends is None or line.startswith(ends):
                return line
    raise TimeoutError("No complete response from the board")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", default="/dev/cu.usbmodem101")
    parser.add_argument("command", choices=["status", "list", "start", "stop", "get"])
    parser.add_argument("name", nargs="?", help="e.g. VN000001.WAV (get only)")
    parser.add_argument("--output", type=pathlib.Path, help="download destination (get only)")
    args = parser.parse_args()
    if args.command == "get" and not re.fullmatch(r"VN[0-9]{6}\.WAV", args.name or ""):
        parser.error("get requires a filename such as VN000001.WAV")
    with serial.Serial(args.port, 115200, timeout=.2, write_timeout=3) as port:
        time.sleep(.25)
        port.reset_input_buffer()
        if args.command != "get":
            port.write((args.command.upper() + "\n").encode())
            if args.command == "list":
                response(port, "FILES_BEGIN", "FILES_END")
            else:
                response(port, {"status": "STATUS", "start": "RECORDING", "stop": "SAVED"}[args.command])
            return
        output = args.output or pathlib.Path(args.name)
        partial = output.with_name(output.name + ".partial")
        if output.exists() or partial.exists():
            raise FileExistsError(f"Refusing to overwrite {output} or {partial}")
        port.write(f"GET {args.name}\n".encode())
        header = response(port, "FILE_BEGIN")
        _, actual_name, size = header.split()
        if actual_name != args.name:
            raise RuntimeError("Unexpected filename in response")
        remaining = int(size)
        deadline = time.monotonic() + 10
        with partial.open("xb") as file:
            while remaining:
                block = port.read(min(4096, remaining))
                if block:
                    file.write(block)
                    remaining -= len(block)
                    deadline = time.monotonic() + 10
                elif time.monotonic() > deadline:
                    raise TimeoutError(f"Transfer stopped; partial file saved to {partial}")
        response(port, "FILE_END")
        partial.rename(output)
        print(f"Saved {output} ({size} bytes)")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, TimeoutError, ValueError) as error:
        sys.exit(str(error))
