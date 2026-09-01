import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve("electron/main.ts"),
          "aeokit-mcp": resolve("server/aeokit-mcp-host.ts"),
        },
        output: { entryFileNames: "[name].js" },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: resolve("electron/preload.ts"), formats: ["cjs"] },
      rollupOptions: {
        output: { entryFileNames: "index.cjs" },
      },
    },
  },
  renderer: {
    root: ".",
    base: "./",
    plugins: [react()],
    build: { rollupOptions: { input: resolve("index.html") } },
  },
});
