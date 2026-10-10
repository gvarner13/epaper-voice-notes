import { DurableObject } from "cloudflare:workers";
import approvedFixtures from "./fixtures.json";

const MODEL = "@cf/openai/whisper-large-v3-turbo";
interface Fixture {
  filename: string;
  duration_seconds: number;
  bytes: number;
  sha256: string;
  expected_outcome: string;
}
const fixtures: Record<string, Fixture> = approvedFixtures;

interface Env {
  AI: Ai;
  AUDIO: R2Bucket;
  JOBS: Queue<{ runId: string }>;
  LEDGER: DurableObjectNamespace<FeasibilityLedger>;
  TEST_TOKEN: string;
  MAX_AUDIO_SECONDS: string;
  MAX_ATTEMPTS_PER_FIXTURE: string;
}
interface Run {
  id: string;
  fixture: string;
  vad_filter: boolean;
  state: "queued" | "running" | "complete" | "failed";
  created_at: string;
  started_at?: string;
  finished_at?: string;
  error?: string;
  latency_ms?: number;
  outcome?: "speech" | "no-speech-model-result";
}
class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}
function fixtureFor(name: string): Fixture {
  if (!Object.hasOwn(fixtures, name)) throw new HttpError(404, "Unknown synthetic fixture");
  return fixtures[name];
}
function validId(id: string) {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(id);
}
function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
function isVerified(object: R2Object | null, fixture: Fixture) {
  return object?.size === fixture.bytes && !!object.checksums.sha256 &&
    hex(object.checksums.sha256) === fixture.sha256;
}
async function authorized(request: Request, token: string | undefined) {
  if (!token || token.length < 32) return false; // Fail closed before a secret is configured.
  const supplied = request.headers.get("authorization");
  if (!supplied || supplied.length > 256) return false;
  const encode = new TextEncoder();
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest("SHA-256", encode.encode(supplied)),
    crypto.subtle.digest("SHA-256", encode.encode(`Bearer ${token}`)),
  ]);
  const a = new Uint8Array(actual), b = new Uint8Array(expected);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

/** A small test ledger, not the production processing-state implementation.
 * Reserve allowance before enqueueing; do not refund uncertain/failed work.
 * Claim once before inference. A crashed running job stays visibly uncertain,
 * rather than automatically making another paid inference call.
 */
export class FeasibilityLedger extends DurableObject<Env> {
  async reserve(id: string, fixtureName: string, vadFilter: boolean) {
    const fixture = fixtureFor(fixtureName);
    const maxSeconds = Number(this.env.MAX_AUDIO_SECONDS);
    const maxAttempts = Number(this.env.MAX_ATTEMPTS_PER_FIXTURE);
    if (!validId(id) || !Number.isSafeInteger(maxSeconds) || maxSeconds <= 0 ||
        !Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) {
      throw new Error("Invalid run or allowance configuration");
    }
    return this.ctx.storage.transaction(async (storage) => {
      const previous = await storage.get<Run>(`run:${id}`);
      if (previous) {
        if (previous.fixture !== fixtureName || previous.vad_filter !== vadFilter) {
          return { accepted: false, status: 409, error: "Run ID already has different inputs" };
        }
        return { accepted: false, status: 200, run: previous };
      }
      const seconds = (await storage.get<number>("reserved_seconds")) ?? 0;
      const attempts = (await storage.get<number>(`attempts:${fixtureName}`)) ?? 0;
      if (seconds + fixture.duration_seconds > maxSeconds || attempts >= maxAttempts) {
        return { accepted: false, status: 429, error: "Test allowance exhausted" };
      }
      const run: Run = { id, fixture: fixtureName, vad_filter: vadFilter,
        state: "queued", created_at: new Date().toISOString() };
      await storage.put({ [`run:${id}`]: run,
        reserved_seconds: seconds + fixture.duration_seconds,
        [`attempts:${fixtureName}`]: attempts + 1 });
      return { accepted: true, status: 202, run };
    });
  }
  async claim(id: string) {
    return this.ctx.storage.transaction(async (storage) => {
      const run = await storage.get<Run>(`run:${id}`);
      if (!run || run.state !== "queued") return null;
      run.state = "running";
      run.started_at = new Date().toISOString();
      await storage.put(`run:${id}`, run);
      return run;
    });
  }
  async finish(id: string, result: {
    state: "complete" | "failed";
    error?: string;
    latency_ms?: number;
    outcome?: "speech" | "no-speech-model-result";
  }) {
    return this.ctx.storage.transaction(async (storage) => {
      const run = await storage.get<Run>(`run:${id}`);
      if (!run || run.state === "complete" || run.state === "failed") return;
      if (result.state === "complete" && run.state !== "running") {
        throw new Error("Cannot complete an unclaimed run");
      }
      await storage.put(`run:${id}`, { ...run, ...result, finished_at: new Date().toISOString() });
    });
  }
  async get(id: string) {
    return (await this.ctx.storage.get<Run>(`run:${id}`)) ?? null;
  }
  async summary() {
    // No external I/O between these reads; storage input gates preserve ordering.
    const reserved = (await this.ctx.storage.get<number>("reserved_seconds")) ?? 0;
    const runs = await this.ctx.storage.list<Run>({ prefix: "run:" });
    return { max_audio_seconds: Number(this.env.MAX_AUDIO_SECONDS),
      reserved_audio_seconds: reserved, runs: Array.from(runs.values()) };
  }
}

