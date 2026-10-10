# Grok STT validation and production activation

Executed 2026-10-10 UTC after the user created gateway `epaper-voice-notes` and
confirmed **$20 of AI Gateway credits**. The user requested enabling transcription.

## Decision

**Enable production `xai/grok-stt` processing.** Five synthetic tests passed through
an isolated deployment of the **same production source**, including two complete
57,600,044-byte / 30-minute WAVs. The dense input that failed Whisper preserved all
60 checkpoints and all 4,740 expected normalized tokens in order with Grok.

The production backlog then completed: **nine originals → nine ready Markdown
files**, one inference attempt per recording, 111.424 reserved audio seconds.
Original IDs, filenames, byte lengths, SHA-256s, capture provenance, and upload
timestamps are unchanged. Local atomic downloads to ignored `transcripts/` succeeded;
a second download skipped every existing file. Device USB status reports:

```text
pending=0 uploaded=9 transcripts=9 damaged=0 failed=0 cloud_http=200
```

No new firmware update, recording, billing purchase, subscription change, or
auto-top-up change was performed during activation. User-created credits are not
permission to spend the entire $20; processing remains bounded by the application
allowance. Previous Whisper resources, evidence, and the 111.5/153-minute ledger
remain untouched; those experiments still failed their quality gate.

## Isolation and exact path

Validation configuration: [`wrangler.validation.jsonc`](../../cloud/worker/wrangler.validation.jsonc).
Production source: [`src/index.ts`](../../cloud/worker/src/index.ts).

- Separate Worker, private R2 bucket, Queue, SQLite Durable Object namespace, and
  independent random application secrets under `epaper-grok-validation`.
- Dedicated names were checked for collisions before creation. Existing production
  and Whisper resources were not modified to create the validation harness.
- Validation allowance: **3,960 seconds / 66 minutes**, **one automatic attempt** per
  recording, Queue infrastructure retries disabled. Production stayed paused until
  all synthetic checks passed. Validation is now paused and its evidence retained.
- Only five exact previously approved synthetic fixtures were uploaded, checked
  against [`fixtures.json`](../../cloud/feasibility/src/fixtures.json) by the operator
  and by R2's full-upload SHA-256 validation. No personal audio was used for this gate.
- Authenticated canonical WAV upload → R2 original → durable ledger/outbox → Queue
  claim → `env.AI.run('xai/grok-stt', {url, language:'en', format:true, filler_words:true})`
  → private raw Completed response → private Markdown → ready ledger state.
- Audio URL is a short-lived, attempt-scoped HMAC capability. xAI fetched each complete
  private original. No base64, whole-audio application buffer, segmentation, rewriting,
  summary, or alternate model was used. Gateway calls skip caching and collect no logs.
- Existing computer OAuth permissions still return HTTP 403 for gateway management.
  The successful binding calls prove this configured inference route works; they do
  not independently audit all account/gateway logging or billing settings.

The validation Markdown's private-reference metadata uses the production renderer's
fixed `epaper-voice-notes` bucket label. The actual validation originals are in
`epaper-grok-validation/audio/<validation-id>.wav`; this staging-only metadata caveat
was not used for audio retrieval or the coverage score. Production references correctly
name the production bucket. The original downloaded validation artifacts are retained.

## Coverage results

| Synthetic fixture | Duration | Known tokens preserved | Checkpoints | Last returned word end |
| --- | ---: | ---: | ---: | ---: |
| Short speech | 30 s | 44/44 | 1/1 in order | 12.628 s |
| Silence (all-zero PCM) | 30 s | Empty model text | None expected | None |
| Intermittent speech | 300 s | 434/434 | 10/10 in order | 285.031 s |
| Intermittent speech | 1,800 s | 2,610/2,610 | 60/60 in order | 1,785.655 s |
| Dense speech (96.61% speech-block fraction) | 1,800 s | 4,740/4,740 | 60/60 in order | 1,798.860 s |

