import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ImageQueueItem, ProgramWithItems, Verse } from "@/types"

const mockInvoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }))
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: vi.fn(async () => new Uint8Array([137, 80, 78, 71])) }))

import { presentActions } from "./present-actions"
import { presentImage, presentVerse } from "@/hooks/use-broadcast"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useMediaStore } from "@/stores/media-store"
import { useQueueStore } from "@/stores/queue-store"
import { rundownSignature, toItemInputs, toQueueItems } from "@/stores/service-store"

const verse = (b: number, c: number, v: number): Verse => ({ id: 0, translation_id: 1, book_number: b, book_name: `Book${b}`, book_abbreviation: "", chapter: c, verse: v, text: "text" })
const picture = (id = "img-1", media_id = "m-1"): ImageQueueItem => ({ id, kind: "image", image: { media_id, name: "Welcome", fit: "cover" }, reference: "Welcome", confidence: 1, source: "manual", added_at: 0, notes: null })
const asset = (id: string, present = true) => ({ id, kind: "image" as const, name: "Welcome", file: `${id}.png`, hash: "a".repeat(64), size: 4, mime: "image/png", width: null, height: null, duration_ms: null, source: "local", source_ref: "", original_path: "", created_at: "", path: `/media/${id}.png`, present })
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  mockInvoke.mockReset()
  mockInvoke.mockImplementation(async (cmd: string, a: Record<string, number>) => {
    if (cmd === "get_verse") return verse(a.bookNumber, a.chapter, a.verse)
    if (cmd === "media_list") return [asset("m-1"), asset("m-gone", false)]
    return null
  })
  useBibleStore.setState({ selectedVerse: null, selectedSlide: null, activeTranslationId: 1, secondaryTranslationId: null, overrideServiceTranslations: false, translations: [{ id: 1, abbreviation: "KJV", title: "", language: "en", is_copyrighted: false, is_downloaded: true }] })
  useBroadcastStore.setState({ isLive: false, liveVerse: null, liveSourceVerse: null, liveItem: null, liveSlide: null, liveItemId: null, heldLive: null, presentWarning: null })
  useQueueStore.setState({ items: [], activeIndex: null })
  useMediaStore.setState({ assets: [], urls: {} })
})

describe("picture items", () => {
  it("present as a full-frame image once the file is read, on air in one step, and the data URL is cached", async () => {
    expect(await presentImage(picture(), { goLive: true })).toBe("presented")
    const s = useBroadcastStore.getState()
    expect(s.isLive).toBe(true)
    expect(s.liveVerse).toMatchObject({ kind: "image", reference: "", image: { fit: "cover" } })
    expect(s.liveVerse?.image?.url.startsWith("data:image/png;base64,")).toBe(true)
    expect(s.liveItemId).toBe("img-1")
    expect(useMediaStore.getState().urls["m-1"]).toBeDefined()
  })

  it("a missing file is reported and the output left alone", async () => {
    await presentVerse(verse(43, 3, 16), { goLive: true })
    expect(await presentImage(picture("img-2", "m-gone"), { goLive: true })).toBe("empty")
    expect(useBroadcastStore.getState().liveVerse?.reference).toContain("Book43 3:16")
    expect(useBroadcastStore.getState().presentWarning).toContain("missing")
  })

  it("Clear while the picture is loading wins", async () => {
    let release!: () => void
    const { readFile } = await import("@tauri-apps/plugin-fs")
    ;(readFile as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise<Uint8Array>((r) => { release = () => r(new Uint8Array([1])) }))
    const p = presentImage(picture(), { goLive: true })
    await flush()
    presentActions.clear()
    release()
    expect(await p).toBe("superseded")
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(useBroadcastStore.getState().liveVerse).toBeNull()
  })

  it("step onto a picture from the rundown and preview it with Show live", async () => {
    useQueueStore.setState({ items: [picture()] })
    presentActions.next()
    await flush()
    await flush()
    expect(useBroadcastStore.getState().liveItemId).toBe("img-1")
    presentActions.clear()
    presentActions.previewItem(picture())
    expect(useBibleStore.getState().selectedSlide?.item.kind).toBe("image")
    presentActions.showLive()
    await flush()
    await flush()
    expect(useBroadcastStore.getState().isLive).toBe(true)
    expect(useBroadcastStore.getState().liveVerse?.kind).toBe("image")
  })

  it("save and reopen through the service store", () => {
    const out = toItemInputs([picture()])
    expect(out[0]).toMatchObject({ kind: "image", reference: "Welcome", payload: JSON.stringify({ media_id: "m-1", fit: "cover" }) })
    const data: ProgramWithItems = {
      program: { id: "p1", title: "Sunday", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 2 },
      items: [
        { id: "img-1", program_id: "p1", position: 0, kind: "image", reference: "Welcome", book_number: null, chapter: null, verse: null, translation: null, secondary_translation: null, notes: null, payload: out[0].payload ?? null },
        { id: "bad", program_id: "p1", position: 1, kind: "image", reference: "?", book_number: null, chapter: null, verse: null, translation: null, secondary_translation: null, notes: null, payload: "{}" },
      ],
    }
    const { items, corrupt } = toQueueItems(data, 1, [])
    expect(items[0]).toMatchObject({ kind: "image", image: { media_id: "m-1", name: "Welcome", fit: "cover" } })
    expect(corrupt.map((u) => u.id)).toEqual(["bad"])
    expect(rundownSignature([picture()])).not.toBe(rundownSignature([{ ...picture(), image: { ...picture().image, fit: "contain" as const } }]))
  })
})

describe("background pictures behind text", () => {
  it("a verse item with a background goes live with the picture under the words, and round-trips", async () => {
    const item = { id: "v-bg", verse: verse(43, 3, 16), reference: "Book43 3:16", confidence: 1, source: "manual" as const, added_at: 0, background: { media_id: "m-1", name: "Welcome" } }
    await presentVerse(item.verse, { goLive: true, itemId: item.id, background: item.background })
    const live = useBroadcastStore.getState().liveVerse
    expect(live?.reference).toContain("Book43 3:16")
    expect(live?.image?.url.startsWith("data:image/png")).toBe(true)
    // Missing picture: the words still show, without a background.
    await presentVerse(item.verse, { goLive: true, background: { media_id: "m-gone" } })
    expect(useBroadcastStore.getState().liveVerse?.image).toBeUndefined()
    expect(useBroadcastStore.getState().liveVerse?.reference).toContain("Book43 3:16")

    const out = toItemInputs([item])
    expect(out[0].payload).toBe(JSON.stringify({ background_media_id: "m-1" }))
    const data: ProgramWithItems = {
      program: { id: "p1", title: "Sunday", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 1 },
      items: [{ id: "v-bg", program_id: "p1", position: 0, kind: "verse", reference: "Book43 3:16", book_number: 43, chapter: 3, verse: 16, translation: null, secondary_translation: null, notes: null, payload: out[0].payload ?? null }],
    }
    const { items } = toQueueItems(data, 1, [])
    expect(items[0].background).toEqual({ media_id: "m-1", name: "" })
    expect(rundownSignature(items)).not.toBe(rundownSignature([{ ...items[0], background: null }]))
  })
})
