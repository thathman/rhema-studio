// Create the real congregation output WebView hidden so desktop QA does not need a monitor.
await window.__TAURI_INTERNALS__.invoke("ensure_broadcast_window", {
  outputId: "main",
  title: "Rhema QA Program Output",
})