Every provider duration matched the independently known WAV duration. Coverage was
**not** inferred from duration, HTTP success, or the final timestamp: complete text
was compared against every known stimulus passage, including repeated adjacent topics.

The comparison normalizes only case/punctuation, checkpoint-number spelling versus
digits, `seconds` versus `s`, and `first` versus `1st` (the model's number formatting).
It does not delete, reorder, summarize, or forgive missing substantive words. The
complete normalized token streams match, not merely word totals/checkpoint labels.
The normalizer's regression tests reject omitted/reordered/repeated passages,
changed numeric values, rewritten words, and polite hallucinations for silence.

Grok produced useful punctuation but no paragraph breaks for the long synthetic
samples. The Markdown publisher preserves provider text without a rewriting stage;
paragraph editing is still manual. The observed empty silence result is not proof
that the model will never hallucinate or that an empty personal result means no speech.

## Usage and limits

- Validation: **5 attempts, exactly 66 reserved minutes**, no inference retries.
- At the catalog's **$0.001667/audio-minute** rate, gross validation inference estimate:
  **$0.110022**. Production backlog estimate: **$0.00309573**. Combined ≈ **$0.1131**,
  excluding storage/operations, credit-purchase fees, taxes, and unrelated account use.
- The raw responses do not report a usable final credit debit; these are estimates,
  **not an invoice or a measured account balance**. The user reported $20 available.
  Unified Billing credit purchases carry a 5% fee.
- Production remains capped at **600 reserved audio minutes per UTC month**, including
  retry reservations. That is roughly $1.0002 gross inference at this rate, not a
  guaranteed account/provider spending cap. Validation has its own exhausted cap.
- The URL route avoided the documented **25 MB gateway `file` limit**. xAI documents
  a 500 MB upstream limit; successful 57.6 MB tests do not establish performance or
  quality for every file below that limit. Application upload ceiling remains 96 MB
  (50 minutes of device-format audio), not a recording cutoff or a proven quality limit.
- Peak Worker memory/CPU and worst-case latency were not instrumented. Queue execution
  completed successfully for these samples; no general concurrency/timeout guarantee
  is implied. A new 15-minute Grok fixture was not run in this bounded experiment.

## Reproduction and retained evidence

- `tools/grok_validation.py`: exact-synthetic-only streaming operator; one persisted
  run ID per fixture; no automatic upload/inference retries. Settings/paths/IDs are
  in ignored permission-600 `.local/grok-validation.json`, secrets separately ignored.
- `tools/grok_coverage.py`: full normalized stimulus comparison against the preserved
  generator manifests and private raw responses. Tests in `tools/test_grok_coverage.py`.
- `.local/grok-validation-results/`: raw JSON, original Markdown, and `coverage.json`.
  `.local/grok-validation-final-state.json`: completed ledger/reservation snapshot.
- Private validation R2: `audio/<id>.wav`, `results/<id>.json`, `transcripts/<id>.md`.
- `.local/production-before-enable.json` and `.local/production-after-enable.json`:
  metadata snapshots, not transcript contents in source control. Production raw JSON
  and canonical Markdown remain private in the production R2 bucket.
- Both production and validation bundle configurations are checked by `npm run check:bundle`.
  Unit/runtime checks use mocked AI and cannot spend remote inference credits.

Do not reset either validation or Whisper ledgers, automatically re-run these paid
tests, enable validation processing, or increase allowances without explicit approval.

## Remaining physical/quality checks

The user confirmed screen appearance and physical BOOT recording. Their 10.368-second
network-active spoken note is ready with a `speech` model outcome. The user still
needs to compare it with what they actually said; no synthetic test proves universal
microphone fidelity. Power-button/battery shutdown, network-loss/reboot recovery,
SD-full behavior, and the observed USB `FILE_END` acknowledgment timeout remain
separate follow-up tests. No original audio was observed to be corrupted.

Sources: [Grok catalog/schema/pricing](https://developers.cloudflare.com/ai/models/xai/grok-stt/),
[AI binding/gateway options](https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/),
[Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/).
