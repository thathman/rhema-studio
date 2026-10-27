import { beforeEach, describe, expect, it, vi } from "vitest"

const emitToMock = vi.fn()

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: emitToMock,
}))

const sampleLiveVerse = {
  reference: "John 3:16",
  segments: [{ text: "For God so loved the world", verseNumber: 16 }],
}

const ndiDefaults = {
  sourceName: "Rhema",
  resolution: "r1080p",
  frameRate: "fps24",
  alphaMode: "straightAlpha",
} as const

describe("broadcast store sync", () => {
  beforeEach(async () => {
    emitToMock.mockReset()
    emitToMock.mockResolvedValue(undefined)
    vi.resetModules()
  })

  it("syncBroadcastOutput emits current theme and verse to the main output window when live", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const theme = useBroadcastStore.getState().themes[0]
    useBroadcastStore.setState({
      isLive: true,
      liveVerse: sampleLiveVerse,
    })
    useBroadcastStore.getState().setActiveTheme(theme.id)

    emitToMock.mockClear()
    useBroadcastStore.getState().syncBroadcastOutput()

    expect(emitToMock).toHaveBeenCalledTimes(1)
    expect(emitToMock).toHaveBeenCalledWith(
      "broadcast-main",
      "broadcast:verse-update",
      expect.objectContaining({
        theme: expect.objectContaining({ id: theme.id }),
        verse: expect.objectContaining({ reference: "John 3:16" }),
      }),
    )
  })

  it("syncBroadcastOutput fans out to every output with its own theme", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const state = useBroadcastStore.getState()
    const [themeA, themeB] = state.themes
    state.setOutputTheme("main", themeA.id)
    state.addOutput({
      id: "out-b",
      name: "Stage",
      type: "ndi",
      themeId: themeB.id,
      monitorIndex: 0,
      ndi: ndiDefaults,
    })
    state.addOutput({
      id: "out-c",
      name: "Lobby",
      type: "display",
      themeId: themeA.id,
      monitorIndex: 1,
      ndi: ndiDefaults,
    })
    useBroadcastStore.setState({ isLive: true, liveVerse: sampleLiveVerse })

    emitToMock.mockClear()
    useBroadcastStore.getState().syncBroadcastOutput()

    expect(emitToMock).toHaveBeenCalledTimes(3)
    expect(emitToMock).toHaveBeenCalledWith(
      "broadcast-main",
      "broadcast:verse-update",
      expect.objectContaining({ theme: expect.objectContaining({ id: themeA.id }) }),
    )
    expect(emitToMock).toHaveBeenCalledWith(
      "broadcast-out-b",
      "broadcast:verse-update",
      expect.objectContaining({ theme: expect.objectContaining({ id: themeB.id }) }),
    )
    expect(emitToMock).toHaveBeenCalledWith(
      "broadcast-out-c",
      "broadcast:verse-update",
      expect.objectContaining({ theme: expect.objectContaining({ id: themeA.id }) }),
    )
  })

  it("removeOutput drops the output from the fan-out but never removes main", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const state = useBroadcastStore.getState()
    state.addOutput({
      id: "out-b",
      name: "Stage",
      type: "ndi",
      themeId: state.themes[0].id,
      monitorIndex: 0,
      ndi: ndiDefaults,
    })

    useBroadcastStore.getState().removeOutput("out-b")
    useBroadcastStore.getState().removeOutput("main")

    expect(useBroadcastStore.getState().outputs.map((o) => o.id)).toEqual(["main"])

    emitToMock.mockClear()
    useBroadcastStore.getState().syncBroadcastOutput()
    expect(emitToMock).toHaveBeenCalledTimes(1)
    expect(emitToMock).toHaveBeenCalledWith(
      "broadcast-main",
      "broadcast:verse-update",
      expect.anything(),
    )
  })

  it("saving a scene keeps its taken program revision until an explicit Take", async () => {
    const [{ useBroadcastStore }, { newScene, SCENE_PRESETS }] = await Promise.all([
      import("./broadcast-store"),
      import("@/lib/scenes"),
    ])
    const scene = newScene("On air", SCENE_PRESETS[0])
    useBroadcastStore.getState().saveScene(scene)
    useBroadcastStore.getState().takeScene("main", scene.id)

    emitToMock.mockClear()
    const edited = { ...scene, background: "#123456" }
    useBroadcastStore.getState().saveScene(edited)
    expect(emitToMock).not.toHaveBeenCalled()

    useBroadcastStore.getState().syncBroadcastOutputFor("main")
    expect(useBroadcastStore.getState().outputFrames.main.scene?.background).toBe(scene.background)
    expect(emitToMock).toHaveBeenLastCalledWith(
      "broadcast-main",
      "broadcast:verse-update",
      expect.objectContaining({ scene: expect.objectContaining({ background: scene.background }) }),
    )

    useBroadcastStore.getState().takeScene("main", scene.id)
    expect(useBroadcastStore.getState().outputFrames.main.scene?.background).toBe(edited.background)
  })

  it("lets rehearsal preview an edited scene while the public screen keeps its pinned revision", async () => {
    const [{ useBroadcastStore, outputsForScreens }, { newScene, SCENE_PRESETS, sceneForOutput }] = await Promise.all([
      import("./broadcast-store"),
      import("@/lib/scenes"),
    ])
    const b = useBroadcastStore.getState()
    const original = { ...newScene("On air", SCENE_PRESETS[0]), background: "#000000" }
    b.saveScene(original)
    b.takeScene("main", original.id)
    b.saveScene({ ...original, background: "#123456" })

    b.setRehearsal(true)
    useBroadcastStore.getState().takeScene("main", original.id)
    const rehearsed = useBroadcastStore.getState()
    const rehearsalOutput = rehearsed.outputs.find((output) => output.id === "main")!
    expect(sceneForOutput(rehearsalOutput, rehearsed.scenes)?.background).toBe("#123456")
    expect(sceneForOutput(outputsForScreens(rehearsed).find((output) => output.id === "main")!, rehearsed.scenes)?.background).toBe("#000000")

    useBroadcastStore.getState().setRehearsal(false)
    const returned = useBroadcastStore.getState().outputs.find((output) => output.id === "main")!
    expect(returned.sceneSnapshot?.background).toBe("#000000")
    expect(useBroadcastStore.getState().outputFrames.main.scene?.background).toBe("#000000")
  })

  it("restoring a backup keeps the on-air scene snapshot when the saved scene is newer", async () => {
    const [{ useBroadcastStore, looksForBackup, restoreLooksFromBackup }, { newScene, SCENE_PRESETS }] = await Promise.all([
      import("./broadcast-store"),
      import("@/lib/scenes"),
    ])
    const scene = { ...newScene("On air", SCENE_PRESETS[0]), background: "#000000" }
    const b = useBroadcastStore.getState()
    b.saveScene(scene)
    b.takeScene("main", scene.id)
    b.saveScene({ ...scene, background: "#123456" })

    restoreLooksFromBackup(looksForBackup())

    const restored = useBroadcastStore.getState()
    expect(restored.scenes.find((candidate) => candidate.id === scene.id)?.background).toBe("#123456")
    expect(restored.outputs.find((output) => output.id === "main")?.sceneSnapshot?.background).toBe("#000000")
    restored.syncBroadcastOutputFor("main")
    expect(restored.outputFrames.main.scene?.background).toBe("#000000")
  })

  it("sends the pinned scene revision to an NDI output after the library scene is saved", async () => {
    const [{ useBroadcastStore }, { newScene, SCENE_PRESETS }] = await Promise.all([
      import("./broadcast-store"),
      import("@/lib/scenes"),
    ])
    const state = useBroadcastStore.getState()
    const scene = { ...newScene("NDI program", SCENE_PRESETS[0]), background: "#000000" }
    state.saveScene(scene)
    state.addOutput({
      id: "ndi-program",
      name: "Sanctuary NDI",
      type: "ndi",
      role: "congregation",
      themeId: state.themes[0].id,
      monitorIndex: 0,
      ndi: ndiDefaults,
    })
    useBroadcastStore.getState().takeScene("ndi-program", scene.id)

    emitToMock.mockClear()
    useBroadcastStore.getState().saveScene({ ...scene, background: "#123456" })
    useBroadcastStore.getState().syncBroadcastOutputFor("ndi-program")

    expect(useBroadcastStore.getState().outputFrames["ndi-program"].scene?.background).toBe("#000000")
    expect(emitToMock).toHaveBeenLastCalledWith(
      "broadcast-ndi-program",
      "broadcast:verse-update",
      expect.objectContaining({ scene: expect.objectContaining({ background: "#000000" }) }),
    )
  })

  it("duplicateOutput copies config with fresh id, unique name and NDI source name", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const state = useBroadcastStore.getState()
    state.duplicateOutput("main")

    const outputs = useBroadcastStore.getState().outputs
    expect(outputs).toHaveLength(2)
    const copy = outputs[1]
    expect(copy.id).not.toBe("main")
    expect(copy.name).toBe("Main Display Copy")
    expect(copy.ndi.sourceName).not.toBe(outputs[0].ndi.sourceName)
  })

  it("with Live edit on, emitDraftToBroadcast only reaches outputs using the edited theme", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const state = useBroadcastStore.getState()
    const [themeA, themeB] = state.themes
    state.setOutputTheme("main", themeA.id)
    state.addOutput({
      id: "out-b",
      name: "Stage",
      type: "ndi",
      themeId: themeB.id,
      monitorIndex: 0,
      ndi: ndiDefaults,
    })

    useBroadcastStore.getState().startEditing(themeB.id)
    useBroadcastStore.getState().setLiveDesign(true)
    emitToMock.mockClear()
    useBroadcastStore.getState().updateDraft({ name: "tweaked" })

    expect(emitToMock).toHaveBeenCalledTimes(1)
    expect(emitToMock).toHaveBeenCalledWith(
      "broadcast-out-b",
      "broadcast:verse-update",
      expect.objectContaining({ theme: expect.objectContaining({ name: "tweaked" }) }),
    )
  })

  it("inherits primary verse styling when a secondary language style is edited", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const theme = useBroadcastStore.getState().themes[0]
    useBroadcastStore.getState().startEditing(theme.id)

    const primary = useBroadcastStore.getState().draftTheme!.verseText
    useBroadcastStore
      .getState()
      .updateDraftNested("secondaryVerseText.color", "#00ff00")

    const secondary = useBroadcastStore.getState().draftTheme!.secondaryVerseText
    expect(secondary).toEqual({ ...primary, color: "#00ff00" })
  })

  it("saving a customised builtin repoints the outputs that used it", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const builtin = useBroadcastStore.getState().themes[0]
    const state = useBroadcastStore.getState()
    state.addOutput({
      id: "out-b",
      name: "Stage",
      type: "ndi",
      themeId: builtin.id,
      monitorIndex: 0,
      ndi: ndiDefaults,
    })

    useBroadcastStore.getState().startEditing(builtin.id)
    useBroadcastStore.getState().updateDraft({ name: "My Look" })
    useBroadcastStore.getState().saveDraft()

    const after = useBroadcastStore.getState()
    const customId = after.themes.at(-1)!.id
    expect(customId).not.toBe(builtin.id)
    // The mirror and the outputs must agree, or the app preview and the
    // projector show different themes.
    expect(after.activeThemeId).toBe(customId)
    expect(after.outputs.find((o) => o.id === "main")?.themeId).toBe(customId)
    expect(after.outputs.find((o) => o.id === "out-b")?.themeId).toBe(customId)
  })

  it("removeOutput clears the removed output's runtime status", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const state = useBroadcastStore.getState()
    state.addOutput({
      id: "out-b",
      name: "Stage",
      type: "ndi",
      themeId: state.themes[0].id,
      monitorIndex: 0,
      ndi: ndiDefaults,
    })
    state.setOutputStatus("out-b", { previewOpen: false, ndiActive: true })
    expect(useBroadcastStore.getState().outputStatus["out-b"]).toBeDefined()

    useBroadcastStore.getState().removeOutput("out-b")

    expect(useBroadcastStore.getState().outputStatus["out-b"]).toBeUndefined()
  })

  it("setActiveTheme updates the main output and its mirror", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const themeB = useBroadcastStore.getState().themes[1]

    useBroadcastStore.getState().setActiveTheme(themeB.id)

    const state = useBroadcastStore.getState()
    expect(state.activeThemeId).toBe(themeB.id)
    expect(state.outputs.find((o) => o.id === "main")?.themeId).toBe(themeB.id)
  })

  it("syncBroadcastOutput emits null verse when not live, even with a live verse set", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    useBroadcastStore.setState({
      isLive: false,
      liveVerse: sampleLiveVerse,
    })

    emitToMock.mockClear()
    useBroadcastStore.getState().syncBroadcastOutput()

    expect(emitToMock).toHaveBeenCalledTimes(1)
    expect(emitToMock).toHaveBeenCalledWith(
      "broadcast-main",
      "broadcast:verse-update",
      expect.objectContaining({ verse: null }),
    )
  })

  it("setLive pushes the persisted live verse to outputs when toggled on", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    useBroadcastStore.setState({ isLive: false, liveVerse: sampleLiveVerse })

    emitToMock.mockClear()
    useBroadcastStore.getState().setLive(true)

    expect(emitToMock).toHaveBeenCalledWith(
      "broadcast-main",
      "broadcast:verse-update",
      expect.objectContaining({
        verse: expect.objectContaining({ reference: "John 3:16" }),
      }),
    )
  })

  it("setLive blanks the outputs when toggled off without clearing the stored verse", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    useBroadcastStore.setState({ isLive: true, liveVerse: sampleLiveVerse })

    emitToMock.mockClear()
    useBroadcastStore.getState().setLive(false)

    expect(emitToMock).toHaveBeenCalledWith(
      "broadcast-main",
      "broadcast:verse-update",
      expect.objectContaining({ verse: null }),
    )
    expect(useBroadcastStore.getState().liveVerse).toEqual(sampleLiveVerse)
  })

  it("autoLive is off until the operator turns it on (FR-01, AI-001), and can be toggled", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")

    expect(useBroadcastStore.getState().autoLive).toBe(false)

    useBroadcastStore.getState().setAutoLive(true)
    expect(useBroadcastStore.getState().autoLive).toBe(true)
    useBroadcastStore.getState().setAutoLive(false)
  })

  it("setLiveVerse records the source verse for re-presentation", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const source = {
      id: 1,
      translation_id: 1,
      book_number: 43,
      book_name: "John",
      book_abbreviation: "Jhn",
      chapter: 3,
      verse: 16,
      text: "For God so loved the world",
    }

    useBroadcastStore.getState().setLiveVerse(sampleLiveVerse, source)

    expect(useBroadcastStore.getState().liveVerse).toEqual(sampleLiveVerse)
    expect(useBroadcastStore.getState().liveSourceVerse).toEqual(source)
  })
})

