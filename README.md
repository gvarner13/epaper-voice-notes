# Waveshare 1.54G voice notes

Firmware for **Waveshare ESP32-S3-ePaper-1.54G**, the four-color (black/white/red/yellow) model with 8 MB flash and 8 MB OPI PSRAM.
Source: `device/VoiceNotes/VoiceNotes.ino`. Codec sources come from the compatible Waveshare black-and-white board examples. The display adapter is based on Waveshare's official **1.54G** initialization sequence, with its original license retained.

The original product link pointed to the black-and-white 1.54 model. A later screenshot identified the actual device as **1.54G**; the original monochrome display driver was incompatible.

## Monorepo

- `device/VoiceNotes/`: Arduino recorder firmware and cloud sync.
- `cloud/worker/`: production Cloudflare Worker, private R2 storage, Queue, and durable ledger using **`xai/grok-stt`**.
- `cloud/feasibility/`: preserved Whisper experiment/evidence; not the production service.
- `tools/`: build, USB, cloud-download, and test commands.

Git is initialized on `main`. Credentials, local account settings, microphone recordings, vendor downloads, and build artifacts are ignored. No Git remote is configured.

```sh
npm ci
npm test
npm run typecheck
npm run check:bundle
npm run build:device
```

Production setup/API/recovery: [`cloud/worker/README.md`](cloud/worker/README.md).
v1.3 has been compiled with cloud enabled and flashed through `/dev/cu.usbmodem101`. SD/microphone startup, Wi-Fi, display-ready status, preservation of all eight notes, and upload of all eight originals to private R2 are verified. Processing is **paused** with zero reserved transcription usage. AI Gateway setup/credits, live Grok quality tests, spoken capture with networking active, physical buttons, and shutdown/recovery tests remain pending. Earlier hardware results below describe prior firmware unless explicitly marked v1.3.

## Current hardware verification

- **v1.3:** flashed successfully; idle status reports `pending=0 uploaded=8 transcripts=0 damaged=0 failed=0 cloud_http=201`, Wi-Fi connected, and `display=2`. All eight pre-update filename/size entries remain on SD. All eight cloud originals are paused; reserved transcription usage is zero. `VN000001.WAV` downloaded over USB and its size/SHA-256 match both the original local fixture and cloud metadata: mono, 16 kHz, 16-bit PCM, 48,128 frames. No new recording was initiated by the agent. Actual screen appearance and network-active spoken capture still require user verification.
- Firmware compiled and flashed successfully through `/dev/cu.usbmodem101`.
- Chip identified as ESP32-S3-PICO-1, 8 MB flash / 8 MB PSRAM.
- ES8311 codec initialization succeeds.
- With explicit user permission, the approximately 64 GB SD card was reformatted from exFAT to FAT32 (32 KB clusters, label VOICE_NOTES). Read/write verification passed.
- The temporary formatter has been replaced by normal recorder firmware, which never automatically formats.
- Saved test notes: `VN000001.WAV` (3.008 s), `VN000002.WAV` (11.968 s). Both survive firmware updates/reboots and are listed on the card.
- `VN000001.WAV` was downloaded and parsed successfully: mono, 16 kHz, 16-bit PCM, 48,128 frames; nonzero microphone signal. Speech intelligibility has not yet been tested by the user.
- Corrected display driver: 1.54G command set, 10,000-byte 2-bit framebuffer, BUSY **LOW = busy / HIGH = ready**. Previous monochrome/SSD1681 driver tests were invalid for this model, not evidence of faulty hardware.
- Corrected firmware completed its first refresh (`DISPLAY_UPDATED Ready`), and subsequent state refreshes finished with `display=2` (ready). Visual appearance/orientation awaits user confirmation.
- Recording while the color screen refreshed was tested: `VN000005.WAV`, 6.016 s, downloaded and parsed as valid mono 16 kHz/16-bit PCM with nonzero microphone signal. Existing notes remain intact.
- Wi-Fi firmware v1.2 compiled and flashed successfully. Device connected to `VarnerN1` and received `192.168.0.115` via DHCP; signal about -45 dBm. Both Ready refreshes completed with `display=2`. Actual on-screen appearance still awaits visual confirmation.
- USB `STATUS`, `LIST`, and `GET` verified after the update; existing notes `VN000001.WAV` through `VN000008.WAV` remain listed. `VN000001.WAV` downloaded with Wi-Fi connected and parsed as valid mono, 16 kHz, 16-bit PCM (48,128 frames). No new recording was made during Wi-Fi verification, and recording with Wi-Fi active has not yet been audio-tested.
- Display task stops cleanly if it cannot initialize; recording continues independently.
- BOOT input reads high (released), PWR reads high (released). Physical button interactions and battery shutdown are not yet verified.

## Operation

