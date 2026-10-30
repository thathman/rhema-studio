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
import { useServiceStore } from "@/stores/service-store"
import {
  LIBRARY_END_OF_RUN_TARGET,
  libraryHeaderTarget,
  useLibraryTargetStore,
} from "@/studio/library/library-target-store"

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
  useShellStore.setState({ workspace: "library", librarySection: "songs", prepareLibraryReturn: null, prepareDesignReturn: null })
  useLibraryTargetStore.getState().clearAll()
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
    selectedQueueItemId: null,
    selectedSlide: null,
    selectedVerse: null,
  })
  useQueueStore.setState({
    items: [],
    headers: [],
    activeIndex: null,
    addTarget: null,
    highlightedId: null,
    removedActive: null,
    past: [],
    future: [],
  })
  useServiceStore.setState({
    current: { id: "service-a", title: "Sunday service A", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 0 },
    dirty: false,
    loading: false,
    saving: false,
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

function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.includes(label) || candidate.getAttribute("aria-label") === label,
  )!
}

async function chooseDestination(value: string) {
  const select = document.querySelector<HTMLSelectElement>("[aria-label='Library destination']")!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value)
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

async function clickButton(label: string) {
  await act(async () => {
    button(label).click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe("Library workspace", () => {
  it("opens the canonical versioned design editor without changing the current Live output", async () => {
    await act(async () => {
      root!.render(<LibraryWorkspace />)
    })

    const tab = [...document.querySelectorAll<HTMLButtonElement>("[role='tab']")]
      .find((candidate) => candidate.textContent === "Visual designs")
    expect(tab).toBeDefined()
    await act(async () => {
      tab!.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(document.body.textContent).toContain("My Designs")
    expect(document.body.textContent).toContain("Choose a starting point")
    expect(useShellStore.getState().workspace).toBe("library")
    expect(useBroadcastStore.getState().isLive).toBe(true)
    expect(useBroadcastStore.getState().liveVerse).toEqual({
      reference: "Psalm 23:1",
      segments: [{ text: "Existing program content" }],
    })
  })

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
    const programBefore = {
      isLive: useBroadcastStore.getState().isLive,
      liveVerse: useBroadcastStore.getState().liveVerse,
      liveItemId: useBroadcastStore.getState().liveItemId,
    }
    useQueueStore.setState({
      items: [
        { id: "before", kind: "slide", slide: { title: "Before", body: "Before" }, reference: "Before", confidence: 1, source: "manual", added_at: 0 },
        { id: "opening-moment", kind: "slide", slide: { title: "Opening", body: "Welcome" }, reference: "Opening", confidence: 1, source: "manual", added_at: 0 },
        { id: "sermon-moment", kind: "slide", slide: { title: "Sermon", body: "Listen" }, reference: "Sermon", confidence: 1, source: "manual", added_at: 0 },
      ],
      headers: [
        { id: "event-opening", type: "group", name: "Opening", at: 1, event: { schema_version: 1 } },
        { id: "event-sermon", type: "group", name: "Sermon", at: 2, event: { schema_version: 1 } },
      ],
      activeIndex: 2,
      addTarget: null,
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
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(useQueueStore.getState().items.map((item) => item.id)).toEqual([
      "before", "opening-moment", "sermon-moment",
    ])
    await chooseDestination(libraryHeaderTarget("event-opening"))
    await clickButton("Cancel")
    expect(useQueueStore.getState().items.map((item) => item.id)).toEqual([
      "before", "opening-moment", "sermon-moment",
    ])
    expect(useLibraryTargetStore.getState().byServiceId["service-a"]).toBeUndefined()
    expect(useBibleStore.getState().selectedQueueItemId).toBeNull()
    expect(useShellStore.getState().workspace).toBe("library")
    expect(useBroadcastStore.getState()).toMatchObject(programBefore)

    await clickButton("Use in service")
    await chooseDestination(libraryHeaderTarget("event-opening"))
    await clickButton("Add to service")

    const queue = useQueueStore.getState()
    expect(queue.items.map((item) => item.id)).toEqual([
      "before", "opening-moment", expect.any(String), "sermon-moment",
    ])
    expect(queue.headers.map(({ id, at }) => [id, at])).toEqual([
      ["event-opening", 1], ["event-sermon", 3],
    ])
    expect(queue.activeIndex).toBe(3)
    expect(queue.items[2]).toMatchObject({
      source: "manual",
      reference: "John 3:16",
      verse: bibleVerse,
      translation: "KJV",
      secondary_translation: null,
    })
    expect(useBibleStore.getState().selectedQueueItemId).toBe(queue.items[2].id)
    expect(useLibraryTargetStore.getState().byServiceId["service-a"]).toBe(libraryHeaderTarget("event-opening"))
    expect(useShellStore.getState().prepareLibraryReturn).toMatchObject({
      serviceId: "service-a",
      targetHeaderId: "event-opening",
      eventId: "event-opening",
      momentId: queue.items[2].id,
      momentTitle: "John 3:16",
    })
    expect(useShellStore.getState().workspace).toBe("prepare")
    expect(useBroadcastStore.getState().liveVerse).toBe(onAirBefore)
    expect(useBroadcastStore.getState()).toMatchObject(programBefore)
  })

  it("remembers different destinations per service and restores each on A → B → A", async () => {
    await act(async () => root!.render(<LibraryWorkspace />))
    useQueueStore.setState({
      headers: [{ id: "event-a", type: "group", name: "Opening A", at: 0, event: { schema_version: 1 } }],
    })
    await clickButton("Choose Library destination")
    await chooseDestination(libraryHeaderTarget("event-a"))
    await clickButton("Remember destination")
    expect(useLibraryTargetStore.getState().byServiceId["service-a"]).toBe(libraryHeaderTarget("event-a"))

    await act(async () => {
      useServiceStore.setState({ current: { id: "service-b", title: "Sunday service B", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 0 } })
      useQueueStore.setState({
        items: [],
        headers: [{ id: "event-b", type: "group", name: "Worship B", at: 0, event: { schema_version: 1 } }],
        activeIndex: null,
        addTarget: null,
      })
    })
    expect(button("Choose Library destination")).toBeTruthy()
    await clickButton("Choose Library destination")
    await chooseDestination(libraryHeaderTarget("event-b"))
    await clickButton("Remember destination")
    expect(useLibraryTargetStore.getState().byServiceId["service-b"]).toBe(libraryHeaderTarget("event-b"))

    await act(async () => {
      useServiceStore.setState({ current: { id: "service-a", title: "Sunday service A", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 0 } })
      useQueueStore.setState({
        items: [],
        headers: [{ id: "event-a", type: "group", name: "Opening A", at: 0, event: { schema_version: 1 } }],
        activeIndex: null,
        addTarget: null,
      })
    })
    expect(document.body.textContent).toContain("Library items go to End of event “Opening A”")
  })

  it("clears a contextual return when leaving Library and asks on a standalone re-entry", async () => {
    useBibleStore.setState({
      savedPassages: [{ id: "4:43:3:16", translationId: 4, bookNumber: 43, chapter: 3, verse: 16, reference: "John 3:16" }],
    })
    useQueueStore.setState({
      items: [],
      headers: [{ id: "event-a", type: "group", name: "Opening A", at: 0, event: { schema_version: 1 } }],
      activeIndex: null,
      addTarget: null,
    })
    useShellStore.setState({
      workspace: "library",
      prepareLibraryReturn: {
        serviceId: "service-a",
        targetHeaderId: "event-a",
        targetHeaderTitle: "Opening A",
        eventId: "event-a",
        momentId: null,
        eventTitle: "Opening A",
        momentTitle: null,
      },
    })

    await act(async () => useShellStore.getState().setWorkspace("home"))
    expect(useShellStore.getState().prepareLibraryReturn).toBeNull()
    await act(async () => {
      useShellStore.getState().setWorkspace("library")
      root!.render(<LibraryWorkspace />)
    })
    expect(button("Choose Library destination")).toBeTruthy()

    const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((candidate) => candidate.textContent === "Bible")!
    await act(async () => tab.click())
    await clickButton("Use in service")

    expect(document.body.textContent).toContain("Choose where to add this item")
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it("recovers a stale Prepare target by asking for a current Library destination", async () => {
    useBibleStore.setState({
      savedPassages: [{ id: "4:43:3:16", translationId: 4, bookNumber: 43, chapter: 3, verse: 16, reference: "John 3:16" }],
    })
    useQueueStore.setState({
      items: [],
      headers: [{ id: "event-current", type: "group", name: "Current event", at: 0, event: { schema_version: 1 } }],
      activeIndex: null,
      addTarget: null,
    })
    useShellStore.setState({
      workspace: "library",
      prepareLibraryReturn: {
        serviceId: "service-a",
        targetHeaderId: "event-removed",
        targetHeaderTitle: "Removed event",
        eventId: "event-removed",
        momentId: null,
        eventTitle: "Removed event",
        momentTitle: null,
      },
    })
    await act(async () => root!.render(<LibraryWorkspace />))
    const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((candidate) => candidate.textContent === "Bible")!
    await act(async () => tab.click())
    await clickButton("Use in service")

    expect(useShellStore.getState().prepareLibraryReturn).toBeNull()
    expect(document.body.textContent).toContain("Choose where to add this item")
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.querySelector("[aria-label='Library destination']")?.textContent).toContain("Current event")
  })

  it("does not redirect a pending Library Add when the open service changes", async () => {
    useBibleStore.setState({
      savedPassages: [{ id: "4:43:3:16", translationId: 4, bookNumber: 43, chapter: 3, verse: 16, reference: "John 3:16" }],
    })
    useQueueStore.setState({
      items: [],
      headers: [{ id: "event-a", type: "group", name: "Opening A", at: 0, event: { schema_version: 1 } }],
      activeIndex: null,
      addTarget: null,
    })
    await act(async () => root!.render(<LibraryWorkspace />))
    const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((candidate) => candidate.textContent === "Bible")!
    await act(async () => tab.click())
    await clickButton("Use in service")
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()

    await act(async () => {
      useServiceStore.setState({ current: { id: "service-b", title: "Sunday service B", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 0 } })
      useQueueStore.setState({ items: [], headers: [], activeIndex: null, addTarget: null })
    })
    await chooseDestination(LIBRARY_END_OF_RUN_TARGET)
    await clickButton("Add to service")

    expect(useQueueStore.getState().items).toEqual([])
    expect(useLibraryTargetStore.getState().byServiceId["service-a"]).toBeUndefined()
    expect(useLibraryTargetStore.getState().byServiceId["service-b"]).toBeUndefined()
    expect(useBibleStore.getState().selectedQueueItemId).toBeNull()
    expect(useShellStore.getState().workspace).toBe("library")
    expect(document.body.textContent).toContain("The open service or Prepare caller changed")
  })

  it("rejects a Bible lookup that completes after the user switches services", async () => {
    useBibleStore.setState({
      savedPassages: [{ id: "4:43:3:16", translationId: 4, bookNumber: 43, chapter: 3, verse: 16, reference: "John 3:16" }],
    })
    let resolveVerse: ((value: typeof bibleVerse) => void) | null = null
    mockInvoke.mockImplementation((command: string) => command === "get_verse"
      ? new Promise((resolve) => { resolveVerse = resolve as (value: typeof bibleVerse) => void })
      : Promise.resolve([]))
    await act(async () => root!.render(<LibraryWorkspace />))
    const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((candidate) => candidate.textContent === "Bible")!
    await act(async () => tab.click())
    await act(async () => button("Use in service").click())
    expect(resolveVerse).not.toBeNull()

    await act(async () => {
      useServiceStore.setState({ current: { id: "service-b", title: "Sunday service B", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 0 } })
    })
    await act(async () => { resolveVerse!(bibleVerse) })
    await vi.waitFor(() => expect(button("Use in service").disabled).toBe(false))

    expect(useQueueStore.getState().items).toEqual([])
    expect(useLibraryTargetStore.getState().byServiceId["service-b"]).toBeUndefined()
    expect(useShellStore.getState().workspace).toBe("library")
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("Psalm 23:1")
  })

  it("rejects a Bible lookup that completes after leaving and reopening Library", async () => {
    useBibleStore.setState({
      savedPassages: [{ id: "4:43:3:16", translationId: 4, bookNumber: 43, chapter: 3, verse: 16, reference: "John 3:16" }],
    })
    useQueueStore.setState({
      items: [],
      headers: [{ id: "event-a", type: "group", name: "Opening A", at: 0, event: { schema_version: 1 } }],
      activeIndex: null,
      addTarget: null,
    })
    useLibraryTargetStore.getState().remember("service-a", libraryHeaderTarget("event-a"))

    let resolveVerse: ((value: typeof bibleVerse) => void) | null = null
    mockInvoke.mockImplementation((command: string) => command === "get_verse"
      ? new Promise((resolve) => { resolveVerse = resolve as (value: typeof bibleVerse) => void })
      : Promise.resolve([]))
    await act(async () => root!.render(<LibraryWorkspace />))
    const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((candidate) => candidate.textContent === "Bible")!
    await act(async () => tab.click())
    await act(async () => button("Use in service").click())
    expect(resolveVerse).not.toBeNull()

    await act(async () => {
      useShellStore.getState().setWorkspace("home")
      useShellStore.getState().setWorkspace("library")
    })
    await act(async () => { resolveVerse!(bibleVerse) })
    await vi.waitFor(() => expect(button("Use in service").disabled).toBe(false))

    expect(useQueueStore.getState().items).toEqual([])
    expect(useBibleStore.getState().selectedQueueItemId).toBeNull()
    expect(useLibraryTargetStore.getState().byServiceId["service-a"]).toBe(libraryHeaderTarget("event-a"))
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("Psalm 23:1")
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
