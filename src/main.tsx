import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { invoke } from "@tauri-apps/api/core"
import { forwardConsoleToLog } from "@/lib/console-to-log"
import "@/lib/qa-hooks"

import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { TooltipProvider } from "@/components/ui/tooltip.tsx"
import { hydrateSettings, useSettingsStore } from "@/stores/settings-store"
import { hydrateBibleStore, initBiblePersistence } from "@/stores/bible-store"
import { hydrateBroadcastThemes } from "@/stores/broadcast-store"
import { hydrateDesignPacks } from "@/lib/design-packs"
import { markBrowserSimulation } from "@/lib/runtime-mode"

// Frontend warnings, errors and uncaught rejections only exist in devtools
// otherwise, so the logs a user sends us would say nothing about them.
forwardConsoleToLog()

// Plain-browser dev runs (no Tauri window) get a stub IPC so layout and
// workflows can be checked. Dead code in production builds.
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  markBrowserSimulation()
  await import("./dev/browser-shim")
}

// Webview reloads do NOT restart the Rust backend, so any STT pipeline
// left running from the previous webview session still has
// `stt_active = true`. That makes the next `start_transcription` call
// fail silently with "Transcription is already running". Reset the
// backend to a clean state on boot, then hydrate persisted settings and
// bible store so the UI reflects the user's choices immediately.
// An OBS companion (#209) needs only its settings: no Bible, no outputs or looks.
invoke("stop_transcription")
  .catch(() => {})
  .then(() => hydrateSettings())
  .then(() => (useSettingsStore.getState().companionMode ? undefined : Promise.all([hydrateBibleStore(), hydrateBroadcastThemes(), hydrateDesignPacks()]).then(() => initBiblePersistence())))
  .finally(() => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <ThemeProvider defaultTheme="dark">
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </StrictMode>
    )
  })