- Press BOOT once to start; press again to stop and save.
- Hold PWR for 2 seconds to stop/save and enter power-off/sleep. Release PWR after holding. Battery behavior still needs a physical test.
- Notes: `/NOTES/VN000001.WAV`, `/NOTES/VN000002.WAV`, etc.
- PCM WAV: 16 kHz, 16-bit, mono (about 1.92 MB/minute).
- Existing files are never overwritten; card is never automatically formatted.
- Never remove SD or power off while recording. Stop and wait for Saved first.
- Header is checkpointed/synced every 2 seconds; this reduces, but does not eliminate, data loss from abrupt power removal. Tail recovery is not implemented.
- Screen updates in a separate task; I2S DMA buffering is expanded to reduce SD-write stalls.
- This four-color screen takes about **20 seconds for full refresh / 15 seconds for fast refresh**. Start/stop recording responds immediately, independently of rendering. The screen refreshes only on state changes, not as a live timer. If a short note starts and stops during a refresh, intermediate screen states may be coalesced; the final Saved state will appear once rendering catches up.
- Power-off waits for screen rendering/sleep to complete (potentially tens of seconds).
- Wi-Fi connects automatically to `VarnerN1`. The main screen shows connecting, connected, or offline/retrying beneath the note details. Network changes preserve the current recording/saved state; retries run independently of audio capture. Status changes share the screen's 15–20 second refresh delay.
- A connection attempt taking longer than 15 seconds shows offline/retrying; reconnect attempts continue every 30 seconds. Recording remains available without Wi-Fi. Wi-Fi is stopped during power-off.
- Connected means joined to the local Wi-Fi network with an IP address, not verified Internet/cloud availability. In v1.3, configured cloud sync uploads valid completed notes while idle; originals remain on SD. Bluetooth and speaker playback remain disabled.
- v1.3 cloud indicators: `P` pending upload, `U` uploaded originals, `T` ready transcripts, `E` damaged/incomplete files or failed/uncertain processing. Counts update after a completed idle scan, not live; a paused upload may leave the previous counts visible. Capture and power-off do not wait for cloud processing.
- `.ID`, `.SHA`, `.UP`, and `.RUN` companions persist identity, original fingerprint, upload/status acknowledgment, and incomplete-recording markers. Do not delete or edit companions. A `.RUN` file blocks automatic upload after interrupted/error saves; no automatic audio repair is performed. Legacy files have unknown capture times and cannot prove a clean historical shutdown merely from a valid header.

## Wi-Fi credentials

Local settings live in `device/VoiceNotes/wifi_credentials.h` (excluded by `.gitignore`). On a fresh checkout, copy `device/VoiceNotes/wifi_credentials.h.example` to that path and fill in the SSID and password before compiling. ESP32-S3 requires a **2.4 GHz** network. Changing credentials requires rebuilding/flashing.

Optional cloud settings live in ignored `device/VoiceNotes/cloud_credentials.h`; copy the adjacent `.example` for a new setup. Without that header, cloud sync is disabled and local capture still works. Only a restricted device credential and trusted root CA belong there, never Cloudflare administrator or xAI credentials. A trusted clock is acquired asynchronously via NTP; historical/unsynchronized capture timestamps remain unknown.

Do not share credential headers or compiled firmware/build artifacts: Wi-Fi/device credentials are embedded in the firmware. They are not printed in USB status output.

## Build and flash

Arduino CLI is downloaded locally at `tools/arduino-cli`.
Installed dependencies: ESP32 Arduino core 3.3.0, Adafruit GFX Library 1.12.6 (BusIO 1.17.4).

From this project directory:

```sh
./tools/arduino-cli compile \
  --fqbn 'esp32:esp32:esp32s3:USBMode=hwcdc,CDCOnBoot=cdc,FlashSize=8M,PartitionScheme=default_8MB,PSRAM=opi' \
  --build-path "$PWD/build" device/VoiceNotes

./tools/arduino-cli upload \
  --fqbn 'esp32:esp32:esp32s3:USBMode=hwcdc,CDCOnBoot=cdc,FlashSize=8M,PartitionScheme=default_8MB,PSRAM=opi' \
  --port /dev/cu.usbmodem101 --input-dir "$PWD/build" device/VoiceNotes
```

USB serial commands (115200 baud, newline terminated): `STATUS`, `START`, `STOP`, `LIST`, `GET VN000001.WAV`.

USB helper (from this project directory):

```sh
./tools/venv/bin/python tools/usb_notes.py status
./tools/venv/bin/python tools/usb_notes.py list
./tools/venv/bin/python tools/usb_notes.py get VN000001.WAV --output ./my-note.wav
```

The helper can also `start` / `stop`; issue these only while idle / recording respectively. Downloads refuse to overwrite existing output or partial files. Display log output is serialized with downloads to prevent corruption of raw WAV transfers.

v1.3 `STATUS` also includes `pending`, `uploaded`, `transcripts`, `damaged`, `failed`, and the last `cloud_http` code. `STATUS` includes `display=0` (starting), `1` (refreshing), `2` (ready), or `3` (offline), plus `wifi=connecting|connected|offline`, `ssid`, DHCP `ip`, and signal strength `rssi` (dBm; 0 while disconnected).
USB log/status lines and WAV download writes are paced in small chunks to prevent native USB-JTAG CDC truncation.
`GET` is available only while idle; sends `FILE_BEGIN <name> <bytes>\n`, exact raw file bytes, then `\nFILE_END\n`. Port is not a USB SD-card mass-storage volume.

## Computer cloud commands

For this machine, reader settings are in ignored `.local/production.env`. For a new setup, export `VOICE_NOTES_URL` (HTTPS origin) and `VOICE_NOTES_READER_TOKEN` (separate from the device credential).

```sh
source .local/production.env
python3 tools/cloud_notes.py status
python3 tools/cloud_notes.py download ./transcripts
python3 tools/cloud_notes.py retry recorder-1_REPLACE_WITH_32_HEX_DIGITS
```

Downloads are atomic and never replace existing/edited Markdown. `retry` is explicit and can spend additional inference allowance. Uploading a recording is separate from having a complete transcript.

## Sources

- Display/actual board: https://docs.waveshare.com/ESP32-S3-ePaper-1.54G
- Color example code: https://github.com/waveshareteam/ESP32-S3-ePaper-1.54G
- Compatible codec sources: https://github.com/waveshareteam/ESP32-S3-ePaper-1.54

Keep normal recorder firmware's `format_if_mount_failed = false`. The temporary `tools/CardFormatter` requires an explicit USB erase command and is not installed on the board. Any future reformat requires fresh user consent.
