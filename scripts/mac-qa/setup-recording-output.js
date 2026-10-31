// Set up a hidden native congregation renderer for the recorder smoke journey.
const waitFor = async (predicate, label, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await sleep(50)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

const stores = await waitFor(() => window.__rhemaQa?.(), "isolated QA stores")
const output = stores.broadcast.getState().outputs.find((candidate) => candidate.id === "main")
if (!output) throw new Error("The default congregation output is missing")
const live = stores.broadcast.getState()
if (!live.isLive || live.liveItemId !== "qa-live-baseline") {
  throw new Error(`Expected the synthetic QA baseline to be on air before recording: ${JSON.stringify({ isLive: live.isLive, liveItemId: live.liveItemId })}`)
}

await window.__TAURI_INTERNALS__.invoke("ensure_broadcast_window", {
  outputId: output.id,
  title: "Rhema QA Recorder Output",
})

// The Rust recorder independently checks this current host Live snapshot; a caller-supplied role
// in recorder_start is deliberately not sufficient authority.
const liveState = {
  v: 1,
  outputs: [{ id: output.id, name: "QA Main Output", role: "congregation" }],
}
await window.__TAURI_INTERNALS__.invoke("publish_live_state", { json: JSON.stringify(liveState) })

return { outputId: output.id, outputName: "QA Main Output", rolePublished: "congregation", liveItemId: live.liveItemId }
