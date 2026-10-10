import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { api, start, upload } from "./helpers";

it("retains queue submission failures for inspection rather than reserving duplicate work", async () => {
  expect((await upload()).status).toBe(201);
  vi.spyOn(env.JOBS, "send").mockRejectedValueOnce(new Error("Queue unavailable"));
  expect((await start("not-enqueued")).status).toBe(503);
  expect((await start("not-enqueued")).status).toBe(200);
  expect(await (await api("/runs/not-enqueued")).json()).toMatchObject({
    state: "failed", error: "Queue submission failed; allowance retained",
  });
  expect(await (await api("/state")).json()).toMatchObject({ reserved_audio_seconds: 30 });
});
