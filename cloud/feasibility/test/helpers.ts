import { env } from "cloudflare:workers";
import { createMessageBatch } from "cloudflare:test";
import worker from "../src/index";
import { vi } from "vitest";

export function fakeAI(response: Response) {
  // Select the native binding's raw-response overload without a type assertion.
  const binding: { run(model: "@cf/openai/whisper-large-v3-turbo",
    input: Ai_Cf_Openai_Whisper_Large_V3_Turbo_Input,
    options: { returnRawResponse: true }): Promise<Response> } = env.AI;
  return vi.spyOn(binding, "run").mockResolvedValue(response);
}

export function silenceWav() {
  // A worked, deterministic device-format fixture: 30 s, mono, 16 kHz PCM16.
  const bytes = new Uint8Array(960044);
  const header = "5249464624a60e0057415645666d74201000000001000100803e0000007d0000020010006461746100a60e00";
  for (let i = 0; i < 44; i++) bytes[i] = Number.parseInt(header.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
export function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${env.TEST_TOKEN}`);
  return worker.fetch(new Request(`https://local.test${path}`, { ...init, headers }), env);
}
export function upload(bytes = silenceWav()) {
  return api("/fixtures/silence", { method: "PUT", body: bytes,
    headers: { "content-type": "audio/wav", "content-length": String(bytes.length) } });
}
export function start(id: string, vadFilter = false) {
  const body = JSON.stringify({ fixture: "silence", vad_filter: vadFilter });
  return api(`/runs/${id}`, { method: "POST", body, headers: {
    "content-type": "application/json", "content-length": String(body.length) } });
}
export async function deliver(id: string) {
  const batch = createMessageBatch("local-jobs", [{ id: `message-${id}`,
    timestamp: new Date(), attempts: 1, body: { runId: id } }]);
  await worker.queue(batch, env);
}