async function handle(request: Request, env: Env) {
  if (!await authorized(request, env.TEST_TOKEN)) {
    return new Response("Unauthorized", { status: 401,
      headers: { "www-authenticate": "Bearer", "cache-control": "no-store" } });
  }
  const path = new URL(request.url).pathname;
  const ledger = env.LEDGER.getByName("milestone-1");
  if (path === "/state" && request.method === "GET") {
    return json({ ...await ledger.summary(), model: MODEL, fixtures });
  }
  const upload = /^\/fixtures\/([a-z0-9_-]+)$/.exec(path);
  if (upload && request.method === "PUT") {
    const fixture = fixtureFor(upload[1]);
    if (request.headers.get("content-type") !== "audio/wav" ||
        request.headers.get("content-length") !== String(fixture.bytes) || !request.body) {
      throw new HttpError(400, "Expected the exact synthetic WAV and Content-Length");
    }
    const key = `samples/${fixture.filename}`;
    const existing = await env.AUDIO.head(key);
    if (isVerified(existing, fixture)) {
      await request.body.cancel();
      return json({ fixture: upload[1], uploaded: true, already_present: true });
    }
    if (existing) throw new HttpError(409, "An unexpected object occupies the fixture key");
    // R2 validates the full SHA-256 as it streams the body. This allowlist prevents
    // uploading personal recordings and makes PCM header parsing unnecessary here.
    let stored: R2Object | null;
    try {
      stored = await env.AUDIO.put(key, request.body, {
        sha256: fixture.sha256, onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: "audio/wav" },
      });
    } catch (error) {
      if (error instanceof Error && /checksum.*did not match/i.test(error.message)) {
        throw new HttpError(422, "WAV checksum does not match the approved synthetic fixture");
      }
      throw error; // Do not misclassify outages or storage failures as invalid audio.
    }
    if (!isVerified(stored ?? await env.AUDIO.head(key), fixture)) {
      throw new HttpError(422, "Stored fixture failed size/checksum verification");
    }
    return json({ fixture: upload[1], uploaded: true }, 201);
  }
  const route = /^\/runs\/([a-z0-9_-]+)(\/result)?$/.exec(path);
  if (!route || !validId(route[1])) throw new HttpError(404, "Not found");
  const id = route[1];
  if (request.method === "GET") {
    const run = await ledger.get(id);
    if (!run) throw new HttpError(404, "Unknown run");
    if (!route[2]) return json(run);
    if (run.state !== "complete") throw new HttpError(409, "Result is not complete");
    const result = await env.AUDIO.get(`results/${id}.json`);
    if (!result) throw new HttpError(503, "Completed result is unavailable");
    return new Response(result.body, { headers: {
      "content-type": "application/json", "cache-control": "no-store" } });
  }
  if (request.method !== "POST" || route[2]) throw new HttpError(405, "Method not allowed");
  const length = Number(request.headers.get("content-length"));
  if (!Number.isInteger(length) || length <= 0 || length > 1024) {
    throw new HttpError(400, "Run requests require a small, explicit Content-Length");
  }
  let input: unknown;
  try { input = await request.json(); } catch { throw new HttpError(400, "Invalid JSON"); }
  if (!input || typeof input !== "object" || !("fixture" in input) ||
      typeof input.fixture !== "string" || !("vad_filter" in input) ||
      typeof input.vad_filter !== "boolean" ||
      Object.keys(input).some((key) => key !== "fixture" && key !== "vad_filter")) {
    throw new HttpError(400, "Expected {fixture: string, vad_filter: boolean}");
  }
  const fixture = fixtureFor(input.fixture);
  if (!isVerified(await env.AUDIO.head(`samples/${fixture.filename}`), fixture)) {
    throw new HttpError(409, "Upload and verify this fixture first");
  }
  const reservation = await ledger.reserve(id, input.fixture, input.vad_filter);
  if (reservation.accepted) {
    try { await env.JOBS.send({ runId: id }); }
    catch {
      await ledger.finish(id, { state: "failed", error: "Queue submission failed; allowance retained" });
      throw new HttpError(503, "Queue submission failed; inspect this run before manually trying a new ID");
    }
  }
  return json(reservation.run ?? { error: reservation.error }, reservation.status);
}

