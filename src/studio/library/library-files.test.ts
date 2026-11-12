import { beforeEach, describe, expect, it, vi } from "vitest"

const mockInvoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null), save: vi.fn(async () => null) }))
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: vi.fn(), writeTextFile: vi.fn() }))

import type { ReusableSlide } from "@/types"
import { applyLibraryFile, buildLibraryFile, matchCollectionItem, newSlides, parseLibraryFile, resolveBackground, LIBRARY_FILE_FORMAT, type LibraryFile, type LibraryIndex } from "@/studio/library/library-files"

const slide = (over: Partial<ReusableSlide>): ReusableSlide => ({
  id: "s1", kind: "slide", title: "Welcome", body: "We're glad you're here", link: null, background_media_id: "pic-1", revision: 3, created_at: "", updated_at: "", ...over,
})
const media = [{ id: "pic-1", name: "Cross.png" }]

beforeEach(() => mockInvoke.mockReset())

describe("library file: slides and collections (#853 G9)", () => {
  it("exports slides with their background by id and name, and collection items with id, title and detail", () => {
    const file = buildLibraryFile(
      [slide({}), slide({ id: "s2", kind: "announcement", title: "Harvest", body: "Friday 6 pm", link: "https://church.example/harvest", background_media_id: null })],
      [{ name: "Harvest", items: [{ kind: "song", item_id: "song-1", title: "Come, ye thankful people", detail: "hymn" }, { kind: "slide", item_id: "s2", title: "Harvest" }, { kind: "media", item_id: "gone", title: null }] }],
      media,
      new Date("2026-11-11T10:00:00Z"),
    )
    expect(file).toEqual({
      format: LIBRARY_FILE_FORMAT,
      version: 1,
      exported_at: "2026-11-11T10:00:00.000Z",
      slides: [
        { kind: "slide", title: "Welcome", body: "We're glad you're here", link: null, background: { id: "pic-1", name: "Cross.png" } },
        { kind: "announcement", title: "Harvest", body: "Friday 6 pm", link: "https://church.example/harvest", background: null },
      ],
      // The missing item has nothing to be found by on another computer, so it is left out.
      collections: [{ name: "Harvest", items: [{ kind: "song", id: "song-1", title: "Come, ye thankful people", detail: "hymn" }, { kind: "slide", id: "s2", title: "Harvest" }] }],
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
      slides: [{ kind: "slide", title: "Ok", body: "", background: { id: 3 } }, { kind: "video", title: "No", body: "" }, null, { kind: "slide", title: 3, body: "" }],
      collections: [{ name: "  ", items: [] }, { name: "Easter", items: [{ kind: "program", title: "x" }, { kind: "song", title: "" }, { kind: "song", title: "Christ the Lord is risen today" }] }],
    }))
    expect(parsed.slides).toEqual([{ kind: "slide", title: "Ok", body: "", link: null, background: null }])
    expect(parsed.collections).toEqual([{ name: "Easter", items: [{ kind: "song", title: "Christ the Lord is risen today" }] }])
  })

  it("imports only slides this library does not have yet; the background is part of being the same", () => {
    const file = parseLibraryFile(JSON.stringify(buildLibraryFile([slide({}), slide({ id: "s2", title: "Offering", body: "Give", background_media_id: null }), slide({ id: "s3", title: "Offering", body: "Give", background_media_id: null })], [], media)))
    // Same words here but without the background: still new.
    expect(newSlides(file, [slide({ id: "here", background_media_id: null })], media).map((s) => s.title)).toEqual(["Welcome", "Offering"])
    // Same words and the same background (by name, even under another id): already here.
    expect(newSlides(file, [slide({ id: "here", background_media_id: "pic-9" })], [{ id: "pic-9", name: "cross.PNG" }]).map((s) => s.title)).toEqual(["Offering"])
  })

  it("keeps a slide's background by id, else by its one matching name, and says when it cannot", () => {
    expect(resolveBackground({ id: "pic-1", name: "Cross.png" }, media)).toEqual({ id: "pic-1", note: null })
    expect(resolveBackground({ id: "elsewhere", name: "cross.png" }, media)).toEqual({ id: "pic-1", note: null })
    expect(resolveBackground({ id: "elsewhere", name: "Dove.png" }, media).note).toMatch(/not on this computer/)
    expect(resolveBackground({ id: "elsewhere", name: "Cross.png" }, [...media, { id: "pic-2", name: "Cross.png" }])).toMatchObject({ id: null, note: expect.stringMatching(/More than one/) })
  })

  it("matches a collection item by id first, then by title narrowed by detail, and reports ambiguity", () => {
    const index: LibraryIndex = {
      song: [{ id: "song-9", title: "Amazing  Grace", detail: "song" }, { id: "hymn-9", title: "Amazing Grace", detail: "hymn" }, { id: "x1", title: "Abide with me", detail: "hymn" }, { id: "x2", title: "Abide With Me", detail: "hymn" }],
      slide: [],
      media: [{ id: "m1", title: "Cross.png", detail: "image" }],
      design: [],
    }
    expect(matchCollectionItem({ kind: "song", id: "hymn-9", title: "Something renamed" }, index)).toEqual({ id: "hymn-9", note: null })
    expect(matchCollectionItem({ kind: "song", title: "amazing grace", detail: "hymn" }, index)).toEqual({ id: "hymn-9", note: null })
    expect(matchCollectionItem({ kind: "media", title: "cross.PNG" }, index)).toEqual({ id: "m1", note: null })
    expect(matchCollectionItem({ kind: "slide", title: "Amazing Grace" }, index)).toEqual({ id: null, note: null })
    expect(matchCollectionItem({ kind: "song", title: "Abide with me", detail: "hymn" }, index)).toMatchObject({ id: null, note: expect.stringMatching(/2 items here match/) })
  })
})

