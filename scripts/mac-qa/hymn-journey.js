// Native Tauri acceptance scenario. Run through qa.py against a fresh QA profile.
// The hymn text is invented fixture data; it is not part of any church library.
const waitFor = async (predicate, label, timeoutMs = 5000) => {
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
  if (button.disabled || button.getAttribute("aria-disabled") === "true") throw new Error(`Button “${normal(button.getAttribute("aria-label") || button.innerText)}” is disabled`)
  const pointerId = Date.now() % 100000
  const pointer = { bubbles: true, button: 0, pointerType: "mouse", pointerId, isPrimary: true }
  button.dispatchEvent(new PointerEvent("pointerdown", pointer))
  button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
  button.dispatchEvent(new PointerEvent("pointerup", pointer))
  button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
  button.click()
  await sleep(100)
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
  await sleep(100)
}
const chooseOption = async (label) => {
  const option = await waitFor(
    () => [...document.querySelectorAll('[role="option"]')].find((candidate) => normal(candidate.innerText) === label),
    `option “${label}”`,
  )
  option.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse", pointerId: 2, isPrimary: true }))
  option.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerType: "mouse", pointerId: 2, isPrimary: true }))
  await sleep(100)
}
const setSelect = async (select, value) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), "value")?.set
  if (!setter) throw new Error("No select value setter")
  setter.call(select, value)
  select.dispatchEvent(new Event("change", { bubbles: true }))
  await sleep(100)
}

