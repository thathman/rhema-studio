// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { TimingPanel } from "./timing-panel"
import { useQueueStore } from "@/stores/queue-store"
import { useJournalStore } from "@/stores/journal-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useEventClock } from "@/stores/event-clock-store"
import type { QueueItem } from "@/types"

const slide = (id: string, planned_minutes: number): QueueItem =>
  ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0, planned_minutes }) as unknown as QueueItem
const at = (h: number, m: number) => new Date(2026, 9, 25, h, m).getTime()

describe("run of show timing: actual times", () => {
  it("shows when the service began against its start, each item's time on air, and moves the finish", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useQueueStore.setState({
      items: [{ ...slide("Welcome", 3), assignees: ["Tolu", "Ade"], prepared_by: "Tolu, Ade" }, slide("Reading", 10)],
      headers: [{ id: "main", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main", starts_at: "10:00" }],
    })
    useJournalStore.setState({
      entries: [
        { at: at(10, 4), mono: 0, kind: "event", label: "Welcome", itemId: "Welcome" },
        { at: at(10, 9), mono: 300_000, kind: "event", label: "Reading", itemId: "Reading" },
      ],
    })
    useBroadcastStore.setState({ isLive: true, liveItemId: "Reading" })
    useEventClock.setState({ currentId: "Reading" })
    const el = document.createElement("div")
    await act(async () => createRoot(el).render(<TimingPanel />))
    const text = el.textContent ?? ""
    expect(text).toContain("Began at 10:04, 4 min late")
    // Planned 3 min, on air 5 min: 2 min over.
    expect(text).toContain("On air 10:04 for 5:00 (+2:00)")
    expect(text).toContain("On air 10:09 for")
    // Planned to finish 10:13. Began 4 late, the welcome ran 2 over, the reading is live from 10:09
    // for its 10 minutes: expected 10:19, 6 minutes late; the plan stays as prepared.
    expect(text).toContain("10:19")
    expect(text).toContain("planned 10:13")
    expect(text).toContain("6 min late")

    // The same as a table: who prepares it (#299 6.10), plan, actual, expected and offset per item.
    const table = [...el.querySelectorAll("button")].find((b) => b.textContent === "Table")!
    await act(async () => table.click())
    const rows = [...document.querySelectorAll("tbody tr")].map((r) => [...r.querySelectorAll("td")].map((c) => c.querySelector("input")?.value ?? c.textContent))
    expect(rows).toEqual([
      ["Welcome", "Tolu, Ade", "10:00", "10:03", "3", "10:04 · 5:00", "", "+4 min", "", "Done"],
      ["Reading", "", "10:03", "10:13", "10", "10:09 · 0:00", "10:09–10:19", "+6 min", "", "On now"],
    ])
    expect(document.querySelector("tfoot")?.textContent).toContain("ends 10:19")
  })
})

describe("run of show timing: an item jumped over", () => {
  it("says Skipped in the panel and the table, with no expected time or offset", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    document.body.innerHTML = ""
    useQueueStore.setState({
      items: [slide("Welcome", 3), slide("Notices", 5), slide("Reading", 10)],
      headers: [{ id: "main", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main", starts_at: "10:00" }],
    })
    useJournalStore.setState({
      entries: [
        { at: at(10, 0), mono: 0, kind: "event", label: "Welcome", itemId: "Welcome" },
        { at: at(10, 3), mono: 180_000, kind: "event", label: "Reading", itemId: "Reading" },
      ],
    })
    useEventClock.setState({ currentId: "Reading" })
    const el = document.createElement("div")
    await act(async () => createRoot(el).render(<TimingPanel />))
    expect(el.textContent).toContain("Skipped")
    const table = [...el.querySelectorAll("button")].find((b) => b.textContent === "Table")!
    await act(async () => table.click())
    const rows = [...document.querySelectorAll("tbody tr")].map((r) => [...r.querySelectorAll("td")].map((c) => c.querySelector("input")?.value ?? c.textContent))
    expect(rows[1]).toEqual(["Notices", "", "10:03", "10:08", "5", "", "", "", "", "Skipped"])
    // The reading follows the welcome: expected 10:03–10:13, 5 min early against its plan (10:08).
    expect(rows[2].slice(6, 8)).toEqual(["10:03–10:13", "−5 min"])
  })
})
