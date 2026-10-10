import { expect, it } from "vitest";
import { api, start, upload } from "./helpers";

it("atomically reserves concurrent attempts and rejects work beyond the configured allowance", async () => {
  expect((await upload()).status).toBe(201);
  const starts = await Promise.all([start("first"), start("second"), start("third")]);
  expect(starts.map((r) => r.status).sort()).toEqual([202, 202, 429]);
  expect(await (await api("/state")).json()).toMatchObject({
    max_audio_seconds: 60, reserved_audio_seconds: 60,
    runs: expect.arrayContaining([expect.objectContaining({ state: "queued" })]),
  });
});
