import { env as runtimeEnv } from "cloudflare:workers";
import { createMessageBatch } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { CLASSIFIER_MODEL, MODEL, hex, type Env } from "../src/domain";
import { audioUrl } from "../src/security";
// Runtime bindings are generated; test secrets/config deliberately differ from production literals.
const env: Env = { ...runtimeEnv, DEVICE_TOKEN: "device-test-token-000000000000000000000",
  READER_TOKEN: "reader-test-token-000000000000000000000", AUDIO_SIGNING_KEY: "signing-test-key-00000000000000000000",
  PROCESSING_ENABLED: "true", PUBLIC_ORIGIN: "https://local.test" };
function id() { return `recorder-1_${crypto.randomUUID().replaceAll("-", "")}`; }
function wav() {
  const bytes = new Uint8Array(32044), view = new DataView(bytes.buffer);
  for (const [offset, text] of [[0, "RIFF"], [8, "WAVEfmt "], [36, "data"]] satisfies [number, string][]) bytes.set(new TextEncoder().encode(text), offset);
  for (const [offset, value] of [[4, 32036], [16, 16], [24, 16000], [28, 32000], [40, 32000]]) view.setUint32(offset, value, true);
  for (const [offset, value] of [[20, 1], [22, 1], [32, 2], [34, 16]]) view.setUint16(offset, value, true);
  return bytes;
}
function api(path: string, init: RequestInit = {}, token = env.DEVICE_TOKEN, settings = env) {
  const headers = new Headers(init.headers); headers.set("authorization", `Bearer ${token}`);
  return worker.fetch(new Request(`https://local.test${path}`, { ...init, headers }), settings);
}
async function upload(recording: string, bytes = wav(), checksum?: string) {
  return api(`/recordings/${recording}`, { method: "PUT", body: bytes,
    headers: { "content-length": String(bytes.length), "content-type": "audio/wav", "x-original-filename": "VN000001.WAV",
      "x-audio-sha256": checksum ?? hex(await crypto.subtle.digest("SHA-256", bytes)) } });
}
async function deliver(recording: string, settings = env) {
  await worker.queue(createMessageBatch("local-jobs", [{ id: crypto.randomUUID(), timestamp: new Date(), attempts: 1, body: { id: recording } }]), settings);
}
function ai(text: string, state = "Completed") {
  const binding: { run(model: string, input: Record<string, unknown>, options?: AiOptions): Promise<unknown> } = env.AI;
  return vi.spyOn(binding, "run").mockImplementation(async model => Response.json(model === CLASSIFIER_MODEL ? {
    model: "clef", answers: { classification: { type: "choice", choice: "note", confidence: 0.8,
      probabilities: { note: 0.9, task: 0.1 } } }, usage: { input_tokens: 100, output_tokens: 0 },
  } : { state, result: { text, duration: 1 } }));
}
afterEach(() => vi.restoreAllMocks());
describe("private whole-file pipeline", () => {
  it("fails closed and separates device and reader privileges", async () => {
    const recording = id(); await upload(recording);
    expect((await api("/recordings", {}, "bad")).status).toBe(401);
    expect((await api("/recordings")).status).toBe(404);
    expect((await api(`/recordings/${recording}/transcript`)).status).toBe(403);
    expect((await api(`/recordings/${recording}/retry`, { method: "POST" })).status).toBe(403);
    expect((await api(`/recordings/other_${"a".repeat(32)}`)).status).toBe(403);
    expect((await api(`/recordings/${recording}`, {}, env.READER_TOKEN)).status).toBe(200);
    expect((await api("/recordings", {}, env.DEVICE_TOKEN, { ...env, DEVICE_TOKEN: "" })).status).toBe(401);
  });
  it("validates header/checksum and never replaces an original", async () => {
    const recording = id(), bytes = wav();
    bytes[0] = 0; expect((await upload(recording, bytes)).status).toBe(422);
    expect(await env.NOTES.head(`audio/${recording}.wav`)).toBeNull();
    expect((await upload(recording, wav(), "0".repeat(64))).status).toBe(422);
    expect((await upload(recording)).status).toBe(201);
    expect((await upload(recording)).status).toBe(201);
    const changed = wav(); changed[50] = 1;
    expect((await upload(recording, changed)).status).toBe(409);
  });
  it("deduplicates concurrent deliveries and publishes Markdown with unknown capture time", async () => {
    const recording = id(); await upload(recording); const inference = ai("These are my original words.");
    await Promise.all([deliver(recording), deliver(recording)]);
    expect(inference).toHaveBeenCalledTimes(2);
    expect(inference.mock.calls[1][0]).toBe(CLASSIFIER_MODEL);
    expect(inference.mock.calls[0][0]).toBe(MODEL);
    expect(inference.mock.calls[0][1]).toMatchObject({ language: "en", filler_words: true });
    const response = await api(`/recordings/${recording}/transcript`, {}, env.READER_TOKEN);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("captured_at: null");
    expect((await env.LEDGER.getByName("personal").get(recording))?.state).toBe("ready");
  });
  it("serves audio only with an expiring, attempt-scoped signature", async () => {
    const recording = id(); await upload(recording);
    const claim = await env.LEDGER.getByName("personal").claim(recording); expect(claim).not.toBeNull();
    const url = await audioUrl(env, recording, claim!.attempt_id!);
    expect((await worker.fetch(new Request(url), env)).status).toBe(200);
    const prefix = await worker.fetch(new Request(url, { headers: { range: "bytes=0-43" } }), env);
    expect(prefix.status).toBe(206); expect((await prefix.arrayBuffer()).byteLength).toBe(44);
    const suffix = await worker.fetch(new Request(url, { headers: { range: "bytes=-10" } }), env);
    expect(suffix.headers.get("content-length")).toBe("10"); expect((await suffix.arrayBuffer()).byteLength).toBe(10);
    const head = await worker.fetch(new Request(url, { method: "HEAD" }), env);
    expect(head.status).toBe(200); expect(await head.text()).toBe("");
    expect((await worker.fetch(new Request(url.replace(/signature=./, "signature=z")), env)).status).toBe(401);
    expect((await worker.fetch(new Request(`https://local.test/source/${recording}`), env)).status).toBe(401);
    await env.LEDGER.getByName("personal").finish(recording, claim!.attempt_id!, { outcome: "speech" });
    expect((await worker.fetch(new Request(url), env)).status).toBe(401);
  });
  it("preserves an explicit no-speech model outcome", async () => {
    const recording = id(); await upload(recording); ai(""); await deliver(recording);
    expect((await env.LEDGER.getByName("personal").get(recording))?.outcome).toBe("no-speech-model-result");
    expect(await (await api(`/recordings/${recording}/transcript`, {}, env.READER_TOKEN)).text()).toContain("not proof of silence");
  });
  it("does not publish incomplete model responses", async () => {
    const recording = id(); await upload(recording); ai("Partial text", "Running"); await deliver(recording);
    expect((await env.LEDGER.getByName("personal").get(recording))?.state).toBe("failed");
    expect(await env.NOTES.head(`transcripts/${recording}.md`)).toBeNull();
    expect((await api(`/recordings/${recording}/retry`, { method: "POST" }, env.READER_TOKEN)).status).toBe(202);
  });
  it("pauses without inference when the monthly allowance is exhausted", async () => {
    const recording = id();
    await env.LEDGER.getByName("personal").commit({ id: recording, filename: "VN000001.WAV", sha256: "0".repeat(64),
      bytes: 44, duration_seconds: 36001, captured_at: null, uploaded_at: new Date().toISOString(), state: "uploaded", attempts: 0 });
    const inference = ai("Unexpected");
    await deliver(recording);
    expect(inference).not.toHaveBeenCalled();
    expect((await env.LEDGER.getByName("personal").get(recording))?.state).toBe("paused");
  });
  it("retains transient failures and their reserved usage", async () => {
    const recording = id(); await upload(recording);
    const binding: { run(model: string, input: Record<string, unknown>, options?: AiOptions): Promise<unknown> } = env.AI;
    const inference = vi.spyOn(binding, "run").mockResolvedValue(new Response(null, { status: 503 }));
    await deliver(recording); await deliver(recording);
    expect(inference).toHaveBeenCalledTimes(1); // backoff prevents immediate rebilling
    const note = await env.LEDGER.getByName("personal").get(recording);
    expect(note?.state).toBe("uploaded"); expect(note?.attempts).toBe(1);
  });
  it("reuses persisted provider output after a real Markdown publication failure", async () => {
    const recording = id(); await upload(recording); const inference = ai("Recovered without inference");
    await env.NOTES.put(`results/${recording}.json`, JSON.stringify({ state: "Completed", result: { text: "Original persisted result" } }));
    const write = vi.spyOn(env.NOTES, "put").mockRejectedValueOnce(new Error("Storage unavailable"));
    await deliver(recording);
    expect((await env.LEDGER.getByName("personal").get(recording))?.state).toBe("uploaded");
    expect((await api(`/recordings/${recording}/transcript`, {}, env.READER_TOKEN)).status).toBe(409);
    write.mockRestore();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120000);
    await deliver(recording);
    expect(inference).toHaveBeenCalledTimes(1);
    expect(inference.mock.calls[0][0]).toBe(CLASSIFIER_MODEL);
    expect(await (await api(`/recordings/${recording}/transcript`, {}, env.READER_TOKEN)).text()).toContain("Original persisted result");
  });
  it("handles simultaneous upload retries without replacing audio", async () => {
    const recording = id();
    const responses = await Promise.all([upload(recording), upload(recording)]);
    expect(responses.map(response => response.status)).toEqual([201, 201]);
  });
  it("repairs a lost Queue submission through the durable outbox", async () => {
    const recording = id();
    const send = vi.spyOn(env.JOBS, "send").mockRejectedValueOnce(new Error("Queue unavailable"));
    expect((await upload(recording)).status).toBe(201);
    expect((await env.LEDGER.getByName("personal").get(recording))?.state).toBe("uploaded");
    send.mockClear();
    await worker.scheduled({ scheduledTime: Date.now(), cron: "* * * * *", noRetry() {} }, env);
    expect(send).toHaveBeenCalledWith({ id: recording });
  });
  it("retains a crashed inference as uncertain rather than automatically rebilling", async () => {
    const recording = id(); await upload(recording);
    const claimed = await env.LEDGER.getByName("personal").claim(recording);
    expect(claimed).not.toBeNull(); const inference = ai("Must not run");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 21 * 60000);
    await deliver(recording);
    expect(inference).not.toHaveBeenCalled();
    expect((await env.LEDGER.getByName("personal").get(recording))?.state).toBe("uncertain");
    expect((await api(`/recordings/${recording}/retry`, { method: "POST" }, env.READER_TOKEN)).status).toBe(202);
  });
  it("bounds automatic retries and retains every usage reservation", async () => {
    const recording = id(); await upload(recording);
    const binding: { run(model: string, input: Record<string, unknown>, options?: AiOptions): Promise<unknown> } = env.AI;
    const inference = vi.spyOn(binding, "run").mockResolvedValue(new Response(null, { status: 503 }));
    const baseline = (await env.LEDGER.getByName("personal").usage()).reserved_audio_seconds;
    const clock = vi.spyOn(Date, "now"); const now = Date.now();
    for (let attempt = 0; attempt < 4; ++attempt) {
      clock.mockReturnValue(now + attempt * 10 * 60000);
      await deliver(recording);
    }
    expect(inference).toHaveBeenCalledTimes(3);
    expect((await env.LEDGER.getByName("personal").get(recording))?.state).toBe("failed");
    expect((await env.LEDGER.getByName("personal").usage()).reserved_audio_seconds - baseline).toBe(3);
  });
});
