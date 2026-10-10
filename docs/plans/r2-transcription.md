# Voice recordings to R2 and Markdown

## Status

Product scope confirmed by the user. **Milestone 1 did not pass its quality gate.** The isolated `cloud/feasibility` harness is deployed after explicit user approval and authorization. Eight Worker behavior tests, nine fixture tests, TypeScript checking, and the dry-run bundle pass. Whole-file 30-minute transport/runtime testing succeeded, but a dense-speech transcript omitted expected passages and eight checkpoint labels. Silence hallucinated text with VAD disabled; VAD enabled fixed that observed silence case but not dense-speech fidelity. Eight synthetic inference attempts used 111.5/153 reserved audio minutes.

Further inference and full pipeline implementation are stopped pending the user's next decision. Private test originals/results and the ledger are retained. No personal recording was uploaded; no paid subscription was activated/changed, and firmware is unchanged. Detailed evidence: [experiment results](../research/r2-transcription-results.md).

The first milestone is a Cloudflare feasibility test. Do not implement the full pipeline or change recorder firmware until that gate passes. Return to the user if meeting the target requires chunking or a shorter supported transcription length.

## Goal

Capture personal English-language thoughts and ideas on the voice-note device, automatically preserve recordings in private Cloudflare R2 storage, and produce faithful Markdown transcripts using Cloudflare-hosted transcription.

Terminology: [GLOSSARY.md](../../GLOSSARY.md).
Initial provider research: [Cloudflare transcription](../research/cloudflare-transcription.md).
Preflight, pricing assumptions, and local tooling: [Milestone 1 findings](../research/r2-transcription-feasibility.md).
Executed Cloudflare tests and quality failure: [experiment results](../research/r2-transcription-results.md).

## Agreed behavior

### Capture and upload

- Recording remains available without Wi-Fi, Internet access, or functioning cloud processing.
- Keep one original WAV per recording on SD and one complete original in R2. Never automatically delete originals from either location.
- Automatically upload existing valid recordings and new completed recordings when idle and Internet access is available.
- Persist pending work across reboots. Avoid duplicate recordings and transcripts when requests or acknowledgments are retried.
- Recording takes priority over uploading. Switching off saves the recording and does not wait for upload or transcription, beyond the recorder's existing safe-shutdown requirements.
- Version one has no upload or transcription chunking. Upload interruption means restarting the file transfer, not resuming at an offset.
- Verify a complete upload before treating it as uploaded or eligible for transcription.
- Flag damaged or incomplete recordings rather than silently treating them as complete. No automatic audio repair in this scope.
- Test English recordings through 30 minutes, typically much shorter. This is a validation target, not a new recording cutoff or a proven provider limit.
- If a recording cannot be transcribed because of its size or duration, preserve the audio and expose that outcome.

### Cloud processing and output

- Use Cloudflare for storage, orchestration, and transcription; no separate third-party transcription endpoint.
- Process asynchronously after upload so the device can switch off.
- Produce one Markdown file per recording, with faithful transcript text and readable punctuation/paragraphs, not summaries or rewritten notes.
- Use stable recording identifiers in filenames, not AI-generated titles. No generated tags in version one.
- Include recording ID, original filename, capture time when known, upload time, duration, and a private reference to the original audio.
- Never substitute upload time for an unknown capture time. Preserve provenance for existing recordings without known capture dates.
- Publish completed results only; never present partial transcription as complete.
- When the model returns no speech, publish metadata and an explicit “No speech detected” outcome. This is a model result, not proof that no speech exists.
- Retry temporary failures a bounded number of times. Retain exhausted/terminal failures for inspection and manual retry; other recordings continue processing.

### Access, visibility, and cost

- Distinguish saved locally, uploaded, and transcript ready on the device; provide concise pending counts. Recording and errors take display priority.
- Fetch cloud processing status only while idle. Respect the display's slow refresh cycle rather than attempting a live progress bar.
- Provide a computer command to inspect detailed failures, retry processing, and download transcripts to a local folder.
- Downloads must not overwrite locally edited files. No web application or automatic Obsidian integration in version one.
- Use a restricted, revocable device upload credential. Never embed Cloudflare account or R2 administrator credentials in firmware.
- Keep storage private and downloads authenticated. Physical access to the device may expose its device credential.
- Target total service spending below $10/month for personal use. Verify the complete estimate before activating paid services.
- Bound retries and processing volume. Pause cloud processing when the configured usage allowance is exhausted without affecting recording or deleting audio. An application allowance is not a guaranteed provider billing cap.

## Proposed architecture

```text
SD recording
  -> authenticated upload Worker
  -> private R2 audio object
  -> R2 object-create notification
  -> Cloudflare Queue
  -> transcription Worker using Workers AI
  -> private R2 Markdown object

Device <- authenticated processing status
Computer command <- authenticated status, retry, and transcript downloads
```

Use object-prefix/suffix filtering so transcript output does not trigger transcription again. The initial model candidate is Cloudflare-hosted `@cf/openai/whisper-large-v3-turbo`; selection remains subject to feasibility and quality validation.