describe("migrateLegacyOutputs", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("returns only the default main output when no legacy keys exist", async () => {
    const { migrateLegacyOutputs } = await import("./broadcast-store")
    const outputs = migrateLegacyOutputs(undefined, undefined)
    expect(outputs).toHaveLength(1)
    expect(outputs[0]).toMatchObject({ id: "main", type: "display", name: "Main Display" })
  })

  it("carries the legacy active theme onto the main output", async () => {
    const { migrateLegacyOutputs } = await import("./broadcast-store")
    const outputs = migrateLegacyOutputs("custom-theme-1", undefined)
    expect(outputs).toHaveLength(1)
    expect(outputs[0].themeId).toBe("custom-theme-1")
  })

  it("creates an alt NDI output when the legacy alt theme differs from the default", async () => {
    const { migrateLegacyOutputs } = await import("./broadcast-store")
    const outputs = migrateLegacyOutputs("custom-theme-1", "custom-theme-2")
    expect(outputs).toHaveLength(2)
    expect(outputs[1]).toMatchObject({ id: "alt", type: "ndi", themeId: "custom-theme-2" })
  })

  it("skips the alt output when its legacy theme is still the builtin default", async () => {
    const { BUILTIN_THEMES } = await import("@/lib/builtin-themes")
    const { migrateLegacyOutputs } = await import("./broadcast-store")
    const outputs = migrateLegacyOutputs("custom-theme-1", BUILTIN_THEMES[0].id)
    expect(outputs).toHaveLength(1)
  })
})

