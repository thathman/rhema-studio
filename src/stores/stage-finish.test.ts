import { describe, expect, it, vi } from "vitest"
import type { QueueItem } from "@/types"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))

const { updateStageFinish } = await import("./stage-finish")
const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useQueueStore } = await import("@/stores/queue-store")
const { useJournalStore } = await import("@/stores/journal-store")
const { stageFinishText } = await import("@/lib/stage-finish-text")
const { applyStageStyle, DEFAULT_STAGE_STYLE } = await import("@/lib/stage-style")

const slide = (id: string, planned_minutes: number): QueueItem =>
  ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0, planned_minutes }) as unknown as QueueItem
const at = (h: number, m: number) => new Date(2099, 0, 3, h, m).getTime()

describe("the stage display's service clock (issue #196)", () => {
  it("says when the service is now expected to end, and how late", () => {
    useQueueStore.setState({ items: [slide("a", 10), slide("b", 20)], headers: [{ id: "m", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main", starts_at: "10:00" }] })
    useBroadcastStore.setState({ isLive: true, liveItemId: "a" })
    useJournalStore.setState({ entries: [{ at: at(10, 5), mono: 0, kind: "live", label: "a", itemId: "a" }] })
    updateStageFinish()
    const f = useBroadcastStore.getState().stageFinish
    expect(f).toEqual({ time: "10:35", lateMin: 5 })
    expect(stageFinishText(f!)).toBe("Ends 10:35 · 5 min late")
    expect(stageFinishText({ time: "10:30", lateMin: 0 })).toBe("Ends 10:30")
  })

  it("is left out when the church hides it, and absent without a start time", () => {
    const stage = { current: null, next: null, note: null, timer: null, message: null, band: null, finish: { time: "10:35", lateMin: 5 } }
    expect(applyStageStyle(stage, { ...DEFAULT_STAGE_STYLE, showFinish: false }).finish).toBeNull()
    useQueueStore.setState({ headers: [] })
    updateStageFinish()
    expect(useBroadcastStore.getState().stageFinish).toBeNull()
  })
})
