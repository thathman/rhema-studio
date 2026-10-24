/// <reference types="vitest/config" />
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Rhema Studio Companion (#209): its own page (companion.html → src/companion-main.tsx), built into
// companion-app/build, sharing the studio's modules through the same "@/" alias. Port 3001, so it
// can run beside the studio's dev server.
const root = path.resolve(__dirname, "..")

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  server: {
    port: 3001,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**", "**/companion-app/src-tauri/**", "**/models/**", "**/embeddings/**", "**/sdk/**", "**/data/**", "**/build/**"],
    },
  },
  build: {
    outDir: path.resolve(__dirname, "build"),
    emptyOutDir: true,
    rollupOptions: {
      input: { companion: path.resolve(root, "companion.html") },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "./src"),
    },
  },
})
