// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { QueueItem } from "@/types"

const calls: { cmd: string; args: Record<string, unknown> }[] = []
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args })
    return null
  }),
}))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { buildLiveState, type LiveStateV1 } from "@/lib/live-state"
import { backstageRows } from "@/lib/cuesheet"
import { useEventClock } from "@/stores/event-clock-store"
import { useJoin } from "@/stores/join-store"
import { useJournalStore } from "@/stores/journal-store"
import { useQueueStore } from "@/stores/queue-store"
import { useSettingsStore } from "@/stores/settings-store"
import { OperatorsPanel } from "@/studio/production/operators-panel"

/** #196 R4: the host's Live State carries each item's times, and every joined desk gets a read-only run of show. */
const slide = (id: string, planned_minutes: number, end_by?: string): QueueItem =>
  ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0, planned_minutes, end_by }) as unknown as QueueItem
const at = (h: number, m: number) => new Date(2026, 9, 25, h, m).getTime()
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

let root: Root | null = null
beforeEach(() => {
  calls.length = 0
  // A loop before the service, then Welcome (done), Notices (skipped), Worship (on now), Sermon (end by 11:00).
  useQueueStore.setState({
    items: [slide("Loop", 0), slide("Welcome", 5), slide("Notices", 5), slide("Worship", 20), slide("Sermon", 30, "11:00")],
    headers: [
      { id: "pre", type: "phase", name: "Pre-service", at: 0, rule: "loop", role: "pre" },
      { id: "main", type: "phase", name: "Main service", at: 1, rule: "manual", role: "main", starts_at: "10:00" },
    ],
  })
  useEventClock.setState({ mode: "own", currentId: "Worship", currentMomentId: "Worship" })
  useJournalStore.setState({ entries: [
    { at: at(10, 3), mono: 0, kind: "event", label: "Welcome", itemId: "Welcome" },
    { at: at(10, 9), mono: 6 * 60_000, kind: "event", label: "Worship", itemId: "Worship" },
  ] })
  useSettingsStore.setState({ joinAddress: "192.168.1.20:8080", joinToken: "t" })
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ""
})

describe("the Live State carries the run of show's times", () => {
  it("plan, expected, actual, state and end by for each item of the main service; nothing for the rest", () => {
    const s = buildLiveState(at(10, 12))
    const by = Object.fromEntries(s.rundown.map((r) => [r.id, r]))
    expect(by.Loop.time).toBeUndefined()
    expect(by.Welcome).toMatchObject({ reference: "Welcome", plannedMinutes: 5, time: { plan: [at(10, 0), at(10, 5)], actual: at(10, 3), ranMs: 6 * 60_000, state: "done" } })
    expect(by.Notices.time).toMatchObject({ plan: [at(10, 5), at(10, 10)], state: "skipped" })
    expect(by.Notices.time?.actual).toBeUndefined()
    expect(by.Worship.time).toMatchObject({ plan: [at(10, 10), at(10, 30)], expected: [at(10, 9), at(10, 29)], actual: at(10, 9), state: "live" })
    expect(by.Sermon.time).toMatchObject({ plan: [at(10, 30), at(11, 0)], expected: [at(10, 29), at(10, 59)], state: "upcoming", endBy: at(11, 0) })
    // Old desks read only what they knew: those fields are unchanged.
    expect(Object.keys(by.Sermon).sort()).toEqual(["id", "plannedMinutes", "reference", "time"])
  })

  it("rows for the backstage cuesheet, with the offset from the plan; none from an older host", () => {
    const rows = backstageRows(buildLiveState(at(10, 12)).rundown)
    expect(rows.map((r) => [r.label, r.time.state, r.offsetMinutes])).toEqual([["Welcome", "done", 3], ["Notices", "skipped", null], ["Worship", "live", -1], ["Sermon", "upcoming", -1]])
    expect(backstageRows([{ id: "a", reference: "Welcome" }])).toEqual([])
  })
})

describe("the read-only backstage run of show on a joined desk", () => {
  async function renderDesk(live: LiveStateV1, role: string) {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useJoin.setState({ status: "connected", me: { name: "Desk", role }, live, receivedAt: performance.now(), clockSkewMs: 0, error: null, paused: false, note: null })
    const el = document.body.appendChild(document.createElement("div"))
    root = createRoot(el)
    await act(async () => root!.render(<OperatorsPanel />))
    return el.querySelector<HTMLElement>('section[aria-label="Run of show (read only)"]')
  }

  it.each(["bible", "screens", "timekeeper"])("a %s desk sees each item with its times and status, and no button", async (role) => {
    const live = buildLiveState(at(10, 12))
    const view = await renderDesk(live, role)
    expect(view).not.toBeNull()
    const rows = [...view!.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent))
    expect(rows.map((r) => r[0])).toEqual(["Welcome", "Notices", "Worship", "Sermon"])
    expect(rows[0][1]).toBe(`${hhmm(at(10, 0))}–${hhmm(at(10, 5))}`)
    expect(rows[0][5]).toBe("Done")
    expect(rows[1][5]).toBe("Skipped")
    expect(rows[2][5]).toBe("On now")
    expect(rows[3][2]).toBe(`${hhmm(at(10, 29))}–${hhmm(at(10, 59))}`)
    expect(rows[3][4]).toBe(hhmm(at(11, 0)))
    expect(view!.querySelectorAll("button, input, select, a")).toHaveLength(0)
  })

  it("a fixed start has a pin, the pause before it a thin row, and running past it says so (R3)", async () => {
    // The Sermon is fixed at 10:35 (5 min after Worship's planned end); Worship began 10:17, so it runs to 10:37.
    useQueueStore.setState({ items: useQueueStore.getState().items.map((i) => (i.id === "Sermon" ? { ...i, end_by: null, starts_at: "10:35" } : i)) })
    useJournalStore.setState({ entries: [
      { at: at(10, 3), mono: 0, kind: "event", label: "Welcome", itemId: "Welcome" },
      { at: at(10, 17), mono: 14 * 60_000, kind: "event", label: "Worship", itemId: "Worship" },
    ] })
    const live = buildLiveState(at(10, 20))
    expect(live.rundown.find((r) => r.id === "Sermon")?.time).toMatchObject({ plan: [at(10, 35), at(11, 5)], expected: [at(10, 37), at(11, 7)], fixed: true, conflict: true, pause: [5 * 60_000, 5 * 60_000] })
    expect(live.rundown.find((r) => r.id === "Worship")?.time?.fixed).toBeUndefined()
    const view = await renderDesk(live, "bible")
    const rows = [...view!.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent))
    expect(rows.map((r) => r[0])).toEqual(["Welcome", "Notices", "Worship", "Pause before the fixed start · 5 min", "Sermon"])
    expect(rows[3][2]).toBe("absorbs 5 min · used up")
    expect(rows[4][5]).toBe("Late for its fixed start")
    expect(view!.querySelector('[aria-label="Fixed start"]')).not.toBeNull()
  })

  it("says so when the host sends no times (no start time, or an older host)", async () => {
    const live = buildLiveState(at(10, 12))
    const old: LiveStateV1 = { ...live, event: { mode: live.event.mode, currentId: live.event.currentId }, rundown: live.rundown.map(({ id, reference, plannedMinutes }) => ({ id, reference, plannedMinutes })) }
    const view = await renderDesk(old, "bible")
    expect(view?.textContent).toContain("No times from the host yet")
    expect(view!.querySelectorAll("button")).toHaveLength(0)
  })
})