async function processRun(id: string, env: Env) {
  const ledger = env.LEDGER.getByName("milestone-1");
  const run = await ledger.claim(id);
  if (!run) return; // Duplicate delivery must not start another inference.
  const fixture = fixtureFor(run.fixture);
  const started = Date.now();
  try {
    const audio = await env.AUDIO.get(`samples/${fixture.filename}`);
    if (!audio || !isVerified(audio, fixture)) throw new Error("Audio failed integrity verification");
    const parameters = { task: "transcribe", language: "en", vad_filter: run.vad_filter };
    const response = await env.AI.run(MODEL, {
      audio: { body: audio.body, contentType: "audio/wav" }, ...parameters,
    }, { returnRawResponse: true });
    const requestId = response.headers.get("cf-ai-req-id");
    if (!response.ok) {
      throw new Error(`Workers AI HTTP ${response.status}; request ${requestId ?? "unknown"}`);
    }
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || !("text" in result) || typeof result.text !== "string") {
      throw new Error("Model response is missing transcript text");
    }
    const latency = Date.now() - started;
    const outcome = result.text.trim() ? "speech" : "no-speech-model-result";
    // Preserve the complete unmodified provider response for coverage/quality review.
    const published = await env.AUDIO.put(`results/${id}.json`, JSON.stringify({
      run_id: id, model: MODEL, fixture: run.fixture, original: fixture,
      parameters, latency_ms: latency, ai_request_id: requestId,
      outcome, completed_at: new Date().toISOString(), response: result,
    }), { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "application/json" } });
    if (!published) throw new Error("Result key already exists; refusing to replace or reuse it");
    await ledger.finish(id, { state: "complete", latency_ms: latency, outcome });
  } catch (error) {
    await ledger.finish(id, { state: "failed", latency_ms: Date.now() - started,
      error: error instanceof Error ? error.message.slice(0, 4000) : "Unknown inference/publication error" });
  }
}

export default {
  async fetch(request: Request, env: Env) {
    try { return await handle(request, env); }
    catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      // Do not put credentials, audio, or transcripts in logs or public errors.
      return json({ error: "Feasibility service failed; inspect authenticated state" }, 500);
    }
  },
  async queue(batch: MessageBatch<{ runId: string }>, env: Env) {
    for (const message of batch.messages) {
      if (!message.body || typeof message.body.runId !== "string" || !validId(message.body.runId)) {
        message.ack();
        continue;
      }
      // If ledger/publication infrastructure itself fails, the invocation fails.
      // No automatic retry is configured. Running/queued uncertainty stays visible.
      await processRun(message.body.runId, env);
      message.ack();
    }
  },
} satisfies ExportedHandler<Env, { runId: string }>;
