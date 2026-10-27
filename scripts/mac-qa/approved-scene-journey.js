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
const normal = (value) => String(value ?? "").replace(/\s+/g, " ").trim()
const buttons = () => [...document.querySelectorAll("button, [role=tab]")]
const clickButton = async (name) => {
  const button = await waitFor(
    () => buttons().find((candidate) => normal(candidate.getAttribute("aria-label") || candidate.innerText) === name),
    "button “" + name + "”",
  )
  if (button.disabled || button.getAttribute("aria-disabled") === "true") throw new Error("Button “" + name + "” is disabled")
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
const setInput = async (selector, value) => {
  const input = await waitFor(() => document.querySelector(selector), "input " + selector)
  input.focus()
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set
  if (!setter) throw new Error("No value setter for " + selector)
  setter.call(input, value)
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }))
  input.dispatchEvent(new Event("change", { bubbles: true }))
  await sleep(100)
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
    qa.settings.getState().setSetup({ dismissedAt: new Date().toISOString() })
    qa.shell.getState().setSetupOpen(false)
    await waitFor(() => !document.body.innerText.includes("Welcome to Rhema Studio"), "setup dialog to close")

    stage = "set the isolated QA operator"
    qa.settings.getState().setOperatorName("QA Operator")
    await window.__TAURI_INTERNALS__.invoke("content_set_actor", { name: "QA Operator" })

    stage = "create and save the approved scene through Production"
    await clickButton("Production")
    await clickButton("Scenes")
    await clickButton("Full screen")
    const sceneNameInput = await waitFor(() => document.querySelector('input[aria-label="Scene name"]'), "scene name field")
    await waitFor(() => sceneNameInput.value === "Full screen", "scene draft to load")
    await setInput('input[aria-label="Scene name"]', "QA Approved Scene")
    await setInput('input[aria-label="Background colour"]', "#123456")
    await clickButton("Save scene")
    const scene = await waitFor(
      () => qa.broadcast.getState().scenes.find((candidate) => candidate.name === "QA Approved Scene" && candidate.background === "#123456"),
      "QA scene to save",
    )
    const sceneId = scene.id

    stage = "prepare independent baseline scenes on two outputs"
    const main = qa.broadcast.getState().outputs.find((candidate) => candidate.id === "main")
    if (!main) throw new Error("The default congregation output is missing")
    const secondary = {
      ...structuredClone(main),
      id: "qa-secondary",
      name: "QA Secondary Output",
      type: "browser",
      role: "congregation",
      feedToken: "qa-secondary-synthetic",
      monitorIndex: 1,
      ndi: { ...main.ndi, sourceName: "QA Secondary Synthetic" },
    }
    qa.broadcast.getState().addOutput(secondary)

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

    stage = "create a synthetic event with an output-scoped scene Take"
    await clickButton("Prepare")
    const item = {
      id: "qa-approved-event",
      kind: "slide",
      slide: { title: "QA Approved Event", body: "Synthetic event content" },
      reference: "QA Approved Event",
      confidence: 1,
      source: "manual",
      added_at: 0,
      on_take: ["scene.take:" + sceneId + "@main"],
    }
    qa.queue.setState({ items: [item], headers: [], activeIndex: null, addTarget: null, removedActive: null })
    const created = await qa.service.getState().createFromRundown("QA Approved Scene Service", null, { discard: true })
    if (created !== "created") throw new Error("Could not create the synthetic service: " + created)
    await waitFor(
      () => qa.service.getState().current?.title === "QA Approved Scene Service" && !qa.service.getState().dirty,
      "synthetic service to save",
    )
    const savedItem = qa.queue.getState().items.find((candidate) => candidate.reference === item.reference)
    if (!savedItem || !savedItem.on_take?.includes("scene.take:" + sceneId + "@main")) {
      throw new Error("Saving the service lost its scoped scene Take")
    }

    stage = "approve the saved service through Prepare"
    await clickButton("Approve")
    await waitFor(() => {
      const service = qa.service.getState()
      return service.current?.approved_revision === service.current?.revision
        && service.approvedDesignRevision === service.current?.revision
        && service.approvedDesigns?.scenes[sceneId]?.scene?.background === "#123456"
        && service.approvedDesigns?.scenes[sceneId]?.outputs?.main
        && service.approvedDesigns?.scenes[sceneId]?.outputs?.["qa-secondary"]
    }, "approved service scene and output snapshots")
    const serviceBeforeEdit = qa.service.getState()
    const approvedScene = serviceBeforeEdit.approvedDesigns.scenes[sceneId].scene
    const approvalRevision = serviceBeforeEdit.current.approved_revision

    stage = "edit the reusable scene after approval"
    qa.broadcast.getState().saveScene({
      ...qa.broadcast.getState().scenes.find((candidate) => candidate.id === sceneId),
      name: "QA Scene Edited After Approval",
      background: "#405060",
    })
    const savedDraft = qa.broadcast.getState().scenes.find((candidate) => candidate.id === sceneId)
    if (savedDraft?.name !== "QA Scene Edited After Approval" || savedDraft.background !== "#405060") {
      throw new Error("The post-approval reusable scene edit did not save")
    }
    if (JSON.stringify(sceneState(qa.broadcast, "main")) !== JSON.stringify(mainBefore)) {
      throw new Error("Editing the reusable scene changed the Main Display before Take")
    }
    if (JSON.stringify(sceneState(qa.broadcast, "qa-secondary")) !== JSON.stringify(secondaryBefore)) {
      throw new Error("Editing the reusable scene changed the secondary output before Take")
    }
    const programBeforePreview = programState(qa.broadcast)

    stage = "preview the approved event without changing Program"
    await clickButton("Present")
    const row = await waitFor(
      () => [...document.querySelectorAll("button[title]")].find(
        (button) => button.title.includes("Click to preview") && normal(button.innerText).includes(savedItem.reference),
      ),
      "approved event in the Present rundown",
    )
    row.click()
    await waitFor(() => qa.bible.getState().selectedQueueItemId === savedItem.id, "approved event Preview")
    if (JSON.stringify(programState(qa.broadcast)) !== JSON.stringify(programBeforePreview)) {
      throw new Error("Preview changed actual Program state before explicit Take")
    }
    if (JSON.stringify(sceneState(qa.broadcast, "main")) !== JSON.stringify(mainBefore)) {
      throw new Error("Preview changed the Main Display scene before explicit Take")
    }
    if (JSON.stringify(sceneState(qa.broadcast, "qa-secondary")) !== JSON.stringify(secondaryBefore)) {
      throw new Error("Preview changed the secondary output scene before explicit Take")
    }

    stage = "Take the approved event in Present"
    await clickButton("Take live")
    await waitFor(() => {
      const state = qa.broadcast.getState()
      const output = state.outputs.find((candidate) => candidate.id === "main")
      return state.liveItemId === savedItem.id
        && output?.sceneSnapshot?.name === "QA Approved Scene"
        && output?.sceneSnapshot?.background === "#123456"
        && state.outputFrames.main?.scene?.background === "#123456"
    }, "approved scene revision to reach the intended output")
    const state = qa.broadcast.getState()
    const mainAfter = sceneState(qa.broadcast, "main")
    const secondaryAfter = sceneState(qa.broadcast, "qa-secondary")
    const output = state.outputs.find((candidate) => candidate.id === "main")
    const approval = output.sceneAppearanceSnapshot?.approved
    if (!state.isLive || state.liveItemId !== savedItem.id) throw new Error("Taking the event did not activate its content")
    if (JSON.stringify(secondaryAfter) !== JSON.stringify(secondaryBefore)) {
      throw new Error("Taking the event changed the other output's scene or frame")
    }
    if (mainAfter.sceneId !== sceneId || mainAfter.sceneSnapshot?.name !== approvedScene.name || mainAfter.sceneSnapshot?.background !== "#123456") {
      throw new Error("The intended output did not receive the approved scene snapshot")
    }
    if (mainAfter.sceneSnapshot?.background === savedDraft.background) {
      throw new Error("Take used the post-approval draft instead of the approved scene")
    }
    if (qa.service.getState().approvedDesigns?.scenes[sceneId]?.scene?.name !== approvedScene.name) {
      throw new Error("Editing the reusable scene changed the approved service snapshot")
    }
    if (qa.broadcast.getState().scenes.find((candidate) => candidate.id === sceneId)?.background !== "#405060") {
      throw new Error("The saved reusable draft was lost")
    }
    if (approval?.programId !== serviceBeforeEdit.current.id || approval?.revision !== approvalRevision) {
      throw new Error("The output did not record the approved service revision: " + JSON.stringify(approval))
    }
    if (approval?.approvedBy !== serviceBeforeEdit.current.approved_by
      || approval?.approvedAt !== serviceBeforeEdit.current.approved_at) {
      throw new Error("Approved actor/time were not preserved: " + JSON.stringify({
        approval,
        serviceApprovedBy: serviceBeforeEdit.current.approved_by,
        serviceApprovedAt: serviceBeforeEdit.current.approved_at,
      }))
    }

    return {
      approvedScene: { id: sceneId, name: approvedScene.name, background: approvedScene.background },
      reusableDraft: { name: savedDraft.name, background: savedDraft.background },
      beforePreview: { main: mainBefore, secondary: secondaryBefore },
      afterTake: { main: mainAfter, secondary: secondaryAfter },
      approvedService: {
        id: serviceBeforeEdit.current.id,
        revision: approvalRevision,
        approvedBy: serviceBeforeEdit.current.approved_by,
        approvedAt: serviceBeforeEdit.current.approved_at,
      },
      onAirApproval: approval,
      liveItemId: state.liveItemId,
      isLive: state.isLive,
    }
  } catch (error) {
    throw new Error(JSON.stringify({
      stage,
      message: error?.message,
      stack: error?.stack,
      outputs: qa.broadcast.getState().outputs.map((output) => ({
        id: output.id,
        scene: output.sceneSnapshot?.name,
        background: output.sceneSnapshot?.background,
        approval: output.sceneAppearanceSnapshot?.approved,
      })),
      service: {
        title: qa.service.getState().current?.title,
        revision: qa.service.getState().current?.revision,
        approvedRevision: qa.service.getState().current?.approved_revision,
      },
      body: normal(document.body.innerText).slice(0, 2400),
    }))
  }
}
