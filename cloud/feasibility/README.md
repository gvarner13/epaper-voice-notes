# Whole-file transcription feasibility harness

Milestone 1 only. This is **not** the production upload/transcription pipeline.
No recorder firmware is changed. The isolated harness is deployed and eight real
synthetic inference attempts ran. **The quality gate did not pass:** dense speech
lost expected passages despite successful whole-file transport. See the
[experiment results](../../docs/research/r2-transcription-results.md). Further
inference and production implementation are stopped pending the user's decision.

## Approved scope

The user reports that the selected account already has Workers Paid and active
R2, with existing usage, and approved proceeding despite shared usage. No new
subscription activation is needed or authorized by this harness. The existing
under-$10/month product target remains unchanged; existing account usage means
free allocations cannot be assumed to remain available.

Only the synthetic WAVs whose exact size and SHA-256 are in `src/fixtures.json`
can be ingested. Personal recordings are not eligible. Originals and raw model
results are never automatically removed.

The native Workers AI binding receives the R2 object's `ReadableStream`, with
`audio/wav`, `task: transcribe`, `language: en`, and an explicit VAD setting. No
base64, whole-audio buffer, segmentation, or rewriting stage is used. The JSON
provider response is retained verbatim as evidence; no production Markdown
publication is implemented here.

This harness explicitly submits jobs to a Queue. R2 object-create notifications
are deferred to Milestone 2; the feasibility path exercises the same asynchronous
R2-read → Queue consumer → AI invocation that needs long-file validation.

## Isolation and access

- All resource names in `wrangler.jsonc` are dedicated to this test. Before
  creation/deployment, inspect the selected account for name collisions. If any
  resource already exists, stop rather than modifying somebody else's resource.
- Create a private R2 bucket with public access disabled; do not enable `r2.dev`.
- The Worker fails closed until the `TEST_TOKEN` secret is set. Its authenticated
  API can only ingest approved synthetic files and operate this test ledger.
- `TEST_TOKEN` is a separate random test credential, not a Cloudflare OAuth token.
  Keep it in ignored local settings and Worker secrets, never in source or logs.
- Administrative OAuth credentials stay in Wrangler's encrypted, Keychain-backed
  storage on the computer. They never go into firmware or the Worker.
