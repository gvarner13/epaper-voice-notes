import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { api, deliver, fakeAI, start, upload } from "./helpers";

it("does not expose an inference response as complete if result storage fails", async () => {
  expect((await upload()).status).toBe(201);
  expect((await start("unpublished")).status).toBe(202);
  fakeAI(Response.json({ text: "A complete model response." }));
  // Fault injection at the external object-storage boundary, after audio upload.
  vi.spyOn(env.AUDIO, "put").mockRejectedValueOnce(new Error("Result storage unavailable"));
  await deliver("unpublished");
  expect(await (await api("/runs/unpublished")).json()).toMatchObject({
    state: "failed", error: "Result storage unavailable",
  });
  expect((await api("/runs/unpublished/result")).status).toBe(409);
  expect(await (await api("/state")).json()).toMatchObject({ reserved_audio_seconds: 30 });
});
