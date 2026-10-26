// Native Tauri acceptance scenario for #398: a service Take uses its approved scene snapshot.
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
const clickButton = async (name) => {
  const button = await waitFor(
    () => buttons().find((candidate) => normal(candidate.getAttribute("aria-label") || candidate.innerText) === name),
    `button “${name}”`,
  )
  if (button.disabled || button.getAttribute("aria-disabled") === "true") throw new Error(`Button “${name}” is disabled`)
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
  const input = await waitFor(() => document.querySelector(selector), `input ${selector}`)
  input.focus()
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set
  if (!setter) throw new Error(`No value setter for ${selector}`)
  setter.call(input, value)
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }))
  input.dispatchEvent(new Event("change", { bubbles: true }))
  await sleep(100)
}

async function runScenario() {
  await waitFor(() => document.querySelector("#root")?.childElementCount, "Rhema Studio window")
  const qa = await waitFor(() => window.__rhemaQa?.(), "isolated QA stores")
  let stage = "open Production scenes"
  try {
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

    stage = "create a synthetic service event"
    await clickButton("Prepare")
    const item = {
      id: "qa-approved-event",
      kind: "slide",
      slide: { title: "QA Approved Event", body: "Synthetic event content" },
      reference: "QA Approved Event",
      confidence: 1,
      source: "manual",
      added_at: 0,
      on_take: [`scene.take:${sceneId}@main`],
    }
    qa.queue.setState({ items: [item], headers: [], activeIndex: null, addTarget: null, removedActive: null })
    const created = await qa.service.getState().createFromRundown("QA Approved Scene Service", null, { discard: true })
    if (created !== "created") throw new Error(`Could not create the synthetic service: ${created}`)
    await waitFor(() => qa.service.getState().current?.title === "QA Approved Scene Service" && !qa.service.getState().dirty, "synthetic service to save")
    const savedItem = qa.queue.getState().items.find((candidate) => candidate.reference === item.reference)
    if (!savedItem || !savedItem.on_take?.includes(`scene.take:${sceneId}@main`)) throw new Error("Saving the service lost its scoped scene Take")

    stage = "approve the saved service through Prepare"
    qa.settings.getState().setOperatorName("QA Operator")
    await window.__TAURI_INTERNALS__.invoke("content_set_actor", { name: "QA Operator" })
    await clickButton("Approve")
    await waitFor(() => {
      const service = qa.service.getState()
      return service.current?.approved_revision === service.current?.revision
        && service.approvedDesignRevision === service.current?.revision
        && service.approvedDesigns?.scenes[sceneId]?.scene?.background === "#123456"
    }, "approved service scene snapshot")
    const serviceBeforeEdit = qa.service.getState()
    const approvedScene = serviceBeforeEdit.approvedDesigns.scenes[sceneId].scene

    stage = "edit the reusable scene after approval"
    qa.broadcast.getState().saveScene({ ...qa.broadcast.getState().scenes.find((scene) => scene.id === sceneId), name: "QA Scene Edited After Approval", background: "#405060" })
    const savedDraft = qa.broadcast.getState().scenes.find((scene) => scene.id === sceneId)
    if (savedDraft?.name !== "QA Scene Edited After Approval" || savedDraft.background !== "#405060") {
      throw new Error("The post-approval reusable scene edit did not save")
    }

    stage = "Take the approved event in Present"
    await clickButton("Present")
    const row = await waitFor(
      () => [...document.querySelectorAll("button[title]")].find((button) => button.title.includes("Click to preview") && normal(button.innerText).includes(savedItem.reference)),
      "approved event in the Present rundown",
    )
    row.click()
    await waitFor(() => qa.bible.getState().selectedQueueItemId === savedItem.id, "approved event preview")
    await clickButton("Take live")

    const outputId = "main"
    await waitFor(() => {
      const state = qa.broadcast.getState()
      const output = state.outputs.find((candidate) => candidate.id === outputId)
      return state.liveItemId === savedItem.id
        && output?.sceneSnapshot?.name === "QA Approved Scene"
        && output?.sceneSnapshot?.background === "#123456"
        && state.outputFrames[outputId]?.scene?.background === "#123456"
    }, "approved scene revision to reach the congregation output")
    const state = qa.broadcast.getState()
    const output = state.outputs.find((candidate) => candidate.id === outputId)
    const approval = output.sceneAppearanceSnapshot?.approved
    if (!state.isLive || state.liveVerse?.reference !== savedItem.reference) throw new Error("Taking the event did not put its content live")
    if (qa.service.getState().approvedDesigns?.scenes[sceneId]?.scene?.name !== approvedScene.name) throw new Error("Editing the reusable scene changed the approved service snapshot")
    if (qa.broadcast.getState().scenes.find((scene) => scene.id === sceneId)?.background !== "#405060") throw new Error("The library no longer shows the saved draft")
    if (approval?.programId !== serviceBeforeEdit.current.id || approval?.revision !== serviceBeforeEdit.current.approved_revision) {
      throw new Error(`The output did not record its approved service revision: ${JSON.stringify(approval)}`)
    }
    if (approval?.approvedBy !== "QA Operator" || !approval.approvedAt) {
      throw new Error(`Approved actor/time were not preserved on the taken scene: ${JSON.stringify(approval)}`)
    }

    return {
      approvedScene: { name: approvedScene.name, background: approvedScene.background },
      reusableDraft: { name: savedDraft.name, background: savedDraft.background },
      onAirScene: { name: output.sceneSnapshot.name, background: output.sceneSnapshot.background },
      onAirFrameBackground: state.outputFrames[outputId]?.scene?.background,
      approvedService: { id: serviceBeforeEdit.current.id, revision: serviceBeforeEdit.current.approved_revision },
      onAirApproval: approval,
      liveItem: state.liveVerse.reference,
      live: state.isLive,
    }
  } catch (error) {
    throw new Error(JSON.stringify({
      stage,
      message: error?.message,
      stack: error?.stack,
      error: String(error),
      buttons: buttons().map((button) => normal(button.getAttribute("aria-label") || button.innerText)).filter(Boolean).slice(0, 80),
      service: {
        title: qa.service.getState().current?.title,
        revision: qa.service.getState().current?.revision,
        approvedRevision: qa.service.getState().current?.approved_revision,
        approvedScene: qa.service.getState().approvedDesigns?.scenes?.["qa-approved-scene"]?.scene,
      },
      outputs: qa.broadcast.getState().outputs.map((output) => ({ id: output.id, scene: output.sceneSnapshot?.name, background: output.sceneSnapshot?.background, approval: output.sceneAppearanceSnapshot?.approved })),
      body: normal(document.body.innerText).slice(0, 2400),
    }))
  }
}
