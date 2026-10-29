// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

const mockInvoke = vi.fn()
const mockStoreSet = vi.fn(async (...args: unknown[]) => {
  void args
})
const mockStoreSave = vi.fn(async () => {})
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))
vi.mock("@tauri-apps/plugin-store", () => ({
  load: async () => ({
    set: (...args: unknown[]) => mockStoreSet(...args),
    save: () => mockStoreSave(),
  }),
}))
vi.mock("@/studio/prepare/song-library", () => ({ SongLibrary: () => null }))
vi.mock("@/studio/prepare/hymn-book", () => ({ HymnBook: () => null }))
vi.mock("@/studio/prepare/media-library", () => ({ MediaLibrary: () => null }))
vi.mock("@/studio/library/library-blocks", () => ({ SongFiles: () => null }))
vi.mock("@/studio/library/slide-library", () => ({ SlideLibrary: () => null }))

import { LibraryWorkspace } from "./library-workspace"
import { useShellStore } from "@/studio/shell-store"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"

const john = {
  id: 1,
  translation_id: 4,
  book_number: 43,
  name: "John",
  abbreviation: "Jn",
  testament: "NT" as const,
}
const bibleVerse = {
  id: 12,
  translation_id: 4,
  book_number: 43,
  book_name: "John",
  book_abbreviation: "Jn",
  chapter: 3,
  verse: 16,
  text: "For God so loved the world.",
}

let root: Root | null = null