Keep upload, processing, and publication states distinct. A successful audio upload is not a successful transcription. Choose the concrete durable state mechanism during implementation, based on tested retry/concurrency requirements.

## Milestone 1 — Whole-file transcription feasibility

Before sending audio or activating paid resources:

1. Inspect available local Cloudflare tooling and configuration without exposing credentials.
2. Verify account requirements and current pricing for Workers, R2, Queues, and Workers AI; present the full estimate and obtain any required activation approval.
3. Use synthetic speech or recordings explicitly approved for cloud testing. The existing test-recordings directory is not blanket permission to upload its contents.
4. Confirm the relevant model input, runtime memory, request-size, timeout, and execution limits from official sources. Do not infer audio-duration support from request-rate limits.

Test the real device format: mono, 16 kHz, signed 16-bit PCM WAV. Progress from a short sample to approximately 5, 15, and 30 minutes through the intended Worker/Workers AI path.

Measure:

- Acceptance of the complete WAV without segmentation.
- Transcript coverage near the beginning, middle, and end; an HTTP success is insufficient if output is truncated.
- Speech accuracy and useful punctuation/paragraph formatting, without a rewriting stage.
- Silent input behavior and obvious hallucination/repetition failures.
- Latency, memory feasibility, timeout behavior, and usage/cost.

A 30-minute recording is about 57.6 MB before transport encoding. Base64 encoding and duplicate buffers can materially increase memory use; validate the chosen request representation rather than assuming it fits.

**Pass:** whole-file transcription works through 30 minutes in the intended runtime, with complete, usable output and an acceptable cost estimate.

**Fail:** document evidence and return to the user to choose chunking, a shorter supported transcription length, or another Cloudflare-hosted option. Do not silently change scope.

## Milestone 2 — Cloud ingestion and durable processing

- Implement authenticated, restricted audio ingestion and separate authorization for transcript reading/manual retry.
- Establish stable recording identity that survives retries and avoids collisions from repeated local filenames, card changes, or device resets. Do not rely on `VN000001.WAV` alone as a global identity.
- Validate WAV format, expected size, and transfer integrity before marking an upload complete. Define handling of incomplete transfer artifacts.
- Configure R2 audio notifications and a Queue consumer; record durable processing outcomes.
- Make duplicate notifications, concurrent deliveries, and lost acknowledgments safe. Publish one canonical result per recording; minimize duplicate inference calls without promising exactly-once provider billing.
- Implement bounded backoff, failed-job retention/manual retry, and processing allowance enforcement. Keep limits configurable and document chosen values.
- Generate Markdown with stable names, explicit unknown capture times, private audio references, and no-speech outcomes.

Test successful processing, malformed input, interrupted upload, duplicate/reordered delivery, transient and permanent inference errors, empty output, retry exhaustion, publication failure, and allowance exhaustion. Verify private objects are not anonymously accessible and a device credential cannot read transcripts or administer storage.

## Milestone 3 — Firmware upload and status

- Add a persistent upload backlog and safe scan of existing recordings.
- Coordinate SD access and upload work with the recorder so capture/start/stop remain responsive.
- Stream completed files with bounded memory; do not buffer entire recordings on the ESP32.
- Interrupt upload safely for recording or shutdown; retain pending state and retry the whole file later.
- Add trusted TLS handling and restricted device credential configuration without logging secrets.
- Add capture timestamps when a trustworthy time source is available, explicitly preserving unknown times otherwise.
- Add concise local-save/upload/transcription states and idle-only status checks without overwhelming the e-paper refresh cycle.
- Preserve the existing no-overwrite, no-auto-format, and offline-recording guarantees.

Test reboot during upload, network loss, lost server acknowledgment, credential rejection, cloud unavailability, backlog recovery, repeated filenames, unknown clock, full SD card, malformed old files, and pressing Record/Power during upload. Audio-test recording quality with networking active; compiling alone is insufficient.

## Milestone 4 — Computer command and end-to-end verification

- Add authenticated status/list, download-new-transcripts, and retry-failed-processing commands.
- Use safe local filenames and atomic downloads. Do not overwrite existing or locally modified output; explain skipped/conflicting files.
- Document setup, credential revocation, usage controls, error recovery, and known supported transcription limits in `README.md`.
- Validate the complete offline-record -> reconnect -> upload -> power-off -> transcribe -> download flow with approved audio.
- Verify historical recordings, silent recordings, exhausted retries, and unavailable cloud processing remain understandable and recoverable.
- Compile firmware and run automated checks before any device update. Coordinate flashing and physical button/audio verification with the user.

## Deferred

- Upload resumption/multipart transfer and transcription segmentation.
- Summaries, rewritten notes, generated titles/tags, and speaker diarization.
- Web UI, automatic vault integration, and transcript editing on the device.
- Automatic audio deletion, retention cleanup, and damaged-audio recovery.

## Remaining technical gates

These are implementation investigations, not permission to change the agreed behavior:

- Actual whole-file model duration/size limits and runtime feasibility.
- Complete account-specific service estimate and application allowance settings.
- Real-device transcription quality and audio integrity during network activity.
- Concrete stable identity, durable processing-state, authentication, and retry mechanisms.
