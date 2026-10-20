import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Verse } from "@/types"

const mockInvoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn().mockResolvedValue(undefined) }))

import { CUE_ACTIONS, MACROS, runMacro } from "./cues"
import { presentVerse } from "@/hooks/use-broadcast"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useTimerStore } from "@/stores/timer-store"
import { idleTimer } from "@/lib/timer"

const verse = (v: number): Verse => ({ id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "", chapter: 3, verse: v, text: "t" })

beforeEach(() => {
  mockInvoke.mockReset()
  mockInvoke.mockImplementation(async (cmd: string, a: Record<string, number>) => (cmd === "get_verse" ? verse(a.verse) : null))
  useBibleStore.setState({ selectedVerse: null, selectedSlide: null, activeTranslationId: 1, secondaryTranslationId: null, overrideServiceTranslations: false, translations: [{ id: 1, abbreviation: "KJV", title: "", language: "en", is_copyrighted: false, is_downloaded: true }] })
  useBroadcastStore.setState({ isLive: false, liveVerse: null, liveSourceVerse: null, liveItem: null, liveSlide: null, liveItemId: null, heldLive: null, presentWarning: null, rehearsal: true, stageMessage: "wrap up", outputs: [] })
  useTimerStore.setState({ timer: idleTimer(10 * 60_000) })
})

describe("cues and macros", () => {
  it("every macro step names a registered action", () => {
    for (const m of MACROS) for (const s of m.steps) expect(CUE_ACTIONS[s]).toBeDefined()
  })

  it("Start the service: rehearsal off, timer running from zero, Welcome on air", () => {
    useTimerStore.getState().start()
    useTimerStore.getState().pause()
    expect(runMacro("service-start")).toEqual(["rehearsal.off", "timer.reset", "timer.start", "quick.welcome"])
    const b = useBroadcastStore.getState()
    expect(b.rehearsal).toBe(false)
    expect(b.isLive).toBe(true)
    expect(b.liveVerse?.reference).toBe("Welcome")
    expect(useTimerStore.getState().timer.startedAt).not.toBeNull()
    expect(useTimerStore.getState().timer.accumulatedMs).toBe(0)
    useTimerStore.getState().pause()
  })

  it("End the service: cleared, timer paused, stage message gone; unknown macros do nothing", async () => {
    await presentVerse(verse(16), { goLive: true })
    useTimerStore.getState().start()
    expect(runMacro("service-end")).toEqual(["clear", "timer.pause", "stage.clearMessage"])
    const b = useBroadcastStore.getState()
    expect(b.isLive).toBe(false)
    expect(b.liveVerse?.reference).toContain("John 3:16")
    expect(b.stageMessage).toBe("")
    expect(useTimerStore.getState().timer.startedAt).toBeNull()
    expect(runMacro("nope")).toEqual([])
    // Running it again is harmless.
    expect(runMacro("service-end")).toHaveLength(3)
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })
})
