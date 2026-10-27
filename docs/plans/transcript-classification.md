# Transcript classification

## Agreed behavior

Use `@cf/cloudflare/clef` after successful speech-to-text to classify each recording
as `note` or `task`. A task contains a clear intended action, commitment, or reminder,
not merely a mention of an activity. Mixed observations and intended actions are
`task`. Otherwise choose `note`. Keep one label per recording: no extraction,
summarization, rewriting, generated titles, editing, or filtering.

Choose the higher of the two probabilities; exact ties are `note`. Store both model
probabilities, not an assertion of calibrated accuracy. Treat the transcript as
untrusted data, never classifier instructions.

Expose classification in recording API metadata, canonical Markdown downloads, and
the reader's Recording details. Preserve the faithful transcript text. Existing
ready recordings remain unclassified; no automatic historical backfill or changes
to downloaded local files. Any future backfill must reuse transcripts, not rerun STT.

## Implementation

- `cloud/worker/src/classification.ts`: Clef choice schema, conservative input guard,
  response validation, safe errors, and native AI binding inference. The model is
  Cloudflare-hosted, separate from the existing Grok STT gateway.
- `cloud/worker/src/ledger.ts`: independent durable classification claims and
  completion, separate from audio attempts/reservations. New speech transcripts
  become `pending`; empty transcripts become `not-applicable` with zero Clef calls.
- Queue delivery attempts classification after transcript publication. Cron recovers
  pending jobs and lost delivery windows. `PROCESSING_ENABLED=false` stops new
  classification claims as well as new STT claims, not already-running requests.
- Only transient HTTP 429/5xx and transport/storage failures retry, after one and two
  minutes, up to three classification attempts. Malformed responses, other HTTP
  failures, and oversized inputs fail without an invented label. A crashed claim
  expires after 20 minutes and becomes failed for inspection, not automatic rebilling.
  Stale completion is ignored. Exactly-once provider billing is not guaranteed.
- Classification failure never changes transcript `state: ready`, blocks download,
  restarts STT, or reserves more audio seconds. The existing `/retry` endpoint is for
  transcription failures; no manual classifier retry/edit/backfill endpoint is added.

### Metadata and publication

The durable ledger is the single source of truth for classification. `GET
/recordings/<id>/transcript` projects the current classification snapshot into the
stored Markdown frontmatter, preserving the transcript body byte-for-byte. The R2
Markdown remains the base transcript; direct R2 reads do **not** include this dynamic
classification metadata. This avoids an inconsistent two-resource write or making
transcript availability depend on classifier publication. Download through the
existing authenticated API/CLI/reader to receive the canonical enriched Markdown.
Historical Markdown without a classification job is returned unchanged. Downloads are
snapshots: a file downloaded while classification is pending remains pending locally.
The existing CLI still skips existing files; it never silently replaces that snapshot
when classification completes. Refresh/re-download explicitly when needed.

Fields: `classification_status` (`pending`, `complete`, `failed`, `not-applicable`),
`classification` (`note`, `task`, or unset), `classification_model`,
`classification_probabilities` (`note`, `task`), `classification_input_tokens`,
`classification_attempts`, and `classification_error`. Markdown uses explicit nulls
for unset values. The existing `model` field still identifies speech-to-text.
Errors are application-controlled; model/provider bodies and transcripts are not
logged. Reading metadata or Markdown never triggers inference.

### Context and cost

Clef documents a 65,536-token context and automatic truncation of long text state.
Admission is conservatively capped at **57,344 UTF-8 bytes** of complete transcript:
at most one token per byte plus an 8,192-token reserve for the fixed question and
model framing. This is deliberately much stricter than an average chars/4 estimate
and can reject transcripts that would actually fit. No truncation or chunking is
performed. The complete transcript remains available when classification is refused.
Live model/tokenizer verification remains part of the approval-gated quality check.

Published Clef pricing: **$0.24 per million input tokens**, no output-token charge.
For example, 10,000 input tokens cost about $0.0024 per successful call, before any
other platform/account charges. Classification is token-billed, **not covered by the
existing monthly audio-seconds reservation cap**. Retries can incur additional
charges; stored successful-call token usage is not a complete billing ledger for
failed or interrupted calls. No new paid subscription, hard account spend cap,
auto-top-up, or billing setting is configured.

## Validation and rollout

Local checks passed: `npm test`, `npm run typecheck`, `npm run check:bundle` (dry-run
Worker bundles and web credential-boundary build check), and `git diff --check`.
Tests cover classification schemas/probabilities/ties, exact input preservation,
UTF-8 size limits, concurrent/duplicate delivery, API/Markdown metadata, transcript
availability during failures, backoff/exhaustion, safe errors, malformed responses,
Cron recovery, paused processing, no-speech skipping, historical opt-out, expired
leases, stale completion, and unchanged STT usage. Reader tests validate metadata
and all classification labels. A local browser smoke check with synthetic data
confirmed Note, Task, probabilities/model, and no-speech details with no page errors.

All AI inference in local tests is mocked and remote bindings are disabled. These
checks establish application behavior, **not real Clef classification quality**.
No deployment, paid inference, historical backfill, or local transcript overwrite
was performed. Deployment and a bounded live quality/cost check require separate
user approval; include positive/negative/mixed examples, ambiguous intent, quoted
instructions, silence, and context-boundary cases before enabling production use.
No firmware change is needed.

## First-party sources

- [Clef model/schema/context/pricing](https://developers.cloudflare.com/workers-ai/models/clef/index.md)
- [Input schema](https://developers.cloudflare.com/workers-ai/models/clef/schema-input.json)
- [Output schema](https://developers.cloudflare.com/workers-ai/models/clef/schema-output.json)
- [Durable storage transactions](https://developers.cloudflare.com/durable-objects/api/legacy-kv-storage-api/index.md#transaction)
