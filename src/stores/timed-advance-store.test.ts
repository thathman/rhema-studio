import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { OutlineHeader } from "@/lib/run-of-show"
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

const { useTimedAdvance } = await import("./timed-advance-store")
const { usePhaseRun } = await import("./phase-run-store")
const { useQueueStore } = await import("@/stores/queue-store")
const { useBroadcastStore } = await import("@/stores/broadcast-store")

const item = (id: string, planned_minutes: number, auto_advance = true): QueueItem =>
  ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0, planned_minutes, auto_advance }) as unknown as QueueItem
const live = (id: string) => useBroadcastStore.setState({ isLive: true, liveItemId: id })

describe("timed moves in the service", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    presented.length = 0
    const headers: OutlineHeader[] = [
      { id: "main", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main" },
      { id: "post", type: "phase", name: "Post-service loop", at: 3, rule: "loop", role: "post" },
    ]
    useQueueStore.setState({ items: [item("a", 2), item("b", 3, false), item("c", 1), item("p", 1)], headers })
    useBroadcastStore.setState({ isLive: false, liveItemId: null })
    usePhaseRun.setState({ run: null })
    useTimedAdvance.getState().setOn(false)
  })
  afterEach(() => vi.useRealTimers())

  it("moves on after the planned minutes only while timed moves are on", async () => {
    live("a")
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(presented).toEqual([])
    useTimedAdvance.getState().setOn(true)
    expect(useTimedAdvance.getState().dueAt).not.toBeNull()
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(presented).toEqual(["b"])
    // b is not marked: it waits for the operator.
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(presented).toEqual(["b"])
  })

  it("anything the operator does to what is live cancels the pending move", async () => {
    useTimedAdvance.getState().setOn(true)
    live("a")
    await vi.advanceTimersByTimeAsync(60_000)
    useBroadcastStore.setState({ isLive: false })
    expect(useTimedAdvance.getState().dueAt).toBeNull()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(presented).toEqual([])
  })

  it("never crosses into the next phase, and leaves a running phase alone", async () => {
    useTimedAdvance.getState().setOn(true)
    live("c")
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(presented).toEqual([])
    usePhaseRun.setState({ run: { headerId: "main", itemId: "a", startsAt: null, nextAt: null } })
    live("a")
    expect(useTimedAdvance.getState().dueAt).toBeNull()
  })
})
