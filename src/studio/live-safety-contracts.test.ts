import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Verse } from "@/types"

const mockInvoke = vi.fn()
const emitTo = vi.fn().mockResolvedValue(undefined)
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: (...args: unknown[]) => emitTo(...args) }))

import { presentVerse } from "@/hooks/use-broadcast"
import { presentActions } from "./present-actions"
import { leaveRehearsal, showRehearsalLive, useApprovalGateStore } from "@/stores/approval-gate-store"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useJournalStore } from "@/stores/journal-store"
import { MAIN_OUTPUT_ID, defaultNdiSettings } from "@/types"

/**
 * Live-safety contracts (ADR 0001, issue #246 C01/C02): what an operator does in the
 * Designer or in rehearsal never reaches the congregation unless they deliberately send it.
 */
const verse = (v: number): Verse => ({ id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "", chapter: 3, verse: v, text: `text ${v}` })
const sentTo = (label: string) => emitTo.mock.calls.filter((c) => c[0] === label).map((c) => c[2] as { verse: { reference: string } | null; theme: { id: string; name: string } })

beforeEach(() => {
  mockInvoke.mockReset()
  emitTo.mockClear()
  mockInvoke.mockImplementation(async (cmd: string, a: Record<string, number>) => (cmd === "get_verse" ? verse(a.verse) : null))
  useBibleStore.setState({ selectedVerse: null, selectedSlide: null, activeTranslationId: 1, secondaryTranslationId: null, overrideServiceTranslations: false, translations: [{ id: 1, abbreviation: "KJV", title: "", language: "en", is_copyrighted: false, is_downloaded: true }] })
  const themes = useBroadcastStore.getState().themes
  useBroadcastStore.setState({
    isLive: false, liveVerse: null, liveSourceVerse: null, liveItem: null, liveSlide: null, liveItemId: null, heldLive: null, cleared: false, presentWarning: null, rehearsal: false,
    editingThemeId: null, draftTheme: null, liveDesign: false,
    outputs: [{ id: MAIN_OUTPUT_ID, name: "Main", type: "display", themeId: themes[0]?.id ?? "", monitorIndex: 0, ndi: defaultNdiSettings() }],
  })
  useJournalStore.setState({ entries: [] })
  useApprovalGateStore.setState({ held: null })
})

describe("rehearsal is isolated from the real program (C02)", () => {
  it("leaving rehearsal puts back exactly what was on air; nothing rehearsed reaches the outputs or the log", async () => {
    await presentVerse(verse(16), { goLive: true })
    useBroadcastStore.getState().setRehearsal(true)
    await presentVerse(verse(17), { goLive: true })
    presentActions.quickScreen("stand")
    emitTo.mockClear()
    leaveRehearsal()
    const b = useBroadcastStore.getState()
    expect(b.rehearsal).toBe(false)
    expect(b.isLive).toBe(true)
    expect(b.liveVerse?.reference).toContain("3:16")
    expect(b.heldLive).toBeNull()
    expect(sentTo("broadcast-main").map((p) => p.verse?.reference)).toEqual([expect.stringContaining("3:16")])
    expect(useJournalStore.getState().entries.map((e) => e.kind)).toEqual(["live", "rehearsal", "rehearsal"])
  })

  it("off air before rehearsal stays off air after it, Restore still offering what was cleared", async () => {
    await presentVerse(verse(16), { goLive: true })
    presentActions.clear()
    useBroadcastStore.getState().setRehearsal(true)
    await presentVerse(verse(18), { goLive: true })
    leaveRehearsal()
    const b = useBroadcastStore.getState()
    expect(b.isLive).toBe(false)
    expect(b.cleared).toBe(true)
    expect(b.liveVerse?.reference).toContain("3:16")
  })

  it("showing the rehearsal result is a deliberate action, and it is what the congregation then sees", async () => {
    await presentVerse(verse(16), { goLive: true })
    useBroadcastStore.getState().setRehearsal(true)
    await presentVerse(verse(17), { goLive: true })
    emitTo.mockClear()
    showRehearsalLive()
    expect(useBroadcastStore.getState().rehearsal).toBe(false)
    expect(sentTo("broadcast-main").at(-1)?.verse?.reference).toContain("3:17")
  })
})

describe("Designer drafts stay off the screens (C01)", () => {
  it("editing a theme an output uses changes no output until Live edit is turned on", () => {
    const b = useBroadcastStore.getState()
    const themeId = b.outputs[0].themeId
    b.setLiveVerse({ reference: "John 3:16", segments: [{ text: "For God so loved" }] }, null, { goLive: true })
    b.startEditing(themeId)
    emitTo.mockClear()
    useBroadcastStore.getState().updateDraft({ name: "Draft in progress" })
    useBroadcastStore.getState().updateDraftNested("verseText.fontSize", 99)
    expect(sentTo("broadcast-main")).toEqual([])
    useBroadcastStore.getState().setLiveDesign(true)
    expect(sentTo("broadcast-main").at(-1)?.theme.name).toBe("Draft in progress")
    emitTo.mockClear()
    useBroadcastStore.getState().setLiveDesign(false)
    expect(sentTo("broadcast-main").at(-1)?.theme.name).not.toBe("Draft in progress")
  })

  it("Live edit ends with the Designer: the next edit session starts safe again", () => {
    const b = useBroadcastStore.getState()
    b.startEditing(b.outputs[0].themeId)
    b.setLiveDesign(true)
    useBroadcastStore.getState().stopEditing()
    expect(useBroadcastStore.getState().liveDesign).toBe(false)
  })
})
