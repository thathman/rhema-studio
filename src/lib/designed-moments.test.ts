import { beforeEach, describe, expect, it, vi } from "vitest"
import type { QueueItem } from "@/types"

/**
 * A designed moment on Live (C2): the pinned version is shown on the congregation screens while it
 * is up, the screens get back what they showed after, and a missing or plain design falls back to
 * the slide's own text. Never another version.
 */
const toast = { error: vi.fn(), info: vi.fn(), warning: vi.fn(), success: vi.fn() }
vi.mock("sonner", () => ({ toast }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn().mockResolvedValue(undefined), listen: vi.fn(async () => () => {}) }))

const { showDesignedMoment, restoreAfterDesignedMoment } = await import("./designed-moments")
const { runTakeSteps } = await import("./take-steps")
const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useQueueStore } = await import("@/stores/queue-store")
const { useServiceStore } = await import("@/stores/service-store")
const { newScene, normalizeScene } = await import("@/lib/scenes")
const { sceneToDesign } = await import("@/design-engine/rhema-scene")
const { MAIN_OUTPUT_ID, defaultNdiSettings } = await import("@/types")

const { designStore } = await import("@/design-engine/design-store")

const welcome = newScene("Welcome card")
const usual = newScene("Camera and Bible")
const versions = { "d1:2": { designId: "d1", version: 2, document: sceneToDesign(welcome) } } as Record<string, { designId: string; version: number; document: ReturnType<typeof sceneToDesign> }>
const getVersion = vi.fn(async (id: string, version: number) => versions[`${id}:${version}`] ?? null)
vi.spyOn(designStore, "getVersion").mockImplementation(getVersion as never)
const moment = (designRef?: { id: string; version: number }): QueueItem =>
  ({ id: "m", kind: "slide", slide: { title: "Welcome", body: "Glad you came", ...(designRef ? { designRef } : {}) }, reference: "Welcome", confidence: 1, source: "manual", added_at: 0 }) as QueueItem
const plain: QueueItem = { id: "p", kind: "slide", slide: { title: "Notices", body: "" }, reference: "Notices", confidence: 1, source: "manual", added_at: 0 } as QueueItem
const out = (id: string) => useBroadcastStore.getState().outputs.find((o) => o.id === id)

const approve = (moments?: Record<string, { id: string; version: number }>) => useServiceStore.setState({
  current: { id: "svc", approved_revision: 3 } as never,
  approvedDesignRevision: 3,
  approvedDesigns: { version: 1, scenes: {}, looks: {}, media_ids: [], ...(moments ? { moments } : {}) },
  approvedDesignsError: null,
})
const live = (item: QueueItem, isLive = true) => useBroadcastStore.setState({ isLive, liveItemId: isLive ? item.id : null })
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  useServiceStore.setState({ current: null, approvedDesigns: null, approvedDesignRevision: null, approvedDesignsError: null })
  useBroadcastStore.setState({ isLive: false, liveItemId: null })
  useQueueStore.setState({ items: [] })
  restoreAfterDesignedMoment()
  for (const f of Object.values(toast)) f.mockClear()
  const theme = useBroadcastStore.getState().themes[0].id
  useBroadcastStore.setState({
    rehearsal: false, rehearsalReturn: null, sceneReturn: {}, sceneTakes: {}, scenes: [usual],
    outputs: [
      { id: MAIN_OUTPUT_ID, name: "Sanctuary", type: "display", themeId: theme, monitorIndex: 0, ndi: defaultNdiSettings() },
      { id: "stage", name: "Stage", type: "display", role: "stage", themeId: theme, monitorIndex: 1, ndi: defaultNdiSettings() },
    ],
  })
  useBroadcastStore.getState().takeScene(MAIN_OUTPUT_ID, usual.id)
})

