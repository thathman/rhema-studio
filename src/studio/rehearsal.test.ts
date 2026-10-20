import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Verse } from "@/types"

const mockInvoke = vi.fn()
const emitTo = vi.fn().mockResolvedValue(undefined)
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: (...args: unknown[]) => emitTo(...args) }))

import { presentVerse } from "@/hooks/use-broadcast"
import { presentActions } from "./present-actions"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { MAIN_OUTPUT_ID, defaultNdiSettings } from "@/types"

const verse = (v: number): Verse => ({ id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "", chapter: 3, verse: v, text: `text ${v}` })

beforeEach(() => {
  mockInvoke.mockReset()
  emitTo.mockClear()
  mockInvoke.mockImplementation(async (cmd: string, a: Record<string, number>) => (cmd === "get_verse" ? verse(a.verse) : null))
  useBibleStore.setState({ selectedVerse: null, selectedSlide: null, activeTranslationId: 1, secondaryTranslationId: null, overrideServiceTranslations: false, translations: [{ id: 1, abbreviation: "KJV", title: "", language: "en", is_copyrighted: false, is_downloaded: true }] })
  const themes = useBroadcastStore.getState().themes
  useBroadcastStore.setState({
    isLive: false, liveVerse: null, liveSourceVerse: null, liveItem: null, liveSlide: null, liveItemId: null, heldLive: null, presentWarning: null, rehearsal: false,
    outputs: [
      { id: MAIN_OUTPUT_ID, name: "Main", type: "display", themeId: themes[0]?.id ?? "", monitorIndex: 0, ndi: defaultNdiSettings() },
      { id: "stage-1", name: "Stage", type: "display", role: "stage", themeId: themes[0]?.id ?? "", monitorIndex: 1, ndi: defaultNdiSettings() },
    ],
  })
})

describe("rehearsal mode", () => {
  it("freezes every output while on, then sends the current content when turned off", async () => {
    await presentVerse(verse(16), { goLive: true })
    expect(emitTo).toHaveBeenCalled()
    const before = emitTo.mock.calls.length
    useBroadcastStore.getState().setRehearsal(true)
    await presentVerse(verse(17), { goLive: true })
    presentActions.clear()
    presentActions.quickScreen("stand")
    expect(useBroadcastStore.getState().liveVerse?.lines).toEqual(["Please stand"])
    expect(emitTo.mock.calls.length).toBe(before)
    emitTo.mockClear()
    useBroadcastStore.getState().setRehearsal(false)
    const labels = emitTo.mock.calls.map((c) => c[0])
    expect(labels).toContain("broadcast-main")
    expect(labels).toContain("broadcast-stage-1")
    const mainPayload = emitTo.mock.calls.find((c) => c[0] === "broadcast-main")?.[2] as { verse: { lines?: string[] } | null }
    expect(mainPayload.verse?.lines).toEqual(["Please stand"])
  })
})
