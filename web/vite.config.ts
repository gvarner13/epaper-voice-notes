import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
    fs: {
      deny: [
        "**/.env",
        "**/.env.*",
        "**/.local/**",
        "**/*.{crt,pem}",
        "**/.git/**",
        "**/cloud_credentials.h",
        "**/wifi_credentials.h",
      ],
    },
  },
  resolve: { tsconfigPaths: true },
  plugins: [tailwindcss(), tanstackStart(), react()],
});
