// Native Tauri acceptance scenario for approved service scene revisions.
// The QA profile and all service/scene data are synthetic and isolated.
const waitFor = async (predicate, label, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await sleep(50)
  }
  throw new Error("Timed out waiting for " + label)
}
const waitForAsync = async (predicate, label, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await predicate()
    if (value) return value
    await sleep(50)
  }
  throw new Error("Timed out waiting for " + label)
}
const normal = (value) => String(value ?? "").replace(/\s+/g, " ").trim()
const designedMomentSceneId = (ref) => `design-${ref.id}-v${ref.version}${ref.pageId ? `-page-${encodeURIComponent(ref.pageId)}` : ""}`
const buttons = () => [...document.querySelectorAll("button, [role=tab]")]
const activateButton = async (button, label) => {
  if (button.disabled || button.getAttribute("aria-disabled") === "true") throw new Error("Button “" + label + "” is disabled")
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
      const label = normal(candidate.getAttribute("aria-label") || candidate.textContent)
      return startsWith ? label.startsWith(name) : label === name
    }),
    "button “" + name + "”",
  )
  return activateButton(button, name)
}
const clickWithin = async (selector, name) => {
  const button = await waitFor(
    () => [...(document.querySelector(selector)?.querySelectorAll("button") ?? [])]
      .find((candidate) => normal(candidate.textContent) === name),
    `button “${name}” in ${selector}`,
  )
  return activateButton(button, name)
}
const setInput = async (selector, value) => {
  const input = await waitFor(() => document.querySelector(selector), "input " + selector)
  return setControlValue(input, value, selector)
}
const setControlValue = async (input, value, label) => {
  input.focus()
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set
  if (!setter) throw new Error("No value setter for " + label)
  setter.call(input, value)
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }))
  input.dispatchEvent(new Event("change", { bubbles: true }))
  await sleep(100)
}
const setLabeledColor = async (labelText, value) => {
  const label = await waitFor(
    () => [...document.querySelectorAll("label")].find((candidate) => normal(candidate.textContent).startsWith(labelText)),
    "colour control “" + labelText + "”",
  )
  const input = label.querySelector('input[type="color"]')
  if (!input) throw new Error("Colour control “" + labelText + "” is not editable")
  await setControlValue(input, value, labelText)
}
const sceneState = (broadcast, outputId) => {
  const state = broadcast.getState()
  const output = state.outputs.find((candidate) => candidate.id === outputId)
  const frame = state.outputFrames[outputId]
  if (!output) throw new Error("Missing output " + outputId)
  return JSON.parse(JSON.stringify({
    sceneId: output.sceneId ?? null,
    sceneSnapshot: output.sceneSnapshot ?? null,
    sceneAppearanceSnapshot: output.sceneAppearanceSnapshot ?? null,
    frameScene: frame?.scene ? { background: frame.scene.background } : null,
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
const captureProgramOutput = async (outputId, name, conditions = {}) => {
  let resolveCapture
  let rejectCapture
  let unlisten = null
  const captured = new Promise((resolve, reject) => {
    resolveCapture = resolve
    rejectCapture = reject
  })
  const timeout = setTimeout(() => rejectCapture(new Error(`Timed out capturing ${outputId} Program at ${name}`)), 12000)
  try {
    unlisten = await listenTauriEvent("qa:program-capture-ack", (event) => {
      if (event.payload?.outputId !== outputId || event.payload?.name !== name) return
      if (event.payload.error) rejectCapture(new Error(`${outputId} Program capture ${name} failed: ${event.payload.error}`))
      else resolveCapture(event.payload.frame)
    })
    await window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {
      event: "qa:program-checkpoint",
      payload: { outputId, name, ...conditions },
    })
    return await captured
  } finally {
    clearTimeout(timeout)
    await unlisten?.()
  }
}
const programState = (broadcast) => {
  const state = broadcast.getState()
  return JSON.parse(JSON.stringify({
    isLive: state.isLive,
    liveItemId: state.liveItemId,
    liveItem: state.liveItem,
    liveSlide: state.liveSlide,
    liveVerse: state.liveVerse,
  }))
}

async function runScenario() {
  await waitFor(() => document.querySelector("#root")?.childElementCount, "Rhema Studio window")
  const qa = await waitFor(() => window.__rhemaQa?.(), "isolated QA stores")
  let stage = "dismiss first-run setup in the isolated profile"
  try {
    await clickButton("Use Rhema Studio now, finish later", { startsWith: true })
    await waitFor(() => !qa.shell.getState().setupOpen, "setup state to close")
    await waitFor(() => !!qa.settings.getState().setup.dismissedAt, "setup dismissal to save")
    await waitFor(() => !document.querySelector('[role="dialog"][data-state="open"]'), "setup dialog to close")

    stage = "set the isolated QA operator"
    qa.settings.getState().setOperatorName("QA Operator")
    await window.__TAURI_INTERNALS__.invoke("content_set_actor", { name: "QA Operator" })

    stage = "choose and customize a scene template in Design"
    await clickButton("Design")
    await waitFor(() => qa.shell.getState().workspace === "design", "Design workspace")
    await clickWithin('nav[aria-label="Design sections"]', "My Designs")
    await waitFor(
      () => normal(document.querySelector('nav[aria-label="Design sections"] button[aria-current="page"]')?.textContent) === "My Designs",
      "My Designs section",
    )
    await clickWithin('aside[aria-label="My designs"]', "Templates")
    await clickWithin('[role="radiogroup"][aria-label="Background"]', "Dark")
    await clickButton("Customize a copy")
    await waitFor(() => document.querySelector('input#design-document-title'), "editable design template copy")
    await setInput("input#design-document-title", "QA Approved Design")
    await setLabeledColor("Background colour", "#123456")
    await setInput('input[aria-label="Version note"]', "QA approved scene baseline")
    await clickButton("Save draft")
    await waitFor(
      () => [...document.querySelectorAll("button")].find((button) => normal(button.textContent) === "Save draft")?.disabled,
      "Design draft to save",
    )
    const designDocument = await waitForAsync(
      async () => (await window.__TAURI_INTERNALS__.invoke("design_list"))
        .find((candidate) => candidate.title === "QA Approved Design" && candidate.revision >= 2),
      "saved Design document",
    )
    await clickButton("Create version")
    await waitForAsync(
      () => window.__TAURI_INTERNALS__.invoke("design_get_version", { id: designDocument.id, version: 1 }),
      "immutable Design version 1",
    )
    if (!designDocument) throw new Error("The saved design document is missing from the local Design library")
    const designVersion = await window.__TAURI_INTERNALS__.invoke("design_get_version", { id: designDocument.id, version: 1 })
    if (!designVersion?.document) throw new Error("The immutable Design version could not be reopened")

    stage = "open Live production tools and save a separate output-scoped scene"
    await clickButton("Live")
    await clickButton("Open production tools")
    await clickButton("Scenes")
    await clickButton("Full screen")
    const sceneNameInput = await waitFor(() => document.querySelector('input[aria-label="Scene name"]'), "scene name field")
    await waitFor(() => sceneNameInput.value === "Full screen", "scene draft to load")
    await setInput('input[aria-label="Scene name"]', "QA Manual Scene")
    await setInput('input[aria-label="Background colour"]', "#2468ac")
    await clickButton("Save scene")
    const scene = await waitFor(
      () => qa.broadcast.getState().scenes.find((candidate) => candidate.name === "QA Manual Scene" && candidate.background === "#2468ac"),
      "manual QA scene to save",
    )
    const sceneId = scene.id
    // Keep the independent scene fixture flat so its centre pixel proves its approved revision.
    qa.broadcast.getState().saveScene({ ...scene, layers: [] })
    await waitFor(
      () => qa.broadcast.getState().scenes.find((candidate) => candidate.id === sceneId)?.layers.length === 0,
      "flat synthetic scene fixture",
    )

    stage = "prepare independent baseline scenes on two outputs"
    const main = qa.broadcast.getState().outputs.find((candidate) => candidate.id === "main")
    const secondary = qa.broadcast.getState().outputs.find((candidate) => candidate.id === "qa-secondary")
    if (!main || !secondary) throw new Error("The isolated QA output windows were not prepared")

    const mainBaseline = {
      id: "qa-main-baseline",
      name: "QA Main Baseline",
      background: "#112233",
      layers: [],
      createdAt: 0,
      updatedAt: 0,
    }
    const secondaryBaseline = {
      id: "qa-secondary-baseline",
      name: "QA Secondary Baseline",
      background: "#56789a",
      layers: [],
      createdAt: 0,
      updatedAt: 0,
    }
    qa.broadcast.getState().saveScene(mainBaseline)
    qa.broadcast.getState().saveScene(secondaryBaseline)
    qa.broadcast.getState().takeScene("main", mainBaseline.id, "QA Operator")
    qa.broadcast.getState().takeScene("qa-secondary", secondaryBaseline.id, "QA Operator")
    const mainBefore = sceneState(qa.broadcast, "main")
    const secondaryBefore = sceneState(qa.broadcast, "qa-secondary")
    if (mainBefore.sceneSnapshot?.background !== "#112233" || mainBefore.frameScene?.background !== "#112233") {
      throw new Error("Could not establish the Main Display baseline scene")
    }
    if (secondaryBefore.sceneSnapshot?.background !== "#56789a" || secondaryBefore.frameScene?.background !== "#56789a") {
      throw new Error("Could not establish the secondary output baseline scene")
    }
    const mainProgramBaseline = await captureProgramOutput("main", "baseline-main", { expectedPixel: [17, 34, 51, 255] })
    const secondaryProgramBaseline = await captureProgramOutput("qa-secondary", "baseline-secondary", { expectedPixel: [86, 120, 154, 255] })

    stage = "create an event and three moments through Prepare"
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
    const addSlideToEvent = async (title, body) => {
      await clickButton("Edit event: Sermon")
      await clickButton("Add content to Sermon")
      await clickButton("Slides")
      await setInput('input[aria-label="Slide title"]', title)
      await setInput('textarea[aria-label="Slide text"]', body)
      await clickButton("Add to service")
      return waitFor(
        () => qa.queue.getState().items.find((item) => item.kind === "slide" && item.slide?.title === title),
        title + " moment",
      )
    }
    const manualItem = await addSlideToEvent("QA Manual Scene Moment", "Synthetic operator-scoped scene test.")
    const designedItem = await addSlideToEvent("QA Designed Moment", "Synthetic pinned Design version test.")
    const followingItem = await addSlideToEvent("QA Following Moment", "Synthetic restore-after-designed-moment test.")

    stage = "attach the manual scene to Main through the event scene controls"
    await clickButton("Edit event: Sermon")
    await clickButton("Event scenes")
    await setInput('select[aria-label="Scene for QA Manual Scene Moment"]', sceneId)
    await clickButton("Add screen override for QA Manual Scene Moment")
    await waitFor(
      () => qa.queue.getState().items.find((item) => item.id === manualItem.id)?.on_take?.includes("scene.take:" + sceneId + "@main"),
      "Main-only manual scene Take intent",
    )

    stage = "attach saved Design version 1 to its exact Prepare moment"
    await clickButton("Edit event: Sermon")
    await clickButton("Event scenes")
    await clickButton("Choose a scene design for QA Designed Moment")
    await clickButton("My Designs")
    await clickButton("Preview version 1")
    await waitFor(() => document.body.innerText.includes("Private artwork preview"), "saved design artwork preview")
    await clickButton("Use in Prepare")
    const pinnedItem = await waitFor(() => {
      const item = qa.queue.getState().items.find((candidate) => candidate.id === designedItem.id)
      return item?.slide?.designRef?.id === designDocument.id && item.slide.designRef.version === 1 && item.scene_id ? item : null
    }, "saved Design version to be pinned to the chosen Prepare moment")
    const pinnedSceneId = pinnedItem.scene_id
    const pinnedScene = qa.broadcast.getState().scenes.find((candidate) => candidate.id === pinnedSceneId)
    if (pinnedScene?.design?.id !== designDocument.id || pinnedScene.design.version !== 1) {
      throw new Error("Prepare did not save the selected version as a pinned scene")
    }

    stage = "save and reopen the service from Home"
    await clickButton("Save")
    await waitFor(() => !qa.service.getState().dirty, "service plan to save")
    await clickButton("Close service")
    await waitFor(() => qa.service.getState().current === null, "service to close")
    await clickButton("Home")
    const serviceRow = await waitFor(
      () => [...document.querySelectorAll('[aria-labelledby="services"] li')]
        .find((row) => normal(row.textContent).startsWith(serviceTitle)),
      "saved service in Home",
    )
    const openService = [...serviceRow.querySelectorAll("button")].find((button) => normal(button.textContent) === "Open")
    if (!openService) throw new Error("Home did not offer an Open action for the saved service")
    await openService.click()
    await waitFor(() => qa.service.getState().current?.id === serviceId, "saved service to reopen")
    await clickButton("Prepare")
    await waitFor(() => qa.shell.getState().workspace === "prepare" && qa.service.getState().current?.id === serviceId, "reopened service in Prepare")
    const reopened = qa.queue.getState()
    const expectedIds = [manualItem.id, designedItem.id, followingItem.id]
    if (JSON.stringify(reopened.items.map((item) => item.id)) !== JSON.stringify(expectedIds)) {
      throw new Error("Save/reopen changed moment IDs or order: " + JSON.stringify(reopened.items.map((item) => item.id)))
    }
    const reopenedManual = reopened.items.find((item) => item.id === manualItem.id)
    const reopenedDesigned = reopened.items.find((item) => item.id === designedItem.id)
    if (!reopenedManual?.on_take?.includes("scene.take:" + sceneId + "@main")) {
      throw new Error("Save/reopen lost the Main-only manual scene Take intent")
    }
    if (reopenedDesigned?.slide?.designRef?.id !== designDocument.id || reopenedDesigned.slide.designRef.version !== 1 || reopenedDesigned.scene_id !== pinnedSceneId) {
      throw new Error("Save/reopen changed the pinned Design identity, version, or scene")
    }

    stage = "approve the saved service through Prepare"
    await clickButton("Approve")
    await waitFor(() => {
      const service = qa.service.getState()
      return service.current?.approved_revision === service.current?.revision
        && service.approvedDesignRevision === service.current?.revision
        && service.approvedDesigns?.scenes[sceneId]?.scene?.background === "#2468ac"
        && service.approvedDesigns?.scenes[sceneId]?.outputs?.main
        && service.approvedDesigns?.scenes[sceneId]?.outputs?.["qa-secondary"]
        && service.approvedDesigns?.moments?.[designedItem.id]?.id === designDocument.id
        && service.approvedDesigns?.moments?.[designedItem.id]?.version === 1
    }, "approved service scene and output snapshots")
    const serviceAtApproval = qa.service.getState()
    const approvedManualScene = serviceAtApproval.approvedDesigns.scenes[sceneId].scene
    const approvalRevision = serviceAtApproval.current.approved_revision

    stage = "change the reusable scene after approval without changing Program"
    qa.broadcast.getState().saveScene({
      ...qa.broadcast.getState().scenes.find((candidate) => candidate.id === sceneId),
      name: "QA Manual Scene Edited After Approval",
      background: "#405060",
    })
    const savedDraft = qa.broadcast.getState().scenes.find((candidate) => candidate.id === sceneId)
    if (savedDraft?.name !== "QA Manual Scene Edited After Approval" || savedDraft.background !== "#405060") {
      throw new Error("The post-approval reusable scene edit did not save")
    }
    if (JSON.stringify(sceneState(qa.broadcast, "main")) !== JSON.stringify(mainBefore)) {
      throw new Error("Editing the reusable scene changed the Main Display before Take")
    }
    if (JSON.stringify(sceneState(qa.broadcast, "qa-secondary")) !== JSON.stringify(secondaryBefore)) {
      throw new Error("Editing the reusable scene changed the secondary output before Take")
    }

    stage = "save a newer Design version while the service still pins version 1"
    await clickButton("Design")
    const designRow = await waitFor(
      () => [...document.querySelectorAll('aside[aria-label="My designs"] button')]
        .find((button) => normal(button.textContent).startsWith("QA Approved Design")),
      "QA design in My Designs",
    )
    await designRow.click()
    await waitFor(() => document.querySelector('input#design-document-title')?.value === "QA Approved Design", "saved design editor to reopen")
    await setLabeledColor("Background colour", "#405060")
    await clickButton("Save draft")
    await waitFor(
      () => [...document.querySelectorAll("button")].find((button) => normal(button.textContent) === "Save draft")?.disabled,
      "newer design draft to save",
    )
    await clickButton("Create version")
    await waitForAsync(
      () => window.__TAURI_INTERNALS__.invoke("design_get_version", { id: designDocument.id, version: 2 }),
      "immutable Design version 2",
    )
    await clickButton("Prepare")
    await waitFor(() => qa.shell.getState().workspace === "prepare" && qa.service.getState().current?.id === serviceId, "approved service to remain open after design edit")
    if (qa.service.getState().approvedDesigns?.moments?.[designedItem.id]?.version !== 1) {
      throw new Error("Creating a newer design version changed the approved service's pinned version")
    }

    stage = "preview the manual scene moment without changing Program"
    await clickButton("Live")
    const rundownRowFor = async (reference) => waitFor(
      () => [...document.querySelectorAll('ol[aria-label="Service rundown"] button[title^="Click to preview"]')]
        .find((button) => normal(button.textContent).includes(reference)),
      reference + " in Live's service rundown",
    )
    const manualRow = await rundownRowFor(manualItem.reference)
    const programBeforeManualPreview = programState(qa.broadcast)
    await manualRow.click()
    await waitFor(() => qa.bible.getState().selectedQueueItemId === manualItem.id, "manual moment Preview")
    if (JSON.stringify(programState(qa.broadcast)) !== JSON.stringify(programBeforeManualPreview)) {
      throw new Error("Preview changed Program before taking the manual-scene moment")
    }
    if (JSON.stringify(sceneState(qa.broadcast, "main")) !== JSON.stringify(mainBefore)
      || JSON.stringify(sceneState(qa.broadcast, "qa-secondary")) !== JSON.stringify(secondaryBefore)) {
      throw new Error("Preview changed an output scene before explicit Take")
    }
    const mainProgramBeforeManualTake = await captureProgramOutput("main", "before-manual-take-main", {
      expectedHash: mainProgramBaseline.hash,
      expectedPixel: [17, 34, 51, 255],
    })
    const secondaryProgramBeforeManualTake = await captureProgramOutput("qa-secondary", "before-manual-take-secondary", {
      expectedHash: secondaryProgramBaseline.hash,
      expectedPixel: [86, 120, 154, 255],
    })

    stage = "Take the approved output-scoped manual scene"
    await clickButton("Take live")
    await waitFor(() => {
      const output = qa.broadcast.getState().outputs.find((candidate) => candidate.id === "main")
      return qa.broadcast.getState().liveItemId === manualItem.id
        && output?.sceneSnapshot?.background === "#2468ac"
        && output?.sceneAppearanceSnapshot?.approved?.revision === approvalRevision
    }, "approved manual scene on Main")
    const afterManualTake = qa.broadcast.getState()
    const mainAfterManual = sceneState(qa.broadcast, "main")
    const secondaryAfterManual = sceneState(qa.broadcast, "qa-secondary")
    const manualApproval = afterManualTake.outputs.find((candidate) => candidate.id === "main")?.sceneAppearanceSnapshot?.approved
    if (JSON.stringify(secondaryAfterManual) !== JSON.stringify(secondaryBefore)) {
      throw new Error("Taking the Main-only scene changed the other congregation output")
    }
    if (mainAfterManual.sceneId !== sceneId || mainAfterManual.sceneSnapshot?.name !== approvedManualScene.name || mainAfterManual.sceneSnapshot?.background !== "#2468ac") {
      throw new Error("Main did not receive the approved scene revision")
    }
    if (mainAfterManual.sceneSnapshot?.background === savedDraft.background) {
      throw new Error("Manual scene Take used the post-approval draft")
    }
    const mainProgramAfterManualTake = await captureProgramOutput("main", "after-manual-take-main", {
      expectedChangeFromHash: mainProgramBaseline.hash,
      expectedPixel: [36, 104, 172, 255],
    })
    const secondaryProgramAfterManualTake = await captureProgramOutput("qa-secondary", "after-manual-take-secondary", {
      expectedHash: secondaryProgramBaseline.hash,
      expectedPixel: [86, 120, 154, 255],
    })

    stage = "preview the approved pinned design without changing Program"
    const designedRow = await rundownRowFor(designedItem.reference)
    const programBeforeDesignedPreview = programState(qa.broadcast)
    await designedRow.click()
    await waitFor(() => qa.bible.getState().selectedQueueItemId === designedItem.id, "designed moment Preview")
    if (JSON.stringify(programState(qa.broadcast)) !== JSON.stringify(programBeforeDesignedPreview)) {
      throw new Error("Preview changed Program before taking the pinned design")
    }
    if (JSON.stringify(sceneState(qa.broadcast, "main")) !== JSON.stringify(mainAfterManual)
      || JSON.stringify(sceneState(qa.broadcast, "qa-secondary")) !== JSON.stringify(secondaryAfterManual)) {
      throw new Error("Preview of the pinned design changed an output before explicit Take")
    }
    const mainProgramBeforeDesignedTake = await captureProgramOutput("main", "before-designed-take-main", {
      expectedHash: mainProgramAfterManualTake.hash,
    })
    const secondaryProgramBeforeDesignedTake = await captureProgramOutput("qa-secondary", "before-designed-take-secondary", {
      expectedHash: secondaryProgramAfterManualTake.hash,
    })

    stage = "Take the approved pinned design version"
    await clickButton("Take live")
    const designRef = designedItem.slide.designRef
    const designSceneId = designedMomentSceneId(designRef)
    await waitFor(() => {
      const state = qa.broadcast.getState()
      return state.liveItemId === designedItem.id
        && state.outputs.filter((candidate) => (candidate.role ?? "congregation") === "congregation")
          .every((candidate) => candidate.sceneId === designSceneId
            && candidate.sceneSnapshot?.design?.id === designRef.id
            && candidate.sceneSnapshot?.design?.version === designRef.version
            && candidate.sceneSnapshot?.design?.pageId === designRef.pageId
            && candidate.sceneSnapshot?.background === "#123456")
    }, "approved Design version 1 on congregation outputs")
    const afterDesignedTake = qa.broadcast.getState()
    const mainAfterDesigned = sceneState(qa.broadcast, "main")
    const secondaryAfterDesigned = sceneState(qa.broadcast, "qa-secondary")
    if (!afterDesignedTake.isLive || afterDesignedTake.liveItemId !== designedItem.id) {
      throw new Error("Taking the pinned design did not activate its content")
    }
    if (mainAfterDesigned.sceneId !== designSceneId || secondaryAfterDesigned.sceneId !== designSceneId) {
      throw new Error("The pinned design did not reach every configured congregation output")
    }
    if (mainAfterDesigned.sceneSnapshot?.design?.id !== designRef.id || mainAfterDesigned.sceneSnapshot.design.version !== designRef.version || mainAfterDesigned.sceneSnapshot.design.pageId !== designRef.pageId
      || secondaryAfterDesigned.sceneSnapshot?.design?.id !== designRef.id || secondaryAfterDesigned.sceneSnapshot.design.version !== designRef.version || secondaryAfterDesigned.sceneSnapshot.design.pageId !== designRef.pageId) {
      throw new Error("The output did not retain the exact approved Design identity and version")
    }
    if (mainAfterDesigned.sceneSnapshot?.background !== "#123456" || secondaryAfterDesigned.sceneSnapshot?.background !== "#123456") {
      throw new Error("Taking version 1 used the newer draft/version 2 design content")
    }
    const mainProgramAfterDesignedTake = await captureProgramOutput("main", "after-designed-take-main", {
      expectedChangeFromHash: mainProgramAfterManualTake.hash,
    })
    const secondaryProgramAfterDesignedTake = await captureProgramOutput("qa-secondary", "after-designed-take-secondary", {
      expectedChangeFromHash: secondaryProgramAfterManualTake.hash,
    })

    stage = "move on and restore each output's previous scene"
    const followingRow = await rundownRowFor(followingItem.reference)
    const programBeforeFollowingPreview = programState(qa.broadcast)
    await followingRow.click()
    await waitFor(() => qa.bible.getState().selectedQueueItemId === followingItem.id, "following moment Preview")
    if (JSON.stringify(programState(qa.broadcast)) !== JSON.stringify(programBeforeFollowingPreview)) {
      throw new Error("Preview of the following moment changed Program")
    }
    await clickButton("Take live")
    await waitFor(() => {
      const state = qa.broadcast.getState()
      const mainOutput = state.outputs.find((candidate) => candidate.id === "main")
      const secondaryOutput = state.outputs.find((candidate) => candidate.id === "qa-secondary")
      return state.liveItemId === followingItem.id
        && mainOutput?.sceneId === sceneId
        && mainOutput?.sceneSnapshot?.name === approvedManualScene.name
        && secondaryOutput?.sceneId === secondaryBefore.sceneId
    }, "designed-moment restoration to the per-output prior scenes")
    const afterRestore = qa.broadcast.getState()
    const mainAfterRestore = sceneState(qa.broadcast, "main")
    const secondaryAfterRestore = sceneState(qa.broadcast, "qa-secondary")
    if (mainAfterRestore.sceneSnapshot?.background !== "#2468ac" || secondaryAfterRestore.sceneSnapshot?.background !== "#56789a") {
      throw new Error("Moving off the designed moment did not restore each output's intended Program scene")
    }
    const mainProgramAfterRestore = await captureProgramOutput("main", "after-designed-restore-main", {
      expectedChangeFromHash: mainProgramAfterDesignedTake.hash,
    })
    const secondaryProgramAfterRestore = await captureProgramOutput("qa-secondary", "after-designed-restore-secondary", {
      expectedChangeFromHash: secondaryProgramAfterDesignedTake.hash,
    })

    return {
      design: { id: designDocument.id, title: designDocument.title, takenVersion: 1, newerVersion: 2 },
      service: { id: serviceAtApproval.current.id, title: serviceAtApproval.current.title, revision: approvalRevision },
      manualScene: { id: sceneId, name: approvedManualScene.name, background: approvedManualScene.background },
      pinnedMoment: { itemId: designedItem.id, designId: designRef.id, version: designRef.version, pageId: designRef.pageId, sceneId: designSceneId, preparedSceneId: pinnedSceneId },
      beforePreview: { main: mainBefore, secondary: secondaryBefore },
      afterManualTake: { main: mainAfterManual, secondary: secondaryAfterManual },
      afterDesignedTake: { main: mainAfterDesigned, secondary: secondaryAfterDesigned },
      afterRestore: { main: mainAfterRestore, secondary: secondaryAfterRestore },
      renderedProgram: {
        baseline: { main: mainProgramBaseline, secondary: secondaryProgramBaseline },
        beforeManualTake: { main: mainProgramBeforeManualTake, secondary: secondaryProgramBeforeManualTake },
        afterManualTake: { main: mainProgramAfterManualTake, secondary: secondaryProgramAfterManualTake },
        beforeDesignedTake: { main: mainProgramBeforeDesignedTake, secondary: secondaryProgramBeforeDesignedTake },
        afterDesignedTake: { main: mainProgramAfterDesignedTake, secondary: secondaryProgramAfterDesignedTake },
        afterRestore: { main: mainProgramAfterRestore, secondary: secondaryProgramAfterRestore },
      },
      approval: {
        revision: approvalRevision,
        approvedBy: serviceAtApproval.current.approved_by,
        approvedAt: serviceAtApproval.current.approved_at,
        moments: serviceAtApproval.approvedDesigns.moments,
      },
      manualSceneOnAirApproval: manualApproval,
      finalProgram: { itemId: afterRestore.liveItemId, isLive: afterRestore.isLive },
    }
  } catch (error) {
    throw new Error(JSON.stringify({
      stage,
      message: error?.message,
      stack: error?.stack,
      outputs: qa.broadcast.getState().outputs.map((output) => ({
        id: output.id,
        sceneId: output.sceneId,
        scene: output.sceneSnapshot?.name,
        background: output.sceneSnapshot?.background,
        design: output.sceneSnapshot?.design,
        approval: output.sceneAppearanceSnapshot?.approved,
      })),
      service: {
        title: qa.service.getState().current?.title,
        revision: qa.service.getState().current?.revision,
        approvedRevision: qa.service.getState().current?.approved_revision,
      },
      items: qa.queue.getState().items.map((item) => ({ id: item.id, reference: item.reference, sceneId: item.scene_id, onTake: item.on_take, designRef: item.kind === "slide" ? item.slide.designRef : undefined })),
      setup: {
        open: qa.shell.getState().setupOpen,
        dismissedAt: qa.settings.getState().setup.dismissedAt,
        dialogs: [...document.querySelectorAll('[role="dialog"]')].map((dialog) => ({ state: dialog.getAttribute("data-state"), text: normal(dialog.textContent).slice(0, 160) })),
      },
      body: normal(document.body.innerText).slice(0, 2400),
    }))
  }
}
