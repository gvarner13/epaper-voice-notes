import { expect, it } from "vitest";
import { api, silenceWav, start, upload } from "./helpers";

it("rejects a corrupted synthetic WAV as invalid input, without reserving inference", async () => {
  const bytes = silenceWav();
  bytes[100] = 1;
  expect((await upload(bytes)).status).toBe(422);
  expect((await start("corrupt")).status).toBe(409);
  expect(await (await api("/state")).json()).toMatchObject({ reserved_audio_seconds: 0, runs: [] });
});
