/// <reference types="vitest/config" />
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    strictPort: true,
    watch: {
      // Keep the watcher out of multi-GB non-frontend dirs (Rust build
      // artifacts, ONNX models, NDI SDK). Crawling them blocks the dev
      // server's event loop for minutes on Windows, so the app windows
      // load before Vite can respond and stay white.
      ignored: [
        "**/src-tauri/**",
        "**/models/**",
        "**/embeddings/**",
        "**/sdk/**",
        "**/data/**",
        "**/build/**",
      ],
    },
  },
  build: {
    outDir: "build",
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        broadcast: path.resolve(__dirname, "broadcast-output.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Many store tests import modules afresh (resetModules); a cold import can pass vitest's 5 s
    // default on a loaded Intel Mac and fail at random (#176, #180, the OBS and sound stores).
    testTimeout: 20_000,
  },
})
