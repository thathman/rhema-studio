import { afterAll, describe, expect, it, vi } from "vitest"
import type { OutlineHeader } from "@/lib/run-of-show"
import type { QueueItem } from "@/types"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
// Going live, as the operator's Show (or a timed move) does it: the item's slide on air.
vi.mock("@/lib/remote-actions", () => ({
  presentQueueItem: vi.fn(async (index: number) => {
    const { useQueueStore } = await import("@/stores/queue-store")
    const { useBroadcastStore } = await import("@/stores/broadcast-store")
    const item = useQueueStore.getState().items[index]
    useBroadcastStore.setState({ isLive: true, liveItemId: item.id, liveVerse: { reference: item.reference, segments: [], content: "slide" } })
  }),
}))

vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date", "performance"] })
// Sunday 09:30, half an hour before the service.
vi.setSystemTime(new Date(2026, 9, 25, 9, 30, 0))

const { presentQueueItem } = await import("@/lib/remote-actions")
const { eventStarts, eventTimes } = await import("@/lib/journal")
const { serviceTiming } = await import("@/lib/timing-engine")
const { useQueueStore } = await import("@/stores/queue-store")
const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useEventClock } = await import("@/stores/event-clock-store")
const { useJournalStore } = await import("@/stores/journal-store")
const { useTimerStore, monotonicNow } = await import("@/stores/timer-store")
const { elapsedMs } = await import("@/lib/timer")
const { useHold } = await import("@/stores/hold-store")
const { useTimedAdvance } = await import("@/stores/timed-advance-store")
const { useServiceOffset } = await import("@/stores/service-offset-store")

afterAll(() => vi.useRealTimers())

const item = (id: string, planned_minutes: number, extra: Partial<QueueItem> = {}): QueueItem =>
  ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0, planned_minutes, ...extra }) as unknown as QueueItem

const MIN = 60_000
const SEC = 1000

/**
 * A long Sunday on fake timers (#196 R7 soak): 09:30 to 12:30, the service at 10:00 started 3
 * minutes late, worship songs moving on by themselves, a hold, the timer paused and corrected,
 * +5 minutes running late, an item moved, the computer's clock corrected by 45 s mid-service, and
 * a verse stepped every 4 s the whole time (so the service log fills past its 2000-entry cap).
 * Every minute the engine's times are checked against what really happened, and the timers
 * running are counted: nothing drifts and nothing piles up.
 */
