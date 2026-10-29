// Native Tauri acceptance scenario for six-event Prepare save/reopen and Preview/Program isolation.
// Fixtures live in the isolated QA profile: the English hymn text is public domain;
// Scripture, the Yorùbá QA line, announcement, audio file, scene, and camera name are synthetic.
const waitFor = async (predicate, label, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await sleep(50)
  }
  throw new Error(`Timed out waiting for ${label}`)
}
// Amazing Grace is public domain. The Yorùbá line is synthetic QA wording, not a published translation.
const englishWords = "Amazing grace, how sweet the sound."
const yorubaWords = "Synthetic Yorùbá QA wording; no published translation supplied."
const songTitle = "Amazing Grace"
const audioFixturePath = "__QA_AUDIO_FIXTURE_PATH__"
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
const clickTab = async (name) => {
  const tab = await waitFor(
    () => [...document.querySelectorAll('[role="tab"]')].find((candidate) => normal(candidate.innerText) === name),
    `tab “${name}”`,
  )
  return activateButton(tab)
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
const setNativeSelect = async (selector, value) => {
  const select = await waitFor(() => document.querySelector(selector), `select ${selector}`)
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set
  if (!setter) throw new Error(`No value setter for ${selector}`)
  setter.call(select, value)
  select.dispatchEvent(new Event("change", { bubbles: true }))
  await sleep(120)
}
const setEventDuration = async (qa, header, duration) => {
  await clickButton(`Edit event: ${header.name}`)
  await clickButton("Event plan")
  await setInput('[aria-label="Planned event length in minutes"]', String(duration))
  document.querySelector('[aria-label="Planned event length in minutes"]')?.blur()
  await waitFor(
    () => qa.queue.getState().headers.find((candidate) => candidate.id === header.id)?.event?.duration_minutes === duration,
    `${header.name} planned event duration`,
  )
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
const listenTauriEvent = async (event, handler) => {
  const callback = window.__TAURI_INTERNALS__.transformCallback(handler)
  const eventId = await window.__TAURI_INTERNALS__.invoke("plugin:event|listen", {
    event,
    target: { kind: "Any" },
    handler: callback,
  })
  return () => window.__TAURI_INTERNALS__.invoke("plugin:event|unlisten", { event, eventId })
}
const captureProgramOutput = async (name, conditions = {}) => {
  let resolveCapture
  let rejectCapture
  let unlisten = null
  const captured = new Promise((resolve, reject) => {
    resolveCapture = resolve
    rejectCapture = reject
  })
  const timeout = setTimeout(() => rejectCapture(new Error(`Timed out capturing Program output at ${name}`)), 25000)
  try {
    unlisten = await listenTauriEvent("qa:program-capture-ack", (event) => {
      if (event.payload?.name !== name) return
      if (event.payload.error) rejectCapture(new Error(`Program output capture ${name} failed: ${event.payload.error}`))
      else resolveCapture(event.payload.frame)
    })
    await window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {
      event: "qa:program-checkpoint",
      payload: { name, ...conditions },
    })
    return await captured
  } finally {
    clearTimeout(timeout)
    await unlisten?.()
  }
}
const waitForProgramCanvas = (expectedText, label) => waitFor(
  () => {
    const canvas = document.querySelector('[data-studio-live] [data-slot="live-picture"] canvas[role="img"]')
    const ariaLabel = canvas?.getAttribute("aria-label") ?? ""
    return ariaLabel.includes(expectedText) ? ariaLabel : null
  },
  `rendered Program to show ${label}`,
)

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
    await waitFor(() => !document.querySelector('[role="dialog"][data-state="open"]'), "setup dialog to close")

    stage = "seed a public-domain hymn with an explicitly synthetic QA language line"
    const imported = await window.__TAURI_INTERNALS__.invoke("content_import_hymnbook", {
      parts: [{
        book: { code: "CAC", name: "CAC Gospel Hymn Book", language: "en", publisher: "Synthetic QA fixture", licence_note: "Public-domain hymn title; synthetic QA arrangement metadata." },
        songs: [{
          number: "999",
          song: {
            title: songTitle,
            authors: "John Newton",
            licence: "public_domain",
            licence_note: "Public-domain hymn; the Yorùbá QA line is synthetic and is not a published translation.",
            primary_language: "en",
            tags: "cacghb",
            sections: [{
              id: "qa-amazing-grace-verse",
              kind: "verse",
              label: "Verse 1",
              texts: {
                en: englishWords,
                yo: yorubaWords,
              },
            }],
            arrangements: [
              { id: "qa-amazing-grace-standard", name: "Standard", sequence: ["qa-amazing-grace-verse"], is_default: true },
              { id: "qa-amazing-grace-repeat", name: "Verse repeated (QA alternate)", sequence: ["qa-amazing-grace-verse", "qa-amazing-grace-verse"], is_default: false },
            ],
          },
        }],
      }],
    })
    if (!imported || imported.added !== 1) throw new Error(`Could not seed synthetic hymn: ${JSON.stringify(imported)}`)

    stage = "load isolated bilingual Scripture fixtures and import a synthetic audio file"
    const translations = await window.__TAURI_INTERNALS__.invoke("list_translations")
    const englishTranslation = translations.find((translation) => translation.abbreviation === "QAEN")
    const yorubaTranslation = translations.find((translation) => translation.abbreviation === "QAYO")
    if (!englishTranslation || !yorubaTranslation) throw new Error(`QA translations were not loaded: ${JSON.stringify(translations)}`)
    qa.bible.getState().setTranslations(translations)
    qa.bible.getState().setActiveTranslation(englishTranslation.id)
    qa.bible.getState().setSecondaryTranslation(yorubaTranslation.id)
    const audioImport = await window.__TAURI_INTERNALS__.invoke("media_import", { paths: [audioFixturePath] })
    const audioAsset = audioImport.find((result) => result.status === "imported")?.asset
    if (!audioAsset) throw new Error(`Could not import the isolated synthetic audio fixture: ${JSON.stringify(audioImport)}`)
    await qa.media.getState().list()
    if (!qa.media.getState().assets.some((asset) => asset.id === audioAsset.id && asset.present)) {
      throw new Error(`The synthetic audio fixture is missing from the isolated media library: ${JSON.stringify(audioAsset)}`)
    }

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
    await setEventDuration(qa, event, 35)

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
    await clickButton("Open Live")
    const baselineRow = await waitFor(
      () => [...document.querySelectorAll('ol[aria-label="Service rundown"] button[title^="Click to preview"]')]
        .find((button) => normal(button.innerText).includes(baseline.reference)),
      "baseline in Live running order",
    )
    await activateButton(baselineRow)
    await waitFor(() => qa.bible.getState().selectedQueueItemId === baseline.id, "baseline Preview selection")
    await clickButton("Take live")
    await waitFor(() => qa.broadcast.getState().isLive && qa.broadcast.getState().liveItemId === baseline.id, "baseline to appear in Program")
    const programOutputBaseline = await captureProgramOutput("baseline", { expectChangeFromInitial: true })
    const renderedBaselineProgram = await waitForProgramCanvas(
      baseline.slide.body,
      "the baseline slide after its explicit Take",
    )
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
        .find((button) => normal(button.innerText) === "Yorùbá"),
      "Yorùbá-first hymn display control",
    )
    await activateButton(languageButton)
    await setInput('input[aria-label="Find a hymn"]', songTitle)
    const hymnResult = await waitFor(
      () => [...document.querySelectorAll('[role="dialog"] button')]
        .find((button) => button.title === "Select to preview and view details" && normal(button.innerText).includes(songTitle)),
      "public-domain hymn in the library picker",
    )
    await activateButton(hymnResult)
    await clickButton("Add to service")
    const hymn = await waitFor(
      () => qa.queue.getState().items.find((item) => item.kind === "song" && item.song?.title === songTitle),
      "public-domain hymn moment to be added to the event",
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
    const expectedInitialIds = [baseline.id, hymn.id, slide.id]
    await waitFor(() => qa.queue.getState().items.map((item) => item.id).join("|") === expectedInitialIds.join("|"), "requested moment order")
    const eventAfterReorder = qa.queue.getState().headers.find((header) => header.id === event.id)
    if (!eventAfterReorder || eventAfterReorder.at !== 1) throw new Error(`Event boundary moved during reorder: ${JSON.stringify(eventAfterReorder)}`)
    if (JSON.stringify(programSnapshot(qa)) !== JSON.stringify(programBeforePrepareEdits)) {
      throw new Error("Editing or reordering the plan changed Program before Take")
    }

    stage = "seed synthetic Preview scene and camera choices"
    const qaScene = {
      id: "qa-six-event-camera-scene",
      name: "QA camera scene (synthetic)",
      background: "#101820",
      layers: [{
        id: "qa-six-event-camera-layer",
        name: "Synthetic pulpit camera",
        kind: "camera",
        box: { x: 0, y: 0, w: 100, h: 100 },
        opacity: 1,
        visible: true,
      }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    qa.broadcast.setState({ scenes: [...qa.broadcast.getState().scenes.filter((scene) => scene.id !== qaScene.id), qaScene] })
    qa.settings.getState().setCameras([{ name: "qa-synthetic-camera", label: "QA camera (synthetic)", token: "" }])

    stage = "plan six distinct events with timer, song, bilingual Scripture, announcement, audio, scene and camera intent"
    const sermonHeader = qa.queue.getState().headers.find((header) => header.id === event.id)
    if (!sermonHeader?.event) throw new Error("Sermon event metadata is missing")

    const publicDomainSong = await qa.songs.getState().load(hymn.song.song_id, { refresh: true })
    const alternateArrangement = publicDomainSong?.arrangements.find((arrangement) => arrangement.name === "Verse repeated (QA alternate)")
    const defaultArrangement = publicDomainSong?.arrangements.find((arrangement) => arrangement.is_default)
    if (!publicDomainSong || !defaultArrangement || !alternateArrangement) throw new Error("The default or named alternate hymn arrangement was not imported")

    const currentSlide = qa.queue.getState().items.find((item) => item.id === slide.id)
    if (!currentSlide || currentSlide.kind !== "slide") throw new Error("The edited Slide is missing before scene setup")
    const currentSlideRow = await waitFor(() => document.querySelector(`[data-rundown-item-id="${slide.id}"]`), "edited Slide row for scene setup")
    await activateButton(currentSlideRow.querySelector('button[title="Click to preview"]'))
    await setNativeSelect(`select[aria-label="Scene for ${currentSlide.reference}"]`, qaScene.id)
    await setNativeSelect(`select[aria-label="Camera for ${currentSlide.reference}"]`, "qa-synthetic-camera")
    await clickTab("Signals")
    const takeSection = await waitFor(
      () => [...document.querySelectorAll("section")].find((section) => normal(section.querySelector("h3")?.innerText) === "When you Take it"),
      "scene Take intent controls",
    )
    const takeSceneCheckbox = takeSection.querySelector('input[type="checkbox"]')
    if (!takeSceneCheckbox) throw new Error("Could not find the scene Take intent checkbox")
    if (!takeSceneCheckbox.checked) takeSceneCheckbox.click()
    await waitFor(
      () => qa.queue.getState().items.find((item) => item.id === slide.id)?.on_take?.includes(`scene.take:${qaScene.id}`),
      "scene Take intent to be saved from its UI control",
    )
    await clickButton("Edit event: Sermon")

    const addEvent = async (label, title, duration) => {
      const before = new Set(qa.queue.getState().headers.map((header) => header.id))
      await clickButton("Add event")
      // The event menu's option reads "<label> Creates <event>" ("Worship" alone when the names match);
      // a bare "Bible" would also match the Add-to-service picker's Bible tab, which stays in the page.
      await clickButton(label === title ? label : `${label} Creates ${title}`, { startsWith: true })
      const header = await waitFor(
        () => qa.queue.getState().headers.find((candidate) => !before.has(candidate.id) && candidate.event && candidate.name === title),
        `${title} event`,
      )
      await setEventDuration(qa, header, duration)
      return header
    }
    const addMomentToEvent = (target, item) => {
      qa.queue.getState().setAddTarget(target.id)
      const addedId = qa.queue.getState().addItem(item, "end")
      qa.queue.getState().setAddTarget(null)
      if (addedId !== item.id) throw new Error(`Could not add ${item.reference} to ${target.name}`)
      return qa.queue.getState().items.find((candidate) => candidate.id === item.id)
    }

    // The selected Hymn row places this first event immediately before Sermon.
    const hymnForPrayerRow = await waitFor(() => document.querySelector(`[data-rundown-item-id="${hymn.id}"]`), "Hymn row before adding Prayer")
    await activateButton(hymnForPrayerRow.querySelector('button[title="Click to preview"]'))
    const prayerEvent = await addEvent("Prayer", "Opening Prayer", 6)
    // Put the opening event before the unchanged Program baseline so the baseline
    // is a pre-service moment inside the first event. This is a planned structure edit.
    qa.queue.getState().updateHeader(prayerEvent.id, { at: 0 })
    const timerCue = addMomentToEvent(prayerEvent, {
      id: crypto.randomUUID(), kind: "cue", reference: "Start prayer timer", confidence: 1, source: "manual", added_at: Date.now(),
    })
    const timerRow = await waitFor(() => document.querySelector(`[data-rundown-item-id="${timerCue.id}"]`), "timer cue row")
    await activateButton(timerRow.querySelector('button[title="Click to preview"]'))
    await clickTab("Timing")
    await setInput('[aria-label="Planned time for Start prayer timer"]', "6")
    document.querySelector('[aria-label="Planned time for Start prayer timer"]')?.blur()
    await clickTab("Signals")
    await setNativeSelect('select[aria-label="Cue when Start prayer timer goes live"]', "timer.fresh")
    await waitFor(() => {
      const item = qa.queue.getState().items.find((candidate) => candidate.id === timerCue.id)
      return item?.planned_minutes === 6 && item.on_live?.cue === "timer.fresh"
    }, "timer cue timing and action set through Prepare")

    await clickButton("Edit event: Opening Prayer")
    const worshipEvent = await addEvent("Worship", "Worship", 12)
    const arrangementMoment = addMomentToEvent(worshipEvent, {
      id: crypto.randomUUID(), kind: "song", song: {
        song_id: hymn.song.song_id, title: songTitle, arrangement_id: null, languages: ["en", "yo"],
      }, reference: `${songTitle} (QA alternate arrangement)`, confidence: 1, source: "manual", added_at: Date.now(),
    })
    const arrangementRow = await waitFor(() => document.querySelector(`[data-rundown-item-id="${arrangementMoment.id}"]`), "song arrangement moment row")
    await activateButton(arrangementRow.querySelector('button[title="Click to preview"]'))
    await clickTab("Slides")
    await clickButton("Order")
    await chooseOption(alternateArrangement.name)
    await waitFor(
      () => qa.queue.getState().items.find((item) => item.id === arrangementMoment.id)?.song?.arrangement_id === alternateArrangement.id,
      "alternate arrangement selected through the song editor",
    )
    await clickTab("Timing")
    await setInput(`[aria-label="Planned time for ${arrangementMoment.reference}"]`, "8")
    document.querySelector(`[aria-label="Planned time for ${arrangementMoment.reference}"]`)?.blur()
    await waitFor(() => qa.queue.getState().items.find((item) => item.id === arrangementMoment.id)?.planned_minutes === 8, "song arrangement planned time")
    await clickButton("Edit event: Worship")

    const scriptureEvent = await addEvent("Bible", "Scripture", 7)
    await clickButton("Edit event: Scripture")
    await clickTab("Content")
    await clickButton("Add content to Scripture")
    // The Add picker opens on the tab used last (the hymn book, earlier in this journey).
    await clickTab("Bible")
    await setInput('input[aria-label="Quick find"]', "John 3 16")
    const verseRow = await waitFor(
      () => [...document.querySelectorAll('ul[aria-live="polite"] li')].find((candidate) => normal(candidate.innerText).includes("John 3:16")),
      "synthetic bilingual John 3:16 result",
    )
    const addVerse = [...verseRow.querySelectorAll("button")].find((button) => normal(button.innerText) === "Add")
    if (!addVerse) throw new Error("QuickFind did not offer the Scripture result to Add")
    await activateButton(addVerse)
    const bibleMoment = await waitFor(
      () => qa.queue.getState().items.find((item) => item.verse?.book_number === 43 && item.verse?.chapter === 3 && item.verse?.verse === 16),
      "bilingual Scripture moment in the service",
    )
    await clickTab("Timing")
    await setInput(`[aria-label="Planned time for ${bibleMoment.reference}"]`, "7")
    document.querySelector(`[aria-label="Planned time for ${bibleMoment.reference}"]`)?.blur()
    await waitFor(() => qa.queue.getState().items.find((item) => item.id === bibleMoment.id)?.planned_minutes === 7, "Scripture planned time")
    await clickButton("Edit event: Scripture")

    const announcementEvent = await addEvent("Announcement", "Announcements", 4)
    await clickButton("Edit event: Announcements")
    await clickTab("Content")
    await clickButton("Add content to Announcements")
    await clickButton("Slides")
    await setInput('[aria-label="Slide title"]', "QA Announcements")
    await setInput('[aria-label="Slide text"]', "Synthetic announcements for the six-event service plan.")
    await clickButton("Add to service")
    const announcementMoment = await waitFor(
      () => qa.queue.getState().items.find((item) => item.kind === "slide" && item.slide?.title === "QA Announcements"),
      "announcement slide in the service",
    )
    await clickTab("Timing")
    await setInput(`[aria-label="Planned time for ${announcementMoment.reference}"]`, "4")
    document.querySelector(`[aria-label="Planned time for ${announcementMoment.reference}"]`)?.blur()
    await waitFor(() => qa.queue.getState().items.find((item) => item.id === announcementMoment.id)?.planned_minutes === 4, "announcement planned time")
    await clickButton("Edit event: Announcements")

    const mediaEvent = await addEvent("Media / Slide", "Media", 5)
    await clickButton("Edit event: Media")
    await clickTab("Content")
    await clickButton("Add content to Media")
    await clickButton("Media")
    const soundRow = await waitFor(
      () => [...document.querySelectorAll('ul[aria-label="Sounds"] li')].find((candidate) => normal(candidate.innerText).includes(audioAsset.name)),
      "isolated synthetic audio in the Media picker",
    )
    const addSound = [...soundRow.querySelectorAll("button")].find((button) => normal(button.innerText).includes("Add"))
    if (!addSound) throw new Error("The Media picker did not offer the synthetic audio to Add")
    await activateButton(addSound)
    const audioMoment = await waitFor(
      () => qa.queue.getState().items.find((item) => item.kind === "audio" && item.audio?.media_id === audioAsset.id),
      "audio moment in the service",
    )
    await clickTab("Timing")
    await setInput(`[aria-label="Planned time for ${audioMoment.reference}"]`, "5")
    document.querySelector(`[aria-label="Planned time for ${audioMoment.reference}"]`)?.blur()
    await waitFor(() => qa.queue.getState().items.find((item) => item.id === audioMoment.id)?.planned_minutes === 5, "audio moment planned time")

    const expectedEventIds = [prayerEvent.id, worshipEvent.id, scriptureEvent.id, announcementEvent.id, mediaEvent.id, event.id]
    const expectedEventPlan = [
      { id: prayerEvent.id, name: "Opening Prayer", duration: 6 },
      { id: worshipEvent.id, name: "Worship", duration: 12 },
      { id: scriptureEvent.id, name: "Scripture", duration: 7 },
      { id: announcementEvent.id, name: "Announcements", duration: 4 },
      { id: mediaEvent.id, name: "Media", duration: 5 },
      { id: event.id, name: "Sermon", duration: 35 },
    ]
    const plannedEvents = qa.queue.getState().headers.filter((header) => header.event).sort((a, b) => a.at - b.at)
    if (JSON.stringify(plannedEvents.map((header) => header.id)) !== JSON.stringify(expectedEventIds)) {
      throw new Error(`The six event boundaries moved unexpectedly: ${JSON.stringify(plannedEvents.map((header) => [header.id, header.name, header.at]))}`)
    }
    const expectedIds = qa.queue.getState().items.map((item) => item.id)
    const expectedKinds = {
      [timerCue.id]: "cue",
      [baseline.id]: "slide",
      [hymn.id]: "song",
      [slide.id]: "slide",
      [arrangementMoment.id]: "song",
      [bibleMoment.id]: bibleMoment.kind ?? "verse",
      [announcementMoment.id]: "slide",
      [audioMoment.id]: "audio",
    }
    const expectedEventMoments = [
      [baseline.id, timerCue.id],
      [arrangementMoment.id],
      [bibleMoment.id],
      [announcementMoment.id],
      [audioMoment.id],
      [hymn.id, slide.id],
    ]
    if (JSON.stringify(programSnapshot(qa)) !== JSON.stringify(programBeforePrepareEdits)) {
      throw new Error("Adding the six-event service content changed Program before Take")
    }

    stage = "save the service"
    await clickButton("Save")
    await waitFor(() => !qa.service.getState().dirty && !qa.service.getState().saving, "service save to finish")
    if (qa.service.getState().current?.id !== serviceId) throw new Error("Saving changed the service ID")

    stage = "continue the open service from Home"
    await clickButton("Home")
    const homeOpenService = await waitFor(
      () => [...document.querySelectorAll('[aria-labelledby="services"] li')].find((row) => normal(row.innerText).startsWith(serviceTitle)),
      "saved service summary on Home",
    )
    if (!normal(homeOpenService.innerText).includes(`${expectedIds.length} item${expectedIds.length === 1 ? "" : "s"}`)) {
      throw new Error(`Home shows the wrong saved service item count: ${normal(homeOpenService.innerText)}`)
    }
    if (![...homeOpenService.querySelectorAll("span")].some((label) => normal(label.innerText) === "open")) {
      throw new Error(`Home does not identify the current service as open: ${normal(homeOpenService.innerText)}`)
    }
    const continueFromHome = await waitFor(
      () => buttons().find((button) => normal(button.innerText).includes(baseline.reference)),
      "service rundown item to continue from Home",
    )
    await activateButton(continueFromHome)
    await waitFor(() => qa.shell.getState().workspace === "prepare" && qa.service.getState().current?.id === serviceId, "Home continuation back to the open service in Prepare")
    if (JSON.stringify(qa.queue.getState().items.map((item) => item.id)) !== JSON.stringify(expectedIds)) {
      throw new Error("Continuing from Home changed the open service item IDs or order")
    }

    stage = "close the service and reopen it from Home's saved-services list"
    await clickButton("Close service")
    await waitFor(() => qa.service.getState().current === null, "service to close")
    await clickButton("Home")
    const homeClosedService = await waitFor(
      () => [...document.querySelectorAll('[aria-labelledby="services"] li')].find((row) => normal(row.innerText).startsWith(serviceTitle)),
      "closed service in Home's saved-services list",
    )
    if (!normal(homeClosedService.innerText).includes(`${expectedIds.length} item${expectedIds.length === 1 ? "" : "s"}`)) {
      throw new Error(`Home shows the wrong saved service item count after close: ${normal(homeClosedService.innerText)}`)
    }
    const openFromHome = [...homeClosedService.querySelectorAll("button")].find((button) => normal(button.innerText) === "Open")
    if (!openFromHome) throw new Error(`Home has no Open action for the saved service: ${normal(homeClosedService.innerText)}`)
    await activateButton(openFromHome)
    await waitFor(() => qa.service.getState().current?.id === serviceId, "saved service to reopen from Home")
    await clickButton("Prepare")
    await waitFor(() => qa.shell.getState().workspace === "prepare" && qa.service.getState().current?.id === serviceId, "reopened service in Prepare")
    const reopened = qa.queue.getState()
    const reopenedIds = reopened.items.map((item) => item.id)
    if (JSON.stringify(reopenedIds) !== JSON.stringify(expectedIds)) throw new Error(`Saved service changed item IDs/order: ${JSON.stringify(reopenedIds)}`)
    const reopenedEvents = reopened.headers.filter((header) => header.event).sort((a, b) => a.at - b.at)
    if (JSON.stringify(reopenedEvents.map((header) => header.id)) !== JSON.stringify(expectedEventIds)) {
      throw new Error(`Saved service changed event IDs/order: ${JSON.stringify(reopenedEvents.map((header) => [header.id, header.name, header.at]))}`)
    }
    if (JSON.stringify(reopenedEvents.map((header) => ({ id: header.id, name: header.name, duration: header.event?.duration_minutes }))) !== JSON.stringify(expectedEventPlan)) {
      throw new Error(`Event names or planned durations did not round-trip: ${JSON.stringify(reopenedEvents.map((header) => ({ id: header.id, name: header.name, duration: header.event?.duration_minutes })))}`)
    }
    for (const [id, expectedKind] of Object.entries(expectedKinds)) {
      const reopenedItem = reopened.items.find((item) => item.id === id)
      const actualKind = reopenedItem?.kind ?? "verse"
      if (actualKind !== expectedKind) throw new Error(`Moment ${id} changed kind: expected ${expectedKind}, received ${actualKind}`)
    }
    const reopenedEventMoments = reopenedEvents.map((header, index) => {
      const end = reopenedEvents[index + 1]?.at ?? reopened.items.length
      return reopened.items.slice(header.at, end).map((item) => item.id)
    })
    if (JSON.stringify(reopenedEventMoments) !== JSON.stringify(expectedEventMoments)) {
      throw new Error(`Saved service changed event moment membership/order: ${JSON.stringify(reopenedEventMoments)}`)
    }
    const reopenedSlide = reopened.items.find((item) => item.id === slide.id)
    const reopenedHymn = reopened.items.find((item) => item.id === hymn.id)
    const reopenedSongArrangement = reopened.items.find((item) => item.id === arrangementMoment.id)
    const reopenedVerse = reopened.items.find((item) => item.id === bibleMoment.id)
    const reopenedAnnouncement = reopened.items.find((item) => item.id === announcementMoment.id)
    const reopenedAudio = reopened.items.find((item) => item.id === audioMoment.id)
    const reopenedTimerCue = reopened.items.find((item) => item.id === timerCue.id)
    const reopenedEvent = reopened.headers.find((header) => header.id === event.id)
    if (reopenedSlide?.slide?.title !== "QA Edited Preview Slide" || reopenedSlide.slide.body !== "Edited synthetic moment; still private until Take.") {
      throw new Error(`Edited Slide did not round-trip: ${JSON.stringify(reopenedSlide)}`)
    }
    if (reopenedHymn?.song?.title !== songTitle || !reopenedEvent?.event) {
      throw new Error("The Hymn or its event did not round-trip")
    }
    if (reopenedHymn.song.languages[0] !== "yo" || !reopenedHymn.song.languages.includes("en")) {
      throw new Error(`The saved Hymn lost one of its selected languages: ${JSON.stringify(reopenedHymn.song.languages)}`)
    }
    if (reopenedHymn.song.arrangement_id != null) {
      throw new Error(`The Hymn picker should retain its default arrangement: ${JSON.stringify(reopenedHymn.song)}`)
    }
    if (reopenedSongArrangement?.kind !== "song" || reopenedSongArrangement.song.arrangement_id !== alternateArrangement.id) {
      throw new Error(`The selected named arrangement did not round-trip: ${JSON.stringify(reopenedSongArrangement)}`)
    }
    const persistedHymn = await qa.songs.getState().load(reopenedHymn.song.song_id, { refresh: true })
    const persistedTexts = persistedHymn?.sections[0]?.texts
    if (persistedTexts?.en !== englishWords || persistedTexts?.yo !== yorubaWords || persistedTexts.en === persistedTexts.yo) {
      throw new Error(`Distinct English and Yorùbá words did not round-trip: ${JSON.stringify(persistedTexts)}`)
    }
    if (!persistedHymn?.arrangements.some((arrangement) => arrangement.id === alternateArrangement.id && arrangement.name === alternateArrangement.name)) {
      throw new Error(`Named alternate hymn arrangement was not in the saved library: ${JSON.stringify(persistedHymn?.arrangements)}`)
    }
    if (!reopenedVerse || reopenedVerse.translation !== englishTranslation.abbreviation || reopenedVerse.secondary_translation !== yorubaTranslation.abbreviation) {
      throw new Error(`Bilingual Scripture translation selection did not round-trip: ${JSON.stringify(reopenedVerse)}`)
    }
    const persistedEnglishVerse = await window.__TAURI_INTERNALS__.invoke("get_verse", { translationId: englishTranslation.id, bookNumber: 43, chapter: 3, verse: 16 })
    const persistedYorubaVerse = await window.__TAURI_INTERNALS__.invoke("get_verse", { translationId: yorubaTranslation.id, bookNumber: 43, chapter: 3, verse: 16 })
    if (!persistedEnglishVerse?.text || !persistedYorubaVerse?.text || persistedEnglishVerse.text === persistedYorubaVerse.text) {
      throw new Error("Synthetic English and Yorùbá Bible fixtures did not remain distinct")
    }
    if (reopenedAnnouncement?.kind !== "slide" || reopenedAnnouncement.slide?.title !== "QA Announcements" || !reopenedAnnouncement.slide.body.includes("Synthetic announcements")) {
      throw new Error(`Announcement slide did not round-trip: ${JSON.stringify(reopenedAnnouncement)}`)
    }
    if (reopenedAudio?.kind !== "audio" || reopenedAudio.audio?.media_id !== audioAsset.id || !qa.media.getState().assets.some((asset) => asset.id === audioAsset.id && asset.present)) {
      throw new Error(`Audio media reference did not round-trip: ${JSON.stringify(reopenedAudio)}`)
    }
    if (reopenedSlide?.scene_id !== qaScene.id || reopenedSlide.camera !== "qa-synthetic-camera" || !reopenedSlide.on_take?.includes(`scene.take:${qaScene.id}`)) {
      throw new Error(`Scene/camera Preview intent did not round-trip: ${JSON.stringify(reopenedSlide)}`)
    }
    if (reopenedTimerCue?.on_live?.cue !== "timer.fresh" || reopenedTimerCue.planned_minutes !== 6) {
      throw new Error(`Planned timer cue or duration did not round-trip: ${JSON.stringify(reopenedTimerCue)}`)
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
    const programAfterHymnPreview = programSnapshot(qa)
    if (JSON.stringify(programAfterHymnPreview) !== JSON.stringify(programBeforePrepareEdits)) {
      throw new Error("Preview changed Program before explicit Take")
    }

    stage = "preview bilingual Scripture from the reopened service"
    const reopenedBibleRow = await waitFor(() => document.querySelector(`[data-rundown-item-id="${bibleMoment.id}"]`), "reopened bilingual Scripture row")
    await activateButton(reopenedBibleRow.querySelector('button[title="Click to preview"]'))
    await waitFor(() => {
      const preview = qa.bible.getState()
      return preview.selectedQueueItemId === bibleMoment.id && preview.selectedVerse?.book_number === 43 && preview.selectedVerse.chapter === 3 && preview.selectedVerse.verse === 16
    }, "reopened bilingual Scripture to become the private Preview selection")
    const programAfterPreview = programSnapshot(qa)
    if (JSON.stringify(programAfterPreview) !== JSON.stringify(programBeforePrepareEdits)) {
      throw new Error("Bilingual Scripture Preview changed Program before explicit Take")
    }

    stage = "verify primary Scripture Preview and bilingual render state after explicit Take"
    await clickButton("Open Live")
    const previewPanel = await waitFor(() => document.querySelector('[data-slot="preview-panel"]'), "Live Preview panel")
    const previewCanvas = await waitFor(() => previewPanel.querySelector('canvas[role="img"]'), "accessible Live Preview canvas")
    const previewLabel = await waitFor(
      () => {
        const label = previewCanvas.getAttribute("aria-label") ?? ""
        return label.includes(persistedEnglishVerse.text) ? label : null
      },
      "the selected primary synthetic Scripture text in Preview",
    )
    if (qa.broadcast.getState().liveItemId !== baseline.id) throw new Error("Program stopped showing the baseline before Take")
    const renderedProgramBeforeTake = await waitForProgramCanvas(
      baseline.slide.body,
      "the unchanged baseline while Scripture is in Preview",
    )
    if (!renderedProgramBeforeTake.includes("QA Program Baseline")) {
      throw new Error(`Rendered Program lost its baseline before Take: ${renderedProgramBeforeTake}`)
    }
    const programOutputBeforeTake = await captureProgramOutput("before-take", { expectedHash: programOutputBaseline.hash })
    if (programOutputBeforeTake.hash !== programOutputBaseline.hash) {
      throw new Error("The broadcast-main output canvas changed while Scripture was only in Preview")
    }
    await clickButton("Take live")
    await waitFor(() => {
      const live = qa.broadcast.getState()
      return live.isLive && live.liveItemId === bibleMoment.id
    }, "explicit Take to update Program to bilingual Scripture")
    const programAfterTake = programSnapshot(qa)
    if (programAfterTake.liveItemId !== bibleMoment.id) throw new Error(`Take did not select Scripture for Program: ${JSON.stringify(programAfterTake)}`)
    const liveScripture = qa.broadcast.getState().liveVerse
    const liveTranslations = liveScripture?.translationLines ?? []
    if (liveTranslations.length !== 2 || liveTranslations[0] !== persistedEnglishVerse.text || liveTranslations[1] !== persistedYorubaVerse.text) {
      throw new Error(`Explicit Take did not put both synthetic translations in the live render state: ${JSON.stringify(liveScripture)}`)
    }
    const renderedProgramAfterTake = await waitForProgramCanvas(
      persistedEnglishVerse.text,
      "the reopened Scripture after its explicit Take",
    )
    const programOutputAfterTake = await captureProgramOutput("after-take", { expectedChangeFromHash: programOutputBaseline.hash })
    if (programOutputAfterTake.hash === programOutputBaseline.hash) {
      throw new Error("The broadcast-main output canvas did not change after explicit Take")
    }

    return {
      service: { id: serviceId, title: serviceTitle },
      events: reopenedEvents.map((header, index) => {
        const end = reopenedEvents[index + 1]?.at ?? reopened.items.length
        const eventMoments = reopened.items.slice(header.at, end)
        return {
          id: header.id,
          title: header.name,
          durationMinutes: header.event?.duration_minutes ?? null,
          momentIds: eventMoments.map((item) => item.id),
          moments: eventMoments.map((item) => ({
            id: item.id,
            kind: item.kind ?? "verse",
            reference: item.reference,
            plannedMinutes: item.planned_minutes ?? null,
            ...(item.kind === "song" ? {
              arrangement: item.song.arrangement_id === alternateArrangement.id ? alternateArrangement.name : defaultArrangement.name,
            } : {}),
          })),
        }
      }),
      eventIdsInOrder: reopenedEvents.map((header) => header.id),
      itemIdsInOrder: reopenedIds,
      fixtures: {
        hymn: {
          title: songTitle,
          licence: "public_domain",
          arrangement: defaultArrangement.name,
          languages: ["en", "yo"],
          englishText: englishWords,
          yorubaText: yorubaWords,
          yorubaTextIsSynthetic: true,
        },
        worshipArrangementMoment: {
          id: arrangementMoment.id,
          title: arrangementMoment.reference,
          arrangement: alternateArrangement.name,
        },
        scripture: {
          reference: "John 3:16",
          translations: [englishTranslation.abbreviation, yorubaTranslation.abbreviation],
          textsAreSynthetic: true,
        },
        announcement: { title: reopenedAnnouncement.slide.title, body: reopenedAnnouncement.slide.body },
        audio: { id: audioAsset.id, name: audioAsset.name, mediaId: reopenedAudio.audio.media_id, playbackVerified: false },
        sceneCamera: { sceneId: qaScene.id, cameraName: "qa-synthetic-camera", cameraLabel: "QA camera (synthetic)", hardwareVerified: false },
        timer: { cue: reopenedTimerCue.on_live.cue, plannedMinutes: reopenedTimerCue.planned_minutes },
      },
      limitations: [
        "Ticker cues are unsupported on the #494 base; the announcement slide does not count as ticker coverage.",
        "The synthetic audio file and its service reference are persisted, but this journey does not verify playback on audio hardware.",
        "The synthetic scene and camera name prove saved intent only; no physical camera input or camera routing is tested.",
        "The timer cue and planned minutes are saved but not run; post-Take bilingual Scripture is checked in render state, not by reading text from the Program raster.",
        "This journey does not validate offline LAN operation, external TV/OBS/phone outputs, frame rate, latency, audio/video sync, soak behavior, or an accessibility matrix.",
      ],
      previewLabel,
      renderedBaselineProgram,
      renderedProgramBeforeTake,
      renderedProgramAfterTake,
      programOutputBaseline,
      programOutputBeforeTake,
      programOutputAfterTake,
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