describe("library file import keeps going and says what it wrote (#853 G9)", () => {
  it("a collection or item that fails is noted, and everything else is still imported", async () => {
    const file: LibraryFile = {
      format: LIBRARY_FILE_FORMAT, version: 1, exported_at: "",
      slides: [{ kind: "slide", title: "Welcome", body: "Hello", link: null, background: null }],
      collections: [
        { name: "Broken", items: [{ kind: "song", title: "Amazing Grace" }] },
        { name: "Christmas", items: [{ kind: "song", title: "Amazing Grace" }, { kind: "song", title: "Silent Night" }, { kind: "song", title: "Not here" }] },
      ],
    }
    const songs = [{ id: "g", title: "Amazing Grace", numbers: [] }, { id: "s", title: "Silent Night", numbers: [] }]
    mockInvoke.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
      switch (command) {
        case "content_list_reusable_slides": return []
        case "media_list": return []
        case "design_list": return []
        case "content_list_songs": return songs
        case "content_create_reusable_slide": return { id: "new" }
        case "content_list_collections": return []
        case "content_create_collection":
          if (args.name === "Broken") throw { kind: "invalid", message: "name refused" }
          return { id: "c-christmas", name: args.name, item_count: 0, created_at: "", updated_at: "" }
        case "content_add_to_collection":
          if (args.itemId === "s") throw { kind: "not_found", message: "song s" }
          return { summary: {}, items: [] }
        default: return null // store set-up calls unrelated to the import
      }
    })
    const outcome = await applyLibraryFile(file)
    expect(outcome).toMatchObject({ slidesAdded: 1, slidesSkipped: 0, collectionsAdded: 1, itemsLinked: 1 })
    expect(outcome.notes).toEqual([
      "Collection “Broken” was not added: name refused",
      "“Silent Night” was not placed in Christmas: song s",
      "“Not here” (song) in Christmas is not in this library.",
    ])
  })
})
