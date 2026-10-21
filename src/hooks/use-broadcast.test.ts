import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Verse } from "@/types"
import { cancelPendingPresents, presentVerse, toDualVerseRenderData } from "./use-broadcast"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"

const mockInvoke = vi.fn()

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))

const sampleVerse: Verse = {
  id: 1,
  translation_id: 1,
  book_number: 1,
  book_name: "Genesis",
  book_abbreviation: "Gen",
  chapter: 1,
  verse: 2,
  text: "The earth was without form and void.",
}

describe("presentVerse", () => {
  const staleVerse: Verse = {
    id: 0,
    translation_id: 1,
    book_number: 43,
    book_name: "John",
    book_abbreviation: "",
    chapter: 3,
    verse: 16,
    text: "",
  }

  beforeEach(() => {
    mockInvoke.mockReset()
    useBibleStore.setState({
      selectedVerse: null,
      activeTranslationId: 2,
      secondaryTranslationId: null,
      translations: [
        {
          id: 2,
          abbreviation: "NKJV",
          title: "New King James Version",
          language: "en",
          is_copyrighted: true,
          is_downloaded: true,
        },
      ],
    })
    useBroadcastStore.setState({ liveVerse: null, liveSourceVerse: null, liveItem: null, presentWarning: null, isLive: false })
  })

  it("presents the refetched verse text, not the stale queue text", async () => {
    const fullVerse: Verse = {
      ...staleVerse,
      id: 26137,
      translation_id: 2,
      book_abbreviation: "Jn",
      text: "For God so loved the world",
    }
    mockInvoke.mockResolvedValue(fullVerse)

    await presentVerse(staleVerse)

    expect(useBibleStore.getState().selectedVerse?.text).toBe(
      "For God so loved the world"
    )
    const liveVerse = useBroadcastStore.getState().liveVerse
    expect(liveVerse?.reference).toBe("John 3:16 (NKJV)")
    expect(liveVerse?.segments[0].text).toBe("For God so loved the world")
  })

  it("follow mode: keeps the preview, does not cancel a present still loading, gives way to a newer one", async () => {
    const onAir: Verse = { ...staleVerse, text: "old" }
    const preview: Verse = { ...staleVerse, verse: 17, text: "browsing" }
    useBroadcastStore.setState({ liveSourceVerse: onAir })
    useBibleStore.setState({ selectedVerse: preview })
    mockInvoke.mockResolvedValue({ ...onAir, translation_id: 2, text: "For God so loved the world" })
    expect(await presentVerse(onAir, { follow: true })).toBe("presented")
    expect(useBibleStore.getState().selectedVerse).toBe(preview)
    expect(useBroadcastStore.getState().liveVerse?.segments[0].text).toBe("For God so loved the world")

    // Something else reaches the screen while the follow is loading: the follow gives way.
    const source = useBroadcastStore.getState().liveSourceVerse as Verse
    let release: (v: unknown) => void = () => {}
    mockInvoke.mockImplementation(() => new Promise((r) => { release = r }))
    const following = presentVerse(source, { follow: true })
    useBroadcastStore.setState({ liveSourceVerse: { ...staleVerse, verse: 18, text: "newer" } })
    release({ ...source, text: "late" })
    expect(await following).toBe("superseded")
  })

  it("looks up by book/chapter/verse against the active translation", async () => {
    mockInvoke.mockResolvedValue(null)

    await presentVerse(staleVerse)

    expect(mockInvoke).toHaveBeenCalledWith("get_verse", {
      translationId: 2, // active translation, not staleVerse.translation_id
      bookNumber: 43,
      chapter: 3,
      verse: 16,
    })
  })

  it("falls back to the passed verse when the lookup returns null", async () => {
    mockInvoke.mockResolvedValue(null)

    await presentVerse(sampleVerse)

    expect(useBibleStore.getState().selectedVerse).toEqual(sampleVerse)
    expect(useBroadcastStore.getState().liveVerse?.segments[0].text).toBe(
      sampleVerse.text
    )
  })

  it("falls back to the passed verse when the lookup rejects", async () => {
    mockInvoke.mockRejectedValue(new Error("db unavailable"))

    await expect(presentVerse(sampleVerse)).resolves.toBe("presented")

    expect(useBibleStore.getState().selectedVerse).toEqual(sampleVerse)
    expect(useBroadcastStore.getState().liveVerse?.segments[0].text).toBe(
      sampleVerse.text
    )
  })

  it("records the presented verse as the live source verse", async () => {
    const fullVerse: Verse = {
      ...staleVerse,
      id: 26137,
      translation_id: 2,
      text: "For God so loved the world",
    }
    mockInvoke.mockResolvedValue(fullVerse)

    await presentVerse(staleVerse)

    expect(useBroadcastStore.getState().liveSourceVerse).toEqual(fullVerse)
  })

  it("presents the active and secondary translations together", async () => {
    const english: Verse = {
      ...staleVerse,
      id: 26137,
      translation_id: 2,
      text: "For God so loved the world",
    }
    const yoruba: Verse = {
      ...staleVerse,
      id: 76137,
      translation_id: 3,
      text: "Nitori Ọlọrun fẹ́ràn ayé",
    }
    useBibleStore.setState({
      secondaryTranslationId: 3,
      translations: [
        {
          id: 2,
          abbreviation: "NKJV",
          title: "New King James Version",
          language: "en",
          is_copyrighted: true,
          is_downloaded: true,
        },
        {
          id: 3,
          abbreviation: "OYCB",
          title: "Yorùbá Bible",
          language: "yo",
          is_copyrighted: false,
          is_downloaded: true,
        },
      ],
    })
    mockInvoke.mockImplementation(
      (command: unknown, args: { translationId?: number }) => {
        if (command !== "get_verse") return Promise.resolve(undefined)
        return Promise.resolve(args.translationId === 2 ? english : yoruba)
      }
    )

    await presentVerse(staleVerse)

    expect(useBroadcastStore.getState().liveVerse).toMatchObject({
      reference: "John 3:16",
      segments: [{ text: "For God so loved the world" }],
      translationLines: [
        "For God so loved the world",
        "Nitori Ọlọrun fẹ́ràn ayé",
      ],
    })
  })

  it("refuses to present a verse with empty text (issue #141)", async () => {
    // Refetch finds nothing and the cached verse has no text (e.g. a cited
    // verse that doesn't exist) — the live output must not change.
    mockInvoke.mockResolvedValue(null)

    await presentVerse(staleVerse)

    expect(useBroadcastStore.getState().liveVerse).toBeNull()
    expect(useBroadcastStore.getState().liveSourceVerse).toBeNull()
  })

  it("refuses to replace the live verse with an empty one", async () => {
    const fullVerse: Verse = {
      ...staleVerse,
      id: 26137,
      translation_id: 2,
      text: "For God so loved the world",
    }
    // Route by command — mark() also calls invoke ("ui_mark"), so Once
    // queues would be consumed by instrumentation.
    let lookups = 0
    mockInvoke.mockImplementation((cmd: unknown) => {
      if (cmd !== "get_verse") return Promise.resolve(undefined)
      lookups += 1
      return Promise.resolve(lookups === 1 ? fullVerse : null)
    })

    await presentVerse(staleVerse)
    await presentVerse({ ...sampleVerse, text: "" })

    expect(useBroadcastStore.getState().liveVerse?.reference).toBe(
      "John 3:16 (NKJV)"
    )
  })

  it("ignores a stale refetch that resolves after a newer present call", async () => {
    const older: Verse = { ...sampleVerse, verse: 1, text: "In the beginning" }
    let resolveOlder: (v: Verse) => void = () => {}
    mockInvoke
      .mockImplementationOnce(
        () => new Promise<Verse>((resolve) => (resolveOlder = resolve))
      )
      .mockResolvedValueOnce(sampleVerse)

    const first = presentVerse(older)
    await presentVerse(sampleVerse)
    resolveOlder(older)
    await first

    expect(useBroadcastStore.getState().liveVerse?.reference).toBe(
      "Genesis 1:2 (NKJV)"
    )
  })
})

