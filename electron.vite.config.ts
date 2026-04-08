import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/main",
      lib: {
        entry: resolve(__dirname, "electron/main/index.ts"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
      lib: {
        entry: resolve(__dirname, "electron/preload/index.ts"),
      },
    },
  },
  renderer: {
    root: ".",
    resolve: {
      alias: {
        "@": resolve("src"),
        "@shared": resolve("src/shared"),
      },
    },
    plugins: [react()],
    build: {
      outDir: "out/renderer",
      rollupOptions: {
        input: resolve(__dirname, "index.html"),
      },
    },
  },
});
