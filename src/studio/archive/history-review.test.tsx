// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockInvoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(async () => null), open: vi.fn(async () => null) }))
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { RunChronologyPage } from "@/studio/archive/run-chronology"
import { JournalBlock } from "@/studio/archive/service-runs"
import { SongUsageBlock } from "@/studio/archive/song-usage-block"
import { usageReportCsv } from "@/studio/archive/song-usage-report"
import { useServiceStore } from "@/stores/service-store"

const run = {
  run_id: "run-1", program_id: "p1", program_revision: 2, service_date: "2026-11-08", title: "Sunday service", time_zone: null,
  started_at: "2026-11-08T09:00:00Z", updated_at: "2026-11-08T11:00:00Z", finished_at: "2026-11-08T11:00:00Z", status: "finished",
  checkpoint: { version: 1, entries: [{ at: Date.parse("2026-11-08T09:05:00Z"), mono: 1, kind: "live", label: "Amazing Grace", itemId: "i1" }], plan: [{ id: "i1", label: "Amazing Grace" }], plannedMs: { i1: 300_000 }, headers: [], operator: "Tolu" },
  after_action_notes: null, notes_updated_at: null,
}
const usage = [{ song_id: "s1", title: "Amazing Grace", hymn: false, hymn_numbers: [], authors: "", ccli_number: "22025", licence: "ccli", services: 2, last_date: "2026-11-08" }]

let root: Root | null = null
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const text = () => document.body.textContent ?? ""
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label)!

beforeEach(() => {
  mockInvoke.mockReset()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useServiceStore.setState({ programs: [], current: null, dirty: false })
  root = createRoot(document.body.appendChild(document.createElement("div")))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

describe("History: one run's chronology page (#854 G10)", () => {
  it("shows plan against actual, the journal in order, and saves after-action notes", async () => {
    mockInvoke.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
      if (command === "content_get_service_run") return run
      if (command === "recorder_list") return []
      if (command === "content_set_service_run_notes") return { ...run, after_action_notes: args.notes, notes_updated_at: "2026-11-09T08:00:00Z" }
      throw new Error(`Unexpected ${command}`)
    })
    const onBack = vi.fn()
    await act(async () => { root!.render(<RunChronologyPage runId="run-1" onBack={onBack} />); await tick() })
    expect(text()).toContain("Sunday service")
    expect(document.querySelector('[aria-label="Planned against actual"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="What happened, in order"]')?.textContent).toContain("Amazing Grace")
    expect(text()).toContain("No Rhema recording was made during this run.")

    const notes = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="After-action notes"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(notes, "Start the band earlier.")
      notes.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(text()).toContain("Not saved yet")
    await act(async () => { button("Save notes").click(); await tick() })
    expect(mockInvoke).toHaveBeenCalledWith("content_set_service_run_notes", { runId: "run-1", notes: "Start the band earlier." })
    expect(text()).toContain("Saved ")

    await act(async () => button("Back to History").click())
    expect(onBack).toHaveBeenCalled()
  })

  it("a run that cannot be read says so with Try again (#832 S8)", async () => {
    let fail = true
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "content_get_service_run") { if (fail) throw { message: "database is locked" }; return run }
      if (command === "recorder_list") return []
      throw new Error(`Unexpected ${command}`)
    })
    await act(async () => { root!.render(<RunChronologyPage runId="run-1" onBack={() => {}} />); await tick() })
    expect(text()).toContain("Could not load this run")
    fail = false
    await act(async () => { button("Try again").click(); await tick() })
    expect(text()).toContain("Sunday service")
  })
})

describe("History: service runs and logs (#805 R6, #832 S8)", () => {
  it("names its parts clearly, opens a run as a page, and shows a failed kept-logs load instead of hiding it", async () => {
    let failLogs = true
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "content_list_service_runs") return [run]
      if (command === "content_list_service_logs") { if (failLogs) throw { message: "disk unavailable" }; return [] }
      return null
    })
    const onOpenRun = vi.fn()
    await act(async () => { root!.render(<JournalBlock onOpenRun={onOpenRun} />); await tick() })
    expect(text()).toContain("This session's log")
    expect(text()).toContain("Saved runs")
    expect(text()).toContain("Kept logs")
    expect(text()).not.toContain("Earlier logs")
    expect(text()).not.toContain("Recent service runs")
    expect(text()).toContain("Could not load kept logs")
    expect(text()).toContain("disk unavailable")

    await act(async () => button("Open the chronology of Sunday service").click())
    expect(onOpenRun).toHaveBeenCalledWith("run-1")

    failLogs = false
    await act(async () => { button("Try again").click(); await tick() })
    expect(text()).not.toContain("Could not load kept logs")
  })
})

describe("History: saved runs page past twenty", () => {
  it("shows twenty runs and Show more asks for the next twenty", async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ ...run, run_id: `run-${i}`, title: `Service ${i}` }))
    mockInvoke.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
      if (command === "content_list_service_runs") return many.slice(0, Number(args.limit))
      if (command === "content_list_service_logs") return []
      return null
    })
    await act(async () => { root!.render(<JournalBlock onOpenRun={() => {}} />); await tick() })
    const rows = () => document.querySelectorAll('[aria-label="Saved runs"] li').length
    expect(rows()).toBe(20)
    expect(mockInvoke).toHaveBeenCalledWith("content_list_service_runs", { programId: null, limit: 21 })
    await act(async () => { button("Show more").click(); await tick() })
    expect(rows()).toBe(25)
    expect(button("Show more")).toBeUndefined()
  })
})

describe("one thing called History (#805 R6)", () => {
  it("calls Prepare's per-save snapshots Versions", async () => {
    const { saveStateOf } = await import("@/studio/prepare/save-state")
    const saved = saveStateOf({ current: { title: "Sunday" }, dirty: false, saving: false, count: 1 })
    const unsaved = saveStateOf({ current: { title: "Sunday" }, dirty: true, saving: false, count: 1 })
    for (const state of [saved, unsaved]) {
      expect(state.title).toContain("Versions has every earlier save")
      expect(state.title).not.toContain("History")
    }
  })
})

describe("History: song usage counts what was shown (#843 S19)", () => {
  it("asks for songs shown in runs by default, and labels the plan-based count as planned", async () => {
    mockInvoke.mockImplementation(async () => usage)
    await act(async () => { root!.render(<SongUsageBlock />); await tick() })
    expect(text()).toContain("Songs shown in services")
    await act(async () => { button("Show").click(); await tick() })
    expect(mockInvoke).toHaveBeenLastCalledWith("content_song_usage_shown", expect.objectContaining({ from: expect.any(String), to: expect.any(String) }))
    expect(document.querySelector('[aria-label="Songs shown"]')?.textContent).toContain("Amazing Grace")

    await act(async () => button("Planned").click())
    expect(text()).toContain("Planned only")
    await act(async () => { button("Show").click(); await tick() })
    expect(mockInvoke).toHaveBeenLastCalledWith("content_song_usage", expect.anything())
    expect(document.querySelector('[aria-label="Songs planned"]')?.textContent).toContain("2 planned")
  })

  it("says in the CSV what was counted", () => {
    const shown = usageReportCsv(usage, "2026-10-01", "2026-10-31", "shown").split("\n")
    expect(shown[0]).toBe("# Song usage 2026-10-01 to 2026-10-31 (shown on screen during service runs)")
    expect(shown[1]).toContain(",Services shown in,")
    const planned = usageReportCsv(usage, "2026-10-01", "2026-10-31", "planned").split("\n")
    expect(planned[0]).toContain("PLANNED")
    expect(planned[1]).toContain(",Services planned in,")
  })
})
