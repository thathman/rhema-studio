// Native Tauri screenshot setup: the real Live page with no service or rundown.
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

  const service = qa.service.getState()
  if (service.current && service.closeProgram({ discard: true }) !== "closed") {
    throw new Error("Could not close the QA service before the empty-state capture")
  }
  qa.queue.setState({ items: [], headers: [], activeIndex: null, removedActive: null, highlightedId: null, past: [], future: [] })
  qa.bible.setState({ selectedVerse: null, selectedSlide: null, selectedQueueItemId: null })
  qa.broadcast.setState({ isLive: false, liveVerse: null, liveSourceVerse: null, liveItem: null, liveSlide: null, liveItemId: null, heldLive: null, rehearsal: false, rehearsalReturn: null })
  qa.shell.getState().setWorkspace("present")

  const recovery = await waitFor(() => document.querySelector('[role="region"][aria-label="Live setup actions"]'), "Live setup actions")
  await waitFor(() => document.querySelector("h1")?.innerText.includes("Live console"), "Live console heading")
  await sleep(250)
  const panelBounds = recovery.getBoundingClientRect()
  const actionButtons = [...recovery.querySelectorAll("button")]
  const clippedActions = actionButtons.filter((button) => {
    const bounds = button.getBoundingClientRect()
    return bounds.top < panelBounds.top || bounds.bottom > panelBounds.bottom
  })
  if (clippedActions.length > 0) {
    throw new Error(`Live recovery actions are clipped: ${clippedActions.map((button) => button.getAttribute("aria-label")).join(", ")}`)
  }
  const result = {
    service: qa.service.getState().current,
    itemCount: qa.queue.getState().items.length,
    headerCount: qa.queue.getState().headers.length,
    programLive: qa.broadcast.getState().isLive,
    actionLabels: actionButtons.map((button) => button.getAttribute("aria-label")),
  }
  if (result.service !== null || result.itemCount !== 0 || result.headerCount !== 0 || result.programLive) {
    throw new Error(`Unexpected empty service state: ${JSON.stringify(result)}`)
  }
  return result
}

return await runScenario()
