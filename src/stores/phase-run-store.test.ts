import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { OutlineHeader } from "@/lib/run-of-show"
import type { QueueItem } from "@/types"

// Going live is the ordinary rundown present: here it just records the live item.
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

const { usePhaseRun } = await import("./phase-run-store")
const { useQueueStore } = await import("@/stores/queue-store")
const { useBroadcastStore } = await import("@/stores/broadcast-store")

const slide = (id: string, planned_minutes?: number): QueueItem =>
  ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0, planned_minutes }) as unknown as QueueItem
const flush = () => vi.advanceTimersByTimeAsync(0)

describe("a phase running by itself in Present", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 25, 9, 0, 0))
    presented.length = 0
    const headers: OutlineHeader[] = [
      { id: "pre", type: "phase", name: "Pre-service loop", at: 0, rule: "loop", role: "pre", advance_seconds: 10 },
      { id: "warm", type: "phase", name: "Warm-up", at: 2, rule: "auto_once", role: "warmup" },
      { id: "main", type: "phase", name: "Main service", at: 4, rule: "manual", role: "main", starts_at: "10:00" },
    ]
    useQueueStore.setState({ items: [slide("a"), slide("b"), slide("w1", 2), slide("w2", 3), slide("m")], headers, activeIndex: null })
    useBroadcastStore.setState({ isLive: false, liveItemId: null })
  })
  afterEach(() => {
    usePhaseRun.getState().stop()
    vi.useRealTimers()
  })

  it("a loop puts its items up in turn and repeats until stopped", async () => {
    usePhaseRun.getState().start("pre")
    await flush()
    expect(presented).toEqual(["a"])
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(presented).toEqual(["a", "b", "a"])
    usePhaseRun.getState().stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(presented).toEqual(["a", "b", "a"])
  })

  it("the operator taking something else, or Clear, stops it at once", async () => {
    usePhaseRun.getState().start("pre")
    await flush()
    useBroadcastStore.setState({ liveItemId: "m" })
    expect(usePhaseRun.getState().run).toBeNull()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(presented).toEqual(["a"])

    usePhaseRun.getState().start("pre")
    await flush()
    useBroadcastStore.setState({ isLive: false })
    expect(usePhaseRun.getState().run).toBeNull()
  })

  it("the warm-up waits until it is due, runs once on planned minutes, and never moves into the service", async () => {
    usePhaseRun.getState().start("warm")
    await flush()
    // 5 planned minutes before 10:00: due at 09:55.
    expect(presented).toEqual([])
    expect(new Date(usePhaseRun.getState().run!.startsAt!).getMinutes()).toBe(55)
    await vi.advanceTimersByTimeAsync(55 * 60_000)
    expect(presented).toEqual(["w1"])
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(presented).toEqual(["w1", "w2"])
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    expect(presented).toEqual(["w1", "w2"])
    expect(usePhaseRun.getState().run).toBeNull()
  })

  it("the main service cannot be run this way", () => {
    usePhaseRun.getState().start("main")
    expect(usePhaseRun.getState().run).toBeNull()
  })
})
