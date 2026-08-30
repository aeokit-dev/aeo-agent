import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { acpBridgePlugin } from "./server/acp-bridge.ts";

export default defineConfig({
  plugins: [react(), acpBridgePlugin()],
  server: {
    port: 4173,
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: true },
    },
  },
  test: { environment: "jsdom", setupFiles: "./src/test-setup.ts" },
});
