import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AudioQueueItem, ProgramWithItems, QueueItem, SlideQueueItem, TakeStep, Verse } from "@/types"

/**
 * Take steps armed on a rundown item (#243 RS.4, OB.2): they run on the operator's own Take only,
 * once per item, never by a timed move or a phase running by itself, never put anything live by
 * themselves, and OBS is never changed in rehearsal (the OBS store's own guard).
 */
const requests: { type: string; data?: Record<string, unknown> }[] = []
let studioMode = false
class FakeClient {
  connect() { return Promise.resolve() }
  close() {}
  request(type: string, data?: Record<string, unknown>) {
    requests.push({ type, data })
    if (type === "GetSceneList") return Promise.resolve({ currentProgramSceneName: "Worship", currentPreviewSceneName: "Worship", scenes: [{ sceneName: "Worship", sceneIndex: 1 }, { sceneName: "Sermon", sceneIndex: 0 }] })
    if (type === "GetStudioModeEnabled") return Promise.resolve({ studioModeEnabled: studioMode })
    return Promise.resolve({ outputActive: false })
  }
}
vi.mock("@/lib/obs", () => ({ ObsClient: FakeClient, ObsRequestError: class extends Error { code = 0 } }))
const toast = { error: vi.fn(), info: vi.fn(), warning: vi.fn(), success: vi.fn() }
vi.mock("sonner", () => ({ toast }))
const john: Verse = { id: 26137, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "Jn", chapter: 3, verse: 16, text: "For God so loved the world" }
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (cmd: string) => (cmd === "get_verse" ? john : null)) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn().mockResolvedValue(undefined), listen: vi.fn(async () => () => {}) }))

const { presentQueueItem, remoteActions } = await import("./remote-actions")
const { runTakeSteps } = await import("./take-steps")
const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useQueueStore } = await import("@/stores/queue-store")
const { useBibleStore } = await import("@/stores/bible-store")
const { useMediaStore } = await import("@/stores/media-store")
const { useObsStore } = await import("@/stores/obs-store")
const { useSettingsStore } = await import("@/stores/settings-store")
const { useServiceStore } = await import("@/stores/service-store")
const { designStore } = await import("@/design-engine/design-store")
const { toQueueItems } = await import("@/stores/service-store")
const { useSoundStore } = await import("@/stores/sound-store")
const { newScene } = await import("@/lib/scenes")
const { MAIN_OUTPUT_ID, defaultNdiSettings } = await import("@/types")

const slide = (id: string, on_take?: TakeStep[], extra: Partial<QueueItem> = {}): QueueItem =>
  ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0, ...(on_take ? { on_take } : {}), ...extra }) as QueueItem
const reading = (id: string, on_take: TakeStep[]): QueueItem =>
  ({ id, verse: { ...john, id: 0, text: "" }, reference: "John 3:16", confidence: 1, source: "manual", added_at: 0, on_take }) as QueueItem

const scene = newScene("Camera and Bible")
const obsSwitches = () => requests.filter((r) => r.type === "SetCurrentProgramScene" || r.type === "SetCurrentPreviewScene")
const sceneOnMain = () => useBroadcastStore.getState().outputs.find((o) => o.id === MAIN_OUTPUT_ID)?.sceneId

async function connectObs() {
  useSettingsStore.setState({ obs: { enabled: true, host: "127.0.0.1", port: 4455, password: "" } })
  await useObsStore.getState().connect()
}

beforeEach(async () => {
  vi.restoreAllMocks()
  requests.length = 0
  studioMode = false
  for (const f of Object.values(toast)) f.mockClear()
  const theme = useBroadcastStore.getState().themes[0].id
  useBroadcastStore.setState({
    isLive: false, liveVerse: null, liveItemId: null, liveSlide: null, heldLive: null, cleared: false, rehearsal: false, rehearsalReturn: null, sources: {}, sceneReturn: {}, sceneTakes: {},
    scenes: [scene],
    outputs: [{ id: MAIN_OUTPUT_ID, name: "Sanctuary", type: "display", themeId: theme, monitorIndex: 0, ndi: defaultNdiSettings() }],
  })
  useBibleStore.setState({ selectedVerse: null, selectedSlide: null, activeTranslationId: 1, translations: [{ id: 1, abbreviation: "KJV", title: "King James Version", language: "en", is_copyrighted: false, is_downloaded: true }] })
  useMediaStore.setState({ assets: [], loaded: true })
  useSoundStore.setState({ assetId: null, itemId: null, playing: false })
  useQueueStore.setState({
    items: [slide("welcome"), slide("sermon", [`scene.take:${scene.id}`, "obs.scene:Sermon"], { scene_id: scene.id }), slide("after"), reading("john", ["source.only", "obs.scene:Sermon"])],
    activeIndex: null,
  })
  useServiceStore.setState({ current: null, approvedDesigns: null, approvedDesignRevision: null, approvedDesignsError: null })
  await connectObs()
  requests.length = 0
})
afterEach(() => vi.restoreAllMocks())

