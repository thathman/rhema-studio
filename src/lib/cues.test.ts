import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Verse } from "@/types"

const mockInvoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn().mockResolvedValue(undefined) }))

import { CUE_ACTIONS, MACROS, runMacro, runSteps } from "./cues"
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

  it("Start the service: rehearsal off, timer running from zero, Welcome on air", async () => {
    useTimerStore.getState().start()
    useTimerStore.getState().pause()
    expect(await runMacro("service-start")).toEqual(["rehearsal.off", "timer.fresh", "quick.welcome"])
    const b = useBroadcastStore.getState()
    expect(b.rehearsal).toBe(false)
    expect(b.isLive).toBe(true)
    expect(b.liveVerse?.reference).toBe("Welcome")
    expect(useTimerStore.getState().timer.startedAt).not.toBeNull()
    expect(useTimerStore.getState().timer.accumulatedMs).toBe(0)
    // Pressed again mid-service (a Stream Deck, the phone): the running timer is left alone.
    const started = useTimerStore.getState().timer.startedAt
    await runMacro("service-start")
    expect(useTimerStore.getState().timer.startedAt).toBe(started)
    useTimerStore.getState().pause()
  })

  it("End the service: cleared, timer paused, stage message gone; unknown macros do nothing", async () => {
    await presentVerse(verse(16), { goLive: true })
    useTimerStore.getState().start()
    expect(await runMacro("service-end")).toEqual(["clear", "timer.pause", "stage.clearMessage"])
    const b = useBroadcastStore.getState()
    expect(b.isLive).toBe(false)
    expect(b.liveVerse?.reference).toContain("John 3:16")
    expect(b.stageMessage).toBe("")
    expect(useTimerStore.getState().timer.startedAt).toBeNull()
    expect(await runMacro("nope")).toEqual([])
    // Running it again is harmless.
    expect(await runMacro("service-end")).toHaveLength(3)
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })

  it("runs the church's own cues by id, skipping steps this build does not know", async () => {
    const { useSettingsStore } = await import("@/stores/settings-store")
    useSettingsStore.setState({ customMacros: [{ id: "baptism", label: "Baptism", steps: ["rehearsal.off", "quick.black", "future.thing"] }] })
    expect(await runMacro("baptism")).toEqual(["rehearsal.off", "quick.black"])
    expect(useBroadcastStore.getState().rehearsal).toBe(false)
    expect(useBroadcastStore.getState().liveVerse?.screen).toBe("black")
    useSettingsStore.setState({ customMacros: [] })
    expect(await runMacro("baptism")).toEqual([])
  })

  it("makes readable, unique ids for new cues", async () => {
    const { macroIdFor } = await import("./cues")
    expect(macroIdFor("Baptism", [])).toBe("baptism")
    expect(macroIdFor("Start the service", ["service-start", "start-the-service"])).toBe("start-the-service-2")
    expect(macroIdFor("Ìpàdé àdúrà!", [])).toBe("ipade-adura")
    expect(macroIdFor("!!!", [])).toBe("cue")
  })

  it("runs steps one after another: a Next still loading is not cancelled by the step after it", async () => {
    const { useQueueStore } = await import("@/stores/queue-store")
    const { useSettingsStore } = await import("@/stores/settings-store")
    const item = (id: string, v: number) => ({ id, verse: verse(v), reference: `John 3:${v}`, confidence: 1, source: "manual", added_at: 0 }) as never
    useBroadcastStore.setState({ rehearsal: false })
    useQueueStore.setState({ items: [item("a", 16), item("b", 17)], activeIndex: 0 })
    // The verse lookup is slow, as on a busy computer.
    mockInvoke.mockImplementation(async (cmd: string, a: Record<string, number>) => {
      await new Promise((r) => setTimeout(r, 20))
      return cmd === "get_verse" ? verse(a.verse) : null
    })
    useSettingsStore.setState({ customMacros: [{ id: "next-offering", label: "Next then Offering", steps: ["next", "quick.offering"] }] })
    await runMacro("next-offering")
    // John 3:17 reached the screen before the Offering screen held it, so Back returns to it.
    expect(useBroadcastStore.getState().heldLive?.liveVerse.reference).toContain("John 3:17")
    useSettingsStore.setState({ customMacros: [] })
  })

  it("a Show live step is on air before the next step runs (a quick screen then holds it)", async () => {
    const v: Verse = { id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "", chapter: 3, verse: 16, text: "t" }
    useBroadcastStore.setState({ isLive: false, liveVerse: null, heldLive: null, rehearsal: false })
    useBibleStore.setState({ selectedVerse: v, selectedSlide: null })
    await runSteps(["showLive", "quick.offering"])
    const s = useBroadcastStore.getState()
    expect(s.liveVerse?.quick).toBe(true)
    expect(s.heldLive?.liveVerse.reference).toContain("John 3:16")
  })
})