describe("a three-hour service on the timing engine and event clock (soak)", () => {
  it("keeps every time true to what happened and never piles up timers", async () => {
    const headers: OutlineHeader[] = [{ id: "main", type: "phase", name: "Service", at: 0, rule: "manual", role: "main", starts_at: "10:00" }]
    useQueueStore.setState({
      items: [
        item("welcome", 5), item("song1", 4, { auto_advance: true }), item("song2", 4, { auto_advance: true }), item("song3", 4), item("prayer", 3),
        item("notices", 4), item("sermon", 35, { end_by: "11:00" } as Partial<QueueItem>), item("offering", 5), item("benediction", 3),
      ],
      headers,
    })
    useBroadcastStore.setState({ isLive: false, liveItemId: null, liveVerse: null, rehearsal: false, stageMessage: "" })
    useEventClock.setState({ mode: "screens", currentId: null })
    useJournalStore.setState({ entries: [] })
    useTimerStore.getState().reset()
    useTimerStore.getState().setDurationMinutes(35)
    const baselineTimers = vi.getTimerCount()

    // What really happened, kept apart from the app: when each item went up (wall and monotonic).
    const truth = new Map<string, { at: number; mono: number }>()
    const order: string[] = []
    const show = async (id: string) => {
      const index = useQueueStore.getState().items.findIndex((i) => i.id === id)
      await presentQueueItem(index, 0)
    }
    // The broadcast store is the one place an item goes live, by hand or by a timed move.
    const offTruth = useBroadcastStore.subscribe((s, p) => {
      if (s.liveItemId && s.liveItemId !== p.liveItemId && !truth.has(s.liveItemId)) {
        truth.set(s.liveItemId, { at: Date.now(), mono: monotonicNow() })
        order.push(s.liveItemId)
      }
    })
    // The service timer, worked out by hand: running since, and time banked before.
    let ranMs = 0
    let runningSince: number | null = null
    const timer = {
      start: () => { useTimerStore.getState().start(); runningSince = monotonicNow() },
      pause: () => { useTimerStore.getState().pause(); ranMs += monotonicNow() - runningSince!; runningSince = null },
      plusOne: () => { useTimerStore.getState().adjustMinutes(1); ranMs += MIN },
    }

    const t0 = Date.now()
    const at = (h: number, m: number, s = 0) => new Date(2026, 9, 25, h, m, s).getTime() - t0
    let clockStep = 0
    const script: [number, () => void | Promise<void>][] = [
      [at(10, 3), () => show("welcome")],
      [at(10, 8), async () => { useTimedAdvance.getState().setOn(true); await show("song1") }],
      // song1 and song2 move on by themselves after 4 minutes each; song3 waits for the operator.
      [at(10, 21), () => show("prayer")],
      // Notices moved to after the offering, while the service runs.
      [at(10, 23), () => { const items = [...useQueueStore.getState().items]; const [n] = items.splice(items.findIndex((i) => i.id === "notices"), 1); items.splice(items.findIndex((i) => i.id === "offering") + 1, 0, n); useQueueStore.setState({ items }) }],
      [at(10, 24), async () => { await show("sermon"); timer.start() }],
      [at(10, 40), () => { useHold.getState().start("Pulpit mic"); timer.pause() }],
      [at(10, 42, 30), () => { useHold.getState().resume(); timer.start() }],
      [at(10, 45), () => useServiceOffset.getState().adjust(5, "Femi")],
      // The computer's clock is corrected by 45 s (NTP) in the middle of the sermon.
      [at(10, 50), () => { clockStep = 45 * SEC; vi.setSystemTime(Date.now() + clockStep) }],
      [at(10, 55), () => timer.plusOne()],
      [at(11, 2), async () => { timer.pause(); await show("offering") }],
      [at(11, 8), () => show("notices")],
      [at(11, 12), () => show("benediction")],
      [at(11, 16), () => useBroadcastStore.setState({ isLive: false })],
    ]

    let plannedEnd: number | null = null
    let peakTimers = 0
    const end = 3 * 60 * MIN
    for (let ms = SEC; ms <= end; ms += SEC) {
      await vi.advanceTimersByTimeAsync(SEC)
      // The script runs on the simulated (monotonic) time, whatever the wall clock says.
      while (script.length && script[0][0] <= ms) await script.shift()![1]()
      // A verse stepped from the Bible desk every 4 s: one log line each.
      if (ms % (4 * SEC) === 0) useJournalStore.getState().add({ kind: "remote", label: "verse_next · by Ade" })
      if (ms % MIN !== 0) continue

      peakTimers = Math.max(peakTimers, vi.getTimerCount())
      const entries = useJournalStore.getState().entries
      expect(entries.length).toBeLessThanOrEqual(2000)
      // The timer: exactly the time it ran, to the millisecond, clock step or not.
      const expectedRan = ranMs + (runningSince === null ? 0 : monotonicNow() - runningSince)
      expect(Math.abs(elapsedMs(useTimerStore.getState().timer, monotonicNow()) - expectedRan)).toBeLessThanOrEqual(1)
      // The engine, as Prepare, Present and the Live State run it.
      const nowMono = Math.max(monotonicNow(), entries.at(-1)?.mono ?? 0)
      const timing = serviceTiming({ items: useQueueStore.getState().items, headers, firstOnAir: eventStarts(entries), onAirMs: eventTimes(entries, nowMono), liveItemId: useEventClock.getState().currentId, now: Date.now(), adjustMinutes: useServiceOffset.getState().minutes })!
      expect(timing).not.toBeNull()
      // The plan is never rewritten.
      plannedEnd ??= timing.plannedEnd
      expect(timing.plannedEnd).toBe(plannedEnd)
      for (const [k, id] of order.entries()) {
        const e = timing.events.find((x) => x.id === id)!
        const real = truth.get(id)!
        // When it really went up, within a second; never "skipped" for being early in a long log.
        expect(e.actualStart, `${id} at ${new Date(Date.now()).toTimeString()}`).not.toBeNull()
        expect(Math.abs(e.actualStart! - real.at)).toBeLessThanOrEqual(SEC)
        expect(e.state).toBe(k === order.length - 1 ? "live" : "done")
        // How long it ran, on the monotonic clock, within a second.
        const next = order[k + 1]
        if (next) expect(Math.abs((eventTimes(entries, nowMono).get(id) ?? 0) - (truth.get(next)!.mono - real.mono))).toBeLessThanOrEqual(SEC)
      }
      // Nothing still to come is expected before now, once the service has begun.
      for (const e of timing.events) if (e.state === "upcoming" && order.length) expect(e.expectedStart).toBeGreaterThanOrEqual(Date.now() - SEC)
    }

    // It all happened, in order: the songs moved on by themselves at their 4 minutes.
    expect(order).toEqual(["welcome", "song1", "song2", "song3", "prayer", "sermon", "offering", "notices", "benediction"])
    expect(truth.get("song2")!.mono - truth.get("song1")!.mono).toBe(4 * MIN)
    expect(truth.get("song3")!.mono - truth.get("song2")!.mono).toBe(4 * MIN)
    expect(useJournalStore.getState().entries.map((e) => e.label)).toEqual(expect.arrayContaining(["hold: Pulpit mic", "resumed after 2:30"]))
    expect(clockStep).toBe(45 * SEC)
    // A handful at most at any time (the timer's ticker, a pending timed move), and none left over.
    expect(peakTimers).toBeLessThanOrEqual(baselineTimers + 3)
    useTimedAdvance.getState().setOn(false)
    expect(vi.getTimerCount()).toBe(baselineTimers)
    offTruth()
  }, 120_000)
})
