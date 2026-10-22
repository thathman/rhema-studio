// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { TimingPanel } from "./timing-panel"
import { useQueueStore } from "@/stores/queue-store"
import { useJournalStore } from "@/stores/journal-store"
import type { QueueItem } from "@/types"

const slide = (id: string, planned_minutes: number): QueueItem =>
  ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0, planned_minutes }) as unknown as QueueItem
const at = (h: number, m: number) => new Date(2026, 9, 25, h, m).getTime()

describe("run of show timing: actual times", () => {
  it("shows when the service began against its start, each item's time on air, and moves the finish", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useQueueStore.setState({
      items: [slide("Welcome", 3), slide("Reading", 10)],
      headers: [{ id: "main", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main", starts_at: "10:00" }],
    })
    useJournalStore.setState({
      entries: [
        { at: at(10, 4), mono: 0, kind: "live", label: "Welcome", itemId: "Welcome" },
        { at: at(10, 9), mono: 300_000, kind: "live", label: "Reading", itemId: "Reading" },
      ],
    })
    const el = document.createElement("div")
    await act(async () => createRoot(el).render(<TimingPanel />))
    const text = el.textContent ?? ""
    expect(text).toContain("Began at 10:04, 4 min late")
    // Planned 3 min, on air 5 min: 2 min over.
    expect(text).toContain("On air 10:04 for 5:00 (+2:00)")
    expect(text).toContain("On air 10:09 for")
    // 13 planned minutes from 10:00, 4 late: 10:17.
    expect(text).toContain("10:17")
    expect(text).toContain("4 min late")
  })
})
