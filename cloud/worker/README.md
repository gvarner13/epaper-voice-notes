# Production voice notes

Private originals → R2 audio notification + durable upload outbox → Queue →
**`xai/grok-stt`** through Cloudflare's AI binding/AI Gateway → raw result + Markdown in R2.
A SQLite Durable Object serializes recording claims and monthly usage reservations.

## Current deployment

The dedicated `epaper-voice-notes` Worker, private R2 bucket, Queue, SQLite ledger,
audio-only R2 notification, and one-minute recovery Cron are deployed. All three
random application secrets are installed. Anonymous API/unsigned audio access is
rejected; device listing is denied; the separate reader can inspect empty state.
Processing is **paused** (`PROCESSING_ENABLED=false`). No audio was uploaded during
setup. Following the user connecting the device, v1.3 was flashed and all eight
existing completed originals uploaded automatically. All eight are paused; reserved
transcription usage remains zero. SD note preservation and one USB/original/cloud
checksum comparison pass. The user's subsequent physical BOOT recording test saved
and uploaded `VN000009.WAV` (10.368 s); all nine originals are now paused with zero
reserved transcription usage. Its complete USB payload matches the cloud checksum,
although the USB end-marker acknowledgment timed out. The user confirms the screen
looks good; transcription quality and independent audio intelligibility remain
unverified. Previous feasibility resources/evidence remain untouched.

The existing computer OAuth authorization cannot inspect/manage AI Gateway
(HTTP 403). Human setup/authorization is required before enabling paid inference:

1. Open Cloudflare Dashboard → **AI → AI Gateway** in the selected account.
2. Create a dedicated gateway named **`epaper-voice-notes`**; disable request/response
   logging and caching. Our binding also sends `collectLog:false`, `skipCache:true`.
3. Either configure an xAI BYOK key under the **default** alias, or confirm there
   are already sufficient Unified Billing credits. Do not purchase credits or enable
   auto-top-up without explicit approval. The binding does not use non-default BYOK
   aliases. ZDR is advertised for this model's Unified Billing route; it is not a
   blanket guarantee for BYOK or logging.
4. Review cost/allowance below. First run approved synthetic Grok tests through this
   exact service, including dense 30-minute coverage and silence. HTTP success is
   not proof of transcript accuracy. Do not upload historical personal recordings
   for model testing without the user's approval.
5. Set `PROCESSING_ENABLED=true` and redeploy only when ready. Paused recordings
   resume through Cron; originals never expire or get deleted.

The selected model is third-party xAI inference routed/billed through Cloudflare,
not Cloudflare-hosted Whisper. This follows the user's subsequent provider choice.
No chunking, shortened recording cutoff, summaries, tags, or rewriting stage is added.
The application upload ceiling is 96,000,044 bytes (50 minutes of device audio),
**not** a recording cutoff or a proven Grok quality limit. Larger notes stay local
with an explicit HTTP 413 outcome; this ceiling can be adjusted after platform review.

## Fresh setup

From the repository root, `npm ci`. Select the intended Cloudflare account explicitly
(e.g. exported `CLOUDFLARE_ACCOUNT_ID`) and verify OAuth/API permissions. Inspect names
before creation; do not modify a same-name resource belonging to another project.
Workers Paid/R2/Queues must already be available; these commands do not authorize a
new subscription. Keep R2 public access disabled.

```sh
npx wrangler r2 bucket create epaper-voice-notes
npx wrangler queues create epaper-voice-notes
npx wrangler r2 bucket notification create epaper-voice-notes \
  --event-types object-create --prefix audio/ --suffix .wav \
  --queue epaper-voice-notes
```

Choose independent random 32+ character `DEVICE_TOKEN`, `READER_TOKEN`, and
`AUDIO_SIGNING_KEY`; install them via `wrangler secret put <NAME> --config
cloud/worker/wrangler.jsonc` or a permission-600 ignored JSON file and `secret bulk`.
Never put account/API credentials in firmware. Revoking/replacing `DEVICE_TOKEN`
immediately prevents uploads/status requests from that device. Do not reuse the
reader token as the device token.

Update `PUBLIC_ORIGIN` to the deployed Worker's exact public HTTPS origin and
`DEVICE_ID` to match the firmware (default `recorder-1`). Set up the gateway as above.

```sh
npm run deploy -w @voice-notes/cloud
```

Copy `device/VoiceNotes/cloud_credentials.h.example` to the ignored local header,
set `CLOUD_ENABLED=1`, HTTPS hostname, matching device ID/token, and trusted root CA
PEM(s) for that hostname. Never use insecure TLS. This machine's header is prepared
with GTS Root R4, which verified the live deployment's certificate. If its CA chain
changes, replace/add the official trusted root and rebuild. NTP must synchronize
for certificate date verification. Firmware refuses redirects with credentials.

Compile before connecting/flashing. Hardware verification remains required for
network-active recording quality, physical buttons, SD-full behavior, lost network,
reboot while uploading, backlog recovery, and power-off during transfer.

## API

All API responses disable caching. IDs are `<device-id>_<32-lowercase-random-hex>`.
Identity lives in an SD companion, survives retries and card movement, and is not
based on a recurring `VN000001.WAV` filename. Audio objects are immutable.