describe("presentVerse translation policy", () => {
  const yoruba = { id: 7, abbreviation: "OYCB", title: "", language: "yo", is_copyrighted: false, is_downloaded: true }
  const kjv = { id: 1, abbreviation: "KJV", title: "", language: "en", is_copyrighted: false, is_downloaded: true }
  const byTranslation = (text: Record<number, string>) =>
    mockInvoke.mockImplementation((cmd: unknown, args?: { translationId: number }) =>
      cmd === "get_verse" && args
        ? Promise.resolve(text[args.translationId] ? { ...sampleVerse, translation_id: args.translationId, text: text[args.translationId] } : null)
        : Promise.resolve(undefined)
    )

  beforeEach(() => {
    mockInvoke.mockReset()
    useBibleStore.setState({ activeTranslationId: 2, secondaryTranslationId: null, overrideServiceTranslations: false, translations: [kjv, { ...kjv, id: 2, abbreviation: "NKJV" }, yoruba] })
    useBroadcastStore.setState({ liveVerse: null, liveSourceVerse: null, liveItem: null, presentWarning: null, isLive: false })
  })

  it("a rundown item saved for OYCB goes live in OYCB even though NKJV is active", async () => {
    byTranslation({ 2: "English", 7: "Yorùbá" })
    expect(await presentVerse(sampleVerse, { item: { translation: "OYCB", secondary_translation: null } })).toBe("presented")
    expect(mockInvoke).toHaveBeenCalledWith("get_verse", expect.objectContaining({ translationId: 7 }))
    expect(mockInvoke).not.toHaveBeenCalledWith("get_verse", expect.objectContaining({ translationId: 2 }))
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("Genesis 1:2 (OYCB)")
    expect(useBroadcastStore.getState().liveItem).toEqual({ translation: "OYCB", secondary_translation: null })
  })

  it("a bilingual item presents both of its saved translations", async () => {
    byTranslation({ 1: "English", 7: "Yorùbá" })
    await presentVerse(sampleVerse, { item: { translation: "OYCB", secondary_translation: "KJV" } })
    expect(useBroadcastStore.getState().liveVerse?.translationLines).toEqual(["Yorùbá", "English"])
  })

  it("a spontaneous verse (no item) follows the active translations", async () => {
    useBibleStore.setState({ secondaryTranslationId: 7 })
    byTranslation({ 2: "English", 7: "Yorùbá" })
    await presentVerse(sampleVerse)
    expect(useBroadcastStore.getState().liveVerse?.translationLines).toEqual(["English", "Yorùbá"])
  })

  it("a missing translation is reported and the live output is untouched", async () => {
    byTranslation({ 2: "English" })
    await presentVerse(sampleVerse)
    const before = useBroadcastStore.getState().liveVerse
    expect(await presentVerse({ ...sampleVerse, verse: 3 }, { item: { translation: "NIV", secondary_translation: null }, goLive: true })).toBe("missing_translation")
    const s = useBroadcastStore.getState()
    expect(s.liveVerse).toBe(before)
    expect(s.presentWarning).toMatch(/Genesis 1:3 not shown.*NIV.*not installed/)
    expect(mockInvoke).not.toHaveBeenCalledWith("get_verse", expect.objectContaining({ verse: 3 }))
  })

  it("the operator override shows the item in the active translation and clears the warning on success", async () => {
    byTranslation({ 2: "English" })
    useBroadcastStore.setState({ presentWarning: "old" })
    useBibleStore.setState({ overrideServiceTranslations: true })
    expect(await presentVerse(sampleVerse, { item: { translation: "NIV", secondary_translation: null } })).toBe("presented")
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("Genesis 1:2 (NKJV)")
    expect(useBroadcastStore.getState().presentWarning).toBeNull()
  })
})

