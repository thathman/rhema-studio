// Native Tauri acceptance scenario for mixed Prepare moments and Preview/Program isolation.
// All content is synthetic and lives in the isolated QA profile.
const waitFor = async (predicate, label, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await sleep(50)
  }
  throw new Error(`Timed out waiting for ${label}`)
}
const normal = (value) => String(value ?? "").replace(/\s+/g, " ").trim()
const buttons = () => [...document.querySelectorAll("button, [role=tab]")]
const activateButton = async (button) => {
  if (button.disabled || button.getAttribute("aria-disabled") === "true") {
    throw new Error(`Button “${normal(button.getAttribute("aria-label") || button.innerText)}” is disabled`)
  }
  const pointerId = Date.now() % 100000
  const pointer = { bubbles: true, button: 0, pointerType: "mouse", pointerId, isPrimary: true }
  button.dispatchEvent(new PointerEvent("pointerdown", pointer))
  button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
  button.dispatchEvent(new PointerEvent("pointerup", pointer))
  button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
  button.click()
  await sleep(120)
  return button
}
const clickButton = async (name, { startsWith = false } = {}) => {
  const button = await waitFor(
    () => buttons().find((candidate) => {
      const label = normal(candidate.getAttribute("aria-label") || candidate.innerText)
      return startsWith ? label.startsWith(name) : label === name
    }),
    `button “${name}”`,
  )
  return activateButton(button)
}
const setInput = async (selector, value) => {
  const input = await waitFor(() => document.querySelector(selector), `input ${selector}`)
  input.focus()
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set
  if (!setter) throw new Error(`No value setter for ${selector}`)
  setter.call(input, value)
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }))
  input.dispatchEvent(new Event("change", { bubbles: true }))
  await sleep(120)
}
const chooseOption = async (prefix) => {
  const option = await waitFor(
    () => [...document.querySelectorAll('[role="option"]')].find((candidate) => normal(candidate.innerText).startsWith(prefix)),
    `service option starting “${prefix}”`,
  )
  option.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse", pointerId: 2, isPrimary: true }))
  option.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerType: "mouse", pointerId: 2, isPrimary: true }))
  await sleep(120)
}
const programSnapshot = (qa) => {
  const live = qa.broadcast.getState()
  return JSON.parse(JSON.stringify({
    isLive: live.isLive,
    liveItemId: live.liveItemId,
    liveSlide: live.liveSlide,
    liveVerse: live.liveVerse,
  }))
}

