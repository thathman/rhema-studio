import { beforeEach, describe, expect, it, vi } from "vitest"
import type { QueueItem, SlideQueueItem, TakeStep, Verse } from "@/types"

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
const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useQueueStore } = await import("@/stores/queue-store")
const { useBibleStore } = await import("@/stores/bible-store")
const { useObsStore } = await import("@/stores/obs-store")
const { useSettingsStore } = await import("@/stores/settings-store")
const { useServiceStore } = await import("@/stores/service-store")
const { newScene } = await import("@/lib/scenes")
const { MAIN_OUTPUT_ID, defaultNdiSettings } = await import("@/types")

const slide = (id: string, on_take?: TakeStep[], extra: Partial<QueueItem> = {}): QueueItem =>
  ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0, ...(on_take ? { on_take } : {}), ...extra }) as QueueItem
const reading = (id: string, on_take: TakeStep[]): QueueItem =>
  ({ id, verse: { ...john, id: 0, text: "" }, reference: "John 3:16", confidence: 1, source: "manual", added_at: 0, on_take }) as QueueItem

const scene = newScene("Camera and Bible")
const overflowScene = newScene("Lyrics and Camera")
const obsSwitches = () => requests.filter((r) => r.type === "SetCurrentProgramScene" || r.type === "SetCurrentPreviewScene")
const sceneOnMain = () => useBroadcastStore.getState().outputs.find((o) => o.id === MAIN_OUTPUT_ID)?.sceneId
const sceneOn = (outputId: string) => useBroadcastStore.getState().outputs.find((o) => o.id === outputId)?.sceneId

async function connectObs() {
  useSettingsStore.setState({ obs: { enabled: true, host: "127.0.0.1", port: 4455, password: "" } })
  await useObsStore.getState().connect()
}

beforeEach(async () => {
  requests.length = 0
  studioMode = false
  for (const f of Object.values(toast)) f.mockClear()
  const theme = useBroadcastStore.getState().themes[0].id
  useBroadcastStore.setState({
    isLive: false, liveVerse: null, liveItemId: null, liveSlide: null, heldLive: null, cleared: false, rehearsal: false, rehearsalReturn: null, sources: {}, sceneReturn: {},
    scenes: [scene],
    outputs: [{ id: MAIN_OUTPUT_ID, name: "Sanctuary", type: "display", themeId: theme, monitorIndex: 0, ndi: defaultNdiSettings() }],
  })
  useBibleStore.setState({ selectedVerse: null, selectedSlide: null, activeTranslationId: 1, translations: [{ id: 1, abbreviation: "KJV", title: "King James Version", language: "en", is_copyrighted: false, is_downloaded: true }] })
  useQueueStore.setState({
    items: [slide("welcome"), slide("sermon", [`scene.take:${scene.id}`, "obs.scene:Sermon"], { scene_id: scene.id }), slide("after"), reading("john", ["source.only", "obs.scene:Sermon"])],
    activeIndex: null,
  })
  useServiceStore.setState({ current: null, approvedDesigns: null, approvedDesignRevision: null, approvedDesignsError: null })
  await connectObs()
  requests.length = 0
})

describe("an item's Take steps", () => {
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

  it("takes each planned scene to its own congregation output", async () => {
    const current = useBroadcastStore.getState()
    useBroadcastStore.setState({
      scenes: [scene, overflowScene],
      outputs: [
        ...current.outputs,
        { ...current.outputs[0], id: "overflow", name: "Overflow", sceneId: undefined },
      ],
    })
    useQueueStore.getState().updateItem("sermon", (item) => ({
      ...item,
      on_take: [`scene.take:${scene.id}`, `scene.take:${overflowScene.id}@overflow`],
    }))

    await presentQueueItem(1)

    expect(sceneOn(MAIN_OUTPUT_ID)).toBe(scene.id)
    expect(sceneOn("overflow")).toBe(overflowScene.id)
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

  it("a missing scene or OBS scene says so and changes nothing", async () => {
    useQueueStore.setState({ items: [slide("x", ["scene.take:gone", "obs.scene:Nope"])] })
    await presentQueueItem(0)
    await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(2))
    expect(sceneOnMain()).toBeUndefined()
    expect(obsSwitches()).toEqual([])
  })
})
