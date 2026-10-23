import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Verse, VerseRenderData } from "@/types"

const mockInvoke = vi.fn()
const emitTo = vi.fn().mockResolvedValue(undefined)
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: (...args: unknown[]) => emitTo(...args) }))

import { presentVerse } from "@/hooks/use-broadcast"
import { presentActions } from "./present-actions"
import { leaveRehearsal } from "@/stores/approval-gate-store"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { MAIN_OUTPUT_ID, defaultNdiSettings } from "@/types"

/**
 * Independent live sources (ADR 0001, LS-002): a Bible verse activated once reaches every feed that
 * follows Bible; a hymn or song going live does not replace it there; the ticker, Black and
 * rehearsal keep their own rules; outputs that follow nothing in particular behave as before.
 */
const verse = (b: number, c: number, v: number, name = "Romans"): Verse => ({ id: 0, translation_id: 1, book_number: b, book_name: name, book_abbreviation: "", chapter: c, verse: v, text: `text ${c}:${v}` })
const hymn: VerseRenderData = { kind: "lyric", content: "hymn", reference: "Amazing Grace · Verse 1", segments: [], lines: ["Amazing grace, how sweet the sound"] }
const song: VerseRenderData = { kind: "lyric", content: "song", reference: "Way Maker · Chorus", segments: [], lines: ["Way maker, miracle worker"] }
const last = (label: string) => emitTo.mock.calls.filter((c) => c[0] === label).map((c) => c[2] as { verse: VerseRenderData | null; theme: { id: string }; ticker?: unknown }).at(-1)

let themes: { id: string }[]
beforeEach(() => {
  mockInvoke.mockReset()
  emitTo.mockClear()
  mockInvoke.mockImplementation(async (cmd: string, a: Record<string, number>) => (cmd === "get_verse" ? verse(a.bookNumber, a.chapter, a.verse) : null))
  useBibleStore.setState({ selectedVerse: null, selectedSlide: null, activeTranslationId: 1, secondaryTranslationId: null, overrideServiceTranslations: false, translations: [{ id: 1, abbreviation: "KJV", title: "", language: "en", is_copyrighted: false, is_downloaded: true }] })
  themes = useBroadcastStore.getState().themes
  useBroadcastStore.setState({
    isLive: false, liveVerse: null, liveSourceVerse: null, liveItem: null, liveSlide: null, liveItemId: null, heldLive: null, cleared: false, presentWarning: null, rehearsal: false, rehearsalReturn: null,
    sources: {}, ticker: null, tickerItems: ["Prayer meeting Wednesday 6:30 PM"],
    outputs: [
      { id: MAIN_OUTPUT_ID, name: "Main", type: "display", themeId: themes[0].id, monitorIndex: 0, ndi: defaultNdiSettings() },
      { id: "bible-full", name: "Rhema Bible | Fullscreen", type: "ndi", themeId: themes[0].id, monitorIndex: 0, ndi: defaultNdiSettings("Rhema Bible | Fullscreen"), shows: ["bible"] },
      { id: "bible-l3", name: "Rhema Bible | Lower Third", type: "ndi", themeId: themes[0].id, themeFor: { bible: themes[1].id }, monitorIndex: 0, ndi: defaultNdiSettings("Rhema Bible | Lower Third"), shows: ["bible"], ticker: true },
      { id: "lyrics", name: "Rhema Lyrics", type: "ndi", themeId: themes[0].id, monitorIndex: 0, ndi: defaultNdiSettings("Rhema Lyrics"), shows: ["song", "hymn"] },
    ],
  })
})

