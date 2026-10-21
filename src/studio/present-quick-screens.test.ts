import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Verse } from "@/types"

const mockInvoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn().mockResolvedValue(undefined) }))

import { presentActions } from "./present-actions"
import { presentQuickScreen, presentVerse } from "@/hooks/use-broadcast"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"

const verse = (b: number, c: number, v: number): Verse => ({ id: 0, translation_id: 1, book_number: b, book_name: `Book${b}`, book_abbreviation: "", chapter: c, verse: v, text: "text" })
const item = (v: Verse) => ({ id: crypto.randomUUID(), verse: v, reference: `${v.book_name} ${v.chapter}:${v.verse}`, confidence: 1, source: "manual" as const, added_at: 0 })
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  mockInvoke.mockReset()
  mockInvoke.mockImplementation(async (cmd: string, a: Record<string, number>) => (cmd === "get_verse" ? verse(a.bookNumber, a.chapter, a.verse) : null))
  useBibleStore.setState({ selectedVerse: null, selectedSlide: null, activeTranslationId: 1, secondaryTranslationId: null, overrideServiceTranslations: false, translations: [{ id: 1, abbreviation: "KJV", title: "", language: "en", is_copyrighted: false, is_downloaded: true }] })
  useBroadcastStore.setState({ isLive: false, liveVerse: null, liveSourceVerse: null, liveItem: null, liveSlide: null, liveItemId: null, heldLive: null, presentWarning: null })
  useQueueStore.setState({ items: [], activeIndex: null })
})

describe("quick screens", () => {
  it("go on air at once and Back returns to the held verse", async () => {
    await presentVerse(verse(43, 3, 16), { goLive: true, itemId: "it-1" })
    presentActions.quickScreen("stand")
    const s = useBroadcastStore.getState()
    expect(s.isLive).toBe(true)
    expect(s.liveVerse).toMatchObject({ kind: "slide", lines: ["Please stand"] })
    expect(s.liveItemId).toBeNull()
    expect(presentActions.canGoBack()).toBe(true)
    presentActions.quickScreen("pray") // one hold, even across several quick screens
    expect(useBroadcastStore.getState().liveVerse?.lines).toEqual(["Let us pray"])
    presentActions.back()
    const back = useBroadcastStore.getState()
    expect(back.isLive).toBe(true)
    expect(back.liveVerse?.reference).toContain("Book43 3:16")
    expect(back.liveItemId).toBe("it-1")
    expect(back.heldLive).toBeNull()
    expect(presentActions.canGoBack()).toBe(false)
  })

  it("Back after a quick screen over a cleared output goes back to off air with the content kept", async () => {
    await presentVerse(verse(43, 3, 16), { goLive: true })
    presentActions.clear()
    presentActions.quickScreen("welcome")
    expect(useBroadcastStore.getState().isLive).toBe(true)
    presentActions.back()
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(useBroadcastStore.getState().liveVerse?.reference).toContain("Book43 3:16")
    expect(presentActions.canRestore()).toBe(true)
  })

  it("moving on with Next drops the hold; a quick screen with nothing live has nothing to go back to", async () => {
    useQueueStore.setState({ items: [item(verse(19, 23, 1))] })
    presentActions.quickScreen("offering")
    expect(presentActions.canGoBack()).toBe(false)
    presentActions.next()
    await flush()
    expect(useBroadcastStore.getState().liveVerse?.reference).toContain("Book19 23:1")
    presentActions.quickScreen("stand")
    expect(presentActions.canGoBack()).toBe(true)
    presentActions.next()
    await flush()
    expect(useBroadcastStore.getState().heldLive).toBeNull()
    expect(presentActions.canGoBack()).toBe(false)
  })

  it("a verse that was loading when the quick screen went up cannot overtake it", async () => {
    let resolve!: (v: Verse) => void
    mockInvoke.mockImplementation((cmd: string) => (cmd === "get_verse" ? new Promise<Verse>((r) => { resolve = r }) : Promise.resolve(null)))
    const pending = presentVerse(verse(43, 3, 16), { goLive: true })
    presentActions.quickScreen("pray")
    resolve(verse(43, 3, 16))
    expect(await pending).toBe("superseded")
    expect(useBroadcastStore.getState().liveVerse?.lines).toEqual(["Let us pray"])
  })
})

describe("bilingual quick screens", () => {
  it("adds the Yorùbá line when a Yorùbá Bible is active or secondary, and not otherwise", () => {
    useBibleStore.setState({
      activeTranslationId: 1, secondaryTranslationId: null,
      translations: [
        { id: 1, abbreviation: "KJV", title: "", language: "en", is_copyrighted: false, is_downloaded: true },
        { id: 7, abbreviation: "OYCB", title: "", language: "yo", is_copyrighted: false, is_downloaded: true },
      ],
    })
    presentActions.quickScreen("stand")
    expect(useBroadcastStore.getState().liveVerse?.secondaryLines).toBeUndefined()
    useBibleStore.setState({ secondaryTranslationId: 7 })
    presentActions.quickScreen("stand")
    expect(useBroadcastStore.getState().liveVerse?.secondaryLines).toEqual(["Ẹ jọ̀wọ́ ẹ dìde"])
    useBibleStore.setState({ activeTranslationId: 7, secondaryTranslationId: null })
    presentActions.quickScreen("welcome")
    expect(useBroadcastStore.getState().liveVerse).toMatchObject({ reference: "Welcome", lines: ["We're glad you're here."], secondaryLines: ["Ẹ kú àbọ̀. Inú wa dùn pé ẹ wá."] })
  })

  it("black, logo and technical-issue screens go on air at once and Back returns", async () => {
    await presentVerse(verse(43, 3, 16), { goLive: true })
    presentQuickScreen("black")
    expect(useBroadcastStore.getState().liveVerse).toMatchObject({ screen: "black", lines: [] })
    expect(useBroadcastStore.getState().isLive).toBe(true)
    presentQuickScreen("logo")
    expect(useBroadcastStore.getState().liveVerse?.screen).toBe("logo")
    presentQuickScreen("technical")
    expect(useBroadcastStore.getState().liveVerse?.lines).toEqual(["We're having technical difficulties", "Please bear with us"])
    presentActions.back()
    expect(useBroadcastStore.getState().liveVerse?.reference).toContain("3:16")
  })
})