async function runScenario() {
  let stage = "load Rhema Studio and its QA bridge"
  let qa
  try {
    await waitFor(() => document.querySelector("#root")?.childElementCount, "Rhema Studio window")
    qa = await waitFor(() => window.__rhemaQa?.(), "isolated QA stores")
    await waitFor(() => buttons().some((button) => normal(button.innerText) === "Prepare"), "Prepare navigation")
    stage = "dismiss isolated-profile setup"
    qa.settings.getState().setSetup({ dismissedAt: new Date().toISOString() })
    qa.shell.getState().setSetupOpen(false)
    await waitFor(() => !document.body.innerText.includes("Welcome to Rhema Studio"), "setup dialog to close")

    stage = "seed synthetic bilingual hymn"
    const imported = await window.__TAURI_INTERNALS__.invoke("content_import_hymnbook", {
      parts: [{
        book: { code: "CAC", name: "CAC Gospel Hymn Book", language: "yo", publisher: "Synthetic QA fixture" },
        songs: [{
          number: "999",
          song: {
            title: "QA Mixed Journey Hymn",
            alternate_titles: ["Orin Ìdánwò"],
            authors: "Synthetic QA fixture",
            licence: "public_domain",
            primary_language: "en",
            tags: "cacghb",
            sections: [{
              kind: "verse",
              label: "Verse 1",
              texts: {
                en: "Synthetic QA words for the mixed Prepare journey.",
                yo: "Synthetic QA words for the mixed Prepare journey.",
              },
            }],
          },
        }],
      }],
    })
    if (!imported || imported.added !== 1) throw new Error(`Could not seed synthetic hymn: ${JSON.stringify(imported)}`)

    stage = "create a service draft and Sermon event through Prepare"
    await clickButton("Prepare")
    await clickButton("Add event")
    await clickButton("Sermon")
    await waitFor(() => qa.service.getState().current?.id, "local service draft")
    const event = await waitFor(
      () => qa.queue.getState().headers.find((header) => header.event && header.name === "Sermon"),
      "Sermon event",
    )
    const serviceId = qa.service.getState().current.id
    const serviceTitle = qa.service.getState().current.title

    stage = "establish a Program baseline using the visible Take control"
    const baseline = {
      id: "qa-program-baseline",
      kind: "slide",
      slide: { title: "QA Program Baseline", body: "This stays in Program until an operator Takes another moment." },
      reference: "QA Program Baseline",
      confidence: 1,
      source: "manual",
      added_at: Date.now(),
    }
    const headers = qa.queue.getState().headers.map((header) => header.id === event.id ? { ...header, at: 1 } : header)
    qa.queue.setState({ items: [baseline], headers, activeIndex: null, addTarget: null })
    await waitFor(() => qa.service.getState().dirty, "baseline plan change to be marked unsaved")
    await clickButton("Present service")
    const baselineRow = await waitFor(
      () => [...document.querySelectorAll('ol[aria-label="Service rundown"] button[title^="Click to preview"]')]
        .find((button) => normal(button.innerText).includes(baseline.reference)),
      "baseline in Live running order",
    )
    await activateButton(baselineRow)
    await waitFor(() => qa.bible.getState().selectedQueueItemId === baseline.id, "baseline Preview selection")
    await clickButton("Take live")
    await waitFor(() => qa.broadcast.getState().isLive && qa.broadcast.getState().liveItemId === baseline.id, "baseline to appear in Program")
    const programBeforePrepareEdits = programSnapshot(qa)

    stage = "add a Slide moment through the event picker"
    await clickButton("Prepare")
    await clickButton("Edit event: Sermon")
    await clickButton("Add content to Sermon")
    await clickButton("Slides")
    await setInput('[aria-label="Slide title"]', "QA Preview Slide")
    await setInput('[aria-label="Slide text"]', "First synthetic moment in the service plan.")
    await clickButton("Add to service")
    const slide = await waitFor(
      () => qa.queue.getState().items.find((item) => item.kind === "slide" && item.slide?.title === "QA Preview Slide"),
      "Slide moment to be added to the event",
    )

    stage = "add a Hymn moment through the event picker"
    await clickButton("Edit event: Sermon")
    await clickButton("Add content to Sermon")
    await clickButton("Hymn book")
    const languageButton = await waitFor(
      () => [...document.querySelectorAll('[role="group"][aria-label="Language shown first"] button')]
        .find((button) => normal(button.innerText) === "English"),
      "English-first hymn display control",
    )
    await activateButton(languageButton)
    await setInput('input[aria-label="Find a hymn"]', "QA Mixed Journey Hymn")
    const hymnResult = await waitFor(
      () => [...document.querySelectorAll('[role="dialog"] button')]
        .find((button) => button.title === "Select to preview and view details" && normal(button.innerText).includes("QA Mixed Journey Hymn")),
      "synthetic hymn in the library picker",
    )
    await activateButton(hymnResult)
    await clickButton("Add to service")
    const hymn = await waitFor(
      () => qa.queue.getState().items.find((item) => item.kind === "song" && item.song?.title === "QA Mixed Journey Hymn"),
      "Hymn moment to be added to the event",
    )

    stage = "edit the Slide moment in Prepare"
    const slideRow = await waitFor(() => document.querySelector(`[data-rundown-item-id="${slide.id}"]`), "Slide row")
    await activateButton(slideRow.querySelector('button[title="Click to preview"]'))
    await setInput('[aria-label="Slide title"]', "QA Edited Preview Slide")
    await setInput('[aria-label="Slide text"]', "Edited synthetic moment; still private until Take.")
    await waitFor(() => {
      const item = qa.queue.getState().items.find((candidate) => candidate.id === slide.id)
      return item?.slide?.title === "QA Edited Preview Slide" && item.slide.body === "Edited synthetic moment; still private until Take."
    }, "edited Slide moment")

    stage = "reorder the Hymn above the edited Slide using the row control"
    const hymnRow = await waitFor(() => document.querySelector(`[data-rundown-item-id="${hymn.id}"]`), "Hymn row")
    await activateButton(hymnRow.querySelector('button[title="Click to preview"]'))
    hymnRow.focus()
    const moveUp = await waitFor(() => {
      const row = document.querySelector(`[data-rundown-item-id="${hymn.id}"]`)
      const button = row?.querySelector('button[aria-label="Move up"]')
      return button && !button.disabled ? button : null
    }, "enabled Move up control on the Hymn row")
    await activateButton(moveUp)
    const expectedIds = [baseline.id, hymn.id, slide.id]
    await waitFor(() => qa.queue.getState().items.map((item) => item.id).join("|") === expectedIds.join("|"), "requested moment order")
    const eventAfterReorder = qa.queue.getState().headers.find((header) => header.id === event.id)
    if (!eventAfterReorder || eventAfterReorder.at !== 1) throw new Error(`Event boundary moved during reorder: ${JSON.stringify(eventAfterReorder)}`)
    if (JSON.stringify(programSnapshot(qa)) !== JSON.stringify(programBeforePrepareEdits)) {
      throw new Error("Editing or reordering the plan changed Program before Take")
    }

    stage = "save the service"
    await clickButton("Save")
    await waitFor(() => !qa.service.getState().dirty && !qa.service.getState().saving, "service save to finish")
    if (qa.service.getState().current?.id !== serviceId) throw new Error("Saving changed the service ID")

    stage = "close and reopen the saved service"
    await clickButton("Close service")
    await waitFor(() => qa.service.getState().current === null, "service to close")
    await clickButton("Service")
    await chooseOption(serviceTitle)
    await waitFor(() => qa.service.getState().current?.id === serviceId, "saved service to reopen")
    const reopened = qa.queue.getState()
    const reopenedIds = reopened.items.map((item) => item.id)
    if (JSON.stringify(reopenedIds) !== JSON.stringify(expectedIds)) throw new Error(`Saved service changed item IDs/order: ${JSON.stringify(reopenedIds)}`)
    const reopenedSlide = reopened.items.find((item) => item.id === slide.id)
    const reopenedHymn = reopened.items.find((item) => item.id === hymn.id)
    const reopenedEvent = reopened.headers.find((header) => header.id === event.id)
    if (reopenedSlide?.slide?.title !== "QA Edited Preview Slide" || reopenedSlide.slide.body !== "Edited synthetic moment; still private until Take.") {
      throw new Error(`Edited Slide did not round-trip: ${JSON.stringify(reopenedSlide)}`)
    }
    if (reopenedHymn?.song?.title !== "QA Mixed Journey Hymn" || !reopenedEvent?.event) {
      throw new Error("The Hymn or its event did not round-trip")
    }
    if (JSON.stringify(programSnapshot(qa)) !== JSON.stringify(programBeforePrepareEdits)) {
      throw new Error("Saving or reopening the plan changed Program before Take")
    }

    stage = "preview the reopened Hymn without changing Program"
    const reopenedHymnRow = await waitFor(() => document.querySelector(`[data-rundown-item-id="${hymn.id}"]`), "reopened Hymn row")
    await activateButton(reopenedHymnRow.querySelector('button[title="Click to preview"]'))
    await waitFor(() => {
      const preview = qa.bible.getState()
      return preview.selectedQueueItemId === hymn.id && preview.selectedSlide?.item.id === hymn.id
    }, "reopened Hymn to become the private Preview selection")
    const programAfterPreview = programSnapshot(qa)
    if (JSON.stringify(programAfterPreview) !== JSON.stringify(programBeforePrepareEdits)) {
      throw new Error("Preview changed Program before explicit Take")
    }

    stage = "verify visible Preview, then Take it explicitly"
    await clickButton("Present service")
    const previewPanel = await waitFor(() => document.querySelector('[data-slot="preview-panel"]'), "Live Preview panel")
    const previewCanvas = await waitFor(() => previewPanel.querySelector('canvas[role="img"]'), "accessible Live Preview canvas")
    const previewLabel = await waitFor(
      () => {
        const label = previewCanvas.getAttribute("aria-label") ?? ""
        return label.includes("Synthetic QA words for the mixed Prepare journey") ? label : null
      },
      "synthetic hymn words in Preview",
    )
    if (qa.broadcast.getState().liveItemId !== baseline.id) throw new Error("Program stopped showing the baseline before Take")
    await clickButton("Take live")
    await waitFor(() => {
      const live = qa.broadcast.getState()
      return live.isLive && (live.liveItemId === hymn.id || live.liveSlide?.itemId === hymn.id)
    }, "explicit Take to update Program to the Hymn")
    const programAfterTake = programSnapshot(qa)
    if (programAfterTake.liveItemId !== hymn.id) throw new Error(`Take did not select the Hymn for Program: ${JSON.stringify(programAfterTake)}`)

    return {
      service: { id: serviceId, title: serviceTitle },
      event: { id: event.id, title: "Sermon" },
      moments: [
        { id: hymn.id, kind: hymn.kind, title: hymn.song.title },
        { id: slide.id, kind: slide.kind, title: reopenedSlide.slide.title, body: reopenedSlide.slide.body },
      ],
      order: reopenedIds,
      previewLabel,
      programBeforeTake: programAfterPreview,
      programAfterTake,
      explicitTakeChangedProgram: programAfterTake.liveItemId !== programAfterPreview.liveItemId,
    }
  } catch (error) {
    throw JSON.stringify({
      stage,
      message: error?.message,
      stack: error?.stack,
      buttons: buttons().map((button) => normal(button.getAttribute("aria-label") || button.innerText)).filter(Boolean).slice(0, 80),
      dialogs: [...document.querySelectorAll('[role="dialog"]')].map((dialog) => ({ state: dialog.getAttribute("data-state"), text: normal(dialog.innerText).slice(0, 240) })),
      bodyText: normal(document.body.innerText).slice(0, 2400),
    })
  }
}

return await runScenario()