describe("independent live sources (LS-002)", () => {
  it("Romans 8:28 activated once reaches both Bible feeds, each in its own look; a hymn then leaves them alone", async () => {
    await presentVerse(verse(45, 8, 28), { goLive: true })
    expect(last("broadcast-bible-full")?.verse?.reference).toContain("8:28")
    expect(last("broadcast-bible-l3")?.verse?.reference).toContain("8:28")
    expect(last("broadcast-bible-l3")?.theme.id).toBe(themes[1].id)
    expect(last("broadcast-lyrics")?.verse ?? null).toBeNull()
    useBroadcastStore.getState().setLiveVerse(hymn, null, { goLive: true })
    expect(last("broadcast-main")?.verse?.reference).toBe("Amazing Grace · Verse 1")
    expect(last("broadcast-lyrics")?.verse?.reference).toBe("Amazing Grace · Verse 1")
    expect(last("broadcast-bible-full")?.verse?.reference).toContain("8:28")
    expect(last("broadcast-bible-l3")?.verse?.reference).toContain("8:28")
    const s = useBroadcastStore.getState().sources
    expect(s.bible?.on && s.hymn?.on).toBe(true)
    expect(s.hymn!.revision).toBeGreaterThan(s.bible!.revision)
  })

  it("songs and hymns stay distinct sources; the lyrics feed follows whichever is newer", () => {
    const b = useBroadcastStore.getState()
    b.setLiveVerse(hymn, null, { goLive: true })
    b.setLiveVerse(song, null, { goLive: true })
    const s = useBroadcastStore.getState().sources
    expect(s.hymn?.value.reference).toBe("Amazing Grace · Verse 1")
    expect(s.song?.value.reference).toBe("Way Maker · Chorus")
    expect(last("broadcast-lyrics")?.verse?.reference).toBe("Way Maker · Chorus")
  })

  it("Clear takes off only what the main screen shows; Restore brings it back; the Bible feeds never blink", async () => {
    await presentVerse(verse(45, 8, 28), { goLive: true })
    useBroadcastStore.getState().setLiveVerse(hymn, null, { goLive: true })
    emitTo.mockClear()
    presentActions.clear()
    expect(last("broadcast-main")?.verse ?? null).toBeNull()
    expect(last("broadcast-lyrics")?.verse ?? null).toBeNull()
    expect(emitTo.mock.calls.filter((c) => c[0] === "broadcast-bible-full" && (c[2] as { verse: unknown }).verse === null)).toEqual([])
    presentActions.restore()
    expect(last("broadcast-lyrics")?.verse?.reference).toBe("Amazing Grace · Verse 1")
    expect(useBroadcastStore.getState().sources.bible?.on).toBe(true)
  })

  it("a source can be cleared and restored on its own without touching the main screen", async () => {
    await presentVerse(verse(45, 8, 28), { goLive: true })
    useBroadcastStore.getState().setLiveVerse(hymn, null, { goLive: true })
    useBroadcastStore.getState().clearSource("bible")
    expect(last("broadcast-bible-full")?.verse ?? null).toBeNull()
    expect(useBroadcastStore.getState().isLive).toBe(true)
    expect(last("broadcast-main")?.verse?.reference).toBe("Amazing Grace · Verse 1")
    useBroadcastStore.getState().restoreSource("bible")
    expect(last("broadcast-bible-full")?.verse?.reference).toContain("8:28")
  })

  it("Next verse updates the Bible source and every Bible feed", async () => {
    await presentVerse(verse(45, 8, 28), { goLive: true })
    const rev = useBroadcastStore.getState().sources.bible!.revision
    await presentVerse(verse(45, 8, 29), { goLive: true })
    expect(useBroadcastStore.getState().sources.bible!.revision).toBeGreaterThan(rev)
    expect(last("broadcast-bible-l3")?.verse?.reference).toContain("8:29")
  })

  it("the ticker runs on its own: a verse or hymn change keeps it on the feeds that show it", async () => {
    useBroadcastStore.getState().setTicker({ backing: null })
    await presentVerse(verse(45, 8, 28), { goLive: true })
    useBroadcastStore.getState().setLiveVerse(hymn, null, { goLive: true })
    expect(last("broadcast-bible-l3")?.ticker).toBeTruthy()
    expect(useBroadcastStore.getState().ticker).not.toBeNull()
  })

  it("Black covers every public feed; Back returns each to its own source", async () => {
    await presentVerse(verse(45, 8, 28), { goLive: true })
    useBroadcastStore.getState().setLiveVerse(hymn, null, { goLive: true })
    presentActions.quickScreen("black")
    for (const id of ["main", "bible-full", "bible-l3", "lyrics"]) expect(last(`broadcast-${id}`)?.verse?.screen).toBe("black")
    presentActions.back()
    expect(last("broadcast-bible-full")?.verse?.reference).toContain("8:28")
    expect(last("broadcast-lyrics")?.verse?.reference).toBe("Amazing Grace · Verse 1")
  })

  it("a welcome screen goes only to feeds that follow everything; Bible feeds keep their verse", async () => {
    await presentVerse(verse(45, 8, 28), { goLive: true })
    presentActions.quickScreen("welcome")
    expect(last("broadcast-main")?.verse?.quick).toBe(true)
    expect(last("broadcast-bible-full")?.verse?.reference).toContain("8:28")
  })

  it("rehearsal never changes a source; leaving it leaves every feed as it was", async () => {
    await presentVerse(verse(45, 8, 28), { goLive: true })
    useBroadcastStore.getState().setRehearsal(true)
    await presentVerse(verse(43, 3, 16, "John"), { goLive: true })
    useBroadcastStore.getState().setLiveVerse(hymn, null, { goLive: true })
    expect(useBroadcastStore.getState().sources.bible?.value.reference).toContain("8:28")
    expect(useBroadcastStore.getState().sources.hymn).toBeUndefined()
    emitTo.mockClear()
    leaveRehearsal()
    expect(last("broadcast-bible-full")?.verse?.reference).toContain("8:28")
  })

  it("a Bible verse heard while a hymn is up changes only the Bible source (Auto, C11)", async () => {
    useBroadcastStore.getState().setLiveVerse(hymn, null, { goLive: true })
    await presentVerse(verse(45, 8, 28), { sourceOnly: true })
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("Amazing Grace · Verse 1")
    expect(last("broadcast-main")?.verse?.reference).toBe("Amazing Grace · Verse 1")
    expect(last("broadcast-bible-full")?.verse?.reference).toContain("8:28")
  })

  it("an output that follows nothing in particular behaves exactly as before: the latest wins", async () => {
    await presentVerse(verse(45, 8, 28), { goLive: true })
    expect(last("broadcast-main")?.verse?.reference).toContain("8:28")
    useBroadcastStore.getState().setLiveVerse(hymn, null, { goLive: true })
    expect(last("broadcast-main")?.verse?.reference).toBe("Amazing Grace · Verse 1")
  })
})
