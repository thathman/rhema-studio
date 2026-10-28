// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { invoke } from "./browser-shim"

/** The dev browser shim answers list commands with lists: a null crashed the page that asked. */
describe("browser shim", () => {
  it("returns Psalm 23:1 text for Psalm 23:1", async () => {
    await expect(invoke("get_verse", { translationId: 1, bookNumber: 19, chapter: 23, verse: 1 })).resolves.toMatchObject({
      book_name: "Psalms",
      chapter: 23,
      verse: 1,
      text: "The LORD is my shepherd; I shall not want.",
    })
  })

  it("keeps the seeded John 3:16 text attached to John 3:16", async () => {
    await expect(invoke("get_verse", { translationId: 1, bookNumber: 43, chapter: 3, verse: 16 })).resolves.toMatchObject({
      book_name: "John",
      chapter: 3,
      verse: 16,
      text: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
    })
  })

  it("searches matching seeded verse text instead of returning John 3:16 for every query", async () => {
    await expect(invoke("search_verses", { query: "the LORD is my shepherd", translationId: 1, limit: 20 })).resolves.toMatchObject([
      { book_name: "Psalms", chapter: 23, verse: 1, text: "The LORD is my shepherd; I shall not want." },
    ])
  })

  it("returns no unrelated Bible result when the query misses the seeded verses", async () => {
    await expect(invoke("search_verses", { query: "a phrase absent from the sample verses", translationId: 1, limit: 20 })).resolves.toEqual([])
  })

  it("marks unseeded KJV text as synthetic", async () => {
    await expect(invoke("get_verse", { translationId: 1, bookNumber: 19, chapter: 23, verse: 2 })).resolves.toMatchObject({
      text: "[Sample KJV text for Psalms 23:2]",
    })
  })

  it("marks Yoruba text as synthetic instead of inventing translation wording", async () => {
    await expect(invoke("get_verse", { translationId: 7, bookNumber: 19, chapter: 23, verse: 1 })).resolves.toMatchObject({
      text: "[Sample OYCB text for Psalms 23:1]",
    })
  })

  it("lists come back as lists (ai drafts in Prepare, audio devices in Settings)", async () => {
    expect(await invoke("ai_drafts_list")).toEqual([])
    expect(await invoke("get_audio_devices")).toEqual([])
    expect(await invoke("content_remove_old_log_transcripts", { days: 30 })).toBe(0)
  })
})
