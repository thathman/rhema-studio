import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ProgramWithItems, SlideQueueItem, Verse, VerseQueueItem } from "@/types"

const mockInvoke = vi.fn()

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))

import { presentActions } from "./present-actions"
import { remoteActions } from "@/lib/remote-actions"
import { presentCustomSlide, presentVerse, toCustomSlideRenderData } from "@/hooks/use-broadcast"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { rundownSignature, toItemInputs, toQueueItems } from "@/stores/service-store"

const verse = (book_number: number, chapter: number, v: number, text = "text"): Verse => ({
  id: 0, translation_id: 1, book_number, book_name: `Book${book_number}`, book_abbreviation: "", chapter, verse: v, text,
})
const verseItem = (v: Verse): VerseQueueItem => ({
  id: crypto.randomUUID(), verse: v, reference: `${v.book_name} ${v.chapter}:${v.verse}`, confidence: 1, source: "manual", added_at: 0,
})
const slide = (title: string, body: string, id = "slide-1"): SlideQueueItem => ({
  id, kind: "slide", slide: { title, body }, reference: title || body.split("\n")[0], confidence: 1, source: "manual", added_at: 0, notes: null,
})
const flush = () => new Promise((r) => setTimeout(r, 0))
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

beforeEach(() => {
  mockInvoke.mockReset()
  mockInvoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) =>
    cmd === "get_verse" ? verse(args.bookNumber as number, args.chapter as number, args.verse as number) : null
  )
  useBibleStore.setState({
    selectedVerse: null, selectedSlide: null, activeTranslationId: 1, secondaryTranslationId: null, overrideServiceTranslations: false,
    translations: [{ id: 1, abbreviation: "KJV", title: "", language: "en", is_copyrighted: false, is_downloaded: true }],
  })
  useBroadcastStore.setState({ isLive: false, liveVerse: null, liveSourceVerse: null, liveItem: null, liveSlide: null, liveItemId: null, presentWarning: null })
  useQueueStore.setState({ items: [], activeIndex: null })
})

describe("custom slides", () => {
  it("render as a title plus hard lines, and refuse an empty slide", () => {
    const data = toCustomSlideRenderData(slide("Welcome", "We're glad you're here.\r\n\r\nPlease silence your phone.  "))
    expect(data).toMatchObject({ kind: "slide", reference: "Welcome", lines: ["We're glad you're here.", "Please silence your phone."] })
    expect(presentCustomSlide(slide("", "   "), { goLive: true })).toBe("empty")
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(useBroadcastStore.getState().presentWarning).toContain("Empty slide")
  })

  it("go on air in one step, and a verse that was still loading cannot overtake them", async () => {
    const d = deferred<Verse>()
    mockInvoke.mockImplementation((cmd: string) => (cmd === "get_verse" ? d.promise : Promise.resolve(null)))
    const pending = presentVerse(verse(43, 3, 16), { goLive: true })
    expect(presentCustomSlide(slide("Please stand", ""), { goLive: true })).toBe("presented")
    const s = useBroadcastStore.getState()
    expect(s.isLive).toBe(true)
    expect(s.liveVerse?.reference).toBe("Please stand")
    expect(s.liveItemId).toBe("slide-1")
    expect(s.liveSlide).toBeNull()
    d.resolve(verse(43, 3, 16))
    expect(await pending).toBe("superseded")
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("Please stand")
  })

  it("step between verses and slides with Next/Previous, highlight by item id, and preview/show live", async () => {
    const items = [verseItem(verse(19, 23, 1)), slide("Welcome", "Hello", "s-a"), slide("Welcome", "Different text", "s-b"), verseItem(verse(43, 3, 16))]
    useQueueStore.setState({ items })
    presentActions.next()
    await flush()
    presentActions.next()
    await flush()
    expect(useBroadcastStore.getState().liveItemId).toBe("s-a")
    remoteActions.queueNext()
    await flush()
    // Two slides with the same title: the item id, not the title, decides where Next goes from.
    expect(useBroadcastStore.getState().liveItemId).toBe("s-b")
    expect(useBroadcastStore.getState().liveVerse?.lines).toEqual(["Different text"])
    presentActions.next()
    await flush()
    expect(useBroadcastStore.getState().liveItemId).toBe(items[3].id)
    expect(useBroadcastStore.getState().liveVerse?.reference).toContain("Book43 3:16")
    presentActions.prev()
    await flush()
    expect(useBroadcastStore.getState().liveItemId).toBe("s-b")

    // Preview then Show live, and a verse selection clears the slide preview.
    presentActions.clear()
    presentActions.previewItem(items[1])
    expect(useBibleStore.getState().selectedSlide?.item.id).toBe("s-a")
    expect(useBroadcastStore.getState().isLive).toBe(false)
    presentActions.showLive()
    await flush()
    expect(useBroadcastStore.getState().isLive).toBe(true)
    expect(useBroadcastStore.getState().liveItemId).toBe("s-a")
    expect(useQueueStore.getState().activeIndex).toBe(1)
    useBibleStore.getState().selectVerse(verse(19, 23, 1))
    expect(useBibleStore.getState().selectedSlide).toBeNull()
  })

  it("save and reopen through the service store; a broken payload is set aside", () => {
    const item = slide("Offering", "Give as the Lord leads.", "s-1")
    const out = toItemInputs([item])
    expect(out[0]).toMatchObject({ kind: "slide", reference: "Offering", payload: JSON.stringify({ title: "Offering", body: "Give as the Lord leads." }) })
    const data: ProgramWithItems = {
      program: { id: "p1", title: "Sunday", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 2 },
      items: [
        { id: "s-1", program_id: "p1", position: 0, kind: "slide", reference: "Offering", book_number: null, chapter: null, verse: null, translation: null, secondary_translation: null, notes: "slow", payload: out[0].payload ?? null },
        { id: "bad", program_id: "p1", position: 1, kind: "slide", reference: "?", book_number: null, chapter: null, verse: null, translation: null, secondary_translation: null, notes: null, payload: "{}" },
      ],
    }
    const { items, unsupported } = toQueueItems(data, 1, [])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: "slide", slide: { title: "Offering", body: "Give as the Lord leads." }, notes: "slow" })
    expect(unsupported.map((u) => u.id)).toEqual(["bad"])
    expect(rundownSignature([item])).not.toBe(rundownSignature([{ ...item, slide: { ...item.slide, body: "changed" } }]))
  })
})
