// Native Tauri screenshot setup: a saved event, private Preview, and untouched Program.
const waitFor = async (predicate, label, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await sleep(50)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function runScenario() {
  const qa = await waitFor(() => window.__rhemaQa?.(), "isolated QA stores")
  qa.settings.getState().setSetup({ dismissedAt: new Date().toISOString() })
  qa.shell.getState().setSetupOpen(false)
  if (qa.service.getState().current && qa.service.getState().closeProgram({ discard: true }) !== "closed") {
    throw new Error("Could not close the QA service before the configured-state capture")
  }

  const item = {
    id: "qa-live-welcome",
    kind: "slide",
    slide: { title: "Welcome", body: "Welcome to worship\nWe are glad you are here." },
    reference: "Welcome",
    confidence: 1,
    source: "manual",
    added_at: Date.now(),
    scene_id: "qa-live-welcome-layout",
  }
  qa.broadcast.getState().saveScene({
    id: "qa-live-welcome-layout",
    name: "Welcome layout",
    background: "#000000",
    layers: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  qa.queue.setState({
    items: [item],
    headers: [{ id: "qa-live-opening", type: "group", name: "Opening", at: 0, event: { schema_version: 1 } }],
    activeIndex: null,
    removedActive: null,
    highlightedId: null,
    past: [],
    future: [],
  })
  qa.broadcast.setState({ isLive: false, liveVerse: null, liveSourceVerse: null, liveItem: null, liveSlide: null, liveItemId: null, heldLive: null, rehearsal: false, rehearsalReturn: null })
  const created = await qa.service.getState().createFromRundown("QA Sunday Service", "2026-11-03")
  if (created !== "created") throw new Error(`Could not save the QA service: ${created}`)

  const savedItem = qa.queue.getState().items[0]
  if (!savedItem) throw new Error("The saved QA service has no opening moment")
  const targetOutput = qa.broadcast.getState().outputs.find((candidate) => (candidate.role ?? "congregation") === "congregation")
  if (!targetOutput) throw new Error("The configured Live state has no congregation output")
  const readProgram = () => {
    const state = qa.broadcast.getState()
    const currentOutput = state.outputs.find((candidate) => candidate.id === targetOutput.id)
    return {
      isLive: state.isLive,
      liveVerse: state.liveVerse,
      liveSourceVerse: state.liveSourceVerse,
      liveItem: state.liveItem,
      liveSlide: state.liveSlide,
      liveItemId: state.liveItemId,
      heldLive: state.heldLive,
      sceneTake: state.sceneTakes?.[targetOutput.id] ?? null,
      outputScene: {
        id: currentOutput?.sceneId ?? null,
        snapshot: currentOutput?.sceneSnapshot ?? null,
        appearance: currentOutput?.sceneAppearanceSnapshot ?? null,
        momentRestore: currentOutput?.designedMomentRestore ?? null,
      },
      activeIndex: qa.queue.getState().activeIndex,
    }
  }
  const programBeforePreview = JSON.stringify(readProgram())
  qa.present.previewItem(savedItem)
  qa.shell.getState().setWorkspace("present")

  await waitFor(() => document.querySelector('[role="region"][aria-label="Live setup actions"]') === null, "configured Live running order")
  await waitFor(() => document.querySelector('[data-studio-live]'), "actual Program panel")
  await waitFor(() => document.querySelector('[data-slot="preview-panel"]'), "private Preview panel")
  await sleep(300)

  const output = qa.broadcast.getState().outputs.find((candidate) => candidate.id === targetOutput.id)
  const preview = qa.bible.getState().selectedSlide
  const outputPicker = document.querySelector('[aria-label="Named congregation output for Preview language and scene Take"]')
  const sourceTake = document.querySelector('[aria-label="Take source live"]')
  const sceneControls = [...document.querySelectorAll('[aria-label^="Quick scene controls for "]')].find((element) => element.getAttribute("aria-label") === `Quick scene controls for ${output?.name}`)
  const scenePicker = sceneControls?.querySelector("select")
  const sceneTake = sceneControls?.querySelector("button[aria-label^='Take scene Welcome layout to ']")
  const liveToolbar = document.querySelector('[role="toolbar"][aria-label="Live tools"]')
  const toolbarButtons = [...(liveToolbar?.querySelectorAll("button") ?? [])].map((button) => button.textContent?.replace(/\s+/g, " ").trim() ?? "")
  const toolbarText = liveToolbar?.textContent?.replace(/\s+/g, " ").trim() ?? ""
  const result = {
    service: qa.service.getState().current?.title,
    saved: !qa.service.getState().dirty,
    itemCount: qa.queue.getState().items.length,
    eventName: qa.queue.getState().headers[0]?.name,
    output: output?.name,
    selectedOutput: outputPicker?.selectedOptions?.[0]?.textContent?.trim(),
    preview: preview?.item.reference,
    programLive: qa.broadcast.getState().isLive,
    programUnchanged: JSON.stringify(readProgram()) === programBeforePreview,
    takeLabel: sourceTake?.getAttribute("aria-label"),
    takeDisabled: sourceTake?.getAttribute("aria-disabled") === "true",
    selectedScene: scenePicker?.selectedOptions?.[0]?.textContent?.trim(),
    sceneTakeLabel: sceneTake?.getAttribute("aria-label"),
    sceneTakeDisabled: sceneTake?.getAttribute("aria-disabled") === "true",
    toolbarButtons,
  }
  if (result.service !== "QA Sunday Service" || !result.saved || result.itemCount !== 1 || result.eventName !== "Opening" || !result.output || !result.selectedOutput?.startsWith(result.output) || result.preview !== "Welcome" || result.takeLabel !== "Take source live" || result.programLive || !result.programUnchanged || result.takeDisabled || result.selectedScene !== "Welcome layout" || result.sceneTakeLabel !== `Take scene Welcome layout to ${result.output}` || result.sceneTakeDisabled || !toolbarButtons.some((label) => label.includes("Find & listen")) || !toolbarButtons.some((label) => label.includes("Live tools")) || toolbarText.includes("Production tools") || toolbarText.includes("More controls") || toolbarText.includes("Listening off") || toolbarText.includes("Saved translations")) {
    throw new Error(`Unexpected configured Live state: ${JSON.stringify(result)}`)
  }
  return result
}

return await runScenario()
