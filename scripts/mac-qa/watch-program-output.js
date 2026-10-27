// Observe rendered pixels in the actual broadcast-main WebView during the mixed Prepare journey.
const invoke = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__)
const waitFor = async (predicate, label, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await sleep(50)
  }
  throw new Error(`Timed out waiting for ${label}`)
}
const hashPng = (dataUrl) => {
  let hash = 2166136261
  for (let index = 0; index < dataUrl.length; index += 1) {
    hash = Math.imul(hash ^ dataUrl.charCodeAt(index), 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}
const sampleProgramCanvas = () => {
  const canvas = document.querySelector("canvas")
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null
  const png = canvas.toDataURL("image/png")
  return { width: canvas.width, height: canvas.height, hash: hashPng(png), dataUrlCharacters: png.length }
}
const initialFrame = await waitFor(sampleProgramCanvas, "the Program output canvas")
const handleCheckpoint = async (event) => {
  const { name, expectedHash, expectedChangeFromHash, expectChangeFromInitial } = event.payload ?? {}
  try {
    const frame = await waitFor(() => {
      const current = sampleProgramCanvas()
      if (!current) return null
      if (expectedHash && current.hash !== expectedHash) return null
      if (expectedChangeFromHash && current.hash === expectedChangeFromHash) return null
      if (expectChangeFromInitial && current.hash === initialFrame.hash) return null
      return current
    }, `the Program output frame for ${name}`)
    await invoke("plugin:event|emit", {
      event: "qa:report",
      payload: { name: `program-output-${name}`, body: frame },
    })
    await invoke("plugin:event|emit", {
      event: "qa:program-capture-ack",
      payload: { name, frame },
    })
  } catch (error) {
    await invoke("plugin:event|emit", {
      event: "qa:program-capture-ack",
      payload: { name, error: String(error?.message ?? error) },
    })
  }
}
const handler = window.__TAURI_INTERNALS__.transformCallback((event) => { void handleCheckpoint(event) })
const eventId = await invoke("plugin:event|listen", {
  event: "qa:program-checkpoint",
  target: { kind: "Any" },
  handler,
})
window.__rhemaQaProgramOutputListener = { event: "qa:program-checkpoint", eventId }
