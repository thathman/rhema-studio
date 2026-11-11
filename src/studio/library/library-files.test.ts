import { describe, expect, it } from "vitest"
import type { ReusableSlide } from "@/types"
import { buildLibraryFile, matchCollectionItem, newSlides, parseLibraryFile, LIBRARY_FILE_FORMAT, type LibraryIndex } from "@/studio/library/library-files"

const slide = (over: Partial<ReusableSlide>): ReusableSlide => ({
  id: "s1", kind: "slide", title: "Welcome", body: "We're glad you're here", link: null, background_media_id: "pic-1", revision: 3, created_at: "", updated_at: "", ...over,
})

describe("library file: slides and collections (#853 G9)", () => {
  it("exports slides without their local ids or background files, and collections by item title", () => {
    const file = buildLibraryFile(
      [slide({}), slide({ id: "s2", kind: "announcement", title: "Harvest", body: "Friday 6 pm", link: "https://church.example/harvest" })],
      [{ name: "Harvest", items: [{ kind: "song", title: "Come, ye thankful people" }, { kind: "slide", title: "Harvest" }, { kind: "media", title: null }] }],
      new Date("2026-11-11T10:00:00Z"),
    )
    expect(file).toEqual({
      format: LIBRARY_FILE_FORMAT,
      version: 1,
      exported_at: "2026-11-11T10:00:00.000Z",
      slides: [
        { kind: "slide", title: "Welcome", body: "We're glad you're here", link: null },
        { kind: "announcement", title: "Harvest", body: "Friday 6 pm", link: "https://church.example/harvest" },
      ],
      // The missing item has nothing to be found by on another computer, so it is left out.
      collections: [{ name: "Harvest", items: [{ kind: "song", title: "Come, ye thankful people" }, { kind: "slide", title: "Harvest" }] }],
    })
    expect(parseLibraryFile(JSON.stringify(file))).toEqual(file)
  })

  it("refuses a file that is not a library file before anything changes", () => {
    expect(() => parseLibraryFile("not json")).toThrow(/not JSON/)
    expect(() => parseLibraryFile(JSON.stringify({ version: 1, songs: [] }))).toThrow(/not a Rhema Studio library file/)
    expect(() => parseLibraryFile(JSON.stringify({ format: LIBRARY_FILE_FORMAT, version: 2, slides: [], collections: [] }))).toThrow()
  })

  it("drops malformed rows and items of unknown kinds", () => {
    const parsed = parseLibraryFile(JSON.stringify({
      format: LIBRARY_FILE_FORMAT, version: 1, exported_at: "x",
      slides: [{ kind: "slide", title: "Ok", body: "" }, { kind: "video", title: "No", body: "" }, null, { kind: "slide", title: 3, body: "" }],
      collections: [{ name: "  ", items: [] }, { name: "Easter", items: [{ kind: "program", title: "x" }, { kind: "song", title: "" }, { kind: "song", title: "Christ the Lord is risen today" }] }],
    }))
    expect(parsed.slides).toEqual([{ kind: "slide", title: "Ok", body: "", link: null }])
    expect(parsed.collections).toEqual([{ name: "Easter", items: [{ kind: "song", title: "Christ the Lord is risen today" }] }])
  })

  it("imports only slides this library does not have yet", () => {
    const file = parseLibraryFile(JSON.stringify(buildLibraryFile([slide({}), slide({ id: "s2", title: "Offering", body: "Give" }), slide({ id: "s3", title: "Offering", body: "Give" })], [])))
    expect(newSlides(file, [slide({ id: "here", background_media_id: null })])).toEqual([{ kind: "slide", title: "Offering", body: "Give", link: null }])
  })

  it("finds a collection item again by title, ignoring case and spacing", () => {
    const index: LibraryIndex = { song: [{ id: "song-9", title: "Amazing  Grace" }], slide: [], media: [{ id: "m1", title: "Cross.png" }], design: [] }
    expect(matchCollectionItem({ kind: "song", title: "amazing grace" }, index)).toBe("song-9")
    expect(matchCollectionItem({ kind: "media", title: "cross.PNG" }, index)).toBe("m1")
    expect(matchCollectionItem({ kind: "slide", title: "Amazing Grace" }, index)).toBeNull()
  })
})
