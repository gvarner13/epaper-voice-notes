import { readFileSync } from "node:fs";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const production = JSON.parse(readFileSync("./wrangler.jsonc", "utf8"));
export default defineConfig({
  plugins: [cloudflareTest({
    main: "./src/index.ts",
    remoteBindings: false, // Absolutely no real AI or cloud storage during tests.
    miniflare: {
      compatibilityDate: production.compatibility_date,
      bindings: { ...production.vars, MAX_AUDIO_SECONDS: "60",
        TEST_TOKEN: "local-test-only-token-not-a-real-secret" },
      r2Buckets: production.r2_buckets.map((b: { binding: string }) => b.binding),
      durableObjects: { LEDGER: { className: "FeasibilityLedger", useSQLite: true } },
      queueProducers: { JOBS: "local-jobs" },
      // No automatic consumer: deliver explicitly through the public Queue entry point.
      ai: { binding: "AI" },
    },
  })],
  test: { include: ["test/*.test.ts"], setupFiles: ["./test/setup.ts"] },
});
