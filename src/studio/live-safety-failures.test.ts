/**
 * QA-002: what the live output does when things fail underneath it. The
 * rule is "what is on air stays on air": a failed lookup, a missing file or
 * a dead output window may show a warning, never a blank or stale frame.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ImageQueueItem, SongQueueItem, SongWithSections, Verse } from "@/types"

const mockInvoke = vi.fn()
const mockEmitTo = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: (...args: unknown[]) => mockEmitTo(...args) }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }))
const mockReadFile = vi.fn()
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: (...args: unknown[]) => mockReadFile(...args) }))

import { presentActions } from "./present-actions"
import { presentImage, presentSlide, presentVerse } from "@/hooks/use-broadcast"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useMediaStore } from "@/stores/media-store"
import { useQueueStore } from "@/stores/queue-store"
import { useSongStore } from "@/stores/song-store"

const verse = (b: number, c: number, v: number): Verse => ({ id: 0, translation_id: 1, book_number: b, book_name: `Book${b}`, book_abbreviation: "", chapter: c, verse: v, text: "text" })
const amazing: SongWithSections = {
  song: { id: "song-1", title: "Amazing Grace", authors: "", copyright: "", ccli_number: null, licence: "public_domain", licence_note: "", primary_language: "en", tags: "", notes: "", key: "", tempo: null, revision: 1, created_at: "", updated_at: "" },
  sections: [{ id: "v1", kind: "verse", label: "Verse 1", texts: { en: "Amazing grace" } }],
  arrangements: [{ id: "a1", name: "Default", sequence: ["v1"], is_default: true }],
  numbers: [],
}
const songItem: SongQueueItem = { id: "item-song", kind: "song", song: { song_id: "song-1", title: "Amazing Grace", arrangement_id: null, languages: ["en"] }, reference: "Amazing Grace", confidence: 1, source: "manual", added_at: 0 }
const picture: ImageQueueItem = { id: "img-1", kind: "image", image: { media_id: "m-1", name: "Welcome", fit: "cover" }, reference: "Welcome", confidence: 1, source: "manual", added_at: 0, notes: null }
const asset = { id: "m-1", kind: "image" as const, name: "Welcome", file: "m-1.png", hash: "a".repeat(64), size: 4, mime: "image/png", width: null, height: null, duration_ms: null, source: "local", source_ref: "", original_path: "", created_at: "", path: "/media/m-1.png", present: true }

beforeEach(() => {
  mockInvoke.mockReset()
  mockEmitTo.mockReset().mockResolvedValue(undefined)
  mockReadFile.mockReset().mockResolvedValue(new Uint8Array([137, 80, 78, 71]))
  mockInvoke.mockImplementation(async (cmd: string, a: Record<string, unknown>) => {
    if (cmd === "get_verse") return verse(a.bookNumber as number, a.chapter as number, a.verse as number)
    if (cmd === "content_get_song") return amazing
    if (cmd === "media_list") return [asset]
    return null
  })
  useBibleStore.setState({ selectedVerse: null, selectedSlide: null, activeTranslationId: 1, secondaryTranslationId: null, overrideServiceTranslations: false, translations: [{ id: 1, abbreviation: "KJV", title: "", language: "en", is_copyrighted: false, is_downloaded: true }] })
  useBroadcastStore.setState({ isLive: false, liveVerse: null, liveSourceVerse: null, liveItem: null, liveSlide: null, liveItemId: null, heldLive: null, presentWarning: null, rehearsal: false })
  useQueueStore.setState({ items: [], activeIndex: null })
  useSongStore.setState({ songs: {}, missing: [] })
  useMediaStore.setState({ assets: [], urls: {} })
})

const live = () => useBroadcastStore.getState()

describe("live output under injected failures", () => {
  it("keeps the verse on air when the next song cannot be loaded (backend error)", async () => {
    expect(await presentVerse(verse(43, 3, 16), { goLive: true })).toBe("presented")
    mockInvoke.mockImplementation(async (cmd: string) => { if (cmd === "content_get_song") throw new Error("database is locked"); return null })
    expect(await presentSlide(songItem, 0, { goLive: true })).toBe("empty")
    expect(live().isLive).toBe(true)
    expect(live().liveVerse?.reference).toContain("Book43 3:16")
    expect(live().presentWarning).toContain("Amazing Grace not shown")
  })

  it("keeps the verse on air when a picture file cannot be read", async () => {
    await presentVerse(verse(19, 23, 1), { goLive: true })
    mockReadFile.mockRejectedValue(new Error("ENOENT"))
    expect(await presentImage(picture, { goLive: true })).toBe("empty")
    expect(live().isLive).toBe(true)
    expect(live().liveVerse?.reference).toContain("Book19 23:1")
    expect(live().presentWarning).toContain("Welcome not shown")
  })

  it("stays cleared when a presentation fails after Clear (no accidental reactivation)", async () => {
    await presentVerse(verse(43, 3, 16), { goLive: true })
    presentActions.clear()
    expect(live().isLive).toBe(false)
    mockInvoke.mockImplementation(async () => { throw new Error("backend gone") })
    expect(await presentSlide(songItem, 0, { goLive: true })).toBe("empty")
    expect(live().isLive).toBe(false)
    // Restore still brings back the last good content, by the operator's choice only.
    presentActions.restore()
    expect(live().isLive).toBe(true)
    expect(live().liveVerse?.reference).toContain("Book43 3:16")
  })

  it("still goes live with the verse it was given when the Bible lookup fails, and survives a dead output window", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => { if (cmd === "get_verse") throw new Error("db unavailable"); return null })
    mockEmitTo.mockRejectedValue(new Error("window not found"))
    expect(await presentVerse(verse(43, 3, 16), { goLive: true })).toBe("presented")
    expect(live().isLive).toBe(true)
    expect(live().liveVerse?.segments[0]?.text).toBe("text")
    expect(mockEmitTo).toHaveBeenCalled()
    await new Promise((r) => setTimeout(r, 0))
    // A later successful present after the window is back is unaffected.
    mockEmitTo.mockResolvedValue(undefined)
    expect(await presentVerse(verse(19, 23, 1), { goLive: true })).toBe("presented")
    expect(live().liveVerse?.reference).toContain("Book19 23:1")
  })

  it("keeps the show running when the content database fails during a save", async () => {
    const { useServiceStore } = await import("@/stores/service-store")
    await presentVerse(verse(43, 3, 16), { goLive: true })
    useQueueStore.setState({ items: [{ id: "q1", verse: verse(43, 3, 16), reference: "John 3:16", confidence: 1, source: "manual", added_at: 0 }, { id: "q2", verse: verse(43, 3, 17), reference: "John 3:17", confidence: 1, source: "manual", added_at: 0 }], activeIndex: 0 })
    useServiceStore.setState({ current: { id: "p1", title: "Sunday", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 2 }, dirty: true, saving: false, unsupportedItems: [] } as never)
    mockInvoke.mockImplementation(async (cmd: string, a: Record<string, unknown>) => {
      if (cmd.startsWith("content_")) throw { kind: "database", message: "disk I/O error" }
      if (cmd === "get_verse") return verse(a.bookNumber as number, a.chapter as number, a.verse as number)
      return null
    })
    expect(await useServiceStore.getState().saveCurrent()).toBe("failed")
    expect(live().isLive).toBe(true)
    expect(live().liveVerse?.reference).toContain("3:16")
    presentActions.next()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    expect(live().liveVerse?.reference).toContain("3:17")
  })

  it("keeps the verse on air when the media library cannot be listed", async () => {
    await presentVerse(verse(43, 3, 16), { goLive: true })
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "media_list") throw { kind: "unavailable", message: "content database unavailable" }
      return null
    })
    const outcome = await presentImage(picture, { goLive: true }).catch(() => "threw")
    expect(outcome).not.toBe("presented")
    expect(live().isLive).toBe(true)
    expect(live().liveVerse?.reference).toContain("3:16")
  })

  it("keeps the screens as they are when a sound cannot play", async () => {
    const { useSoundStore } = await import("@/stores/sound-store")
    await presentVerse(verse(43, 3, 16), { goLive: true })
    class FailingAudio {
      loop = false
      volume = 1
      addEventListener() {}
      play() { return Promise.reject(new Error("NotSupportedError")) }
      pause() {}
      removeAttribute() {}
      load() {}
    }
    vi.stubGlobal("Audio", FailingAudio)
    useMediaStore.setState({ fileUrl: async () => "asset://x.mp3" } as never)
    await useSoundStore.getState().play({ id: "s1", name: "Broken" })
    vi.unstubAllGlobals()
    expect(useSoundStore.getState()).toMatchObject({ playing: false })
    expect(useSoundStore.getState().error).toContain("could not play")
    expect(live().liveVerse?.reference).toContain("3:16")
    expect(live().isLive).toBe(true)
  })
})
