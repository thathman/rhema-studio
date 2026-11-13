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
const clickButton = async (name, { startsWith = false, within = null } = {}) => {
  const scope = within ?? document
  const button = await waitFor(
    () => [...scope.querySelectorAll("button, [role=tab]")].find((candidate) => {
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
const chooseSceneForOutput = async (sceneName, outputName) => {
  const picker = await waitFor(() => {
    const quick = [...document.querySelectorAll('[role="group"][aria-label^="Quick scene controls for "]')]
      .find((element) => element.getAttribute("aria-label") === `Quick scene controls for ${outputName}`)
    const select = quick?.querySelector("select[aria-label^='Choose scene for ']")
    if (select) return { select }
    const group = [...document.querySelectorAll('[role="group"][aria-label^="Scenes for "]')]
      .find((element) => element.getAttribute("aria-label") === `Scenes for ${outputName}`)
    return group ? { group } : null
  }, `scene picker for ${outputName}`)
  if (picker.select) {
    const option = [...picker.select.options].find((candidate) => normal(candidate.textContent) === sceneName)
    if (!option) throw new Error(`Scene “${sceneName}” is not available for ${outputName}`)
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set
    if (!setter) throw new Error("No value setter for scene picker")
    setter.call(picker.select, option.value)
    picker.select.dispatchEvent(new Event("change", { bubbles: true }))
    await sleep(100)
    return
  }
  await clickButton(sceneName, { startsWith: true, within: picker.group })
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
    // Scenes are arranged in Design → Scenes (UX audit slice 4); choosing and Take stay on Live.
    await clickButton("Design")
    await clickButton("Scenes")
    await waitFor(() => document.querySelector('[aria-label="Scene preview"]'), "Scene Composer")

    stage = "create a scene from the built-in Full screen arrangement"
    await clickButton("Full screen")
    const sceneName = await waitFor(() => document.querySelector('input[aria-label="Scene name"]'), "scene name field")
    await waitFor(() => sceneName.value === "Full screen", "new scene draft")

    const output = qaStores.broadcast.getState().outputs.find((candidate) => (candidate.role ?? "congregation") === "congregation")
    if (!output) throw new Error("No congregation output is configured")

    stage = "save the initial scene to the library without changing the output"
    await clickButton("Save scene")
    const savedInitialScene = await waitFor(
      () => qaStores.broadcast.getState().scenes.find((scene) => scene.name === "Full screen"),
      "initial scene revision to save",
    )

    stage = "choose the saved scene in the output's private scene preview"
    await clickButton("Live")
    await chooseSceneForOutput("Full screen", output.name)
    const initialTakeLabel = `Take scene Full screen to ${output.name}`
    await waitFor(() => buttons().some((button) => button.getAttribute("aria-label") === initialTakeLabel && !button.disabled && button.getAttribute("aria-disabled") !== "true"), "ready named scene Take in Program")

    stage = "Take the initial scene to the congregation output"
    await clickButton(initialTakeLabel)
    const stateAfterInitialTake = qaStores.broadcast.getState()
    const outputId = output.id
    await waitFor(() => {
      const current = qaStores.broadcast.getState()
      const taken = current.outputs.find((candidate) => candidate.id === outputId)
      return taken?.sceneSnapshot?.id === savedInitialScene.id
        && taken.sceneSnapshot.name === "Full screen"
        && current.outputFrames[outputId]?.scene?.sceneId === savedInitialScene.id
    }, "initial scene revision to reach the output")
    const takenBeforeEdit = qaStores.broadcast.getState().outputs.find((candidate) => candidate.id === outputId)?.sceneSnapshot
    const frameBeforeEdit = qaStores.broadcast.getState().outputFrames[outputId]?.scene
    const liveBeforeEdit = qaStores.broadcast.getState().isLive
    if (!takenBeforeEdit || !frameBeforeEdit) throw new Error("Initial Take did not produce a visible scene revision")

    stage = "edit the scene draft"
    await clickButton("Design")
    await clickButton("Scenes")
    // Design → Scenes opens fresh: choose the saved scene by name in its list.
    const savedButton = await waitFor(
      () => [...document.querySelectorAll('section[aria-label="Scenes"] li button')].find((button) => normal(button.querySelector("span")?.textContent) === "Full screen"),
      "Full screen in Design → Scenes",
    )
    savedButton.click()
    await waitFor(() => document.querySelector('input[aria-label="Scene name"]')?.value === "Full screen", "the saved scene in Design → Scenes")
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
    await clickButton("Live")
    await chooseSceneForOutput("QA Scene Draft", output.name)
    const savedTakeLabel = `Take scene QA Scene Draft to ${output.name}`
    await waitFor(() => buttons().some((button) => button.getAttribute("aria-label") === savedTakeLabel && !button.disabled && button.getAttribute("aria-disabled") !== "true"), "ready Take for the saved scene revision")
    await clickButton(savedTakeLabel)
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
