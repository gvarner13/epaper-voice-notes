import { env } from "cloudflare:workers";
import { beforeEach, afterEach, vi } from "vitest";

declare global {
  namespace Cloudflare { interface Env { TEST_TOKEN: string } }
}

beforeEach(() => {
  vi.spyOn(env.AI, "run").mockRejectedValue(new Error("Real AI is forbidden in local tests"));
});
afterEach(() => vi.restoreAllMocks());
