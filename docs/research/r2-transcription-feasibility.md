# R2 transcription — Milestone 1 preflight

Checked 2026-10-10 UTC against current first-party documentation. Scope: [implementation plan](../plans/r2-transcription.md).

## Decision so far

**Milestone 1 did not pass its quality gate.** The isolated Cloudflare test accepted complete 30-minute WAVs, but dense speech lost expected passages and checkpoint labels. Eight synthetic inference attempts ran; no personal recording was sent. Firmware and paid subscriptions are unchanged. Further inference and production implementation are stopped pending the user's decision.

See [the full experiment results](r2-transcription-results.md) for evidence, latency/usage, silence hallucination, VAD tests, and the dense-speech failure.

Login and account selection are verified. The user reports Workers Paid and active R2 with existing account usage, and explicitly approved proceeding with the feasibility test despite shared usage/cost uncertainty. These subscription states are user-reported, not API-verified; free allocations cannot be assumed available. No new subscription activation is required or authorized. The under-$10/month product target remains unchanged.

The isolated [`cloud/feasibility`](../../cloud/feasibility/README.md) harness is implemented and deployed after the user confirmed its behavioral test boundaries and granted setup/inference OAuth authorization. Eight Worker behavior tests, nine fixture tests, TypeScript checking, and the dry-run bundle pass. HTTP success and full-duration metadata did not establish complete output; the dense-speech experiment demonstrates why the coverage gate is necessary.

## Local tooling and account access

- Initial preflight found no Cloudflare configuration or JavaScript package manifest. The isolated harness now has its own configuration, package manifest, and lockfile under `cloud/feasibility`; firmware tooling is unchanged.
- Neither `cf` nor `wrangler` is on PATH. Initial inspection found cached Wrangler **4.37.0**. Login/inspection and the harness now pin **4.149.0**; the harness also pins TypeScript **7.0.2**. No global installation was added.
- Node/npm, macOS `say`, ffmpeg, and ffprobe are available.
- No `CLOUDFLARE_*`, `CF_*`, or `WRANGLER_*` environment variables are set.
- Initial read-only inspection found expired OAuth credentials. The user subsequently completed a local browser-login/account-selection wizard. Current `wrangler whoami --json` succeeds, reports OAuth authentication, and confirms the saved account is accessible.
- Initial scopes were read-only. Following explicit approval, current OAuth scopes are **`account:read`, `user:read`, `workers:write`, `workers_scripts:write`, `ai:write`, `queues:write`, and `offline_access`**. Administrative credentials remain encrypted/Keychain-backed and were not printed or saved in project files. Ignored `.local/cloudflare.env` holds account selection and non-secret authorization metadata; the separate random Worker test secret is in ignored mode-0600 `.local/feasibility-secrets.json` and Worker secrets.
- Workers Paid and R2 activation are **user-confirmed**. Exact shared allowance consumption and account-specific metering remain unverified; the user approved proceeding despite that uncertainty. Do not ask the user to paste credentials into chat.

These are local observations, not provider guarantees.

### Historical read-only account inspection (before expanded authorization)

Using the OAuth credential only in process memory, performed two authenticated **GET** requests against the selected account:

