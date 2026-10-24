import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { QueueItem } from "@/types"

const presented: string[] = []
vi.mock("@/lib/remote-actions", () => ({
  presentQueueItem: vi.fn(async (index: number) => {
    const { useQueueStore } = await import("@/stores/queue-store")
    const { useBroadcastStore } = await import("@/stores/broadcast-store")
    const item = useQueueStore.getState().items[index]
    presented.push(item.id)
    useBroadcastStore.setState({ isLive: true, liveItemId: item.id })
  }),
}))

const { useHold } = await import("./hold-store")
const { useTimedAdvance } = await import("./timed-advance-store")
const { useQueueStore } = await import("@/stores/queue-store")
const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useJournalStore } = await import("@/stores/journal-store")

const item = (id: string, planned_minutes: number, auto_advance = true): QueueItem =>
  ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0, planned_minutes, auto_advance }) as unknown as QueueItem

describe("a hold in the service (issue #196)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    presented.length = 0
    useQueueStore.setState({ items: [item("a", 1), item("b", 3, false)], headers: [] })
    useBroadcastStore.setState({ isLive: false, liveItemId: null, stageMessage: "" })
    useJournalStore.setState({ entries: [] })
  })
  afterEach(() => { useHold.getState().resume(); useTimedAdvance.getState().setOn(false); vi.useRealTimers() })

  it("is logged and shown on the stage; a timed move waits and is made at Resume", async () => {
    useTimedAdvance.getState().setOn(true)
    useBroadcastStore.setState({ isLive: true, liveItemId: "a" })
    useHold.getState().start("  waiting for   the pastor ")
    expect(useBroadcastStore.getState().stageMessage).toBe("On hold: waiting for the pastor")
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    expect(presented).toEqual([])
    useHold.getState().resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(presented).toEqual(["b"])
    expect(useBroadcastStore.getState().stageMessage).toBe("")
    expect(useJournalStore.getState().entries.map((e) => e.label)).toEqual(expect.arrayContaining(["hold: waiting for the pastor", "resumed after 3:00"]))
  })

  it("Resume leaves a stage message the operator changed meanwhile", () => {
    useHold.getState().start("tech issue")
    useBroadcastStore.getState().setStageMessage("Mic 2 is off")
    useHold.getState().resume()
    expect(useBroadcastStore.getState().stageMessage).toBe("Mic 2 is off")
  })

  it("a hold from a joined desk puts up the stage message as that desk's, not this desk's operator's", () => {
    useHold.getState().start("Waiting for the pastor", "QA Timekeeper")
    expect(useBroadcastStore.getState().stateSources.stage?.by).toBe("QA Timekeeper")
    useHold.getState().resume("QA Timekeeper")
    expect(useBroadcastStore.getState().stateSources.stage?.by).toBe("QA Timekeeper")
    expect(useBroadcastStore.getState().stateSources.stage?.on).toBe(false)
  })
})
