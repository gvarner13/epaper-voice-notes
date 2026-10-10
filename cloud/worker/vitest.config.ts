import { readFileSync } from "node:fs";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
const config = JSON.parse(readFileSync("./wrangler.jsonc", "utf8"));
export default defineConfig({
  plugins: [cloudflareTest({ main: "./src/index.ts", remoteBindings: false,
    miniflare: { compatibilityDate: config.compatibility_date,
      bindings: { ...config.vars, PROCESSING_ENABLED: "true", PUBLIC_ORIGIN: "https://local.test",
        DEVICE_TOKEN: "device-test-token-000000000000000000000", READER_TOKEN: "reader-test-token-000000000000000000000",
        AUDIO_SIGNING_KEY: "signing-test-key-00000000000000000000" },
      r2Buckets: ["NOTES"], durableObjects: { LEDGER: { className: "NotesLedger", useSQLite: true } },
      queueProducers: { JOBS: "local-jobs" }, ai: { binding: "AI" } } })],
  test: { include: ["test/*.test.ts"] },
});
