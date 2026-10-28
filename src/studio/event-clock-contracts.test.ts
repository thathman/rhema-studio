import { beforeEach, describe, expect, it, vi } from "vitest"
import type { QueueItem } from "@/types"
import type { OutlineHeader } from "@/lib/run-of-show"

const emitTo = vi.fn().mockResolvedValue(undefined)
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: (...args: unknown[]) => emitTo(...args), listen: vi.fn(async () => () => {}) }))

const { CUE_ACTIONS } = await import("@/lib/cues")
const fresh = vi.spyOn(CUE_ACTIONS["timer.fresh"], "run").mockImplementation(() => undefined)
await import("@/stores/on-live-cues")
const { useEventClock } = await import("@/stores/event-clock-store")
const { eventStarts, eventTimes, actualDurations } = await import("@/lib/journal")
const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useJournalStore } = await import("@/stores/journal-store")
const { useQueueStore } = await import("@/stores/queue-store")

/**
 * The event clock (ADR 0001, #246 C03): starting an event, activating content and taking a scene
 * are different actions. By default the clock follows the screens (an item's content going on air
 * starts its event, as before); the timekeeper can run it on its own instead.
 */
const slide = (id: string, on_live?: QueueItem["on_live"]): QueueItem =>
  ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0, on_live }) as unknown as QueueItem
const show = (id: string | null, extra: Record<string, unknown> = {}) =>
  useBroadcastStore.getState().setLiveVerse({ kind: "slide", content: "slide", reference: id ?? "x", segments: [], lines: [id ?? "x"], ...extra }, null, { goLive: true, itemId: id })
const events = () => useJournalStore.getState().entries.filter((e) => e.kind === "event").map((e) => e.eventId ?? e.itemId)

beforeEach(() => {
  fresh.mockClear()
  useBroadcastStore.setState({ isLive: false, liveVerse: null, liveItemId: null, heldLive: null, rehearsal: false, rehearsalReturn: null, stageMessage: "", sources: {} })
  useQueueStore.setState({ items: [slide("welcome"), slide("hymn"), slide("sermon", { cue: "timer.fresh" }), slide("blessing")], headers: [], activeIndex: null })
  useEventClock.setState({ mode: "screens", currentId: null, currentMomentId: null })
  useJournalStore.setState({ entries: [] })
})

describe("the event clock (ARCH-003, C03)", () => {
  it("follows the screens by default: an item going on air starts its event, once", () => {
    show("welcome")
    show("hymn")
    useBroadcastStore.getState().setLive(false)
    useBroadcastStore.getState().setLive(true)
    expect(events()).toEqual(["welcome", "hymn"])
    expect(useEventClock.getState().currentId).toBe("hymn")
  })

  it("quick screens and rehearsal never start an event", () => {
    show("welcome")
    show(null, { quick: true, quickScreen: "stand" })
    useBroadcastStore.getState().setRehearsal(true)
    show("sermon")
    useBroadcastStore.getState().setRehearsal(false)
    expect(events()).toEqual(["welcome"])
    expect(fresh).not.toHaveBeenCalled()
  })

  it("run on its own, the timekeeper starts events without touching any screen, and showing content starts none", () => {
    useEventClock.getState().setMode("own")
    show("hymn")
    expect(events()).toEqual([])
    emitTo.mockClear()
    useEventClock.getState().start("welcome")
    useEventClock.getState().next()
    expect(events()).toEqual(["welcome", "hymn"])
    expect(emitTo).not.toHaveBeenCalled()
    expect(useBroadcastStore.getState().liveItemId).toBe("hymn")
    useEventClock.getState().next()
    expect(useEventClock.getState().currentId).toBe("sermon")
    expect(fresh).toHaveBeenCalledTimes(1) // the sermon's cue runs as its event starts
    show("blessing")
    expect(useEventClock.getState().currentId).toBe("sermon")
  })

  it("one planned event covers its moments and Timekeeper navigation skips to the next event", () => {
    const items = [slide("prayer-words"), slide("prayer-bible"), slide("sermon-scripture"), slide("sermon-slides"), slide("closing")]
    const headers: OutlineHeader[] = [
      { id: "prayer", type: "group", name: "Opening Prayer", at: 0, event: { schema_version: 1, duration_minutes: 15, approval: "approved" } },
      { id: "sermon", type: "group", name: "Sermon", at: 2, event: { schema_version: 1, duration_minutes: 40, approval: "approved" } },
    ]
    useQueueStore.setState({ items, headers })
    useEventClock.getState().setMode("own")

    useEventClock.getState().start("prayer")
    expect(useEventClock.getState()).toMatchObject({ currentId: "prayer", currentMomentId: null })
    expect(useBroadcastStore.getState().liveItemId).toBeNull()
    useEventClock.getState().next()
    expect(useEventClock.getState()).toMatchObject({ currentId: "sermon", currentMomentId: null })
    expect(events()).toEqual(["prayer", "sermon"])
    expect(useBroadcastStore.getState().liveItemId).toBeNull()
  })

  it("screen changes update the current moment without restarting its parent event", () => {
    const items = [slide("prayer-words"), slide("prayer-bible"), slide("sermon")]
    const headers: OutlineHeader[] = [
      { id: "prayer", type: "group", name: "Opening Prayer", at: 0, event: { schema_version: 1, duration_minutes: 15, approval: "approved" } },
      { id: "sermon", type: "group", name: "Sermon", at: 2, event: { schema_version: 1, duration_minutes: 40, approval: "approved" } },
    ]
    useQueueStore.setState({ items, headers })
    show("prayer-words")
    show("prayer-bible")

    expect(useEventClock.getState()).toMatchObject({ currentId: "prayer", currentMomentId: "prayer-bible" })
    expect(events()).toEqual(["prayer"])
  })

  it("timing reads the events: when each started and how long it ran, apart from what was on screen", () => {
    const t0 = Date.now()
    useJournalStore.setState({ entries: [
      { at: t0, mono: 0, kind: "event", label: "welcome", itemId: "welcome" },
      { at: t0, mono: 0, kind: "live", label: "welcome", itemId: "welcome" },
      { at: t0 + 60_000, mono: 60_000, kind: "live", label: "Psalm 23", itemId: "hymn" },
      { at: t0 + 120_000, mono: 120_000, kind: "event", label: "hymn", itemId: "hymn" },
    ] })
    const entries = useJournalStore.getState().entries
    expect(eventStarts(entries)).toEqual(new Map([["welcome", t0], ["hymn", t0 + 120_000]]))
    expect(eventTimes(entries, 180_000)).toEqual(new Map([["welcome", 120_000], ["hymn", 60_000]]))
    // An event start does not cut what was on screen short.
    expect(actualDurations(entries, 180_000).map((d) => d.ms)).toEqual([60_000, 120_000])
  })
})