describe("presentVerse atomic go-live", () => {
  function deferredLookup() {
    let resolve: (v: Verse | null) => void = () => {}
    let reject: (e: unknown) => void = () => {}
    mockInvoke.mockImplementation((cmd: unknown) =>
      cmd === "get_verse" ? new Promise<Verse | null>((res, rej) => { resolve = res; reject = rej }) : Promise.resolve(undefined)
    )
    return { resolve: (v: Verse | null) => resolve(v), reject: (e: unknown) => reject(e) }
  }

  beforeEach(() => {
    mockInvoke.mockReset()
    useBibleStore.setState({ activeTranslationId: 2, secondaryTranslationId: null, overrideServiceTranslations: false })
    useBroadcastStore.setState({ liveVerse: null, liveSourceVerse: null, liveItem: null, presentWarning: null, isLive: false })
  })

  it("stays off air until the verse has arrived, then goes on air with it in one step", async () => {
    const lookup = deferredLookup()
    const p = presentVerse(sampleVerse, { goLive: true })
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(useBroadcastStore.getState().liveVerse).toBeNull()
    lookup.resolve({ ...sampleVerse, text: "arrived" })
    expect(await p).toBe("presented")
    const s = useBroadcastStore.getState()
    expect(s.isLive).toBe(true)
    expect(s.liveVerse?.segments[0].text).toBe("arrived")
  })

  it("a cleared screen stays cleared when the lookup finds nothing", async () => {
    mockInvoke.mockResolvedValue({ ...sampleVerse, text: "old" })
    await presentVerse(sampleVerse, { goLive: true })
    useBroadcastStore.getState().setLive(false) // Clear
    mockInvoke.mockResolvedValue(null)
    expect(await presentVerse({ ...sampleVerse, verse: 9, text: "" }, { goLive: true })).toBe("empty")
    const s = useBroadcastStore.getState()
    expect(s.isLive).toBe(false)
    expect(s.liveVerse?.segments[0].text).toBe("old") // Restore still has the last good verse
    expect(s.presentWarning).toMatch(/Genesis 1:9 not shown/)
  })

  it("a cleared screen stays cleared when the lookup rejects and the passed verse is empty", async () => {
    mockInvoke.mockResolvedValue({ ...sampleVerse, text: "old" })
    await presentVerse(sampleVerse, { goLive: true })
    useBroadcastStore.getState().setLive(false)
    const lookup = deferredLookup()
    const p = presentVerse({ ...sampleVerse, verse: 9, text: "" }, { goLive: true })
    lookup.reject(new Error("db unavailable"))
    expect(await p).toBe("empty")
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })

  it("Clear while a present is loading wins: the late verse never appears", async () => {
    const lookup = deferredLookup()
    const p = presentVerse(sampleVerse, { goLive: true })
    cancelPendingPresents()
    useBroadcastStore.getState().setLive(false)
    lookup.resolve({ ...sampleVerse, text: "late" })
    expect(await p).toBe("superseded")
    const s = useBroadcastStore.getState()
    expect(s.isLive).toBe(false)
    expect(s.liveVerse).toBeNull()
  })

  it("a slow older Next cannot overtake a newer one, on air or not", async () => {
    let calls = 0
    const pending: Array<(v: Verse | null) => void> = []
    mockInvoke.mockImplementation((cmd: unknown) =>
      cmd === "get_verse" ? new Promise<Verse | null>((res) => { calls += 1; pending.push(res) }) : Promise.resolve(undefined)
    )
    const first = presentVerse({ ...sampleVerse, verse: 1 }, { goLive: true })
    const second = presentVerse({ ...sampleVerse, verse: 2 }, { goLive: true })
    expect(calls).toBe(2)
    pending[1]({ ...sampleVerse, verse: 2, text: "two" })
    expect(await second).toBe("presented")
    pending[0]({ ...sampleVerse, verse: 1, text: "one" })
    expect(await first).toBe("superseded")
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("Genesis 1:2 (NKJV)")
    expect(useBroadcastStore.getState().isLive).toBe(true)
  })
})

describe("toDualVerseRenderData", () => {
  it("keeps two translations on the same scripture reference", () => {
    const english = { ...sampleVerse, text: "In the beginning" }
    const yoruba = { ...sampleVerse, text: "Ni atetekọṣe" }

    const rendered = toDualVerseRenderData([
      { verse: english, translation: "KJV" },
      { verse: yoruba, translation: "OYCB" },
    ])

    expect(rendered.reference).toBe("Genesis 1:2")
    expect(rendered.segments).toEqual([{ text: "In the beginning" }])
    expect(rendered.translationLines).toEqual([
      "In the beginning",
      "Ni atetekọṣe",
    ])
  })
})
