// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { useServiceTiming } from "./use-service-timing"
import { useQueueStore } from "@/stores/queue-store"
import { useJournalStore } from "@/stores/journal-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useEventClock } from "@/stores/event-clock-store"
import type { QueueItem } from "@/types"

const slide = (id: string, planned_minutes: number): QueueItem =>
  ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0, planned_minutes }) as unknown as QueueItem
const at = (h: number, m: number) => new Date(2026, 9, 25, h, m).getTime()
const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

afterEach(() => vi.restoreAllMocks())

function Probe() {
  const { timing } = useServiceTiming()
  return <span>{timing ? `${hhmm(timing.plannedEnd)} ${hhmm(timing.expectedEnd)}` : "none"}</span>
}

describe("one timing for Prepare and Present", () => {
  it("gives the planned and expected end from the run of show", async () => {
    vi.spyOn(Date, "now").mockReturnValue(at(10, 5))
    vi.spyOn(performance, "now").mockReturnValue(0)
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useQueueStore.setState({ items: [slide("a", 10), slide("b", 20)], headers: [{ id: "m", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main", starts_at: "10:00" }] })
    useJournalStore.setState({ entries: [{ at: at(10, 5), mono: 0, kind: "event", label: "a", itemId: "a" }] })
    useBroadcastStore.setState({ isLive: true, liveItemId: "a" })
    useEventClock.setState({ currentId: "a", currentMomentId: "a" })
    const el = document.createElement("div")
    await act(async () => createRoot(el).render(<Probe />))
    // Planned 10:30; began at 10:05 with a live, so expected 10:35.
    expect(el.textContent).toBe("10:30 10:35")
  })
})
