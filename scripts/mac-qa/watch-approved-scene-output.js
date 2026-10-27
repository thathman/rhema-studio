// Watch one actual Tauri output canvas and answer output-specific checkpoints.
const invoke = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__)
const outputId = new URLSearchParams(window.location.search).get("output")
if (!outputId) throw new Error("Missing output ID in this Tauri output window")

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
  const context = canvas.getContext("2d")
  if (!context) return null
  const pixel = [...context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data]
  return { width: canvas.width, height: canvas.height, hash: hashPng(canvas.toDataURL("image/png")), centerPixel: pixel }
}
const matches = (frame, conditions) => {
  if (conditions.expectedHash && frame.hash !== conditions.expectedHash) return false
  if (conditions.expectedChangeFromHash && frame.hash === conditions.expectedChangeFromHash) return false
  if (conditions.expectedPixel && JSON.stringify(frame.centerPixel) !== JSON.stringify(conditions.expectedPixel)) return false
  return true
}
const handleCheckpoint = async (event) => {
  const { outputId: requestedOutput, name, expectedHash, expectedChangeFromHash, expectedPixel } = event.payload ?? {}
  if (requestedOutput !== outputId) return
  try {
    const frame = await waitFor(() => {
      const current = sampleProgramCanvas()
      if (!current) return null
      return matches(current, { expectedHash, expectedChangeFromHash, expectedPixel }) ? current : null
    }, `the rendered ${outputId} frame for ${name}`)
    await invoke("plugin:event|emit", {
      event: "qa:program-capture-ack",
      payload: { outputId, name, frame },
    })
  } catch (error) {
    await invoke("plugin:event|emit", {
      event: "qa:program-capture-ack",
      payload: { outputId, name, error: String(error?.message ?? error) },
    })
  }
}
const handler = window.__TAURI_INTERNALS__.transformCallback((event) => { void handleCheckpoint(event) })
const eventId = await invoke("plugin:event|listen", {
  event: "qa:program-checkpoint",
  target: { kind: "Any" },
  handler,
})
const initialFrame = await waitFor(sampleProgramCanvas, `${outputId} Program canvas`)
window.__rhemaQaProgramOutputListener = { event: "qa:program-checkpoint", eventId, outputId, initialFrame }