beforeEach(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  mockInvoke.mockReset()
  mockInvoke.mockImplementation(async (command: string) =>
    command === "get_verse" ? bibleVerse : []
  )
  mockStoreSet.mockReset()
  mockStoreSave.mockReset()
  useShellStore.setState({ workspace: "library", librarySection: "songs" })
  useBibleStore.setState({
    translations: [
      {
        id: 4,
        abbreviation: "KJV",
        title: "King James Version",
        language: "en",
        is_copyrighted: false,
        is_downloaded: true,
      },
    ],
    activeTranslationId: 4,
    secondaryTranslationId: null,
    books: [john],
    savedPassages: [],
  })
  useQueueStore.setState({
    items: [],
    headers: [],
    activeIndex: null,
    addTarget: null,
  })
  useBroadcastStore.setState({
    isLive: true,
    liveVerse: {
      reference: "Psalm 23:1",
      segments: [{ text: "Existing program content" }],
    },
  })
  root = createRoot(document.body.appendChild(document.createElement("div")))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

describe("Library workspace", () => {
  it("offers saved Bible passages as a first-class Library section", async () => {
    await act(async () => {
      root!.render(<LibraryWorkspace />)
    })
    const tab = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ].find((button) => button.textContent === "Bible")
    expect(tab).toBeDefined()
    await act(async () => {
      tab!.click()
    })

    expect(tab?.getAttribute("aria-selected")).toBe("true")
    expect(
      document.querySelector('[role="tabpanel"]')?.getAttribute("aria-label")
    ).toBe("Bible")
    expect(document.body.textContent).toContain("Saved passages")
  })

  it("saves a reference locally and uses it in Prepare without changing Live", async () => {
    const onAirBefore = useBroadcastStore.getState().liveVerse
    await act(async () => {
      root!.render(<LibraryWorkspace />)
    })
    const tab = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ].find((button) => button.textContent === "Bible")!
    await act(async () => {
      tab.click()
    })
    const reference = document.querySelector<HTMLInputElement>(
      '[aria-label="Scripture reference"]'
    )
    expect(reference).not.toBeNull()
    if (!reference) return
    const enterReference = (value: string) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(reference, value)
      reference.dispatchEvent(new Event("input", { bubbles: true }))
    }
    const find = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Find passage"))!
    await act(async () => {
      enterReference("John 3:16-18")
      find.click()
    })
    expect(document.body.textContent).toContain("This range was not shortened")
    expect(mockInvoke).not.toHaveBeenCalledWith("get_verse", expect.anything())

    await act(async () => {
      enterReference("John 3:16")
      find.click()
    })
    expect(document.body.textContent).toContain("For God so loved the world.")

    const save = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Save passage"))!
    await act(async () => {
      save.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(useBibleStore.getState().savedPassages).toHaveLength(1)
    expect(mockStoreSet).toHaveBeenCalledWith("savedPassages", [
      {
        id: "4:43:3:16",
        translationId: 4,
        bookNumber: 43,
        chapter: 3,
        verse: 16,
        reference: "John 3:16",
      },
    ])
    expect(document.body.textContent).toContain("John 3:16")

    const use = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Use in service"))!
    await act(async () => {
      use.click()
    })
    expect(useQueueStore.getState().items[0]).toMatchObject({
      source: "manual",
      reference: "John 3:16",
      verse: bibleVerse,
      translation: "KJV",
      secondary_translation: null,
    })
    expect(useBibleStore.getState().selectedQueueItemId).toBe(
      useQueueStore.getState().items[0].id
    )
    expect(useShellStore.getState().workspace).toBe("prepare")
    expect(useBroadcastStore.getState().liveVerse).toBe(onAirBefore)
    expect(useBroadcastStore.getState().isLive).toBe(true)
  })

  it("corrects a mismatched saved label and requires review before Use", async () => {
    useBibleStore.setState({
      savedPassages: [
        {
          id: "4:43:3:16",
          translationId: 4,
          bookNumber: 43,
          chapter: 3,
          verse: 16,
          reference: "Jude 3:16",
        },
      ],
    })
    await act(async () => {
      root!.render(<LibraryWorkspace />)
    })
    const tab = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ].find((button) => button.textContent === "Bible")!
    await act(async () => {
      tab.click()
    })
    const use = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Use in service"))!

    await act(async () => {
      use.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(useQueueStore.getState().items).toEqual([])
    expect(useBibleStore.getState().savedPassages[0].reference).toBe(
      "John 3:16"
    )
    expect(document.body.textContent).toContain(
      "corrected to John 3:16; review it before using it"
    )
    expect(useShellStore.getState().workspace).toBe("library")
  })

  it("does not use or rewrite a passage when the edition returns different coordinates", async () => {
    const saved = {
      id: "4:43:3:17",
      translationId: 4,
      bookNumber: 43,
      chapter: 3,
      verse: 17,
      reference: "John 3:17",
    }
    useBibleStore.setState({ savedPassages: [saved] })
    await act(async () => {
      root!.render(<LibraryWorkspace />)
    })
    const tab = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ].find((button) => button.textContent === "Bible")!
    await act(async () => {
      tab.click()
    })
    const use = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Use in service"))!

    await act(async () => {
      use.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(useQueueStore.getState().items).toEqual([])
    expect(useBibleStore.getState().savedPassages).toEqual([saved])
    expect(document.body.textContent).toContain(
      "could not be verified against its saved coordinates"
    )
    expect(useShellStore.getState().workspace).toBe("library")
  })

  it("shows the book name from the saved passage edition instead of its stored label", async () => {
    const otherEditionBook = { ...john, id: 2, translation_id: 5 }
    mockInvoke.mockImplementation(
      async (command: string, args?: { translationId?: number }) => {
        if (command === "get_verse") return bibleVerse
        if (command === "list_books" && args?.translationId === 5)
          return [otherEditionBook]
        return []
      }
    )
    useBibleStore.setState({
      translations: [
        {
          id: 4,
          abbreviation: "KJV",
          title: "King James Version",
          language: "en",
          is_copyrighted: false,
          is_downloaded: true,
        },
        {
          id: 5,
          abbreviation: "WEB",
          title: "World English Bible",
          language: "en",
          is_copyrighted: false,
          is_downloaded: true,
        },
      ],
      savedPassages: [
        {
          id: "5:43:3:16",
          translationId: 5,
          bookNumber: 43,
          chapter: 3,
          verse: 16,
          reference: "Jude 3:16",
        },
      ],
    })
    await act(async () => {
      root!.render(<LibraryWorkspace />)
    })
    const tab = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ].find((button) => button.textContent === "Bible")!
    await act(async () => {
      tab.click()
    })

    expect(mockInvoke).toHaveBeenCalledWith("list_books", { translationId: 5 })
    expect(document.body.textContent).toContain("John 3:16")
    expect(document.body.textContent).not.toContain("Jude 3:16")
    expect(
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent?.includes("Use in service")
      )?.disabled
    ).toBe(false)
  })

  it("reports a disk write failure instead of claiming the passage was saved", async () => {
    mockStoreSet.mockRejectedValue(new Error("disk full"))
    await act(async () => {
      root!.render(<LibraryWorkspace />)
    })
    const tab = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ].find((button) => button.textContent === "Bible")!
    await act(async () => {
      tab.click()
    })
    const reference = document.querySelector<HTMLInputElement>(
      '[aria-label="Scripture reference"]'
    )!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(reference, "John 3:16")
      reference.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const find = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Find passage"))!
    await act(async () => {
      find.click()
    })
    const save = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Save passage"))!
    await act(async () => {
      save.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(useBibleStore.getState().savedPassages).toEqual([])
    expect(document.body.textContent).toContain(
      "could not be saved to this computer"
    )
  })

  it("discards a lookup result if the selected Bible edition changes while it is loading", async () => {
    let releaseVerse!: (verse: typeof bibleVerse) => void
    mockInvoke.mockImplementation((command: string) =>
      command === "get_verse"
        ? new Promise<typeof bibleVerse>((resolve) => {
            releaseVerse = resolve
          })
        : Promise.resolve([])
    )
    useBibleStore.setState({
      translations: [
        {
          id: 4,
          abbreviation: "KJV",
          title: "King James Version",
          language: "en",
          is_copyrighted: false,
          is_downloaded: true,
        },
        {
          id: 5,
          abbreviation: "WEB",
          title: "World English Bible",
          language: "en",
          is_copyrighted: false,
          is_downloaded: true,
        },
      ],
    })
    await act(async () => {
      root!.render(<LibraryWorkspace />)
    })
    const tab = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ].find((button) => button.textContent === "Bible")!
    await act(async () => {
      tab.click()
    })
    const reference = document.querySelector<HTMLInputElement>(
      '[aria-label="Scripture reference"]'
    )!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(reference, "John 3:16")
      reference.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const find = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Find passage"))!
    await act(async () => {
      find.click()
    })
    expect(reference.disabled).toBe(true)
    expect(
      document.querySelector<HTMLSelectElement>('[aria-label="Bible edition"]')
        ?.disabled
    ).toBe(true)
    await act(async () => {
      useBibleStore.setState({ activeTranslationId: 5 })
    })
    await act(async () => {
      releaseVerse(bibleVerse)
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain(
      "edition or reference changed during lookup"
    )
    expect(
      [...document.querySelectorAll<HTMLButtonElement>("button")].some(
        (button) => button.textContent?.includes("Save passage")
      )
    ).toBe(false)
    expect(useBibleStore.getState().savedPassages).toEqual([])
  })
})
