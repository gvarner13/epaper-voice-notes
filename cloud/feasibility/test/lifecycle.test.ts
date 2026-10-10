import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { api, deliver, fakeAI, start, upload } from "./helpers";

it("publishes the original provider result once after asynchronous processing", async () => {
  expect((await upload()).status).toBe(201);
  expect((await upload()).status).toBe(200);
  expect((await start("example")).status).toBe(202);
  expect((await api("/runs/example/result")).status).toBe(409);
  const provider = { text: "Checkpoint number one. An example thought.",
    segments: [{ start: 0, end: 15, text: "Checkpoint number one. An example thought." }] };
  const ai = fakeAI(Response.json(provider,
    { headers: { "cf-ai-req-id": "fake-request-1" } }));
  await deliver("example");
  expect(await (await api("/runs/example/result")).json()).toMatchObject({
    run_id: "example", fixture: "silence", ai_request_id: "fake-request-1",
    outcome: "speech", response: provider,
  });
  expect((await start("example")).status).toBe(200);
  expect((await start("example", true)).status).toBe(409);
  await deliver("example");
  expect(await (await api("/runs/example")).json()).toMatchObject({ state: "complete" });
  expect(await (await api("/state")).json()).toMatchObject({ reserved_audio_seconds: 30 });
  // Count external provider submissions, not calls to internal collaborators.
  expect(ai).toHaveBeenCalledTimes(1);
});
