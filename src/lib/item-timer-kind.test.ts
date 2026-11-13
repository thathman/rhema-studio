import { describe, expect, it } from "vitest"
import { countdownText, itemCounting, lookCounting, NO_COUNTDOWN_SOURCES } from "@/lib/countdown-display"
import { cleanItemTiming } from "@/lib/item-timing"

const live = (actualStart: number | null) => ({ events: [{ state: "live", label: "Sermon", plannedStart: 0, plannedEnd: 30 * 60_000, actualStart, hardStop: null }] })

describe("an item's own timer (#196)", () => {
  it("is kept when saved, never on a milestone, and only as up or none", () => {
    expect(cleanItemTiming({ timer: "up" })).toEqual({ timer: "up" })
    expect(cleanItemTiming({ timer: "none", warn_minutes: 2 })).toEqual({ warn_minutes: 2, timer: "none" })
    expect(cleanItemTiming({ timer: "sideways" })).toBeNull()
    expect(cleanItemTiming({ milestone: true, timer: "up" })).toEqual({ milestone: true })
  })

  it("counts down by default, up from the item's start, or not at all", () => {
    expect(itemCounting(live(1_000))).toMatchObject({ totalMs: 30 * 60_000, endsAt: 1_000 + 30 * 60_000 })
    const up = itemCounting(live(1_000), "up")!
    expect(up).toMatchObject({ label: "Sermon", totalMs: 0, endsAt: 1_000 })
    // 3 min 5 s after it started, the display reads 3:05, counting up.
    expect(countdownText(up.totalMs, up.endsAt! - (1_000 + 185_000))).toBe("3:05")
    const none = itemCounting(live(1_000), "none")!
    expect(none.idle).toContain("no timer")
  })

  it("a countdown look on the item on now shows what the item asks for", () => {
    const look = { counts: "item" } as Parameters<typeof lookCounting>[0]
    const timer = { durationMs: 0, startedAt: null, accumulatedMs: 0 }
    const sources = { ...NO_COUNTDOWN_SOURCES, item: itemCounting(live(1_000), "none") }
    expect(lookCounting(look, sources, timer, 0, 0).idle).toContain("no timer")
  })
})

describe("the countdown sources follow the counted row's own timer (#196)", () => {
  it("reads the setting from the item the timing counts, not the moment inside an event", async () => {
    const { useQueueStore } = await import("@/stores/queue-store")
    const { useBroadcastStore } = await import("@/stores/broadcast-store")
    const { updateCountdownTiming } = await import("@/stores/countdown-sources")
    useQueueStore.setState({ items: [{ id: "sermon", kind: "slide", slide: { title: "Sermon", body: "" }, reference: "Sermon", confidence: 1, source: "manual", added_at: 0, timing: { timer: "up" } }] as never })
    const t = { start: 0, events: [{ id: "sermon", state: "live", label: "Sermon", plannedStart: 0, plannedEnd: 1_800_000, actualStart: 5_000, hardStop: null }] }
    updateCountdownTiming(t as never)
    expect(useBroadcastStore.getState().countdownSources.item).toMatchObject({ totalMs: 0, endsAt: 5_000 })
    // An event row (no item of that id) counts down.
    updateCountdownTiming({ ...t, events: [{ ...t.events[0], id: "worship-event" }] } as never)
    expect(useBroadcastStore.getState().countdownSources.item).toMatchObject({ totalMs: 1_800_000 })
  })
})
