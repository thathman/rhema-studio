// Observe rendered pixels in the actual broadcast-main WebView during the mixed Prepare journey.
const invoke = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__)
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
const waitForStableCanvas = async (matches, label, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs
  let previousHash = null
  let stableSamples = 0
  let lastFrame = null
  while (Date.now() < deadline) {
    const frame = sampleProgramCanvas()
    if (frame) {
      lastFrame = frame
      if (matches(frame) && frame.hash === previousHash) stableSamples += 1
      else stableSamples = matches(frame) ? 1 : 0
      previousHash = frame.hash
      if (stableSamples >= 4) return frame
    }
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}; last frame ${JSON.stringify(lastFrame)}; font status ${document.fonts?.status ?? "unavailable"}`)
}
await document.fonts?.ready
await sleep(250)
const initialFrame = await waitForStableCanvas(() => true, "a stable initial Program output frame")
const handleCheckpoint = async (event) => {
  const { name, expectedHash, expectedChangeFromHash, expectChangeFromInitial } = event.payload ?? {}
  try {
    const frame = await waitForStableCanvas((current) => {
      if (expectedHash && current.hash !== expectedHash) return false
      if (expectedChangeFromHash && current.hash === expectedChangeFromHash) return false
      if (expectChangeFromInitial && current.hash === initialFrame.hash) return false
      return true
    }, `the stable Program output frame for ${name}`)
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