| Inspection | Result | Interpretation |
| --- | --- | --- |
| `/accounts/{account_id}/subscriptions` | HTTP **403**, code **10000**, “Authentication error” | Subscription inspection is denied; this is not evidence that subscriptions are absent. [First-party SDK endpoint](https://github.com/cloudflare/cloudflare-typescript/blob/main/src/resources/accounts/subscriptions/subscriptions.ts) |
| `/accounts/{account_id}/workers/account-settings` | HTTP **401**, code **10023**, “You do not have access to this feature. Please ensure it is enabled.” | Workers settings are unavailable; do not infer a Free/Paid plan or activate anything from this error alone. [API reference](https://developers.cloudflare.com/api/resources/workers/subresources/account_settings/methods/get/) |

At this initial read-only stage, no R2 object or bucket listing was attempted: the documented endpoint requires Workers R2 Storage Read/Write permission, which those scopes did not grant. [R2 API permissions](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/list/)

User dashboard confirmation was preferred over broad write permission escalation solely for billing inspection. No checkout, subscription changes, deployment, or inference occurred at that stage. After the user approved the experiment, expanded setup/inference authorization allowed resource metadata inspection and isolated test deployment; unrelated resources were not changed.

## Verified provider constraints

| Constraint | Evidence and consequence |
| --- | --- |
| Selected model | `@cf/openai/whisper-large-v3-turbo` is Cloudflare-hosted ASR, with transcription and English language selection. [Model](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/) |
| Input representation | Schema accepts base64 or an object containing `body` and `contentType`; no duration or byte-size maximum is stated. [Input schema](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/schema-input.json) |
| Streaming binding | Cloudflare's current workerd source handles `{ body: ReadableStream, contentType }` by forwarding the stream directly as the request body and placing remaining model parameters in query metadata. It explicitly rejects AI Gateway with this stream path. This supports trying the native AI binding without Gateway, but does not prove backend acceptance of long WAVs. [First-party source, `Ai.#generateStreamFetch`](https://github.com/cloudflare/workerd/blob/main/src/cloudflare/internal/ai-api.ts) |
| Worker memory | **128 MB per isolate**, shared across concurrent invocations, on both Free and Paid. A paid upgrade does not increase it. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/#memory) |
| Incoming upload size | Free/Pro Cloudflare account plans have a **100 MB** request-body limit, independent of Workers subscription. The 57.6 MB target is below it; this is not the AI endpoint's own input limit. [Request limits](https://developers.cloudflare.com/workers/platform/limits/#request-and-response-limits) |
| Worker CPU | Free: **10 ms** per HTTP invocation. Paid: **30 seconds default**, configurable to **5 minutes**. Network/inference waiting is not CPU time. Measure upload validation CPU before assuming Free is usable. [CPU limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time) |
| Queue consumer | **15 minutes wall time** per invocation. Queue limits document 30 seconds default CPU, configurable to 5 minutes. Workers pricing describes a different queue CPU maximum; use the conservative Queue-specific limit until clarified. [Queue limits](https://developers.cloudflare.com/queues/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/#workers) |
| HTTP lifetime | No hard duration limit while the client stays connected, but `waitUntil()` provides only **30 seconds** after response/disconnect. An HTTP-only test is not proof that the intended Queue path works after device power-off. [Duration](https://developers.cloudflare.com/workers/platform/limits/#duration) |
| Queue payload | **128 KB** maximum, so enqueue object keys/metadata, not WAV bytes. Free retention is only **24 hours**; Paid defaults to 4 days, configurable to 14. Neither is durable failure retention by itself. [Queue limits](https://developers.cloudflare.com/queues/platform/limits/), [Queue pricing](https://developers.cloudflare.com/queues/platform/pricing/) |
| ASR request rate | **720 requests/minute**; not an audio-duration constraint. [Workers AI limits](https://developers.cloudflare.com/workers-ai/platform/limits/) |

### Memory arithmetic

A canonical mono, 16 kHz, 16-bit PCM WAV with a 44-byte header contains:

| Duration | WAV bytes | Base64 bytes |
| --- | ---: | ---: |
| 30 seconds | 960,044 | 1,280,060 |
| 5 minutes | 9,600,044 | 12,800,060 |
| 15 minutes | 28,800,044 | 38,400,060 |
| 30 minutes | 57,600,044 | 76,800,060 |

For 30 minutes, raw bytes plus one base64 representation already total **134,400,104 bytes**, approximately **128.17 MiB**, before JSON serialization, extra copies, and other isolate work. String encoding and runtime allocation can increase this further. Avoid `arrayBuffer()`, base64 conversion, and numeric audio arrays in the proposed Worker path.

Streamed request representation exercised in the remote tests (transport accepted; quality gate not passed):

```js
const result = await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
  audio: { body: audioObject.body, contentType: "audio/wav" },
  task: "transcribe",
  language: "en",
});
```

Start with one message per invocation and one consumer at a time. Measure latency against the 15-minute Queue wall limit. No documented model-specific maximum input size/duration or inference timeout was established by the retrieved model, schema, AI limits, or binding documents. These remain test gates, not unlimited allowances.

## Pricing and activation requirements

All figures are USD, exclude tax, assume published non-Enterprise pricing, and are **not an account-specific quote**. Included allocations may already be consumed by other projects.

| Service | Included allocation and cost | Activation considerations |
| --- | --- | --- |
| Workers | Free: 100,000 requests/day, very small CPU budget. Paid: **$5/month account minimum**, 10 million requests and 30 million CPU ms/month; excess $0.30/million requests and $0.02/million CPU ms. [Pricing](https://developers.cloudflare.com/workers/platform/pricing/#workers) | Verify current plan. Do not upgrade without approval. |
| Workers AI | 10,000 Neurons/day included on Free or Paid; paid excess **$0.011/1,000 Neurons**. Turbo: **46.63 Neurons/audio minute**. Its model page lists **$0.000513/audio minute**; the main pricing table rounds to $0.0005. Use $0.000513 for estimates. [AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [model](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/) | Turbo is not listed among models requiring paid billing. Free inference stops at the allowance; exceeding it requires Workers Paid. |
| R2 Standard | **10 GB-month**, 1 million Class A and 10 million Class B operations/month included; then **$0.015/GB-month**, $4.50/million A, $0.36/million B. No Standard retrieval fee or direct R2 egress charge. Billing rounds upward to GB-month/million-operation units. [Pricing](https://developers.cloudflare.com/r2/pricing/) | Requires an **R2 subscription checkout**, even to use included usage. Verify whether already active; activation needs approval. [Get started](https://developers.cloudflare.com/r2/get-started/) |
| Queues | Free: 10,000 operations/day. Paid: 1 million/month, then **$0.40/million operations**. Small successful messages normally incur write/read/delete = 3 operations; retries add reads. Consumer execution also uses Workers. [Pricing](https://developers.cloudflare.com/queues/platform/pricing/) | Available on Free and Paid; no separate fixed Queue subscription listed. |
| Durable metadata, later | Mechanism not selected. D1 on Paid includes 5 GB, 25 billion rows read and 50 million rows written/month. SQLite Durable Objects have storage/row allowances and separately metered request/duration usage. [D1 and Durable Objects pricing](https://developers.cloudflare.com/workers/platform/pricing/) | Do not deploy durable metadata yet. Recompute the estimate after selection; do not claim it is intrinsically free. |
| Observability | Workers Paid includes 20 million log events/month; excess $0.60/million. [Logs pricing](https://developers.cloudflare.com/workers/platform/pricing/#workers-logs) | Avoid audio/transcript/credential logging and unnecessary paid log export. |

### Small feasibility test

One run of 30-second, 5-, 15-, and 30-minute speech fixtures plus 30-second silence is **51 audio minutes**, approximately **2,378 Neurons**, or **$0.0262 gross inference cost** before free allocations. Three total attempts per fixture would be **153 minutes**, approximately **7,134 Neurons**, or **$0.0785 gross**.

The complete set occupies **97,920,220 bytes** (about 0.098 GB); minimal upload/read/result and Queue operations fit included allocations if available. A proposed test allowance is **153 submitted audio minutes maximum**, with no automatic retries and no uploads of personal recordings. This is a proposed application allowance, not a provider billing cap. Confirm how failed calls are metered during the test.

- On an eligible Free account with unused allowances, the test may have **$0 metered usage**, but runtime suitability is unproven and R2 still requires subscription activation.
- If Workers Paid is needed and not active, budget the **$5 monthly subscription**, not just pennies of inference. Existing plan status is unknown.

### Illustrative ongoing usage — not a user-selected allowance

Assume **1 hour/day, 30 hours/month**, at most 600 recordings/month, no existing archive, at most 10,000 Worker invocations/month, 30 million CPU ms/month, 10,000 Queue operations/month, 10,000 R2 Class A and 100,000 Class B operations/month, and logging/state within their included allocations.

- Audio adds **3.456 GB/month** at 1.92 MB/minute. Transcripts/state add a small but nonzero amount; reserve **0.1 GB/month** for those in this example.
- Inference at the gross unit rate is **$0.9234/month**. Even daily distribution uses only about 2,798 Neurons/day, so AI would be **$0 billed** if the daily free allowance is otherwise unused. A concentrated backlog or retries can change this.
- On Workers Paid, month one is approximately **$5** with available allocations, or **$5.93** if reserving the full gross inference amount.
- After 12 months with no deletion, end-of-month archive size is approximately **42.672 GB**. Using that larger end size for the entire month's storage is conservative: 33 billable GB after rounding and the free tier = **$0.495/month**. Total approximately **$5.50**, or **$6.42** including gross inference.
- Worker/Queue/R2 operation overages, other account usage, metadata choices, and tax must be added if applicable. The above CPU allowance is an assumption to measure, not a prediction.

**Indefinite original retention means storage grows indefinitely.** The under-$10 goal is not a permanent guarantee, even when inference is paused. Report archive growth and re-estimate periodically; do not solve budget pressure by silently deleting originals.

## Local fixtures and verification

Added:

- `tools/transcription_fixtures.py`: uses macOS `say` and ffmpeg locally; creates a new directory only, produces complete device-format WAVs, SHA-256 hashes, and a manifest with expected speech and per-slot timestamps. It never accesses cloud APIs or personal recordings.
- `tools/test_transcription_fixtures.py`: nine automated tests covering exact format/duration, padding, distinct markers, silence, no overwrite, invalid/oversized synthesis, cache behavior, and no completed manifest after generation failure.

Run:

```sh
python3 -m unittest discover -s tools -p 'test_*.py' -v
python3 tools/transcription_fixtures.py --output /tmp/voice-note-feasibility-fixtures
```

The output directory must not already exist. A failed generation can leave incomplete diagnostic files; do not use a directory without a completed `manifest.json`.

Verification performed:

- **9 tests passed**.
- Generated all five actual fixtures locally in `/tmp/epaper-transcription.8XTHUA/fixtures` and parsed their WAV headers/frame counts successfully. Temporary files may disappear; the script reproduces them.
- The 30-minute file is exactly **57,600,044 bytes**, with **60** distinct numbered checkpoints, including near the beginning, middle, and end.
- Current synthetic speech occupies roughly 12.75–16.09 seconds of each 30-second slot, with silence padding. This deliberate intermittent input can expose silence hallucinations, but does **not** establish dense-speech output limits or real-device intelligibility. Add dense synthetic speech and approved real-device samples before declaring the complete quality gate passed.
- Subsequent remote tests, the dense generator, computer probe, and returned usage evidence are documented in [the experiment results](r2-transcription-results.md). Peak memory/CPU and invoice charges were not instrumented; successful execution is not a measured peak or a permanent billing guarantee.

## Execution sequence and outcome

1. **Login/account selection completed.** The user reports Workers Paid and active R2, acknowledges existing usage, and approved proceeding; no further billing permission escalation is needed just to inspect costs.
2. **Authorization/test boundaries confirmed.** Computer-only setup/inference permissions were granted; the 153-minute allowance, synthetic-only uploads, unchanged firmware, and no new subscriptions were retained.
3. **Local checks passed and isolated resources deployed.** Name collisions were inspected first. Remote bindings are disabled for local behavior tests. Do not use `wrangler dev` inference casually: local-mode AI requests count toward real limits. [AI limits](https://developers.cloudflare.com/workers-ai/platform/limits/)
4. **Short → 5 → 15 → 30-minute progression completed.** All intermittent checkpoints were present. VAD disabled hallucinated text on digital silence; VAD enabled returned an empty no-speech model result and preserved the intermittent 30-minute checkpoints.
5. **Dense-speech test completed; coverage/quality failed.** Eight checkpoint labels and substantive passages were missing despite complete-duration metadata and final speech coverage. No real-device recording was uploaded; any such upload still needs explicit approval.
6. **Stopped and returned to the user.** 111.5/153 minutes were reserved. Keep private originals/results and the ledger intact. Choose the next investigation or scope change explicitly before further inference or full-pipeline implementation.
