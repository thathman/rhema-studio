type BrowserRuntime = Window & { __RHEMA_BROWSER_MODE__?: "simulated" }

/** Mark the plain-browser development shim before it installs its Tauri-compatible IPC stub. */
export function markBrowserSimulation() {
  if (typeof window !== "undefined") (window as BrowserRuntime).__RHEMA_BROWSER_MODE__ = "simulated"
}

/** The simulator is deliberately a development-only mode; a packaged host never sets this marker. */
export function isBrowserSimulation() {
  return import.meta.env.DEV && typeof window !== "undefined" && (window as BrowserRuntime).__RHEMA_BROWSER_MODE__ === "simulated"
}
