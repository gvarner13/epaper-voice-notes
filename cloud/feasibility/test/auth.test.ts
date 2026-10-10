import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import worker from "../src/index";
import { api } from "./helpers";

it("requires the configured test credential for every endpoint and fails closed without it", async () => {
  for (const [method, path] of [["GET", "/state"], ["PUT", "/fixtures/silence"],
    ["POST", "/runs/example"], ["GET", "/runs/example/result"]]) {
    const response = await worker.fetch(new Request(`https://local.test${path}`, { method }), env);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  const request = new Request("https://local.test/state", {
    headers: { authorization: `Bearer ${env.TEST_TOKEN}` },
  });
  expect((await worker.fetch(request, { ...env, TEST_TOKEN: "" })).status).toBe(401);
  expect(await (await api("/state")).json()).toMatchObject({ reserved_audio_seconds: 0, runs: [] });
});
