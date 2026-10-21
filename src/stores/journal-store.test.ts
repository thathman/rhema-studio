import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}) }))

import { useJournalStore } from "./journal-store"
import { useBroadcastStore } from "./broadcast-store"
import type { VerseRenderData } from "@/types"

const slide = (reference: string, extra: Partial<VerseRenderData> = {}) => ({ kind: "slide", reference, segments: [], lines: [reference], ...extra }) as unknown as VerseRenderData

describe("service log entries (AR-001)", () => {
  beforeEach(() => {
    useBroadcastStore.setState({ isLive: false, liveVerse: null, liveItemId: null, heldLive: null, rehearsal: false })
    useJournalStore.getState().clear()
  })

  it("a quick screen with nothing live is logged as a quick screen; Black and Logo by name", () => {
    useBroadcastStore.setState({ isLive: true, liveVerse: slide("Welcome", { quick: true }) })
    useBroadcastStore.setState({ liveVerse: slide("", { screen: "black", quick: true }) })
    const entries = useJournalStore.getState().entries
    expect(entries.map((x) => [x.kind, x.label])).toEqual([["quick", "Welcome"], ["quick", "Black screen"]])
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
})