| Route | Authorization | Behavior |
| --- | --- | --- |
| `PUT /recordings/<id>` | Device, matching ID prefix | Canonical PCM16/16kHz/mono WAV; exact Content-Length; `Content-Type: audio/wav`; `X-Audio-SHA256`; `X-Original-Filename: VN000001.WAV`; optional `X-Captured-At` UTC ISO seconds, otherwise unknown. Checks header/size and full R2 SHA-256 before ledger/processing acceptance. Same ID/input repairs lost acknowledgments; conflicting inputs return 409. |
| `GET /recordings/<id>` | Device for own prefix, or reader | Upload/processing metadata, attempts, safe error, outcome. |
| `GET /recordings?after=<id>` | Reader only | Up to 100 records, continuation cursor, current month's reserved usage. |
| `POST /recordings/<id>/retry` | Reader only | Retry failed/paused/uncertain work; grants another bounded batch without refunding usage. |
| `GET /recordings/<id>/transcript` | Reader only | Complete Markdown only; 409 while unfinished. |
| `GET/HEAD /source/<id>?...` | Short-lived HMAC capability | Exact original, supporting a single byte range. Only during that active attempt; expires after 15 minutes and is revoked on completion/failure. |

Grok's documented `file` input has a gateway-side 25 MB limit; 30-minute WAVs
are about 57.6 MB. The documented `url` input avoids that gateway limit and whole-audio
buffering. xAI fetches the complete audio through a signed capability, not a public
bucket. Anyone possessing that URL can read that one original until expiry/revocation;
never log/share it. Account-wide access logs/security policies may need separate
privacy review. Originals are never automatically deleted, including failed jobs.

Model parameters: English, formatting enabled, fillers preserved, no diarization.
Only a `state: Completed` response with `result.text` is accepted; raw provider JSON
is retained privately. Markdown preserves provider text, explicit unknown capture
provenance, stable identity, duration, upload time, and private R2 reference. Empty
text means “No speech detected (model result; not proof of silence).” There is no
paragraph rewriting stage; paragraph quality follows provider output.

## Recovery and cost controls

- Queue duplicates and concurrent delivery claim only once. Normal inference errors
  retry at 1, 2, then 4-minute backoff with **3 total attempts** per automatic batch.
  HTTP 429/5xx and transport/storage errors are retryable; malformed/incomplete
  model output and other HTTP failures are terminal. Infrastructure delivery retries
  are separately bounded in Queue configuration.
- The durable ledger is an outbox. One-minute Cron repairs failed enqueue, early R2
  notifications, and lost acknowledgment windows. An original stored before a ledger
  commit is repaired by the device's immutable whole-file retry.
- A crashed running attempt becomes **uncertain after 20 minutes**, not silently
  re-inferred. Inspect before explicit manual retry; exactly-once provider billing
  is not promised. Partial provider output is never published as complete.
- Raw completed results are reused after publication failure; Markdown is canonical.
  A retry still reserves usage conservatively, even when a persisted result means
  no inference is necessary. Reservations are never refunded after errors/uncertainty.
- Default monthly reservation cap: **36,000 seconds / 600 minutes**, including retries,
  resets by UTC calendar month. Exhaustion pauses processing, not uploads/capture.
  Disabling processing pauses future claims, not an already-running provider request.
- Published model rate is **$0.001667/audio minute**: 600 reserved minutes ≈ **$1.0002**
  gross inference. Unified Billing credit purchases add **5%**; no auto-top-up is enabled
  by this implementation. Workers Paid has an existing $5/month base in the selected
  account. R2 storage/operations, Queue operations, Worker/DO usage, taxes, and other
  account projects are additional. R2 standard storage is published at $0.015/GB-month;
  600 minutes generates about 1.15 GB of new original audio (~$0.0173 for a full month),
  accumulating indefinitely because there is no deletion policy. App controls are
  **not a guaranteed $10 provider/account bill cap**. Review account usage and configure
  gateway/provider spend limits before enabling.

## Checks

From root: `npm test`, `npm run typecheck`, `npm run check:bundle`, `npm run build:device`.
Runtime tests use real local R2/SQLite storage, explicit Queue delivery, and mocked
AI with remote bindings disabled. They cover auth, header/checksum failures, immutable
and concurrent uploads, signed/private source access, no-speech outcomes, completed
publication, duplicate processing, allowance pause, backoff/exhaustion, lost enqueue,
crash uncertainty, and publication recovery. Computer tests cover atomic no-clobber
files; host-side firmware tests cover WAV/identity validation. None substitutes for
live Grok quality, full-duration capability, or physical capture/network tests.

Do not casually run `wrangler dev` with processing enabled: AI bindings can perform
remote paid inference during local development.

## Sources

- [Grok STT catalog/schema/pricing](https://developers.cloudflare.com/ai/models/xai/grok-stt/)
- [AI binding and gateway options](https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/)
- [Unified Billing, BYOK precedence, credit fees](https://developers.cloudflare.com/ai-gateway/features/unified-billing/)
- [xAI STT formats and 500 MB upstream limit](https://docs.x.ai/developers/model-capabilities/audio/speech-to-text)
- [R2 API/checksums/conditional writes](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Queue retries](https://developers.cloudflare.com/queues/configuration/batching-retries/)
