// Native Tauri acceptance scenario for #383: saving a scene is a plan edit; Take changes the output.
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
const clickButton = async (name, { startsWith = false } = {}) => {
  const button = await waitFor(
    () => buttons().find((candidate) => {
      const label = normal(candidate.getAttribute("aria-label") || candidate.innerText)
      return startsWith ? label.startsWith(name) : label === name
    }),
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
  const qaStores = await waitFor(() => window.__rhemaQa?.(), "isolated QA stores")
  let stage = "open Live scene tools"
  try {
    await clickButton("Live")
    await clickButton("Open production tools")
    await waitFor(() => buttons().some((button) => button.getAttribute("role") === "tab" && normal(button.innerText) === "Scenes"), "Live production tool tabs")
    await clickButton("Scenes")
    await waitFor(() => document.querySelector('[aria-label="Scene preview"]'), "Scene Composer")

    stage = "create a scene from the built-in Full screen arrangement"
    await clickButton("Full screen")
    const sceneName = await waitFor(() => document.querySelector('input[aria-label="Scene name"]'), "scene name field")
    await waitFor(() => sceneName.value === "Full screen", "new scene draft")

    stage = "Take the initial scene to the congregation output"
    await clickButton("Take Full screen to ", { startsWith: true })
    const stateAfterInitialTake = qaStores.broadcast.getState()
    const output = stateAfterInitialTake.outputs.find((candidate) => (candidate.role ?? "congregation") === "congregation")
    if (!output) throw new Error("No congregation output is configured")
    const outputId = output.id
    await waitFor(() => {
      const current = qaStores.broadcast.getState()
      return current.outputs.find((candidate) => candidate.id === outputId)?.sceneSnapshot?.name === "Full screen"
        && current.outputFrames[outputId]?.scene?.sceneId === output.sceneId
    }, "initial scene revision to reach the output")
    const takenBeforeEdit = qaStores.broadcast.getState().outputs.find((candidate) => candidate.id === outputId)?.sceneSnapshot
    const frameBeforeEdit = qaStores.broadcast.getState().outputFrames[outputId]?.scene
    const liveBeforeEdit = qaStores.broadcast.getState().isLive
    if (!takenBeforeEdit || !frameBeforeEdit) throw new Error("Initial Take did not produce a visible scene revision")

    stage = "edit the scene draft"
    await setInput('input[aria-label="Scene name"]', "QA Scene Draft")
    await setInput('input[aria-label="Background colour"]', "#123456")
    await waitFor(() => buttons().some((button) => normal(button.innerText) === "Save scene"), "Save scene action")

    stage = "save the draft without changing the output"
    await clickButton("Save scene")
    await waitFor(() => qaStores.broadcast.getState().scenes.find((scene) => scene.id === takenBeforeEdit.id)?.name === "QA Scene Draft", "edited reusable scene to save")
    const afterSave = qaStores.broadcast.getState()
    const savedScene = afterSave.scenes.find((scene) => scene.id === takenBeforeEdit.id)
    const onAirAfterSave = afterSave.outputs.find((candidate) => candidate.id === outputId)
    const frameAfterSave = afterSave.outputFrames[outputId]?.scene
    if (savedScene?.name !== "QA Scene Draft") throw new Error("Save did not update the reusable scene")
    if (savedScene.background !== "#123456") throw new Error(`Save did not persist the scene draft background: ${savedScene.background}`)
    if (onAirAfterSave?.sceneSnapshot?.name !== "Full screen" || frameAfterSave?.sceneId !== takenBeforeEdit.id) {
      throw new Error(`Save changed the on-air scene: snapshot=${onAirAfterSave?.sceneSnapshot?.name}, frame=${frameAfterSave?.sceneId}`)
    }
    if (JSON.stringify(onAirAfterSave.sceneSnapshot) !== JSON.stringify(takenBeforeEdit)) throw new Error("Save changed the taken scene revision")
    if (frameAfterSave?.background !== frameBeforeEdit.background) throw new Error(`Save changed the scene frame background to ${frameAfterSave?.background}`)
    if (afterSave.isLive !== liveBeforeEdit) throw new Error("Saving the scene changed Live content state")

    stage = "Take the saved revision deliberately"
    await clickButton("Take QA Scene Draft to ", { startsWith: true })
    await waitFor(() => {
      const current = qaStores.broadcast.getState()
      return current.outputs.find((candidate) => candidate.id === outputId)?.sceneSnapshot?.name === "QA Scene Draft"
        && current.outputFrames[outputId]?.scene?.background === "#123456"
    }, "explicit Take to apply the saved scene revision")
    const afterTake = qaStores.broadcast.getState()
    if (afterTake.isLive !== liveBeforeEdit) throw new Error("Taking a scene changed the Live content bus")

    return {
      outputId,
      librarySceneAfterSave: savedScene.name,
      libraryBackgroundAfterSave: savedScene.background,
      sceneOnAirAfterSave: onAirAfterSave.sceneSnapshot.name,
      sceneBackgroundAfterSave: frameAfterSave.background,
      sceneOnAirAfterTake: afterTake.outputs.find((candidate) => candidate.id === outputId)?.sceneSnapshot?.name,
      sceneBackgroundAfterTake: afterTake.outputFrames[outputId]?.scene?.background,
      live: afterTake.isLive,
    }
  } catch (error) {
    throw new Error(JSON.stringify({
      stage,
      message: error?.message,
      stack: error?.stack,
      buttons: buttons().map((button) => normal(button.getAttribute("aria-label") || button.innerText)).filter(Boolean).slice(0, 80),
      sceneOutputs: qaStores.broadcast.getState().outputs.map((candidate) => ({ id: candidate.id, sceneId: candidate.sceneId, scene: candidate.sceneSnapshot?.name })),
      body: normal(document.body.innerText).slice(0, 2400),
    }))
  }
}
