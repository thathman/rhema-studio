import path from "path"
import { realpathSync } from "node:fs"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, searchForWorkspaceRoot } from "vite"
import { configDefaults } from "vitest/config"

// https://vite.dev/config/
// Worktrees share node_modules through a symlink. Vite resolves that symlink outside this
// worktree and blocks packaged font files unless the real dependency directory is allowed.
const workspaceRoot = searchForWorkspaceRoot(__dirname)
const realNodeModules = realpathSync(path.resolve(__dirname, "node_modules"))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    strictPort: true,
    fs: { allow: [workspaceRoot, realNodeModules] },
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
        // Browser feeds (ARCH-002): served by the LAN listener from the built app.
        feed: path.resolve(__dirname, "feed.html"),
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
    exclude: [...configDefaults.exclude, "**/engage-cloud/**"],
  },
})
