import { HttpError, MODEL, hex, markdown, validId, wavDuration, type Env, type Note } from "./domain";
import { audioUrl, authorized, validAudioUrl } from "./security";
export { NotesLedger } from "./ledger";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
const ledger = (env: Env) => env.LEDGER.getByName("personal");

async function upload(request: Request, env: Env, id: string) {
  const size = Number(request.headers.get("content-length"));
  const checksum = request.headers.get("x-audio-sha256") ?? "";
  const filename = request.headers.get("x-original-filename") ?? "";
  const captured = request.headers.get("x-captured-at") ?? "unknown";
  const limit = Number(env.MAX_AUDIO_BYTES);
  if (!Number.isSafeInteger(limit) || limit < 46) throw new HttpError(503, "Invalid upload limit");
  if (!Number.isSafeInteger(size) || size <= 44 || size > limit) throw new HttpError(413, "Unsupported audio size; original remains local");
  if (!/^[a-f0-9]{64}$/.test(checksum) || !/^VN\d{6}\.WAV$/.test(filename) ||
      request.headers.get("content-type") !== "audio/wav" || !request.body ||
      (captured !== "unknown" && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(captured) || !Number.isFinite(Date.parse(captured)))))
    throw new HttpError(400, "Invalid audio metadata");
  const key = `audio/${id}.wav`;
  let existing = await env.NOTES.head(key);
  if (existing && (existing.size !== size || !existing.checksums.sha256 || hex(existing.checksums.sha256) !== checksum ||
      existing.customMetadata?.filename !== filename || existing.customMetadata?.captured_at !== captured))
    throw new HttpError(409, "Recording ID already contains different audio or metadata");
  if (!existing) {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = []; let count = 0;
    while (count < 44) {
      const part = await reader.read();
      if (part.done) throw new HttpError(422, "Truncated WAV header");
      chunks.push(part.value); count += part.value.length;
    }
    const header = new Uint8Array(44); let offset = 0;
    for (const chunk of chunks) { const n = Math.min(chunk.length, 44 - offset); header.set(chunk.subarray(0, n), offset); offset += n; }
    const duration = wavDuration(header, size);
    // FixedLengthStream preserves a known length for R2 and rejects short/long bodies.
    const fixed = new FixedLengthStream(size);
    const input = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (chunks.length) { controller.enqueue(chunks.shift()!); return; }
        const part = await reader.read();
        if (part.done) controller.close(); else controller.enqueue(part.value);
      }, cancel(reason) { return reader.cancel(reason); },
    });
    const transfer = input.pipeTo(fixed.writable);
    try {
      const [stored] = await Promise.all([env.NOTES.put(key, fixed.readable, {
        sha256: checksum, onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "audio/wav" },
        customMetadata: { filename, captured_at: captured, duration: String(duration), uploaded_at: new Date().toISOString() },
      }), transfer]);
      existing = stored ?? await env.NOTES.head(key);
    } catch (error) {
      if (error instanceof Error && /checksum|length|bytes/i.test(error.message)) throw new HttpError(422, "Incomplete audio or checksum mismatch");
      throw error;
    }
  } else await request.body.cancel();
  if (!existing || existing.size !== size || !existing.checksums.sha256 || hex(existing.checksums.sha256) !== checksum ||
      existing.customMetadata?.filename !== filename || existing.customMetadata?.captured_at !== captured)
    throw new HttpError(409, "Upload verification conflict");
  const note = await ledger(env).commit({ id, filename, sha256: checksum, bytes: size,
    captured_at: captured === "unknown" ? null : captured,
    duration_seconds: Number(existing.customMetadata.duration), uploaded_at: existing.customMetadata.uploaded_at,
    state: "uploaded", attempts: 0 });
  // Durable outbox is the ledger: Cron repairs the R2/ledger/Queue acknowledgment windows.
  // Failed send does not lie about durable upload or force another whole-file transfer.
  try { await env.JOBS.send({ id }); } catch { /* scheduled recovery */ }
  return json(note, 201);
}
async function handle(request: Request, env: Env) {
  const url = new URL(request.url), source = /^\/source\/([^/]+)$/.exec(url.pathname);
  if (source) {
    if (!["GET", "HEAD"].includes(request.method) || !validId(source[1]) || !await validAudioUrl(env, url, source[1]))
      throw new HttpError(401, "Unauthorized");
    const range = request.headers.get("range");
    if (range && !/^bytes=\d*-\d*$/.test(range)) throw new HttpError(416, "Unsupported range");
    const audio = await env.NOTES.get(`audio/${source[1]}.wav`, range ? { range: request.headers } : undefined);
    if (!audio) throw new HttpError(404, "Not found");
    const headers = new Headers({ "content-type": "audio/wav", "cache-control": "private, no-store", "accept-ranges": "bytes" });
    let length = audio.size;
    if (audio.range) {
      const suffix = "suffix" in audio.range ? audio.range.suffix : undefined;
      const offset = typeof suffix === "number" ? Math.max(0, audio.size - suffix) :
        "offset" in audio.range ? audio.range.offset ?? 0 : 0;
      length = typeof suffix === "number" ? Math.min(audio.size, suffix) :
        "length" in audio.range ? audio.range.length ?? audio.size - offset : audio.size - offset;
      headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${audio.size}`);
    }
    headers.set("content-length", String(length));
    if (request.method === "HEAD") await audio.body.cancel();
    return new Response(request.method === "HEAD" ? null : audio.body, { status: range ? 206 : 200, headers });
  }
  const reader = await authorized(request, env.READER_TOKEN);
  const device = await authorized(request, env.DEVICE_TOKEN);
  if (!reader && !device) throw new HttpError(401, "Unauthorized");
  if (url.pathname === "/recordings" && request.method === "GET" && reader) {
    const after = url.searchParams.get("after") ?? "";
    if (after && !validId(after)) throw new HttpError(400, "Invalid cursor");
    return json({ ...await ledger(env).list(after), usage: await ledger(env).usage(), model: MODEL });
  }
  const route = /^\/recordings\/([^/]+)(\/(transcript|retry))?$/.exec(url.pathname);
  if (!route || !validId(route[1])) throw new HttpError(404, "Not found");
  const id = route[1], suffix = route[3];
  if (!reader && !id.startsWith(`${env.DEVICE_ID}_`)) throw new HttpError(403, "Wrong device");
  if (!suffix && request.method === "PUT" && device) return upload(request, env, id);
  const note = await ledger(env).get(id);
  if (!note) throw new HttpError(404, "Not found");
  if (!suffix && request.method === "GET") return json(note);
  if (suffix === "retry" && request.method === "POST" && reader) {
    if (!await ledger(env).retry(id)) throw new HttpError(409, "Not retryable");
    try { await env.JOBS.send({ id }); } catch { /* scheduled recovery */ }
    return json({ accepted: true }, 202);
  }
  if (suffix === "transcript" && request.method === "GET" && reader) {
    if (note.state !== "ready") throw new HttpError(409, "Transcript not complete");
    const result = await env.NOTES.get(`transcripts/${id}.md`);
    if (!result) throw new HttpError(503, "Transcript unavailable");
    return new Response(result.body, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } });
  }
  throw new HttpError(403, "Operation not permitted");
}

class ProcessingError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}
export function transcript(response: unknown): string {
  if (!response || typeof response !== "object") throw new ProcessingError("Invalid model response", false);
  // Cloudflare's third-party binding wraps the provider in state/result. Never publish non-completed jobs.
  if (!("state" in response) || response.state !== "Completed" || !("result" in response) ||
      !response.result || typeof response.result !== "object" || !("text" in response.result) || typeof response.result.text !== "string")
    throw new ProcessingError("Model did not return a completed transcript", false);
  return response.result.text;
}
async function process(id: string, env: Env) {
  const note = await ledger(env).claim(id);
  if (!note) return;
  const attempt = note.attempt_id!;
  try {
    const audio = await env.NOTES.head(`audio/${id}.wav`);
    if (!audio || audio.size !== note.bytes || !audio.checksums.sha256 || hex(audio.checksums.sha256) !== note.sha256)
      throw new ProcessingError("Original audio integrity failed", false);
    let raw = await env.NOTES.get(`results/${id}.json`);
    if (!raw) {
      const response = await env.AI.run(MODEL, { url: await audioUrl(env, id, attempt), language: "en", format: true, filler_words: true },
        { gateway: { id: env.AI_GATEWAY_ID, collectLog: false, skipCache: true }, returnRawResponse: true });
      if (!(response instanceof Response)) throw new ProcessingError("Expected raw inference response", false);
      if (!response.ok) {
        await response.body?.cancel();
        throw new ProcessingError(`Inference HTTP ${response.status}`, response.status === 429 || response.status >= 500);
      }
      const result: unknown = await response.json();
      transcript(result);
      await env.NOTES.put(`results/${id}.json`, JSON.stringify(result), { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "application/json" } });
      raw = await env.NOTES.get(`results/${id}.json`);
    }
    if (!raw) throw new Error("Result publication failed");
    const text = transcript(await raw.json());
    await env.NOTES.put(`transcripts/${id}.md`, markdown(note, text), { httpMetadata: { contentType: "text/markdown; charset=utf-8" } });
    await ledger(env).finish(id, attempt, { outcome: text.trim() ? "speech" : "no-speech-model-result" });
  } catch (error) {
    // Provider errors may contain signed URLs or sensitive input: persist only our safe messages.
    await ledger(env).finish(id, attempt, { error: error instanceof ProcessingError ? error.message : "Processing/storage failure",
      retryable: error instanceof ProcessingError ? error.retryable : true });
  }
}
export default {
  async fetch(request: Request, env: Env) {
    try { return await handle(request, env); }
    catch (error) { return json({ error: error instanceof HttpError ? error.message : "Service unavailable" }, error instanceof HttpError ? error.status : 503); }
  },
  async queue(batch: MessageBatch<unknown>, env: Env) {
    for (const message of batch.messages) {
      const body = message.body;
      const id = body && typeof body === "object" && "id" in body && typeof body.id === "string" ? body.id :
        body && typeof body === "object" && "object" in body && body.object && typeof body.object === "object" &&
        "key" in body.object && typeof body.object.key === "string" ? /^audio\/(.+)\.wav$/.exec(body.object.key)?.[1] : undefined;
      if (id && validId(id)) await process(id, env);
      message.ack(); // Durable retry_at/outbox owns application retries, not Queue delivery count.
    }
  },
  async scheduled(_event: ScheduledController, env: Env) {
    let after = "";
    do {
      const page = await ledger(env).list(after);
      for (const note of page.notes) {
        if (note.state === "running" && (note.lease_until ?? Infinity) < Date.now()) await ledger(env).claim(note.id);
        else if (env.PROCESSING_ENABLED === "true" && ["uploaded", "paused"].includes(note.state) &&
            (note.retry_at ?? 0) <= Date.now()) await env.JOBS.send({ id: note.id });
      }
      after = page.cursor ?? "";
    } while (after);
  },
};