describe("a designed moment on Live", () => {
  it("gives the screens back when Program leaves the moment without a Take", async () => {
    useBroadcastStore.setState({ isLive: true, liveItemId: "m" })
    await showDesignedMoment(moment({ id: "d1", version: 2 }), getVersion)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v2")
    useBroadcastStore.setState({ isLive: false })
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
    expect(out(MAIN_OUTPUT_ID)?.designedMomentRestore).toBeUndefined()
  })

  it("stays up while the moment is live, and across a Take that shows another design", async () => {
    useBroadcastStore.setState({ isLive: true, liveItemId: "m" })
    await showDesignedMoment(moment({ id: "d1", version: 2 }), getVersion)
    useBroadcastStore.setState({ liveItemId: "m" })
    useQueueStore.setState({ items: [{ ...moment({ id: "d1", version: 2 }), id: "m2" }] })
    useBroadcastStore.setState({ liveItemId: "m2" })
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v2")
    useQueueStore.setState({ items: [] })
  })

  it("survives a rehearsal: the design and its way back both return", async () => {
    await showDesignedMoment(moment({ id: "d1", version: 2 }), getVersion)
    useBroadcastStore.getState().setRehearsal(true)
    restoreAfterDesignedMoment()
    useBroadcastStore.getState().setRehearsal(false)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v2")
    restoreAfterDesignedMoment()
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
  })

  it("does not bring back a scene deleted during the moment", async () => {
    await showDesignedMoment(moment({ id: "d1", version: 2 }), getVersion)
    useBroadcastStore.getState().deleteScene(usual.id)
    restoreAfterDesignedMoment()
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBeUndefined()
    useBroadcastStore.setState({ scenes: [usual] })
  })

  it("keeps a rehearsal's manual scene chosen while the design loads", async () => {
    useBroadcastStore.getState().setRehearsal(true)
    const other = newScene("Manual")
    useBroadcastStore.setState({ scenes: [usual, other] })
    let release: (value: unknown) => void = () => {}
    const slow = vi.fn(() => new Promise((resolve) => { release = resolve })) as unknown as typeof getVersion
    const showing = showDesignedMoment(moment({ id: "d1", version: 2 }), slow)
    useBroadcastStore.getState().takeScene(MAIN_OUTPUT_ID, other.id)
    release(versions["d1:2"])
    await showing
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(other.id)
    useBroadcastStore.getState().setRehearsal(false)
  })

  it("shows the pinned version on congregation screens and gives them back after", async () => {
    await showDesignedMoment(moment({ id: "d1", version: 2 }), getVersion)
    expect(getVersion).toHaveBeenCalledWith("d1", 2)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v2")
    expect(out(MAIN_OUTPUT_ID)?.sceneSnapshot?.design).toEqual({ id: "d1", version: 2 })
    expect(out(MAIN_OUTPUT_ID)?.sceneSnapshot?.name).toBe("Welcome card")
    expect(out("stage")?.sceneId).toBeUndefined()
    expect(useBroadcastStore.getState().scenes.map((s) => s.id)).toEqual([usual.id])

    await showDesignedMoment(plain, getVersion)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
  })

  it("does not let a delayed design replace a newer Take", async () => {
    let resolveVersion!: (value: (typeof versions)[string] | null) => void
    const pendingVersion = new Promise<(typeof versions)[string] | null>((resolve) => { resolveVersion = resolve })
    const getDelayedVersion = vi.fn(async () => pendingVersion)
    let targetIsCurrent = true

    const olderTake = showDesignedMoment(moment({ id: "d1", version: 2 }), getDelayedVersion, () => targetIsCurrent)
    targetIsCurrent = false
    resolveVersion(versions["d1:2"])
    await olderTake

    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
  })

  it("keeps a manual scene Take made during a delayed design lookup", async () => {
    let resolveVersion!: (value: (typeof versions)[string] | null) => void
    const pendingVersion = new Promise<(typeof versions)[string] | null>((resolve) => { resolveVersion = resolve })
    const getDelayedVersion = vi.fn(async () => pendingVersion)
    const delayedTake = showDesignedMoment(moment({ id: "d1", version: 2 }), getDelayedVersion)

    const manual = newScene("Manually taken while design loaded")
    useBroadcastStore.setState({ scenes: [usual, manual] })
    useBroadcastStore.getState().takeScene(MAIN_OUTPUT_ID, manual.id)
    resolveVersion(versions["d1:2"])
    await delayedTake

    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(manual.id)
    expect(out(MAIN_OUTPUT_ID)?.sceneSnapshot?.name).toBe(manual.name)
    expect(out(MAIN_OUTPUT_ID)?.designedMomentRestore).toBeUndefined()
  })

  it("keeps a designed moment on congregation screens during a Bible-feeds-only Take", async () => {
    await showDesignedMoment(moment({ id: "d1", version: 2 }), getVersion)
    const bibleOnly = {
      id: "bible-only", kind: "verse", verse: { id: 26137, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "Jn", chapter: 3, verse: 16, text: "For God so loved the world" },
      reference: "John 3:16", confidence: 1, source: "manual", added_at: 0, on_take: ["source.only"],
    } as QueueItem

    await runTakeSteps(bibleOnly)

    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v2")
  })

  it("restores the prior scene from persisted output state after a restart", async () => {
    await showDesignedMoment(moment({ id: "d1", version: 2 }), getVersion)
    const savedOutputs = JSON.parse(JSON.stringify(useBroadcastStore.getState().outputs))
    const savedScenes = JSON.parse(JSON.stringify(useBroadcastStore.getState().scenes))

    vi.resetModules()
    const { useBroadcastStore: restartedStore } = await import("@/stores/broadcast-store")
    const { restoreAfterDesignedMoment: restoreAfterRestart } = await import("./designed-moments")
    restartedStore.setState({ outputs: savedOutputs, scenes: savedScenes })
    restoreAfterRestart()

    expect(restartedStore.getState().outputs.find((output) => output.id === MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
  })

  it("a screen that had no scene is released again", async () => {
    useBroadcastStore.getState().releaseScene(MAIN_OUTPUT_ID)
    await showDesignedMoment(moment({ id: "d1", version: 2 }), getVersion)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v2")
    restoreAfterDesignedMoment()
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBeUndefined()
  })

  it("a missing version shows the slide's own text, never another version, and says why", async () => {
    await showDesignedMoment(moment({ id: "d1", version: 3 }), getVersion)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
    expect(toast.warning).toHaveBeenCalledWith("Design not shown", expect.objectContaining({ description: expect.stringContaining("version 3") }))
  })

  it("a plain slide changes nothing", async () => {
    await showDesignedMoment(plain, getVersion)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it("an operator's own scene change during the moment is kept", async () => {
    await showDesignedMoment(moment({ id: "d1", version: 2 }), getVersion)
    const other = newScene("Announcements")
    useBroadcastStore.setState({ scenes: [usual, other] })
    useBroadcastStore.getState().takeScene(MAIN_OUTPUT_ID, other.id)
    await showDesignedMoment(plain, getVersion)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(other.id)
  })

  it("two designed moments in a row restore to what was up before the first", async () => {
    versions["d1:3"] = { designId: "d1", version: 3, document: sceneToDesign(welcome) }
    await showDesignedMoment(moment({ id: "d1", version: 2 }), getVersion)
    await showDesignedMoment(moment({ id: "d1", version: 3 }), getVersion)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v3")
    restoreAfterDesignedMoment()
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
    delete versions["d1:3"]
  })
})

describe("a designed moment and the service's approval", () => {
  const pin = { id: "d1", version: 2 }

  it("shows the version the approval captured for this item", async () => {
    approve({ m: pin })
    await showDesignedMoment(moment(pin), getVersion)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v2")
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it.each([
    ["pinned after approval", { other: pin }],
    ["moved to another version", { m: { id: "d1", version: 1 } }],
    ["moved to another design", { m: { id: "d9", version: 2 } }],
    ["approved before pins were captured", undefined],
  ])("%s: the screen keeps its approved scene and the operator is told", async (_why, moments) => {
    approve(moments)
    await showDesignedMoment(moment(pin), getVersion)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
    expect(toast.warning).toHaveBeenCalledWith("Design needs approval", expect.objectContaining({ description: expect.stringContaining("approval") }))
  })

  it("an approved service whose list could not be read shows no design", async () => {
    useServiceStore.setState({ current: { id: "svc", approved_revision: 3 } as never, approvedDesigns: null, approvedDesignRevision: null, approvedDesignsError: "database busy" })
    await showDesignedMoment(moment(pin), getVersion)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
    expect(toast.warning).toHaveBeenCalledWith("Design needs approval", expect.objectContaining({ description: "database busy" }))
  })

  it("a list from another approved revision does not count", async () => {
    approve({ m: pin })
    useServiceStore.setState({ approvedDesignRevision: 2 })
    await showDesignedMoment(moment(pin), getVersion)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
  })

  it("an unapproved pin leaving the previous design gives the screen back", async () => {
    await showDesignedMoment(moment(pin), getVersion)
    approve({})
    await showDesignedMoment({ ...moment(pin), id: "m2" } as QueueItem, getVersion)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
    expect(out(MAIN_OUTPUT_ID)?.designedMomentRestore).toBeUndefined()
  })

  it("a change made while the version loads is what counts", async () => {
    approve({ m: pin })
    const slow = vi.fn(async (id: string, version: number) => {
      approve({})
      return getVersion(id, version)
    })
    await showDesignedMoment(moment(pin), slow)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
  })
})

describe("the screens following Program", () => {
  const pin = { id: "d1", version: 2 }

  it("a restore from an older build, with no item, is given back when Program moves", async () => {
    await showDesignedMoment(moment(pin), getVersion)
    const o = out(MAIN_OUTPUT_ID)!
    useBroadcastStore.getState().updateOutput(o.id, { designedMomentRestore: { ...o.designedMomentRestore!, itemId: undefined } })
    live(plain)
    live(plain, false)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
    expect(out(MAIN_OUTPUT_ID)?.designedMomentRestore).toBeUndefined()
  })

  it("a timed move onto a pinned slide shows its design, and off it gives the scene back", async () => {
    versions["d1:3"] = { designId: "d1", version: 3, document: versions["d1:2"].document }
    useQueueStore.setState({ items: [moment(pin), { ...moment({ id: "d1", version: 3 }), id: "n" } as QueueItem, plain] })
    live(moment(pin))
    await settled()
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v2")
    useBroadcastStore.setState({ liveItemId: "n" })
    await settled()
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v3")
    useBroadcastStore.setState({ liveItemId: "p" })
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
  })

  it("a timed move does not get around the approval", async () => {
    approve({})
    useQueueStore.setState({ items: [moment(pin)] })
    live(moment(pin))
    await settled()
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
    expect(toast.warning).toHaveBeenCalledTimes(1)
  })

  it("a Take and the Program change together put the design up once, and it still goes back", async () => {
    useQueueStore.setState({ items: [moment(pin), plain] })
    live(moment(pin))
    await runTakeSteps(moment(pin))
    await settled()
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v2")
    expect(out(MAIN_OUTPUT_ID)?.designedMomentRestore?.scene?.id).toBe(usual.id)
    live(plain, false)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
  })

  it("Show this live onto a plain item gives back the design that was up before the rehearsal", async () => {
    useQueueStore.setState({ items: [moment(pin), plain] })
    live(moment(pin))
    await settled()
    useBroadcastStore.getState().setRehearsal(true)
    useBroadcastStore.setState({ liveItemId: "p" })
    useBroadcastStore.getState().setRehearsal(false, { keepRehearsed: true })
    expect(useBroadcastStore.getState().liveItemId).toBe("p")
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
  })

  it("Show this live onto a pinned slide shows its design", async () => {
    useQueueStore.setState({ items: [moment(pin), plain] })
    live(plain)
    useBroadcastStore.getState().setRehearsal(true)
    useBroadcastStore.setState({ liveItemId: "m" })
    useBroadcastStore.getState().setRehearsal(false, { keepRehearsed: true })
    await settled()
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v2")
  })

  it("leaving a rehearsal with Program as it was changes nothing", async () => {
    useQueueStore.setState({ items: [moment(pin), plain] })
    live(moment(pin))
    await settled()
    useBroadcastStore.getState().setRehearsal(true)
    useBroadcastStore.getState().setRehearsal(false)
    await settled()
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v2")
    expect(toast.warning).not.toHaveBeenCalled()
  })
})

describe("a designed moment put back by a recovery", () => {
  const pin = { id: "d1", version: 2 }
  // A recovery restores each screen's saved scene first, then Program: the moment is already up when Program moves.
  const recovered = async (moments: Record<string, { id: string; version: number }> | undefined, ref = pin) => {
    await showDesignedMoment(moment(pin), getVersion)
    useQueueStore.setState({ items: [moment(ref)] })
    approve(moments)
    toast.warning.mockClear()
    live(moment(ref))
    await settled()
  }

  it("stays up when the approval still covers that exact pin", async () => {
    await recovered({ m: pin })
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v2")
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it.each([["missing from", {}], ["different in", { m: { id: "d1", version: 1 } }], ["absent from an older", undefined]])("comes down when the pin is %s the approval", async (_why, moments) => {
    await recovered(moments)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
    expect(toast.warning).toHaveBeenCalledWith("Design needs approval", expect.anything())
  })

  it("a slide pinned to another version since does not keep the old one up", async () => {
    versions["d1:3"] = { designId: "d1", version: 3, document: versions["d1:2"].document }
    await recovered({ m: { id: "d1", version: 3 } }, { id: "d1", version: 3 })
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v3")
  })

  it("comes down when the service's approval arrives or changes with the moment already up", async () => {
    useQueueStore.setState({ items: [moment(pin)] })
    live(moment(pin))
    await settled()
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v2")
    approve({ m: pin })
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v2")
    approve({})
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
    expect(toast.warning).toHaveBeenCalledWith("Design needs approval", expect.anything())
  })
})

describe("the approval changing with a moment up compares what is on the screen", () => {
  const v2 = { id: "d1", version: 2 }
  const v3 = { id: "d1", version: 3 }

  it("v2 on screen with the item now pinning an approved v3 goes back, and v3 is not claimed", async () => {
    versions["d1:3"] = { designId: "d1", version: 3, document: versions["d1:2"].document }
    await showDesignedMoment(moment(v2), getVersion)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v2")
    useQueueStore.setState({ items: [moment(v3)] })
    approve({ m: v3 })
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
    expect(out(MAIN_OUTPUT_ID)?.designedMomentRestore).toBeUndefined()
    expect(toast.warning).toHaveBeenCalledWith("Design needs approval", expect.anything())
  })

  it("the approved version on screen stays", async () => {
    await showDesignedMoment(moment(v2), getVersion)
    useQueueStore.setState({ items: [moment(v2)] })
    approve({ m: v2 })
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v2")
  })

  it("a moment whose item is gone from an approved service goes back", async () => {
    await showDesignedMoment(moment(v2), getVersion)
    useQueueStore.setState({ items: [plain] })
    approve({ m: v2 })
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
  })

  it("a restore from an older build, with no item, goes back once a service is approved", async () => {
    await showDesignedMoment(moment(v2), getVersion)
    const o = out(MAIN_OUTPUT_ID)!
    useBroadcastStore.getState().updateOutput(o.id, { designedMomentRestore: { ...o.designedMomentRestore!, itemId: undefined } })
    approve({ m: v2 })
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
  })
})

describe("a scene's design pin", () => {
  it("survives normalising; a malformed pin is dropped", () => {
    expect(normalizeScene({ ...usual, design: { id: "d1", version: 2 } })?.design).toEqual({ id: "d1", version: 2 })
    for (const bad of [{ id: "d1", version: 0 }, { id: "d1", version: 1.5 }, { id: "../x", version: 1 }, "d1"]) {
      expect(normalizeScene({ ...usual, design: bad })?.design).toBeUndefined()
    }
  })
})
