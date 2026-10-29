import { beforeEach, describe, expect, it, vi } from "vitest"

const mockInvoke = vi.fn<(...args: unknown[]) => Promise<unknown>>(async (command: unknown) => command === "content_finalize_service_run" ? { id: "log-id" } : null)
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}) }))

import { flushServiceRunCheckpoint, useJournalStore } from "./journal-store"
import { useBroadcastStore } from "./broadcast-store"
import { useQueueStore } from "./queue-store"
import type { VerseRenderData } from "@/types"

const slide = (reference: string, extra: Partial<VerseRenderData> = {}) => ({ kind: "slide", reference, segments: [], lines: [reference], ...extra }) as unknown as VerseRenderData

describe("service log entries (AR-001)", () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockImplementation(async (command: unknown) => command === "content_finalize_service_run" ? { id: "log-id" } : null)
    useBroadcastStore.setState({ isLive: false, liveVerse: null, liveItemId: null, heldLive: null, rehearsal: false })
    useJournalStore.getState().clear()
  })

  it("a quick screen with nothing live is logged as a quick screen; Black and Logo by name", () => {
    useBroadcastStore.setState({ isLive: true, liveVerse: slide("Welcome", { quick: true }) })
    useBroadcastStore.setState({ liveVerse: slide("", { screen: "black", quick: true }) })
    const entries = useJournalStore.getState().entries
    expect(entries.map((x) => [x.kind, x.label])).toEqual([["quick", "Welcome"], ["quick", "Black screen"]])
  })

  it("a picture or QR slide (no words of its own) is logged by its rundown name", () => {
    useQueueStore.setState({ items: [{ id: "p1", kind: "image", image: { media_id: "m", name: "Harvest banner", fit: "contain" }, reference: "Harvest banner", confidence: 1, source: "manual", added_at: 0 }] as never })
    useBroadcastStore.setState({ isLive: true, liveItemId: "p1", liveVerse: { kind: "slide", reference: "", segments: [], lines: [] } as unknown as VerseRenderData })
    expect(useJournalStore.getState().entries.map((x) => [x.kind, x.label])).toEqual([["live", "Harvest banner"]])
  })

  it("rehearsal off logs what the congregation then sees, only when it changed", () => {
    const a = slide("John 3:16")
    useBroadcastStore.setState({ isLive: true, liveVerse: a, liveItemId: "a" })
    useBroadcastStore.setState({ rehearsal: true })
    useBroadcastStore.setState({ liveVerse: slide("Romans 8:28"), liveItemId: "b" })
    useBroadcastStore.setState({ rehearsal: false })
    const kinds = useJournalStore.getState().entries.map((x) => `${x.kind}:${x.label}`)
    expect(kinds).toEqual(["live:John 3:16", "rehearsal:on", "rehearsal:off", "live:Romans 8:28"])
    // Rehearsal on and off with nothing changed: no extra line.
    useJournalStore.getState().clear()
    useBroadcastStore.setState({ rehearsal: true })
    useBroadcastStore.setState({ rehearsal: false })
    expect(useJournalStore.getState().entries.map((x) => x.kind)).toEqual(["rehearsal", "rehearsal"])
  })

  it("the plan is the rundown when the service first went on air; saving later does not change it", async () => {
    const { useQueueStore } = await import("./queue-store")
    const item = (id: string) => ({ id, verse: { id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "", chapter: 3, verse: 16, text: "" }, reference: id, confidence: 1, source: "manual", added_at: 0 }) as never
    useQueueStore.setState({ items: [item("a"), item("b")] })
    useBroadcastStore.setState({ isLive: true, liveVerse: slide("a"), liveItemId: "a" })
    useQueueStore.setState({ items: [item("a"), item("b"), item("added")] })
    useBroadcastStore.setState({ liveVerse: slide("added"), liveItemId: "added" })
    expect(useJournalStore.getState().startItemIds).toEqual(["a", "b"])
  })

  it("the plan is taken at the first service content on air (not a quick screen) and again for the next service", async () => {
    const { useQueueStore } = await import("./queue-store")
    const { useServiceStore } = await import("./service-store")
    const item = (id: string) => ({ id, verse: { id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "", chapter: 3, verse: 16, text: "" }, reference: id, confidence: 1, source: "manual", added_at: 0 }) as never
    useServiceStore.setState({ current: { id: "s1" } as never })
    useJournalStore.setState({ startItemIds: null })
    useQueueStore.setState({ items: [] })
    useBroadcastStore.setState({ isLive: true, liveVerse: slide("", { screen: "black", quick: true }) }) // a black-screen test before the service
    expect(useJournalStore.getState().startItemIds).toBeNull()
    useQueueStore.setState({ items: [item("x"), item("y")] })
    useBroadcastStore.setState({ liveVerse: slide("x"), liveItemId: "x" })
    expect(useJournalStore.getState().startItemIds).toEqual(["x", "y"])
    useServiceStore.setState({ current: { id: "s2" } as never })
    expect(useJournalStore.getState().runContext?.programId).toBe("s1")
    expect(useJournalStore.getState().startItemIds).toEqual(["x", "y"])
    useJournalStore.getState().add({ kind: "event", label: "Service 2 starts", itemId: "new-event" })
    expect(useJournalStore.getState().runContext?.programId).toBe("s2")
    expect(useJournalStore.getState().entries.map((entry) => entry.label)).toEqual(["Service 2 starts"])
    expect(useJournalStore.getState().startItemIds).toEqual(["x", "y"])
  })

  it("formats History from the captured service and plan after the current service changes", async () => {
    const { useServiceStore } = await import("./service-store")
    const { journalText } = await import("./journal-store")
    const item = (id: string) => ({ id, kind: "verse", verse: { id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "Jn", chapter: 3, verse: 16, text: "" }, reference: id, planned_minutes: 3, confidence: 1, source: "manual", added_at: 0 }) as never
    useServiceStore.setState({ current: { id: "s1", title: "Sunday morning", revision: 4, service_date: "2026-10-25" } as never })
    useQueueStore.setState({ items: [item("Welcome"), item("Sermon")] })
    useJournalStore.getState().add({ kind: "event", label: "Welcome", itemId: "welcome-event" })
    const body = journalText()

    useServiceStore.setState({ current: { id: "s2", title: "Midweek", revision: 1, service_date: "2026-10-28" } as never })
    useQueueStore.setState({ items: [item("Different plan")] })

    expect(body).toContain("Sunday morning")
    expect(body).not.toContain("Midweek")
    expect(body).toContain("Welcome: not shown")
    expect(body).toContain("Sermon: not shown")
    expect(body).not.toContain("Different plan")
  })

  it("finalizes an accepted Finish with one stable run key and can retry an ambiguous response", async () => {
    const { useServiceStore } = await import("./service-store")
    const { finalizeServiceRun } = await import("./journal-store")
    useServiceStore.setState({ current: { id: "s1", title: "Sunday", revision: 2, service_date: "2026-10-25" } as never })
    const broadcastBeforeFinish = useBroadcastStore.getState()
    useJournalStore.getState().add({ kind: "event", label: "Opening", itemId: "opening" })
    useJournalStore.getState().add({ kind: "event", label: "Service finished" })
    const runId = useJournalStore.getState().runContext?.runId
    let committed = false
    mockInvoke.mockImplementation(async (command: unknown) => {
      if (command === "content_finalize_service_run") {
        if (!committed) {
          committed = true
          throw new Error("response lost after commit")
        }
        return { id: "the-run-log" }
      }
      return null
    })

    await expect(finalizeServiceRun()).rejects.toThrow("response lost after commit")
    expect(useJournalStore.getState()).toMatchObject({ runStatus: "finished", checkpointStatus: "error", finalizedLogId: null })
    await finalizeServiceRun()

    const finalCalls = mockInvoke.mock.calls.filter(([command]) => command === "content_finalize_service_run")
    expect(finalCalls).toHaveLength(2)
    expect(finalCalls.map(([, args]) => (args as { runId: string }).runId)).toEqual([runId, runId])
    expect(finalCalls[0]?.[1]).toMatchObject({ transcript: null, finishedAt: expect.any(String) })
    expect(useJournalStore.getState()).toMatchObject({ runStatus: "finished", finalizedLogId: "the-run-log" })
    expect(useBroadcastStore.getState()).toBe(broadcastBeforeFinish)
  })

  it("stores a wall and monotonic anchor with each durable run checkpoint", async () => {
    const { useServiceStore } = await import("./service-store")
    useServiceStore.setState({ current: { id: "s1", title: "Sunday", revision: 2, service_date: "2026-10-25" } as never })
    useJournalStore.getState().add({ kind: "event", label: "Opening", itemId: "opening" })

    await flushServiceRunCheckpoint()

    const checkpointCall = mockInvoke.mock.calls.find(([command]) => command === "content_checkpoint_service_run")
    expect(checkpointCall?.[1]).toMatchObject({
      checkpoint: {
        version: 2,
        checkpointAt: expect.any(Number),
        checkpointMono: expect.any(Number),
        entries: [expect.objectContaining({ kind: "event", label: "Opening" })],
      },
    })
  })
})

