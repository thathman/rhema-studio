const waitFor = async (predicate, label, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await sleep(50)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

const canvas = await waitFor(() => {
  const candidate = document.querySelector("canvas")
  return candidate?.width === 1920 && candidate?.height === 1080 ? candidate : null
}, "native output canvas")
await sleep(250)
return { canvasWidth: canvas.width, canvasHeight: canvas.height }
