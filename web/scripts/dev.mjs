import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Reuse the computer reader's ignored credentials; explicit environment wins.
for (const relative of ["../.env.local", "../../.local/production.env"]) {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
}

const server = await createServer({
  server: { host: "127.0.0.1", port: 3000, strictPort: true },
});
await server.listen();
server.printUrls();