describe("an item's Take steps", () => {
  it("does not run hidden scene or OBS Take steps on a typed audio cue", async () => {
    const audio: AudioQueueItem = {
      id: "walk-in",
      kind: "audio",
      audio: { media_id: "walkin", name: "Walk-in" },
      reference: "Walk-in",
      confidence: 1,
      source: "manual",
      added_at: 0,
      on_take: [`scene.take:${scene.id}`, "obs.scene:Sermon"],
    }
    useMediaStore.setState({ assets: [{ id: "walkin", kind: "audio", name: "Walk-in", present: true, path: "/media/walkin.mp3", hash: "walkin", size: 1, mime: "audio/mpeg", width: null, height: null, duration_ms: null, created_at: "" }] as never })
    useSoundStore.setState({ play: async ({ id, itemId }: { id: string; itemId?: string }) => {
      useSoundStore.setState({ assetId: id, itemId: itemId ?? null, playing: true })
      return true
    } } as never)
    useQueueStore.setState({ items: [audio], activeIndex: null })

    await presentQueueItem(0)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useQueueStore.getState().activeIndex).toBe(0)
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(useBroadcastStore.getState().liveItemId).toBeNull()
    expect(sceneOnMain()).toBeUndefined()
    expect(obsSwitches()).toEqual([])
  })

  it("keeps legacy image rows migrated to audio from running their saved Take steps", async () => {
    const legacy: ProgramWithItems = {
      program: { id: "p1", title: "Sunday", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 1 },
      items: [{
        id: "walk-in",
        program_id: "p1",
        position: 0,
        kind: "image",
        reference: "Walk-in",
        book_number: null,
        chapter: null,
        verse: null,
        translation: null,
        secondary_translation: null,
        notes: null,
        payload: JSON.stringify({ media_id: "walkin", fit: "cover", on_take: [`scene.take:${scene.id}`, "obs.scene:Sermon"] }),
      }],
    }
    const migrated = toQueueItems(legacy, 1, [], new Map([["walkin", "audio"]]))
    expect(migrated.items[0].kind).toBe("audio")
    expect(migrated.items[0].on_take).toEqual([`scene.take:${scene.id}`, "obs.scene:Sermon"])
    useMediaStore.setState({ assets: [{ id: "walkin", kind: "audio", name: "Walk-in", present: true, path: "/media/walkin.mp3", hash: "walkin", size: 1, mime: "audio/mpeg", width: null, height: null, duration_ms: null, created_at: "" }] as never })
    useSoundStore.setState({ play: async ({ id, itemId }: { id: string; itemId?: string }) => {
      useSoundStore.setState({ assetId: id, itemId: itemId ?? null, playing: true })
      return true
    } } as never)
    useQueueStore.setState({ items: migrated.items, activeIndex: null })

    await presentQueueItem(0)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useQueueStore.getState().activeIndex).toBe(0)
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(useBroadcastStore.getState().liveItemId).toBeNull()
    expect(sceneOnMain()).toBeUndefined()
    expect(obsSwitches()).toEqual([])
  })

  it("takes the scene/look revisions pinned by the approved service", async () => {
    const theme = useBroadcastStore.getState().themes[0]
    const approvedScene = { ...scene, background: "#001122", updatedAt: scene.updatedAt - 1 }
    useServiceStore.setState({
      current: { id: "service-1", title: "Sunday", service_date: null, revision: 3, approved_revision: 3, approved_at: "2026-10-25T10:00:00.000Z", approved_by: "Pastor Ade", created_at: "", updated_at: "", item_count: 0 },
      approvedDesignRevision: 3,
      approvedDesigns: {
        version: 1,
        scenes: { [scene.id]: { scene: approvedScene, outputs: { [MAIN_OUTPUT_ID]: { themes: { [theme.id]: theme }, logoUrl: null } } } },
        looks: { [theme.id]: theme },
        media_ids: [],
      },
    })

    await presentQueueItem(1)

    expect(useBroadcastStore.getState().outputFrames[MAIN_OUTPUT_ID].scene?.background).toBe("#001122")
    expect(useBroadcastStore.getState().outputs.find((o) => o.id === MAIN_OUTPUT_ID)?.sceneAppearanceSnapshot?.approved).toEqual({ programId: "service-1", revision: 3, appearanceComplete: true, approvedAt: "2026-10-25T10:00:00.000Z", approvedBy: "Pastor Ade" })
    const { buildLiveState } = await import("@/lib/live-state")
    expect(buildLiveState().outputs[0]).toMatchObject({ sceneApprovedServiceId: "service-1", sceneApprovedRevision: 3, sceneApprovedAppearanceComplete: true, sceneApprovedAt: "2026-10-25T10:00:00.000Z", sceneApprovedBy: "Pastor Ade" })
  })

  it("does not substitute a mutable scene when the approved design manifest is missing", async () => {
    useServiceStore.setState({
      current: { id: "legacy", title: "Sunday", service_date: null, revision: 3, approved_revision: 3, created_at: "", updated_at: "", item_count: 0 },
      approvedDesigns: null,
      approvedDesignRevision: null,
      approvedDesignsError: "This approved service predates saved scene and look snapshots.",
    })

    await presentQueueItem(1)

    expect(useBroadcastStore.getState().outputs.find((o) => o.id === MAIN_OUTPUT_ID)?.sceneId).toBeUndefined()
    expect(useBroadcastStore.getState().sceneTakes[MAIN_OUTPUT_ID]).toBeUndefined()
  })

  it("does not fall back to today's scene when an approved manifest omits the item's scene", async () => {
    const approvedTheme = useBroadcastStore.getState().themes[0]
    useServiceStore.setState({
      current: { id: "service-2", title: "Sunday", service_date: null, revision: 3, approved_revision: 3, created_at: "", updated_at: "", item_count: 0 },
      approvedDesigns: { version: 1, scenes: {}, looks: {}, media_ids: [] },
      approvedDesignRevision: 3,
      approvedDesignsError: null,
    })
    expect(approvedTheme.id).toBeTruthy()

    await presentQueueItem(1)

    expect(useBroadcastStore.getState().outputs.find((o) => o.id === MAIN_OUTPUT_ID)?.sceneId).toBeUndefined()
    expect(useBroadcastStore.getState().sceneTakes[MAIN_OUTPUT_ID]).toBeUndefined()
  })

  it("run on the operator's own Take, after its content is up, and once per item", async () => {
    await presentQueueItem(1)
    expect(useBroadcastStore.getState().liveItemId).toBe("sermon")
    await vi.waitFor(() => expect(obsSwitches()).toEqual([{ type: "SetCurrentProgramScene", data: { sceneName: "Sermon" } }]))
    expect(sceneOnMain()).toBe(scene.id)
    // The same item again (a Take of what is already up) runs nothing.
    useBroadcastStore.getState().releaseScene(MAIN_OUTPUT_ID)
    await presentQueueItem(1)
    await Promise.resolve()
    expect(sceneOnMain()).toBeUndefined()
    expect(obsSwitches()).toHaveLength(1)
  })

  it("Take live of the item in Preview runs them too", async () => {
    useBibleStore.getState().selectSlide({ item: useQueueStore.getState().items[1] as SlideQueueItem, index: 0 })
    await remoteActions.sendToLive()
    await vi.waitFor(() => expect(sceneOnMain()).toBe(scene.id))
  })

  it("never for a timed move or a phase running by itself", async () => {
    await presentQueueItem(1, 0, undefined, { automatic: true })
    expect(useBroadcastStore.getState().liveItemId).toBe("sermon")
    await Promise.resolve()
    expect(sceneOnMain()).toBeUndefined()
    expect(obsSwitches()).toEqual([])
  })

  it("put nothing live by themselves", async () => {
    const { useApprovalGateStore } = await import("@/stores/approval-gate-store")
    const { runTakeSteps } = await import("./take-steps")
    await runTakeSteps(useQueueStore.getState().items[1])
    const b = useBroadcastStore.getState()
    expect([b.isLive, b.liveVerse, b.liveItemId]).toEqual([false, null, null])
    expect(sceneOnMain()).toBe(scene.id)
    expect(useApprovalGateStore.getState().held).toBeFalsy()
  })

  it("in rehearsal a scene Take is practice and OBS is refused by its own guard", async () => {
    const { OBS_REHEARSAL_REASON } = await import("@/stores/obs-store")
    useBroadcastStore.getState().setRehearsal(true)
    await presentQueueItem(1)
    await vi.waitFor(() => expect(toast.info).toHaveBeenCalledWith("OBS not changed", { description: OBS_REHEARSAL_REASON }))
    expect(obsSwitches()).toEqual([])
    expect(sceneOnMain()).toBe(scene.id)
    // Leaving rehearsal puts the screen back as it was: the practice scene does not stay.
    useBroadcastStore.getState().setRehearsal(false)
    expect(sceneOnMain()).toBeUndefined()
    expect(obsSwitches()).toEqual([])
  })

  it("in OBS's Studio Mode the scene only waits in OBS's preview", async () => {
    studioMode = true
    await connectObs()
    requests.length = 0
    await presentQueueItem(1)
    await vi.waitFor(() => expect(obsSwitches()).toEqual([{ type: "SetCurrentPreviewScene", data: { sceneName: "Sermon" } }]))
    expect(requests.some((r) => r.type === "TriggerStudioModeTransition")).toBe(false)
  })

  it("a reading armed Bible feeds only leaves the main screens alone", async () => {
    await presentQueueItem(3)
    const b = useBroadcastStore.getState()
    expect(b.isLive).toBe(false)
    expect(b.sources.bible?.itemId).toBe("john")
    await vi.waitFor(() => expect(obsSwitches()).toHaveLength(1))
    // Taking it again (Next at the end) runs its steps no second time.
    await presentQueueItem(3)
    await Promise.resolve()
    expect(obsSwitches()).toHaveLength(1)
  })

  it("does not run an older item's scene step when its design lookup finishes after a newer Take", async () => {
    let resolveVersion!: (value: null) => void
    const pendingVersion = new Promise<null>((resolve) => { resolveVersion = resolve })
    const getVersion = vi.spyOn(designStore, "getVersion").mockImplementation(async () => pendingVersion)
    let targetIsCurrent = true
    const olderItem = slide("older", [`scene.take:${scene.id}`], {
      slide: { title: "Older", body: "", designRef: { id: "d1", version: 2 } },
    })

    const running = runTakeSteps(olderItem, () => targetIsCurrent)
    await vi.waitFor(() => expect(getVersion).toHaveBeenCalledTimes(1))
    targetIsCurrent = false
    resolveVersion(null)
    await running

    expect(sceneOnMain()).toBeUndefined()
  })

  it("a missing scene or OBS scene says so and changes nothing", async () => {
    useQueueStore.setState({ items: [slide("x", ["scene.take:gone", "obs.scene:Nope"])] })
    await presentQueueItem(0)
    await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(2))
    expect(sceneOnMain()).toBeUndefined()
    expect(obsSwitches()).toEqual([])
  })

  it("takes a shared scene before output overrides and keeps each screen's own scene", async () => {
    const { runTakeSteps } = await import("./take-steps")
    const overflowScene = newScene("Overflow")
    const sanctuaryScene = newScene("Sanctuary override")
    const current = useBroadcastStore.getState()
    useBroadcastStore.setState({
      scenes: [scene, overflowScene, sanctuaryScene],
      outputs: [
        ...current.outputs,
        { ...current.outputs[0], id: "overflow", name: "Overflow" },
      ],
    })
    const taken: Array<[string, string]> = []
    const takeScene = vi.spyOn(useBroadcastStore.getState(), "takeScene").mockImplementation((outputId, sceneId) => {
      taken.push([outputId, sceneId])
    })

    await runTakeSteps(slide("multi-screen", [
      `scene.take:${overflowScene.id}@overflow`,
      `scene.take:${scene.id}`,
      `scene.take:${sanctuaryScene.id}@${MAIN_OUTPUT_ID}`,
    ]))

    expect(taken).toEqual([
      [MAIN_OUTPUT_ID, scene.id],
      ["overflow", scene.id],
      ["overflow", overflowScene.id],
      [MAIN_OUTPUT_ID, sanctuaryScene.id],
    ])
    takeScene.mockRestore()
  })

  it("ignores missing and non-congregation output targets without changing any screen", async () => {
    const { runTakeSteps } = await import("./take-steps")
    const current = useBroadcastStore.getState()
    useBroadcastStore.setState({
      outputs: [
        ...current.outputs,
        { ...current.outputs[0], id: "stage", name: "Stage", role: "stage" },
        { ...current.outputs[0], id: "signage", name: "Signage", role: "signage" },
      ],
    })
    const takeScene = vi.spyOn(useBroadcastStore.getState(), "takeScene")

    await runTakeSteps(slide("invalid-targets", [
      `scene.take:${scene.id}@missing-screen`,
      `scene.take:${scene.id}@stage`,
      `scene.take:${scene.id}@signage`,
    ]))

    expect(toast.warning).toHaveBeenCalledTimes(3)
    expect(takeScene).not.toHaveBeenCalled()
    expect(useBroadcastStore.getState().outputs.map((o) => o.sceneId)).toEqual([undefined, undefined, undefined])
    takeScene.mockRestore()
  })
})
