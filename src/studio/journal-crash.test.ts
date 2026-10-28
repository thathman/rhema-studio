import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let unclean = false
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (cmd: string) => (cmd === "last_exit_unclean" ? unclean : null)) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/api/window", () => ({ availableMonitors: vi.fn(async () => []) }))
/** recovery.json: written as a file would be (a copy), and still there after the process is killed. */
const file = new Map<string, string>()
const fakeStore = { get: vi.fn(async (k: string) => (file.has(k) ? JSON.parse(file.get(k)!) : undefined)), set: vi.fn(async (k: string, v: unknown) => void file.set(k, JSON.stringify(v))), save: vi.fn(async () => {}) }
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn(async () => fakeStore) }))

const { useJournalStore, capJournal, JOURNAL_MAX } = await import("@/stores/journal-store")
const { startLiveRecovery, restoreJournal } = await import("@/lib/live-recovery")
const { eventStarts, eventTimes } = await import("@/lib/journal")
const { monotonicNow } = await import("@/stores/timer-store")
const { useBroadcastStore } = await import("@/stores/broadcast-store")
type Entry = ReturnType<typeof useJournalStore.getState>["entries"][number]

const SEC = 1000
const ITEMS = ["welcome", "song1", "song2", "prayer", "sermon", "offering", "benediction"]
const inOrder = (entries: Entry[]) => entries.every((e, i) => i === 0 || e.mono >= entries[i - 1].mono)

/**
 * The service log under its cap and through a crash (#196 R7): a long service fills it past 2000
 * entries, Rhema is killed (kill -9: no clean exit, nothing saved at the end), and the next start
 * brings the log back (restoreJournal) in order, with every item's start and duration as before.
 */
describe("the service log at its cap and after kill -9", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] })
    vi.setSystemTime(new Date(2026, 9, 25, 9, 30))
    useBroadcastStore.setState({ rehearsal: false })
    useJournalStore.setState({ entries: [], startItemIds: null, added: 0, keptAt: 0 })
    file.clear()
    unclean = false
  })
  afterEach(() => vi.useRealTimers())

  /** A service: each item started (an event), and a verse stepped every 4 s in between. */
  function runService(stepsBetween: number, clockStepAt?: number) {
    ITEMS.forEach((id, k) => {
      if (k === clockStepAt) vi.setSystemTime(Date.now() + 45 * SEC) // the clock corrected (NTP)
      useJournalStore.getState().add({ kind: "event", label: id, itemId: id })
      for (let s = 0; s < stepsBetween; s++) {
        vi.advanceTimersByTime(4 * SEC)
        useJournalStore.getState().add({ kind: "remote", label: "verse_next · by Ade" })
      }
    })
  }

  it("keeps the newest 2000 and every item's start, in order", () => {
    runService(400)
    const { entries, added } = useJournalStore.getState()
    expect(added).toBe(ITEMS.length * 401)
    expect(entries).toHaveLength(JOURNAL_MAX)
    expect(entries.filter((e) => e.kind === "event").map((e) => e.itemId)).toEqual(ITEMS)
    expect(inOrder(entries)).toBe(true)
    // What went is the oldest of the rest: the newest are all there.
    expect(entries.at(-1)).toMatchObject({ kind: "remote" })
    expect(entries.filter((e) => e.kind !== "event")).toHaveLength(JOURNAL_MAX - ITEMS.length)
    // A log of nothing but event starts (never in practice) still stops at 2000.
    const events = Array.from({ length: 2100 }, (_, i) => ({ at: i, mono: i, kind: "event" as const, label: `e${i}`, itemId: `e${i}` }))
    expect(capJournal(events).map((e) => e.label)).toEqual(events.slice(-2000).map((e) => e.label))
  })

  it("after kill -9 the kept log comes back in order with each item's times as before, clock step and all", async () => {
    const stop = await startLiveRecovery()
    runService(400, 4)
    // Kept 3 s after the last change.
    await vi.advanceTimersByTimeAsync(3 * SEC)
    const crashMono = monotonicNow()
    const before = useJournalStore.getState().entries
    const startsBefore = eventStarts(before)
    const timesBefore = eventTimes(before, crashMono)
    // kill -9: the process is gone. A new run starts 20 s later and logs a scene put back at start-up.
    stop()
    unclean = true
    vi.advanceTimersByTime(20 * SEC)
    useJournalStore.setState({ entries: [], startItemIds: null, added: 0, keptAt: 0 })
    useJournalStore.getState().add({ kind: "scene", label: "Main Display: Pulpit camera" })
    const stop2 = await startLiveRecovery()

    const { entries } = useJournalStore.getState()
    expect(entries.length).toBeLessThanOrEqual(JOURNAL_MAX)
    // The kept log first, then this run's own entry, then the note that it was brought back.
    expect(entries.slice(-2).map((e) => e.kind)).toEqual(["scene", "recovery"])
    // At the cap, the two new ones push out the two oldest verse steps: nothing else moves.
    expect(before).toHaveLength(JOURNAL_MAX)
    const pushedOut = before.filter((e) => e.kind !== "event").slice(0, 2)
    expect(entries.slice(0, -2).map((e) => [e.kind, e.label, e.at])).toEqual(before.filter((e) => !pushedOut.includes(e)).map((e) => [e.kind, e.label, e.at]))
    expect(inOrder(entries)).toBe(true)
    // Every item's start as before, and how long each ran, to the millisecond (the last one ran on
    // until Rhema was killed, and its event carries on).
    expect(eventStarts(entries)).toEqual(startsBefore)
    const timesAfter = eventTimes(entries, monotonicNow())
    for (const id of ITEMS.slice(0, -1)) expect(timesAfter.get(id), id).toBe(timesBefore.get(id))
    expect(timesAfter.get("benediction")!).toBeGreaterThanOrEqual(timesBefore.get("benediction")!)
    // Only once.
    expect(restoreJournal(JSON.parse(file.get("journal")!))).toBe(false)
    stop2()
  })

  it("what changed in the last 3 s before the kill is not kept, and nothing is doubled", async () => {
    const stop = await startLiveRecovery()
    runService(10)
    await vi.advanceTimersByTimeAsync(3 * SEC)
    const saved = useJournalStore.getState().entries.length
    useJournalStore.getState().add({ kind: "remote", label: "last press before the kill" })
    stop()
    unclean = true
    useJournalStore.setState({ entries: [], startItemIds: null, added: 0, keptAt: 0 })
    const stop2 = await startLiveRecovery()
    const labels = useJournalStore.getState().entries.map((e) => e.label)
    expect(labels).toHaveLength(saved + 1)
    expect(labels).not.toContain("last press before the kill")
    expect(new Set(labels.filter((l) => ITEMS.includes(l))).size).toBe(ITEMS.length)
    stop2()
  })
})
