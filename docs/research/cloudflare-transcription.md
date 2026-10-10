# Cloudflare transcription: initial feasibility

Research for the voice-note design discussion; not an approved architecture.

## Verified capabilities

- Workers AI offers Cloudflare-hosted `@cf/openai/whisper-large-v3-turbo` for speech recognition. The listed unit price is $0.000513 per audio minute (about $0.03078 per hour), excluding other services and any applicable allowances. It supports transcription, language selection, and voice activity detection. [Model documentation](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/)
- The input schema accepts base64 audio or an audio object with `body` and `contentType`. It does not specify a maximum audio duration or size. This is not evidence of unlimited input. [Input schema](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/schema-input.json)
- R2 object-create events can trigger Cloudflare Queues, consumed by a Worker. Prefix/suffix filters allow triggering on recordings without triggering on transcript outputs. [R2 event notifications](https://developers.cloudflare.com/r2/buckets/event-notifications/)
- The documented default speech-recognition rate limit is 720 requests per minute. This is a request-rate limit, not an audio-duration limit. [Workers AI limits](https://developers.cloudflare.com/workers-ai/platform/limits/)
- Cloudflare states that Workers AI customer content is not used to train models or improve Cloudflare or third-party services without explicit consent. Model license terms still apply. This page alone does not establish geographic processing guarantees or a specific transient retention period. [Data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)

## Unresolved before implementation

- Confirm the desired recording duration and daily workload.
- Verify practical audio-size/duration limits, Worker memory limits, execution timeouts, and whether chunking is required for that target. Test using the device's actual WAV format.
- Verify complete service pricing and account requirements before provisioning.
- Evaluate transcription quality on user-approved samples; no recording has been uploaded for this research.