- The OAuth authorization needed for setup is `account:read`, `user:read`,
  `workers:write`, `workers_scripts:write`, `ai:write`, `queues:write`, plus
  Wrangler's automatic `offline_access`. `workers:write` is the available broad
  Workers OAuth permission used for R2 administration; this is **not** an
  account-scoped device credential. Only operate on the saved selected account
  and named test resources. [OAuth scopes](https://developers.cloudflare.com/workers/wrangler/commands/general/#login)

## Allowance and failure behavior

- `MAX_AUDIO_SECONDS=9180`: **153 audio minutes** across all reserved attempts.
- `MAX_ATTEMPTS_PER_FIXTURE=3`: at most three attempts per allowlisted fixture.
- A SQLite-backed Durable Object reserves allowance atomically **before** Queue
  submission. Queue-submission failures, failed inference, uncertain completion,
  and publication errors retain that reservation conservatively.
- A repeated run ID with the same inputs returns its existing state; different
  inputs conflict. A Queue delivery claims a run once before inference. Duplicate
  deliveries do not automatically start another inference.
- Consumer configuration is one message, one consumer, and **zero retries**.
  An explicit manual attempt must use a new run ID and consumes more allowance.
- A crash can leave `queued` or `running` work uncertain. The ledger retains it;
  do not interpret it as completed or automatically retry it. This deliberate
  test behavior is not the final production retry/recovery mechanism.
- The consumer's 15-minute wall-clock limit still applies. A timeout is evidence
  against the intended runtime, not permission to add chunking.
- Never reset the ledger, change its name/namespace, or raise allowances just to
  evade the test budget. Bounds are application controls, not a billing cap.

At the published gross model rate, 153 minutes is about **$0.0785 inference**.
R2/Queue/Worker/DO operations use existing account allocations or incur overages;
existing shared usage is not known, so do not promise zero metered charges. No
additional fixed Worker subscription is expected because Paid is already active.
Dense-speech fixtures may be added to the allowlist after local generation, but
must fit the same cumulative allowance.

## Public API

Every endpoint requires `Authorization: Bearer <TEST_TOKEN>` and disables caching.

| Method and route | Behavior |
| --- | --- |
| `PUT /fixtures/<name>` | Stream an exact allowlisted WAV. Requires `Content-Type: audio/wav` and exact `Content-Length`. R2 checks the SHA-256 before the upload is accepted. Existing verified originals are not replaced. |
| `POST /runs/<run-id>` | JSON `{ "fixture": "short", "vad_filter": false }`, explicit `Content-Length` between 1 and 1024. Reserve budget and enqueue; return 202. Repeating the same ID/inputs returns existing state without new work. |
| `GET /runs/<run-id>` | Inspect queued/running/complete/failed state and error details. |
| `GET /runs/<run-id>/result` | Return complete raw inference evidence only after successful publication; unfinished runs return 409. |
| `GET /state` | List all runs, model/fixture metadata, and cumulative reserved allowance. |

Run IDs must contain 1–64 lowercase ASCII letters/digits, hyphens, or underscores,
starting with a letter/digit. Fixture names are `short`, `five-minute`,
`fifteen-minute`, `thirty-minute`, `thirty-minute-dense`, and `silence`.

## Confirmed test boundaries

1. **Public authenticated control API and Queue delivery entry point:** local
   runtime tests should check authorization, exact fixture integrity, safe retry
   identity, allowance exhaustion, duplicate delivery, terminal inference errors,
   no-speech results, and result publication. Use local R2/DO storage and replace
   only the external AI boundary. These tests cannot prove actual model duration,
   timeout, memory, or transcription quality.
2. **Real deployed Worker → Workers AI → result evidence:** approved synthetic
   uploads should prove full-file acceptance and coverage, silence behavior,
   output quality, and measured latency/usage in the intended Queue runtime. These
   tests do not prove real-device microphone quality or firmware/network behavior.

The user confirmed these boundaries through the authorization wizard before the
behavioral tests were added. Eight Worker runtime tests pass with real local
R2/SQLite DO storage and mocked external AI. Remote bindings are disabled, so
local tests cannot spend inference allowance. Test files have separate storage;
the local cumulative allowance is 60 seconds to exercise exhaustion without
changing the deployed 153-minute allowance.

## Local checks

```sh
npm ci
npm test
npm run typecheck
npm run check:bundle
```

Run these from `cloud/feasibility`. Do **not** run `wrangler dev` casually: an AI
binding can perform paid remote inference even when the Worker is running locally.

## Remote sequence used for this experiment

1. Verify that the saved account matches the authorized login and granted scopes.
2. Confirm test boundaries; add and pass local behavior tests with fake external
   inference before deployment.
3. Inspect name collisions; create the dedicated private R2 bucket and Queue.
4. Generate a separate random test secret, install it without logging its value,
   and deploy the Worker with this account selected explicitly. No subscription
   checkout or unrelated resource updates.
5. Verify unauthenticated API/object access is rejected before uploading audio.
6. Upload/run the short fixture and review full raw output. Only then progress
   through 5, 15, and 30 minutes, plus silence and dense-speech validation. Do not
   equate HTTP success or ledger `complete` with the feasibility gate passing.
7. Record input hashes, settings, request IDs when returned, output coverage,
   punctuation/repetition, latency, runtime failures, and metering evidence.
8. Stop on a feasibility failure and return to the user. Do not add chunking,
   shorten recorder limits, or proceed to the full pipeline silently.

This sequence has run through the dense-speech failure. **111.5/153 minutes are
reserved**, and no jobs are pending. Keep the existing ledger/namespace and
originals intact. Do not recreate resources or reset the budget for another run.

### Computer probe

`tools/transcription_probe.py` reads the saved deployment URL and test secret from
ignored `.local/` settings. It identifies itself as `VoiceNotesFeasibility/1.0`,
validates local audio against the remote SHA-256/size allowlist before sending it,
streams uploads using trusted TLS, never follows redirects with the credential,
and performs no automatic retries. Result downloads refuse existing/partial
files and use an exclusive atomic publication step.

Read-only inspection from the project root:

```sh
python3 tools/transcription_probe.py state
python3 tools/transcription_probe.py result --run-id dense-thirty-minute-vad-1 \
  --output /tmp/dense-evidence-new.json
```

Upload/run commands exist only for further **explicitly approved** experiments.
This is not the Milestone 4 production computer command. Digital silence with VAD
disabled hallucinated “Thank you.”; VAD enabled returned an explicit no-speech
model result, but did not solve dense-speech omissions.

See [Milestone 1 research](../../docs/research/r2-transcription-feasibility.md) and
[the agreed plan](../../docs/plans/r2-transcription.md).
