// Native Tauri screenshot setup: contextual Scripture and hymn search inside Live tools.
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
  const before = {
    serviceId: qa.service.getState().current?.id ?? null,
    itemIds: qa.queue.getState().items.map((item) => item.id),
    isLive: qa.broadcast.getState().isLive,
    liveVerse: qa.broadcast.getState().liveVerse,
    previewVerse: qa.bible.getState().selectedVerse?.id ?? null,
    previewSlide: qa.bible.getState().selectedSlide?.item.id ?? null,
  }

  const findButton = await waitFor(
    () => [...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Open Find and listening tools"),
    "Find and listening tools button"
  )
  findButton.click()

  const search = await waitFor(
    () => document.querySelector('[data-slot="live-tools-panel"] [data-tour="quick-find"] input[aria-label="Quick find"]'),
    "contextual Quick Find input"
  )
  await waitFor(() => document.activeElement === search, "Quick Find focus")
  await sleep(200)

  const selectedTab = document.querySelector('[data-slot="live-tools-panel"] [role="tab"][aria-selected="true"]')?.textContent?.replace(/\s+/g, " ").trim()
  const after = {
    serviceId: qa.service.getState().current?.id ?? null,
    itemIds: qa.queue.getState().items.map((item) => item.id),
    isLive: qa.broadcast.getState().isLive,
    liveVerse: qa.broadcast.getState().liveVerse,
    previewVerse: qa.bible.getState().selectedVerse?.id ?? null,
    previewSlide: qa.bible.getState().selectedSlide?.item.id ?? null,
  }
  if (selectedTab !== "Find & cue" || JSON.stringify(after) !== JSON.stringify(before)) {
    throw new Error(`Opening contextual search changed the wrong Live state: ${JSON.stringify({ selectedTab, before, after })}`)
  }

  return { selectedTab, focused: document.activeElement === search, serviceId: after.serviceId, itemIds: after.itemIds, programLive: after.isLive }
}

return await runScenario()
