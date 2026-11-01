import { beforeEach, expect, it, vi } from "vitest"
/** Live output safety across rehearsal, timed moves and recovery: reproduced by the reliability audit of main 18193426. */
import type { QueueItem } from "@/types"
const toast = Object.assign(vi.fn(), { error: vi.fn(), info: vi.fn(), warning: vi.fn(), success: vi.fn() })
vi.mock("sonner", () => ({ toast }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn().mockResolvedValue(undefined), listen: vi.fn(async () => () => {}) }))
const { showDesignedMoment, restoreAfterDesignedMoment } = await import("./designed-moments")
const { runTakeSteps } = await import("./take-steps")
const { presentQueueItem } = await import("./remote-actions")
const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useQueueStore } = await import("@/stores/queue-store")
const { useServiceStore } = await import("@/stores/service-store")
const { useSongStore } = await import("@/stores/song-store")
const { useTimedAdvance, catchUpTimedAdvance } = await import("@/stores/timed-advance-store")
const { newScene } = await import("@/lib/scenes")
const { sceneToDesign } = await import("@/design-engine/rhema-scene")
const { MAIN_OUTPUT_ID, defaultNdiSettings } = await import("@/types")
const { designStore } = await import("@/design-engine/design-store")
const { dismissRecovery, useRecovery, putBack, takeSnapshot } = await import("./live-recovery")
const welcome = newScene("Welcome card"), usual = newScene("Camera and Bible"), other = newScene("Manual")
const versions: Record<string, { designId: string; version: number; document: ReturnType<typeof sceneToDesign> }> = { "d1:2": { designId: "d1", version: 2, document: sceneToDesign(welcome) }, "d1:3": { designId: "d1", version: 3, document: sceneToDesign(welcome) } }
const getVersion = vi.fn(async (id: string, v: number) => versions[`${id}:${v}`] ?? null)
vi.spyOn(designStore, "getVersion").mockImplementation(getVersion as never)
const moment = (designRef?: { id: string; version: number }, id = "m"): QueueItem => ({ id, kind: "slide", slide: { title: "Welcome", body: "Glad you came", ...(designRef ? { designRef } : {}) }, reference: "Welcome", confidence: 1, source: "manual", added_at: 0 }) as QueueItem
const out = (id: string) => useBroadcastStore.getState().outputs.find((o) => o.id === id)
const pin = { id: "d1", version: 2 }
const approve = (moments: Record<string, { id: string; version: number }>) => useServiceStore.setState({ current: { id: "svc", approved_revision: 3 } as never, approvedDesignRevision: 3, approvedDesigns: { version: 1, scenes: {}, looks: {}, media_ids: [], moments }, approvedDesignsError: null })
const settled = () => new Promise((r) => setTimeout(r, 0))
const b = () => useBroadcastStore.getState()
beforeEach(() => {
  useServiceStore.setState({ current: null, approvedDesigns: null, approvedDesignRevision: null, approvedDesignsError: null })
  useBroadcastStore.setState({ isLive: false, liveItemId: null, liveVerse: null, cleared: false, rehearsal: false, rehearsalReturn: null })
  useQueueStore.setState({ items: [], activeIndex: null })
  useRecovery.setState({ offer: null, dismissed: false, damaged: false, restoreError: null })
  restoreAfterDesignedMoment(); toast.warning.mockClear()
  const theme = b().themes[0].id
  useBroadcastStore.setState({ sceneReturn: {}, sceneTakes: {}, scenes: [usual, other], outputs: [
    { id: MAIN_OUTPUT_ID, name: "Sanctuary", type: "display", themeId: theme, monitorIndex: 0, ndi: defaultNdiSettings() },
    { id: "second", name: "Overflow", type: "display", themeId: theme, monitorIndex: 1, ndi: defaultNdiSettings() } ] })
  b().takeScene(MAIN_OUTPUT_ID, usual.id)
})
const up = async () => { useQueueStore.setState({ items: [moment(pin)] }); useBroadcastStore.setState({ isLive: true, liveItemId: "m" }); await settled(); expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v2") }
it("R1 approval withdrawn in rehearsal", async () => { await up(); approve({ m: pin }); b().setRehearsal(true); approve({}); b().setRehearsal(false); await settled(); expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id) })
it("R1b same, Show this live", async () => { await up(); approve({ m: pin }); b().setRehearsal(true); approve({}); b().setRehearsal(false, { keepRehearsed: true }); await settled(); expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id) })
it("R2 approval v2 to v3 in rehearsal", async () => { await up(); approve({ m: pin }); b().setRehearsal(true); useQueueStore.setState({ items: [moment({ id: "d1", version: 3 })] }); approve({ m: { id: "d1", version: 3 } }); b().setRehearsal(false); await settled(); expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v3") })
it("R3 Not now in rehearsal", async () => { await showDesignedMoment(moment(pin), getVersion); b().updateOutput(MAIN_OUTPUT_ID, { designedMomentRestore: undefined }); useBroadcastStore.setState({ isLive: false, liveItemId: null }); useRecovery.setState({ offer: { v: 1 } as never }); b().setRehearsal(true); dismissRecovery(); b().setRehearsal(false); await settled(); expect(out(MAIN_OUTPUT_ID)?.sceneId).toBeUndefined() })
it("F Take loading at rehearsal start", async () => { useQueueStore.setState({ items: [moment(pin)] }); let release: (v: unknown) => void = () => {}; vi.mocked(designStore.getVersion).mockImplementationOnce((() => new Promise((r) => { release = r })) as never); useBroadcastStore.setState({ isLive: true, liveItemId: "m" }); b().setRehearsal(true); release(versions["d1:2"]); await settled(); b().setRehearsal(false); await settled(); expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v2") })
it("covered moment survives rehearsal with its way back", async () => { await up(); approve({ m: pin }); b().setRehearsal(true); b().setRehearsal(false); await settled(); expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v2"); expect(toast.warning).not.toHaveBeenCalled(); useBroadcastStore.setState({ isLive: false }); expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id) })
it("T3 timed move vs loading manual Take", async () => {
  const song = { song: { id: "song1", title: "Hymn", primary_language: "en", tags: "" }, numbers: [], sections: [{ id: "x", label: "V", kind: "verse", position: 0, order: 0, lines: ["Line"], lyrics: "Line", content: { en: "Line" }, texts: { en: "Line" } }], arrangements: [] }
  const manual = { id: "s", kind: "song", song: { song_id: "song1", title: "Hymn", arrangement_id: null, languages: [] }, reference: "Hymn", confidence: 1, source: "manual", added_at: 0 } as unknown as QueueItem
  useQueueStore.setState({ items: [{ ...moment(undefined, "a"), auto_advance: true, planned_minutes: 1 } as QueueItem, moment(undefined, "b"), manual] })
  await presentQueueItem(0); useTimedAdvance.getState().setOn(true)
  let release: (v: unknown) => void = () => {}
  useSongStore.setState({ load: vi.fn(() => new Promise((r) => { release = r })) } as never)
  const take = presentQueueItem(2); catchUpTimedAdvance(Date.now() + 120_000); await settled(); release(song); await take; await settled()
  useTimedAdvance.getState().setOn(false); expect(b().liveItemId).toBe("s") })
it("B1 Bible-only with a scene step", async () => { const item = { id: "r", verse: { book_number: 43, chapter: 3, verse: 16, book_name: "John", translation_id: 1, text: "", id: 0 }, reference: "John 3:16", confidence: 1, source: "manual", added_at: 0, on_take: ["source.only", `scene.take:${other.id}`] } as unknown as QueueItem; await runTakeSteps(item); expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id) })
it("T1 Take again after re-pin", async () => { await up(); useQueueStore.setState({ items: [moment({ id: "d1", version: 3 })] }); await presentQueueItem(0); await settled(); expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v3") })
it("T2 Take again after refresh", async () => { await up(); approve({}); approve({ m: pin }); await presentQueueItem(0); await settled(); expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v2") })
it("R5 Put back in rehearsal keeps the offer", async () => { b().takeScene(MAIN_OUTPUT_ID, other.id); b().setLiveVerse({ reference: "Welcome", segments: [], lines: ["x"], content: "slide", kind: "slide" } as never, null, { goLive: true, itemId: "p" }); const snap = { ...takeSnapshot(), outputsOn: [], eventId: null }; b().takeScene(MAIN_OUTPUT_ID, usual.id); useBroadcastStore.setState({ isLive: false, liveItemId: null, liveVerse: null }); useRecovery.setState({ offer: snap, dismissed: true }); b().setRehearsal(true); expect(await putBack(snap)).toBe(false); expect(useRecovery.getState().restoreError).toContain("rehearsal"); b().setRehearsal(false); expect(useRecovery.getState().offer).toBeTruthy() })
it("T4 Not now keeps manual scenes", async () => { await up(); b().takeScene(MAIN_OUTPUT_ID, other.id); b().takeScene("second", other.id); useRecovery.setState({ offer: { v: 1 } as never }); dismissRecovery(); await settled(); expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(other.id) })
it("M2 role change mid-moment", async () => { await up(); b().updateOutput(MAIN_OUTPUT_ID, { role: "stage" }); useBroadcastStore.setState({ isLive: false }); await settled(); b().updateOutput(MAIN_OUTPUT_ID, { role: "congregation" }); expect(out(MAIN_OUTPUT_ID)?.sceneId).not.toBe("design-d1-v2") })
it("warns when a design goes up with no earlier scene", async () => { await up(); b().updateOutput(MAIN_OUTPUT_ID, { designedMomentRestore: undefined }); await showDesignedMoment(moment(pin), getVersion); expect(toast.warning).toHaveBeenCalledWith("Earlier scene lost", expect.anything()) })
