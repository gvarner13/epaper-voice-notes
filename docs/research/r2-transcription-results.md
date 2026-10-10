# Whole-file transcription experiment results

Executed 2026-10-10 UTC. Scope: [Milestone 1](../plans/r2-transcription.md).
Harness: [`cloud/feasibility`](../../cloud/feasibility/README.md).

## Decision

**Milestone 1 has NOT passed. Stop before the production pipeline or firmware changes.**

The Cloudflare storage/runtime path accepts a complete **57,600,044-byte,
30-minute WAV** and returns speech from its beginning, middle, and end. But the
dense-speech test omitted expected spoken material despite reporting success and
the full input duration. That does not meet the faithful, complete, usable-output
requirement. No chunking, shorter supported duration, or alternate provider/model
has been silently adopted.

Return to the user to choose further model investigation, another Cloudflare-hosted
option, chunked transcription, or testing a shorter supported transcription
length. A shorter transcription limit would not be a recording cutoff or permission
to discard originals, and it has not yet been established by these tests.

## Authorization and isolation

- The user reported Workers Paid and active R2 with existing account usage, and
  approved proceeding despite shared-usage/cost uncertainty. No paid subscription
  was activated or changed.
- The user completed the computer-only OAuth authorization and confirmed the
  public control API/Queue test boundary and the real Worker/AI evidence boundary.
- Inspected the selected account's existing Worker, R2, and Queue metadata before
  creation. No dedicated test-resource name collided with existing resources.
- Created only a Worker, private R2 bucket, Queue, and SQLite Durable Object test
  ledger under the dedicated name `epaper-transcription-feasibility-20261010`.
- A separate random Worker test secret is in ignored local settings and Worker
  secrets. Administrative OAuth credentials remain Keychain-backed on the computer.
  No credential values were printed or embedded in source/firmware.
- Unauthenticated control API requests returned **401** with the probe's user-agent.
  R2 managed public access is disabled and its public URL returned **401**. No
  custom public domain or object-public access was configured.
- Only allowlisted **synthetic** WAVs were sent. Existing device/test recordings
  were not uploaded. Firmware is unchanged.

## Actual execution path

```text
Authenticated, checksum-checked whole-WAV upload
  -> private R2 original
  -> explicit authenticated job submission
  -> Queue consumer (one message / one consumer / zero retries)
  -> R2 ReadableStream passed to native Workers AI binding
  -> private raw JSON result
  -> durable ledger marks published evidence complete
```

There was no base64 conversion, application-side transcription segmentation, or
rewriting stage. R2 object-create notifications remain deferred to Milestone 2.
A harness run marked `complete` means evidence was published, **not** that its
transcript passed quality/coverage checks.

Model: `@cf/openai/whisper-large-v3-turbo`. Explicit parameters:
`task: transcribe`, `language: en`, and the VAD value below. Other parameters
retained provider defaults. Raw responses, including word/segment timings and
returned usage, were preserved.

## Results

Latency is measured from the consumer's claimed run through R2 read/inference
response parsing, **before** result publication; it is not just GPU inference
latency or the total upload-to-publication time.

| Input | VAD | Processing seconds | Result |
| --- | --- | ---: | --- |
| 30-second speech | off | 2.461 | Complete checkpoint/text; useful punctuation. |
| 5-minute intermittent speech | off | 10.584 | All 10 checkpoints in order; final speech through 284.96 s. |
| 15-minute intermittent speech | off | 21.659 | All 30 checkpoints in order; final speech through 884.98 s. |
| 30-minute intermittent speech | off | 48.699 | All 60 checkpoints in order; final speech through 1785.66 s. |
| 30-second digital silence | off | 2.295 | **Hallucinated “Thank you.”**, two words, despite zero audio samples. |
| 30-second digital silence | on | 0.920 | Empty text/segments; explicit `no-speech-model-result`. |
| 30-minute intermittent speech | on | 71.640 | All 60 checkpoints in order; provider duration 1800 s, post-VAD duration 925.84 s. |
| 30-minute dense speech | on | 87.860 | Reaches final speech at 1798.72 s, but **missing 8 checkpoint labels and multiple expected passages**. |

Intermittent fixtures contain about 12.75–16.09 seconds of speech per 30-second
slot. Dense construction contains two known topics per slot and uses local
ffmpeg `atempo` to fit approximately 29 seconds of speech into each slot without
truncating words. The resulting speech-block fraction is **96.61%**. Both formats
are mono, 16 kHz, signed 16-bit PCM with complete canonical WAV headers.

### Dense coverage failure

Dense fixture SHA-256:
`c14f4c4fd6c1e64bcbcfa55875bcd1e6426cdb68e4332a4495e70333efbfb021`.

- Gold text has **4,740 whitespace-delimited words**; returned text has **4,493**.
  Word-count difference alone is not proof of omitted speech; comparison against
  the known stimulus identifies the missing passages below.
- After normalizing written/spelled checkpoint numbers, labels **8, 15, 23, 30,
  38, 46, 55, and 60** are absent. This is not merely a digits-versus-words parsing
  problem: all spelling variants from one through sixty were checked.
