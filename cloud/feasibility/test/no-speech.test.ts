import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { api, deliver, fakeAI, start, upload } from "./helpers";

it("retains an explicit no-speech model outcome rather than fabricating transcript text", async () => {
  expect((await upload()).status).toBe(201);
  expect((await start("silent")).status).toBe(202);
  fakeAI(Response.json({ text: "", word_count: 0, segments: [] }));
  await deliver("silent");
  expect(await (await api("/runs/silent/result")).json()).toMatchObject({
    outcome: "no-speech-model-result", response: { text: "", word_count: 0, segments: [] },
  });
});