async function runScenario() {
await waitFor(() => document.querySelector("#root")?.childElementCount, "Rhema Studio window")
const qaStores = await waitFor(() => window.__rhemaQa?.(), "isolated QA stores")
await waitFor(() => buttons().some((candidate) => normal(candidate.innerText) === "Prepare"), "Prepare navigation")
let stage = "prepare isolated test profile"
try {
qaStores.settings.getState().setSetup({ dismissedAt: new Date().toISOString() })
qaStores.shell.getState().setSetupOpen(false)
await waitFor(
  () => !qaStores.shell.getState().setupOpen && !document.querySelector('[role="dialog"][data-state="open"]'),
  "setup dialog to close",
)

stage = "seed QA hymn"
let imported
try {
  imported = await window.__TAURI_INTERNALS__.invoke("content_import_hymnbook", {
  parts: [{
    book: { code: "CAC", name: "CAC Gospel Hymn Book", language: "yo", publisher: "QA fixture" },
    songs: [{
      number: "999",
      song: {
        title: "QA Journey Hymn",
        alternate_titles: ["Orin Idanwo"],
        authors: "Rhema QA fixture",
        licence: "public_domain",
        primary_language: "en",
        tags: "cacghb",
        sections: [{
          kind: "verse",
          label: "Verse 1",
          texts: { en: "Test words for a Sunday service.", yo: "Ọ̀rọ̀ ìdánwò fún iṣẹ́ ọjọ́ Ìsinmi." },
        }],
      },
    }],
  }],
  })
} catch (error) {
  throw new Error(`Could not seed QA hymn: ${JSON.stringify(error)} (${String(error)})`)
}
if (!imported || imported.added !== 1) throw new Error(`Could not seed QA hymn: ${JSON.stringify(imported)}`)

stage = "open Prepare"
await clickButton("Prepare")
stage = "create isolated service fixture"
const created = await qaStores.service.getState().createFromRundown("QA Sunday Service", null)
if (created !== "created") throw new Error(`Could not create QA service: ${created}`)
await waitFor(() => qaStores.service.getState().current?.title === "QA Sunday Service", "QA service to open")
stage = "seed two phases with unrelated earlier items"
const seedSlide = (id, title) => ({
  id,
  kind: "slide",
  slide: { title, body: `Fixture content for ${title}` },
  reference: title,
  confidence: 1,
  source: "manual",
  added_at: 0,
})
const expectedOrder = ["QA First A", "QA First B", "QA Later C", "QA Journey Hymn Edited"]
const phaseHeaders = [
  { id: "qa-phase-one", type: "phase", name: "QA Phase One", at: 0, role: "pre", rule: "manual" },
  { id: "qa-phase-two", type: "phase", name: "QA Phase Two", at: 2, role: "main", rule: "manual" },
]
qaStores.queue.setState({
  items: [seedSlide("qa-first-a", expectedOrder[0]), seedSlide("qa-first-b", expectedOrder[1]), seedSlide("qa-later-c", expectedOrder[2])],
  headers: phaseHeaders,
  activeIndex: 0,
  addTarget: null,
})
await waitFor(() => document.querySelector('[aria-label="Phase: QA Phase Two"]'), "second QA phase in Prepare")

stage = "open the Add picker from the later phase"
await clickButton("Add to QA Phase Two")
await waitFor(() => normal(document.querySelector('[role="dialog"][data-state="open"]')?.innerText).includes("Add to QA Phase Two"), "phase-targeted Add picker")
stage = "open hymn picker"
await clickButton("Hymn book")
await waitFor(() => document.querySelector('input[aria-label="Find a hymn"]'), "hymn search field")
await setInput('input[aria-label="Find a hymn"]', "QA Journey Hymn")
stage = "find seeded hymn"
await waitFor(() => [...document.querySelectorAll("button")].some((b) => normal(b.innerText).includes("QA Journey Hymn")), "seeded hymn result")

stage = "select hymn"
const result = await waitFor(
  () => [...document.querySelectorAll('[role="dialog"][data-state="open"] button')].find((button) =>
    (button.title === "Select to preview and view details" || button.title === "Click to preview")
      && normal(button.innerText).includes("QA Journey Hymn")),
  "hymn preview row",
)
result.click()
stage = "open selected hymn details"
await waitFor(() => document.querySelector('[aria-label="Hymn details"]'), "selected hymn details pane")

const detailText = normal(document.querySelector('[aria-label="Hymn details"]')?.innerText)
if (!detailText.includes("QA Journey Hymn") || !detailText.includes("CAC Main 999")) {
  throw new Error(`Hymn details are incomplete: ${detailText}`)
}

stage = "edit library hymn"
await clickButton("Edit library hymn QA Journey Hymn", { startsWith: true })
const hymnTitleInput = 'input[placeholder="Amazing Grace"]'
await waitFor(() => document.querySelector(hymnTitleInput)?.value === "QA Journey Hymn", "selected hymn to finish loading into the editor")
await setInput(hymnTitleInput, "QA Journey Hymn Edited")
await waitFor(() => {
  const save = buttons().find((button) => normal(button.innerText) === "Save")
  return document.querySelector(hymnTitleInput)?.value === "QA Journey Hymn Edited" && save && !save.disabled
}, "edited hymn to become saveable")
stage = "save library hymn"
const hymnEditor = await waitFor(
  () => [...document.querySelectorAll('[role="dialog"][data-state="open"]')].find((dialog) => normal(dialog.innerText).includes("Edit song")),
  "hymn editor dialog",
)
const hymnEditorSave = await waitFor(() => [...hymnEditor.querySelectorAll("button")].find((button) => normal(button.innerText) === "Save"), "hymn editor Save button")
await activateButton(hymnEditorSave)
await waitFor(() => ![...document.querySelectorAll('[role="dialog"][data-state="open"]')].some((dialog) => normal(dialog.innerText).includes("Edit song")), "hymn editor to close after save")
await waitFor(() => normal(document.querySelector('[aria-label="Hymn details"]')?.innerText).includes("QA Journey Hymn Edited"), "updated hymn details")

stage = "choose language order"
const yorubaFirst = await waitFor(
  () => [...document.querySelectorAll('[role="group"][aria-label="Language shown first"] button')].find((button) => normal(button.innerText) === "Yorùbá"),
  "Yorùbá first-language control",
)
yorubaFirst.click()
await waitFor(() => yorubaFirst.getAttribute("aria-pressed") === "true", "Yorùbá-first preference")

stage = "add hymn to service"
await clickButton("Add to service")
await waitFor(
  () => ![...document.querySelectorAll('[role="dialog"][data-state="open"]')].some((dialog) => normal(dialog.innerText).includes("Added items go to the end of QA Phase Two")),
  "phase-targeted hymn picker to close after Add",
)
const queue = qaStores.queue.getState()
const selectedQueueItemId = qaStores.bible.getState().selectedQueueItemId
const addedItem = queue.items.find((item) => item.id === selectedQueueItemId)
if (queue.items.length !== 4 || !addedItem || addedItem.kind !== "song") throw new Error(`Add did not insert and select one hymn: ${JSON.stringify(queue.items)}`)
if (queue.items.map((item) => item.reference).join("|") !== expectedOrder.join("|")) {
  throw new Error(`Adding to the later phase changed unrelated items or order: ${queue.items.map((item) => item.reference).join("|")}`)
}
if (queue.headers.map(({ id, at }) => `${id}:${at}`).join("|") !== "qa-phase-one:0|qa-phase-two:2") {
  throw new Error(`Adding to the later phase changed phase positions: ${JSON.stringify(queue.headers)}`)
}
if (queue.addTarget !== null) throw new Error(`Successful Add did not clear its phase target: ${queue.addTarget}`)
if (qaStores.bible.getState().selectedQueueItemId !== addedItem.id) throw new Error("Add did not select the inserted hymn in Prepare")
if (addedItem.song.title !== "QA Journey Hymn Edited" || JSON.stringify(addedItem.song.languages) !== '["yo","en"]') {
  throw new Error(`Added hymn has the wrong saved title or language order: ${JSON.stringify(addedItem.song)}`)
}
if (qaStores.broadcast.getState().isLive) throw new Error("Adding the hymn changed Live output")

stage = "edit service appearance"
await waitFor(() => document.querySelector('[aria-label="Languages"]'), "in-service language controls")
const lookSelect = await waitFor(() => document.querySelector('select[aria-label^="Look for"]'), "in-service look control")
const theme = qaStores.broadcast.getState().themes[0]
if (!theme) throw new Error("No built-in look is available for the hymn")
await setSelect(lookSelect, theme.id)
await waitFor(() => qaStores.queue.getState().items.find((item) => item.id === addedItem.id)?.look_id === theme.id, "service look choice")

stage = "save service"
await clickButton("Save")
await waitFor(() => !qaStores.service.getState().dirty && !qaStores.service.getState().saving, "service save to complete")
const savedId = qaStores.service.getState().current?.id
if (!savedId) throw new Error("Saved service has no current ID")

stage = "close saved service"
await clickButton("Close service")
await waitFor(() => qaStores.service.getState().current === null, "saved service to close")

stage = "reopen saved service"
await clickButton("Service")
await chooseOption("QA Sunday Service")
await waitFor(() => qaStores.service.getState().current?.id === savedId && qaStores.queue.getState().items.length === 4, "saved service to reopen")
const reopenedQueue = qaStores.queue.getState()
if (reopenedQueue.items.map((item) => item.reference).join("|") !== expectedOrder.join("|")) {
  throw new Error(`Saved service reopened with a different phase order: ${reopenedQueue.items.map((item) => item.reference).join("|")}`)
}
if (reopenedQueue.headers.map(({ id, at }) => `${id}:${at}`).join("|") !== "qa-phase-one:0|qa-phase-two:2") {
  throw new Error(`Saved service reopened with different phase positions: ${JSON.stringify(reopenedQueue.headers)}`)
}

stage = "preview reopened hymn"
const rundownRow = await waitFor(
  () => buttons().find((button) => button.title === "Click to preview" && normal(button.innerText).includes("QA Journey Hymn Edited")),
  "reopened hymn in the rundown",
)
qaStores.bible.getState().selectSlide(null)
rundownRow.click()
await waitFor(() => {
  const selected = qaStores.bible.getState()
  return selected.selectedQueueItemId === addedItem.id && selected.selectedSlide?.item.id === addedItem.id
}, "reopened hymn preview selection")
await clickButton("Live")
const preview = await waitFor(() => document.querySelector('[data-slot="preview-panel"]'), "Live preview panel")
const previewCanvas = await waitFor(() => preview.querySelector('canvas[role="img"]'), "Live preview canvas")
await waitFor(() => {
  const label = previewCanvas.getAttribute("aria-label") ?? ""
  return label.includes("Test words for a Sunday service") || label.includes("Ọ̀rọ̀ ìdánwò fún iṣẹ́")
}, "hymn words in Live preview")
if (qaStores.broadcast.getState().isLive) throw new Error("Previewing the saved hymn changed Live output")

return { imported, hymn: "QA Journey Hymn Edited", added: addedItem.id, order: reopenedQueue.items.map((item) => item.reference), phases: reopenedQueue.headers.map(({ id, at }) => ({ id, at })), savedService: savedId, preview: previewCanvas.getAttribute("aria-label"), live: qaStores.broadcast.getState().isLive }
} catch (error) {
  const visibleButtons = buttons().map((button) => normal(button.getAttribute("aria-label") || button.innerText)).filter(Boolean).slice(0, 80)
  throw new Error(JSON.stringify({
    stage,
    message: error?.message,
    stack: error?.stack,
    error: String(error),
    visibleButtons,
    dialogs: [...document.querySelectorAll('[role="dialog"]')].map((dialog) => ({ state: dialog.getAttribute("data-state"), modal: dialog.getAttribute("aria-modal"), text: normal(dialog.innerText).slice(0, 280) })),
    bodyText: normal(document.body.innerText).slice(0, 3000),
  }))
}
}
