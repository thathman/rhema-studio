import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/api/window", () => ({ availableMonitors: vi.fn(async () => []), getAllWindows: vi.fn(async () => []) }))
vi.mock("@tauri-apps/plugin-log", () => ({ info: vi.fn(async () => {}), error: vi.fn(async () => {}) }))
/** recovery.json, in memory. */
const kept = new Map<string, unknown>()
const fakeStore = { get: vi.fn(async (k: string) => kept.get(k)), set: vi.fn(async (k: string, v: unknown) => void kept.set(k, v)), save: vi.fn(async () => {}) }
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn(async () => fakeStore) }))

await import("@/stores/on-live-cues")
const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useEventClock } = await import("@/stores/event-clock-store")
const { useQueueStore } = await import("@/stores/queue-store")
const { useTimerStore } = await import("@/stores/timer-store")
const { takeSnapshot, putBack, useRecovery } = await import("@/lib/live-recovery")
const { elapsedMs } = await import("@/lib/timer")
const { MAIN_OUTPUT_ID, defaultNdiSettings } = await import("@/types")

describe("crash recovery never runs go-live cues again (#411 timing hunt)", () => {
  it("keeps the sermon timer's 20 minutes when its go-live cue is timer.fresh", async () => {
    const themeId = useBroadcastStore.getState().themes[0].id
    useBroadcastStore.setState({ isLive: false, liveVerse: null, sources: {}, rehearsal: false, scenes: [], outputStatus: {}, stageMessage: "",
      outputs: [{ id: MAIN_OUTPUT_ID, name: "Projector", type: "display", themeId, monitorIndex: 0, ndi: defaultNdiSettings() }] as never })
    useQueueStore.setState({ items: [{ id: "sermon", kind: "slide", slide: { title: "Sermon", body: "" }, reference: "Sermon", confidence: 1, source: "manual", added_at: 0, on_live: { stage_message: "Go", cue: "timer.fresh" } } as never], headers: [], activeIndex: null })
    useEventClock.setState({ mode: "screens", currentId: null, currentMomentId: null })
    useTimerStore.getState().reset()
    const snap = { ...takeSnapshot(), isLive: true, liveVerse: { reference: "Sermon", segments: [{ text: "x" }], content: "bible" as const }, liveItemId: "sermon", outputsOn: [], eventId: "sermon", eventMomentId: "sermon", timer: { durationMs: 35 * 60_000, elapsedMs: 20 * 60_000, running: true } }
    useRecovery.setState({ offer: snap, dismissed: false })
    await putBack(snap)
    await new Promise((r) => setTimeout(r, 10))
    expect(elapsedMs(useTimerStore.getState().timer, performance.now())).toBeGreaterThan(19 * 60_000)
    // Its go-live stage message is not sent again either.
    expect(useBroadcastStore.getState().stageMessage).toBe("")
  })
})
