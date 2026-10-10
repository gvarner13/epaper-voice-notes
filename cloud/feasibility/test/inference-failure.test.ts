import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { api, deliver, fakeAI, start, upload } from "./helpers";

it("retains an inference failure and its allowance without publishing or automatically retrying", async () => {
  expect((await upload()).status).toBe(201);
  expect((await start("failed")).status).toBe(202);
  const ai = fakeAI(new Response("Unavailable", { status: 503 }));
  await deliver("failed");
  expect(await (await api("/runs/failed")).json()).toMatchObject({
    state: "failed", error: expect.stringContaining("Workers AI HTTP 503"),
  });
  expect((await api("/runs/failed/result")).status).toBe(409);
  await deliver("failed");
  expect(ai).toHaveBeenCalledTimes(1);
  expect(await (await api("/state")).json()).toMatchObject({ reserved_audio_seconds: 30 });
});