describe("updateDraftNested deep paths", () => {
  beforeEach(async () => {
    emitToMock.mockReset()
    emitToMock.mockResolvedValue(undefined)
    vi.resetModules()
  })

  it("creates missing intermediates, so a whole surface must be written at once", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const theme = useBroadcastStore.getState().themes[0]
    useBroadcastStore.getState().startEditing(theme.id)

    // Writing a leaf under an absent object creates the object with only that
    // key — which is why the surface panel writes the whole object first.
    useBroadcastStore.getState().updateDraftNested("reference.surface.color", "#123456")
    expect(useBroadcastStore.getState().draftTheme?.reference.surface).toEqual({
      color: "#123456",
    })

    useBroadcastStore.getState().updateDraftNested("reference.surface", {
      enabled: true,
      color: "#000000",
      opacity: 0.7,
      borderRadius: 12,
      padding: 24,
      image: null,
    })
    const surface = useBroadcastStore.getState().draftTheme?.reference.surface
    expect(surface?.enabled).toBe(true)
    expect(surface?.image).toBeNull()
  })

  it("does not mutate the saved theme while editing a draft", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const theme = useBroadcastStore.getState().themes[0]
    useBroadcastStore.getState().startEditing(theme.id)
    useBroadcastStore.getState().updateDraftNested("textBox.padding", 99)

    expect(useBroadcastStore.getState().draftTheme?.textBox.padding).toBe(99)
    expect(useBroadcastStore.getState().themes[0].textBox.padding).toBe(
      theme.textBox.padding
    )
  })

  it("a lower third goes only to outputs that show lower thirds, and survives presents and Clear", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const s = useBroadcastStore.getState()
    s.addOutput({ id: "stream", name: "Stream", type: "ndi", themeId: s.themes[0].id, monitorIndex: 0, ndi: ndiDefaults, lowerThirds: true })
    s.addOutput({ id: "stage", name: "Stage", type: "display", role: "stage", themeId: s.themes[0].id, monitorIndex: 1, ndi: ndiDefaults, lowerThirds: true })
    emitToMock.mockClear()
    useBroadcastStore.getState().setLowerThird({ line1: "  Pastor Tolu  ", line2: "Senior Pastor" })
    expect(useBroadcastStore.getState().lowerThird).toMatchObject({ line1: "Pastor Tolu", line2: "Senior Pastor" })
    const targets = emitToMock.mock.calls.map((c) => c[0])
    expect(targets).toEqual(["broadcast-stream"])
    expect(emitToMock.mock.calls[0][2]).toMatchObject({ overlay: { line1: "Pastor Tolu", line2: "Senior Pastor" } })

    emitToMock.mockClear()
    useBroadcastStore.setState({ isLive: true, liveVerse: sampleLiveVerse })
    useBroadcastStore.getState().syncBroadcastOutput()
    const byWindow = Object.fromEntries(emitToMock.mock.calls.map((c) => [c[0], c[2]]))
    expect(byWindow["broadcast-stream"]).toMatchObject({ overlay: { line1: "Pastor Tolu" } })
    expect(byWindow["broadcast-main"].overlay).toBeNull()
    expect(byWindow["broadcast-stage"].overlay).toBeUndefined()

    emitToMock.mockClear()
    useBroadcastStore.setState({ isLive: false })
    useBroadcastStore.getState().syncBroadcastOutput()
    expect(Object.fromEntries(emitToMock.mock.calls.map((c) => [c[0], c[2]]))["broadcast-stream"]).toMatchObject({ verse: null, overlay: { line1: "Pastor Tolu" } })

    useBroadcastStore.getState().setLowerThird({ line1: " ", line2: "" })
    expect(useBroadcastStore.getState().lowerThird).toBeNull()
  })

  it("live theme edits keep the lower third on the outputs that show it, and are frozen during rehearsal", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const s = useBroadcastStore.getState()
    const theme = s.themes[0]
    s.addOutput({ id: "stream", name: "Stream", type: "ndi", themeId: theme.id, monitorIndex: 0, ndi: ndiDefaults, lowerThirds: true })
    useBroadcastStore.getState().setLowerThird({ line1: "Pastor Tolu", line2: "" })
    useBroadcastStore.setState({ draftTheme: { ...theme, name: "Draft" }, editingThemeId: theme.id, liveDesign: true })
    emitToMock.mockClear()
    useBroadcastStore.getState().updateDraft({ name: "Draft 2" })
    const toStream = emitToMock.mock.calls.filter((c) => c[0] === "broadcast-stream")
    expect(toStream.length).toBeGreaterThan(0)
    expect(toStream.at(-1)?.[2]).toMatchObject({ overlay: { line1: "Pastor Tolu" } })
    emitToMock.mockClear()
    useBroadcastStore.setState({ rehearsal: true })
    useBroadcastStore.getState().updateDraft({ name: "Draft 3" })
    expect(emitToMock).not.toHaveBeenCalled()
  })

  it("records what each output was last sent, for the multiview", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const s = useBroadcastStore.getState()
    s.addOutput({ id: "stream", name: "Stream", type: "ndi", themeId: s.themes[0].id, monitorIndex: 0, ndi: ndiDefaults, lowerThirds: true, language: "first" })
    s.addOutput({ id: "stage", name: "Stage", type: "display", role: "stage", themeId: s.themes[0].id, monitorIndex: 1, ndi: ndiDefaults })
    useBroadcastStore.setState({ isLive: true, liveVerse: { ...sampleLiveVerse, translationLines: ["For God so loved", "Nítorí Ọlọ́run"] } })
    useBroadcastStore.getState().setLowerThird({ line1: "Pastor Tolu", line2: "" })
    useBroadcastStore.getState().syncBroadcastOutput()
    const frames = useBroadcastStore.getState().outputFrames
    expect(frames.stream.verse?.translationLines).toBeUndefined() // first language only
    expect(frames.stream.overlay).toMatchObject({ line1: "Pastor Tolu", line2: "" })
    expect(frames.main.verse?.translationLines).toHaveLength(2)
    expect(frames.main.overlay).toBeNull()
    expect(frames.stage.stage).toBe(true)
    useBroadcastStore.getState().removeOutput("stream")
    expect(useBroadcastStore.getState().outputFrames.stream).toBeUndefined()
  })

  it("the ticker crawls only on outputs that show it, takes word changes at once and stops", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const s = useBroadcastStore.getState()
    s.addOutput({ id: "stream", name: "Stream", type: "ndi", themeId: s.themes[0].id, monitorIndex: 0, ndi: ndiDefaults, ticker: true })
    useBroadcastStore.setState({ isLive: true, liveVerse: sampleLiveVerse })
    useBroadcastStore.getState().setTicker({ backing: null })
    expect(useBroadcastStore.getState().ticker).toBeNull() // nothing to say yet
    useBroadcastStore.getState().setTickerItems(["Youth meeting Friday", ""])
    useBroadcastStore.getState().setTicker({ backing: null })
    expect(useBroadcastStore.getState().outputFrames.stream.ticker?.items[0]).toBe("Youth meeting Friday")
    expect(useBroadcastStore.getState().outputFrames.main?.ticker ?? null).toBeNull()
    useBroadcastStore.getState().setTickerItems(["Choir Saturday"])
    expect(useBroadcastStore.getState().outputFrames.stream.ticker?.items).toEqual(["Choir Saturday"])
    useBroadcastStore.getState().setTicker({ backing: null })
    const started = useBroadcastStore.getState().ticker!.startedAt
    vi.spyOn(Date, "now").mockReturnValue(started + 5000)
    useBroadcastStore.getState().pauseTicker(true)
    expect(useBroadcastStore.getState().outputFrames.stream.ticker?.pausedAt).toBe(started + 5000)
    // Resumed 3 s later: it carries on from where it stopped (the start moves on by the pause).
    vi.spyOn(Date, "now").mockReturnValue(started + 8000)
    useBroadcastStore.getState().pauseTicker(false)
    expect(useBroadcastStore.getState().ticker).toMatchObject({ startedAt: started + 3000, pausedAt: undefined })
    vi.restoreAllMocks()
    useBroadcastStore.getState().setTicker(null)
    expect(useBroadcastStore.getState().outputFrames.stream.ticker).toBeNull()
  })

  it("saved announcement sets: a set of the same name is replaced; nothing to save without words or a name", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    useBroadcastStore.getState().setTickerItems(["Prayer meeting Wednesday 6:30 PM", ""])
    useBroadcastStore.getState().saveTickerPreset(" Weekday ")
    useBroadcastStore.getState().setTickerItems(["Youth gathering Saturday 4 PM"])
    useBroadcastStore.getState().saveTickerPreset("weekday")
    useBroadcastStore.getState().saveTickerPreset("  ")
    useBroadcastStore.getState().setTickerItems([" "])
    useBroadcastStore.getState().saveTickerPreset("Empty")
    expect(useBroadcastStore.getState().tickerPresets.map((p) => [p.name, p.items])).toEqual([["weekday", ["Youth gathering Saturday 4 PM"]]])
    useBroadcastStore.getState().deleteTickerPreset(useBroadcastStore.getState().tickerPresets[0].id)
    expect(useBroadcastStore.getState().tickerPresets).toEqual([])
  })

  it("a signage output can show the ticker over its pictures; the stage never does", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const s = useBroadcastStore.getState()
    s.addOutput({ id: "foyer", name: "Foyer", type: "display", role: "signage", themeId: s.themes[0].id, monitorIndex: 0, ndi: ndiDefaults, signage: { mediaIds: [], seconds: 5 }, ticker: true })
    s.addOutput({ id: "stage", name: "Stage", type: "display", role: "stage", themeId: s.themes[0].id, monitorIndex: 1, ndi: ndiDefaults, ticker: true })
    useBroadcastStore.getState().setTickerItems(["Prayer meeting Wednesday 6:30 PM"])
    useBroadcastStore.getState().setTicker({ backing: null })
    await vi.waitFor(() => expect(useBroadcastStore.getState().outputFrames.foyer?.ticker?.items[0]).toBe("Prayer meeting Wednesday 6:30 PM"))
    expect(useBroadcastStore.getState().outputFrames.stage?.ticker ?? null).toBeNull()
  })

  it("an output can give a kind of content its own look (hymns in one theme, the rest in the main one)", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const s = useBroadcastStore.getState()
    const [main, hymns] = [s.themes[0], s.themes[1]]
    s.setOutputTheme("main", main.id)
    s.updateOutput("main", { themeFor: { hymn: hymns.id } })
    useBroadcastStore.setState({ isLive: true, liveVerse: { ...sampleLiveVerse, content: "hymn" } })
    useBroadcastStore.getState().syncBroadcastOutput()
    expect(useBroadcastStore.getState().outputFrames.main.theme.id).toBe(hymns.id)
    useBroadcastStore.setState({ liveVerse: { ...sampleLiveVerse, content: "bible" } })
    useBroadcastStore.getState().syncBroadcastOutput()
    expect(useBroadcastStore.getState().outputFrames.main.theme.id).toBe(main.id)
    // The hymn theme is in use: it cannot be deleted while the output names it.
    expect(useBroadcastStore.getState().deleteTheme(hymns.id).inUse).toContain("Main Display")
  })

  it("discarding or closing a live-edited draft puts the saved theme back on the outputs and their cards", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const s = useBroadcastStore.getState()
    const theme = s.themes[0]
    s.setOutputTheme("main", theme.id)
    s.startEditing(theme.id)
    useBroadcastStore.getState().setLiveDesign(true)
    useBroadcastStore.getState().updateDraft({ name: "Draft" })
    expect(useBroadcastStore.getState().outputFrames.main.theme.name).toBe("Draft")
    emitToMock.mockClear()
    useBroadcastStore.getState().discardDraft()
    expect(useBroadcastStore.getState().outputFrames.main.theme.name).toBe(theme.name)
    expect(emitToMock.mock.calls.some((c) => c[0] === "broadcast-main")).toBe(true)
    useBroadcastStore.getState().updateDraft({ name: "Draft again" })
    useBroadcastStore.getState().setDesignerOpen(false)
    expect(useBroadcastStore.getState().outputFrames.main.theme.name).toBe(theme.name)
    useBroadcastStore.getState().resetOutputRuntime("main")
    expect(useBroadcastStore.getState().outputFrames.main).toBeUndefined()
  })

  it("ignores the old default-on autoLive value and keeps only a choice saved under the new key", async () => {
    for (const [saved, expected] of [[{ autoLive: true }, false], [{ autoLive: true, autoLiveOptIn: true }, true], [{ autoLiveOptIn: false }, false]] as const) {
      vi.resetModules()
      vi.doMock("@tauri-apps/plugin-store", () => ({
        load: async () => ({ get: async (key: string) => (saved as Record<string, unknown>)[key], set: async () => {}, save: async () => {} }),
      }))
      const { useBroadcastStore, hydrateBroadcastThemes } = await import("./broadcast-store")
      await hydrateBroadcastThemes()
      expect(useBroadcastStore.getState().autoLive, JSON.stringify(saved)).toBe(expected)
      vi.doUnmock("@tauri-apps/plugin-store")
    }
  })

  it("refuses to delete a theme an output uses, naming the outputs (FR-06)", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const s = useBroadcastStore.getState()
    const custom = { ...s.themes[0], id: "lt-custom", name: "Stream lower third", builtin: false }
    useBroadcastStore.setState({ themes: [...s.themes, custom], outputs: s.outputs.map((o, k) => (k === 0 ? { ...o, themeId: "lt-custom" } : o)) })
    const name = useBroadcastStore.getState().outputs[0].name
    expect(useBroadcastStore.getState().deleteTheme("lt-custom")).toEqual({ inUse: [name] })
    expect(useBroadcastStore.getState().themes.some((t) => t.id === "lt-custom")).toBe(true)
    useBroadcastStore.setState({ outputs: useBroadcastStore.getState().outputs.map((o) => ({ ...o, themeId: s.themes[0].id })) })
    expect(useBroadcastStore.getState().deleteTheme("lt-custom")).toEqual({ inUse: [] })
    expect(useBroadcastStore.getState().themes.some((t) => t.id === "lt-custom")).toBe(false)
  })

  it("stage outputs are sent no theme pictures (they draw none; this goes out with every timer tick)", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const s = useBroadcastStore.getState()
    const heavy = { ...s.themes[0], id: "heavy", name: "Photo", builtin: false, background: { ...s.themes[0].background, image: { url: "data:image/png;base64," + "A".repeat(1000) } } }
    const stage = { ...s.outputs[0], id: "stage-1", role: "stage" as const, themeId: "heavy", enabled: true }
    useBroadcastStore.setState({ themes: [...s.themes, heavy as never], outputs: [...s.outputs, stage as never], rehearsal: false })
    emitToMock.mockClear()
    useBroadcastStore.getState().syncBroadcastOutputFor("stage-1")
    const sent = emitToMock.mock.calls.find((c) => String(c[0]).includes("stage-1"))
    expect(sent).toBeDefined()
    expect(JSON.stringify(sent?.[2])).not.toContain("base64")
  })

  it("video sound plays from the congregation output, whatever the main output's role", async () => {
    const { soundOutputId } = await import("./broadcast-store")
    const o = (id: string, role?: string) => ({ id, role }) as never
    expect(soundOutputId([o("main"), o("b")], {})).toBe("main")
    expect(soundOutputId([o("main", "stage"), o("b"), o("c")], { c: { previewOpen: true } })).toBe("c")
    expect(soundOutputId([o("main", "signage"), o("b")], {})).toBe("b")
    expect(soundOutputId([o("main", "stage")], {})).toBeNull()
  })

  it("when the sound output changes, every output is told (only one plays: no echo)", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const s = useBroadcastStore.getState()
    const main = { ...s.outputs[0], id: "main", role: "stage" as const }
    const b = { ...s.outputs[0], id: "b", role: "congregation" as const }
    useBroadcastStore.setState({ outputs: [main, b], rehearsal: false, isLive: true, liveVerse: { kind: "verse", reference: "John 3:16", segments: [] } as never })
    emitToMock.mockClear()
    // Main goes back to Congregation: main now plays the sound, and b must be told to stop.
    useBroadcastStore.setState({ outputs: [{ ...main, role: "congregation" as const }, b] })
    const sent = Object.fromEntries(emitToMock.mock.calls.map((c) => [String(c[0]), (c[2] as { sound?: boolean }).sound]))
    expect(sent["broadcast-main"]).toBe(true)
    expect(sent["broadcast-b"]).toBe(false)
  })

  it("while a theme is live-edited, a present shows its outputs the draft (not the saved theme), with the sound flag", async () => {
    const { emitTo } = await import("@tauri-apps/api/event")
    const { useBroadcastStore } = await import("./broadcast-store")
    const s = useBroadcastStore.getState()
    const out = s.outputs[0]
    const theme = s.themes.find((t) => t.id === out.themeId)!
    useBroadcastStore.setState({ editingThemeId: theme.id, draftTheme: { ...theme, name: "Draft colour" }, liveDesign: true, isLive: true, rehearsal: false })
    vi.mocked(emitTo).mockClear()
    useBroadcastStore.getState().syncBroadcastOutputFor(out.id)
    const sent = vi.mocked(emitTo).mock.calls.find((c) => c[1] === "broadcast:verse-update")![2] as { theme: { name: string }; sound?: boolean }
    expect(sent.theme.name).toBe("Draft colour")
    expect(sent).toHaveProperty("sound")
    useBroadcastStore.setState({ editingThemeId: null, draftTheme: null, liveDesign: false, isLive: false })
  })
})

