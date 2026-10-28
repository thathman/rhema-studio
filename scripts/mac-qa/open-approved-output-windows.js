// Prepare synthetic congregation outputs and their hidden native renderers.
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
await waitFor(() => document.querySelector("#root")?.childElementCount, "Rhema Studio window")
await waitFor(
  () => [...document.querySelectorAll("button")].some((button) => button.innerText.replace(/\s+/g, " ").trim() === "Production"),
  "workspace navigation",
)
await waitFor(() => document.body.innerText.includes("Welcome to Rhema Studio"), "first-run setup prompt")

let stage = "find the Main output"
try {
  const main = stores.broadcast.getState().outputs.find((output) => output.id === "main")
  if (!main) throw new Error("The default congregation output is missing")

  stage = "add the synthetic secondary display"
  if (!stores.broadcast.getState().outputs.some((output) => output.id === "qa-secondary")) {
    stores.broadcast.getState().addOutput({
      ...structuredClone(main),
      id: "qa-secondary",
      name: "QA Secondary Output",
      type: "display",
      role: "congregation",
      monitorIndex: 1,
      ndi: { ...main.ndi, sourceName: "QA Secondary Synthetic" },
    })
  }

  stage = "create the hidden Main renderer"
  await window.__TAURI_INTERNALS__.invoke("ensure_broadcast_window", {
    outputId: "main",
    title: "Rhema QA Main Program",
  })
  stage = "create the hidden secondary renderer"
  await window.__TAURI_INTERNALS__.invoke("ensure_broadcast_window", {
    outputId: "qa-secondary",
    title: "Rhema QA Secondary Program",
  })
} catch (error) {
  throw new Error(JSON.stringify({ stage, message: error?.message, stack: error?.stack }))
}