- Missing material includes the reading-group passage around checkpoint 23 and
  again around checkpoint 55; other omissions include sentences about the river
  route, water pipes, testing a project, and stopping for coffee.
- The final 1770-second elapsed-time statement and final topics are present.
  This is **not simple tail truncation**: holes occur within the transcription.
- The first several minutes are mostly lowercase and unpunctuated. Later text has
  useful punctuation, but neither intermittent nor dense output contains paragraph
  breaks. Deterministic paragraph formatting can improve layout; it cannot recover
  omitted words or safely repair missing punctuation without additional assumptions.
- The provider still reports `duration: 1800` and `duration_after_vad: 1800`.
  Those metadata fields, HTTP success, and an end timestamp are insufficient
  completeness checks.

The dense fixture deliberately repeats known topics, including adjacent repeated
passages. It is synthetic/time-adjusted, not a real-microphone recording. These
facts limit generalization to ordinary voice notes, but they do not justify
silently deleting spoken repetitions or ignoring the observed omissions. No
claim is made that every recording of this duration will fail, nor that another
parameter setting or model cannot succeed.

### Silence behavior

VAD solved the observed all-zero silence hallucination in one test and preserved
all checkpoints in the intermittent 30-minute test. It did **not** make the dense
transcript complete. Do not claim that an empty model response proves the audio
contains no speech, or use VAD to hide the baseline hallucination evidence.

## Runtime and usage

- Complete 30-minute originals were accepted through the intended Worker/R2/AI
  stream representation. No Worker memory-limit or timeout error was observed.
- Peak memory and per-invocation CPU were **not instrumented**. Successful execution
  is evidence of feasibility under the deployed runtime's limits, not a measured
  peak or a concurrency guarantee. The Queue was deliberately limited to one
  consumer and one message; paid Workers still have the documented 128 MB isolate
  limit. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- The longest measured processing latency was **87.860 seconds**, below the
  documented **15-minute Queue wall limit**. No timeout failure was induced and
  no claim is made about worst-case provider latency. [Queue limits](https://developers.cloudflare.com/queues/platform/limits/)
- **8 inference attempts, 111.5 reserved audio minutes**, within the approved
  **153-minute** allowance. **41.5 minutes remain**, but further inference was
  stopped pending the user's decision. No automatic retries ran.
- Provider responses report **5,199.271504 Neurons** total. At the published
  $0.011/1,000 Neurons rate this is approximately **$0.0572 gross AI usage**, before
  shared daily free allocation and excluding other services/tax. This is **not an
  invoice or the complete account charge**. The VAD-enabled silence call still
  reported usage for its original 30 seconds. [AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- Original fixture audio in R2 totals **155,520,264 bytes**, about 0.156 GB, plus raw
  JSON results and small durable state. Existing shared storage/operation allowances
  were not assumed free. Normal R2/Queue/Worker/DO account usage charges apply.

## Local behavior checks and operational findings

**8 Worker runtime tests pass**, using real local R2/SQLite DO storage, explicit
Queue-handler delivery, and mocked external inference with remote bindings
explicitly disabled. Covered authorization/fail-closed setup, upload integrity,
result publication, request/Queue deduplication, concurrent allowance reservation,
no-speech model results, inference/storage failures, and Queue submission failure.
The integrity test exposed and fixed checksum errors being classified as HTTP 500
instead of invalid-input HTTP 422.

**9 existing fixture tests pass.** TypeScript checks include tests/configuration,
and the Wrangler dry-run bundle passes.

The default Python urllib user-agent received Cloudflare error **1010**, before
reaching the Worker. Changing only the probe's user-agent to
`VoiceNotesFeasibility/1.0` restored the expected 401/authorized behavior. Account
security policies were not relaxed. A post-deployment allowlist check also avoided
uploading the dense fixture before the new Worker version had propagated.

## Evidence and reproduction

- Intermittent fixture generator: `tools/transcription_fixtures.py`.
- Dense fixture generator: `tools/transcription_dense_fixture.py`.
- Streaming, no-retry test operator: `tools/transcription_probe.py`.
- Exact approved audio metadata: `cloud/feasibility/src/fixtures.json`.
- Local fixture manifests during this run: `/tmp/epaper-transcription.8XTHUA/fixtures/manifest.json`
  and `/tmp/epaper-dense.hcxiig/fixtures/manifest.json`. Temporary local audio may
  disappear, but private R2 originals are retained; the generators preserve the
  known-text construction, while TTS output hashes can vary across systems.
- Raw downloaded responses and final state are in ignored `.local/feasibility-results/`
  and `.local/feasibility-final-state.json`; private R2 `results/<run-id>.json`
  contains the complete original evidence response for each run.
- Dense response request ID: `00a63866-4825-4942-aa03-d92e91d2ecef`.
  VAD-enabled intermittent 30-minute request ID: `833dd987-7660-41ff-be5a-cb561fdb21ab`.
- Run IDs are the filenames in `.local/feasibility-results/` without `.json`, except
  `summary.json`, which is a local aggregate, not an inference result.

The private test resources and evidence remain intact and idle. No original or
result has been automatically deleted. Do not reset the ledger or deploy the
production pipeline while treating these results as a passing gate.
