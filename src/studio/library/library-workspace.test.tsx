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
// What Library hands its browsers (#447: privatePreview, so browsing never reaches Live).
const childProps = vi.hoisted(() => ({ song: null as unknown, hymn: null as unknown, media: null as unknown }))
vi.mock("@/studio/library/song-library", () => ({ SongLibrary: (p: unknown) => { childProps.song = p; return null } }))
vi.mock("@/studio/library/hymn-book", () => ({ HymnBook: (p: unknown) => { childProps.hymn = p; return null } }))
vi.mock("@/studio/library/media-library", () => ({ MediaLibrary: (p: unknown) => { childProps.media = p; return null } }))
vi.mock("@/studio/library/library-blocks", () => ({ SongFiles: () => null }))
vi.mock("@/studio/library/slide-library", () => ({ SlideLibrary: () => null }))
vi.mock("@/studio/library/collections-panel", () => ({ CollectionsPanel: () => null }))
vi.mock("@/studio/library/library-file-block", () => ({ LibraryFileBlock: () => null }))
vi.mock("@chenglou/pretext", () => ({ clearCache: vi.fn() }))
vi.mock("@chenglou/pretext/rich-inline", () => ({
  prepareRichInline: vi.fn(() => ({})),
  materializeRichInlineLineRange: vi.fn(() => []),
  measureRichInlineStats: vi.fn(() => ({ width: 0, height: 0, lines: 0 })),
  walkRichInlineLineRanges: vi.fn(),
}))

import { toast } from "sonner"
import { designStore, type DesignVersion } from "@/design-engine/design-store"
import { createBlankRhemaDesign } from "@/design-engine/design-document-utils"
import { prepareLibraryReturnForMoment } from "@/studio/prepare/library-return"
import { sceneStep } from "@/lib/item-intent"
import { LibraryWorkspace } from "./library-workspace"
import { useShellStore } from "@/studio/shell-store"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import { useRundownSelection } from "@/studio/prepare/rundown-selection"
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
  vi.restoreAllMocks()
  mockInvoke.mockReset()
  mockInvoke.mockImplementation(async (command: string) =>
    command === "get_verse" ? bibleVerse : []
  )
  mockStoreSet.mockReset()
  mockStoreSave.mockReset()
  useShellStore.setState({ workspace: "library", librarySection: "songs", prepareLibraryReturn: null, prepareDesignReturn: null })
  useLibraryTargetStore.getState().clearAll()
  useRundownSelection.setState({ focusId: null })
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

function expectNoLiveInvokeCommands() {
  const commands = mockInvoke.mock.calls
    .map(([command]) => command)
    .filter((command) => command !== "content_checkpoint_service_run")
  expect(commands).toEqual([])
}

function contextualDesign() {
  const moment = {
    id: "opening-moment", kind: "slide" as const,
    slide: { title: "Opening", body: "Welcome" }, reference: "Opening",
    confidence: 1, source: "manual" as const, added_at: 0,
    scene_id: "old-scene",
    on_take: [sceneStep("old-scene"), sceneStep("other-output-scene", "overflow")],
  }
  useQueueStore.setState({
    items: [moment, { ...moment, id: "other-moment", reference: "Other" }],
    headers: [{ id: "event-opening", type: "group", name: "Opening", at: 0, event: { schema_version: 1 } }],
  })
  const context = prepareLibraryReturnForMoment(moment.id)!
  useShellStore.setState({ librarySection: "designs", prepareLibraryReturn: context })
  const version: DesignVersion = {
    designId: "design-opening", version: 2, fromRevision: 3, title: "Welcome design",
    document: createBlankRhemaDesign("Welcome design"), note: null,
    savedBy: "Tolu", createdAt: new Date(0).toISOString(),
  }
  vi.spyOn(designStore, "list").mockResolvedValue([{
    id: version.designId, title: version.title, kind: "design", revision: 3,
    latestVersion: 2, updatedAt: version.createdAt,
  }])
  vi.spyOn(designStore, "listVersions").mockResolvedValue([{ ...version, document: null }])
  vi.spyOn(designStore, "getVersion").mockResolvedValue(version)
  return { context, version, moment }
}

describe("Library workspace", () => {
  it("pins the selected immutable design to the exact Prepare moment and returns without changing Live or outputs", async () => {
    const { context, version: originalVersion } = contextualDesign()
    const version = { ...originalVersion, document: { ...originalVersion.document! } }
    const rootNode = version.document.scene.nodes[version.document.scene.root]
    const background = Object.values(version.document.scene.nodes).find((node) => node.type === "rect")
    if (!rootNode || rootNode.type !== "group" || !background || background.type !== "rect") throw new Error("Expected a design root and background")
    const secondBackground = { ...background, id: "page-two-background", parentId: "page-two-group", name: "Yoruba background", fill: { type: "solid" as const, color: "#264060" } }
    version.document.pages = [
      { id: "page-one", nodeId: "page-one-group", title: "English" },
      { id: "page-two", nodeId: "page-two-group", title: "Yoruba" },
    ]
    version.document.scene = {
      ...version.document.scene,
      nodes: {
        ...version.document.scene.nodes,
        [rootNode.id]: { ...rootNode, children: ["page-one-group", "page-two-group"] },
        "page-one-group": { id: "page-one-group", type: "group", parentId: rootNode.id, name: "English", visible: true, opacity: 1, children: [background.id] },
        "page-two-group": { id: "page-two-group", type: "group", parentId: rootNode.id, name: "Yoruba", visible: true, opacity: 1, children: [secondBackground.id] },
        [background.id]: { ...background, parentId: "page-one-group" },
        [secondBackground.id]: secondBackground,
      },
    }
    version.document.bindings[secondBackground.id] = { ...version.document.bindings[background.id], id: secondBackground.id, color: "#264060" }
    vi.mocked(designStore.getVersion).mockResolvedValue(version)
    const broadcastBefore = useBroadcastStore.getState()
    const itemsBefore = useQueueStore.getState().items
    await act(async () => root!.render(<LibraryWorkspace />))
    mockInvoke.mockClear()
    await clickButton("Choose a saved version for this moment")
    await clickButton("Preview version 2")
    const pageSelect = document.querySelector<HTMLSelectElement>("[aria-label='Preview page']")!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(pageSelect, "page-two")
      pageSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await clickButton("Use this version in the current moment")

    const [updated, other] = useQueueStore.getState().items
    const scene = useBroadcastStore.getState().scenes.find((candidate) => candidate.id === updated.scene_id)!
    expect(scene).toMatchObject({ design: { id: version.designId, version: 2, pageId: "page-two" }, layers: [expect.objectContaining({ id: "page-two-background", color: "#264060" })] })
    expect(updated.kind === "slide" && updated.slide.designRef).toEqual({ id: version.designId, version: 2, pageId: "page-two" })
    expect(updated.on_take).toEqual([sceneStep(scene.id), sceneStep("other-output-scene", "overflow")])
    expect(other).toBe(itemsBefore[1])
    expect(useShellStore.getState().prepareLibraryReturn).toEqual(context)
    expect(useShellStore.getState().workspace).toBe("prepare")
    expect(useBroadcastStore.getState()).toMatchObject({
      ...broadcastBefore,
      scenes: expect.any(Array),
    })
    expectNoLiveInvokeCommands()
  })

  it.each(["service", "removed moment", "moved moment", "caller"])("rejects a %s changed while the design version loads", async (change) => {
    const { version } = contextualDesign()
    const error = vi.spyOn(toast, "error")
    vi.mocked(designStore.getVersion).mockResolvedValue(version)
    await act(async () => root!.render(<LibraryWorkspace />))
    mockInvoke.mockClear()
    await clickButton("Choose a saved version for this moment")
    await clickButton(`Preview version ${version.version}`)
    await act(async () => {
      if (change === "service") {
        useServiceStore.setState({ current: { ...useServiceStore.getState().current!, id: "service-b" } })
      } else if (change === "removed moment") {
        useQueueStore.setState({ items: useQueueStore.getState().items.slice(1) })
      } else if (change === "moved moment") {
        useQueueStore.setState({ headers: [
          ...useQueueStore.getState().headers,
          { id: "event-new", type: "group", name: "New event", at: 0, event: { schema_version: 1 } },
        ] })
      } else {
        useShellStore.setState({ prepareLibraryReturn: prepareLibraryReturnForMoment("other-moment") })
      }
    })
    const queueBefore = useQueueStore.getState().items
    const broadcastBefore = useBroadcastStore.getState()
    await clickButton("Use this version in the current moment")
    expect(error).toHaveBeenCalledWith("The Prepare service or moment changed", expect.anything())
    expect(useQueueStore.getState().items).toBe(queueBefore)
    expect(useBroadcastStore.getState()).toBe(broadcastBefore)
    expect(useShellStore.getState().workspace).toBe("library")
    expectNoLiveInvokeCommands()
  })

  it("does not invent a moment action for a standalone or event-only Library visit", async () => {
    contextualDesign()
    useShellStore.setState({ prepareLibraryReturn: null })
    await act(async () => root!.render(<LibraryWorkspace />))
    expect(button("Choose a saved version for this moment")).toBeUndefined()
    await act(async () => useShellStore.setState({ prepareLibraryReturn: {
      ...prepareLibraryReturnForMoment("opening-moment")!, momentId: null, momentTitle: null,
    } }))
    expect(button("Choose a saved version for this moment")).toBeUndefined()
  })

  it("links to the one My Designs in Design instead of mounting a second copy, without changing the current Live output (#806)", async () => {
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
    expect(document.body.textContent).not.toContain("Choose a starting point")
    const link = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Open My Designs in Design")!
    await act(async () => link.click())
    expect(useShellStore.getState().designRequest).toBe("my-designs")
    expect(useShellStore.getState().workspace).toBe("library")
    expect(useBroadcastStore.getState().isLive).toBe(true)
    expect(useBroadcastStore.getState().liveVerse).toEqual({
      reference: "Psalm 23:1",
      segments: [{ text: "Existing program content" }],
    })
  })

  it("browses songs, hymns, pictures and sounds privately, and a section switch closes the Library preview (#447)", async () => {
    const { useLibraryPreview } = await import("@/stores/library-preview-store")
    await act(async () => {
      root!.render(<LibraryWorkspace />)
    })
    const open = async (label: string) => {
      const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent === label)!
      await act(async () => tab.click())
    }
    await open("Songs & ministrations")
    expect(childProps.song).toMatchObject({ privatePreview: true })
    await open("Hymn book")
    expect(childProps.hymn).toMatchObject({ privatePreview: true })
    await open("Pictures & videos")
    expect(childProps.media).toMatchObject({ privatePreview: true, kinds: "visual" })
    useLibraryPreview.getState().inspect({ item: { kind: "image" } as never, title: "Welcome.png", detail: "" })
    await open("Sounds")
    expect(childProps.media).toMatchObject({ privatePreview: true, kinds: "audio" })
    expect(useLibraryPreview.getState().inspected).toBeNull()
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
    // Focused in Prepare (#447); Live's Preview is not changed by Add to service.
    expect(useRundownSelection.getState().focusId).toBe(queue.items[2].id)
    expect(useBibleStore.getState().selectedQueueItemId).toBeNull()
    expect(useBibleStore.getState().selectedVerse).toBeNull()
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
    await act(async () => useQueueStore.setState({
      headers: [{ id: "event-a", type: "group", name: "Opening A", at: 0, event: { schema_version: 1 } }, { id: "event-a2", type: "group", name: "Sermon A", at: 0, event: { schema_version: 1 } }],
    }))
    await clickButton("Choose Library destination")
    await chooseDestination(libraryHeaderTarget("event-a"))
    await clickButton("Remember destination")
    expect(useLibraryTargetStore.getState().byServiceId["service-a"]).toBe(libraryHeaderTarget("event-a"))

    await act(async () => {
      useServiceStore.setState({ current: { id: "service-b", title: "Sunday service B", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 0 } })
      useQueueStore.setState({
        items: [],
        headers: [{ id: "event-b", type: "group", name: "Worship B", at: 0, event: { schema_version: 1 } }, { id: "event-b2", type: "group", name: "Sermon B", at: 0, event: { schema_version: 1 } }],
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
        headers: [{ id: "event-a", type: "group", name: "Opening A", at: 0, event: { schema_version: 1 } }, { id: "event-a2", type: "group", name: "Sermon A", at: 0, event: { schema_version: 1 } }],
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
      headers: [{ id: "event-a", type: "group", name: "Opening A", at: 0, event: { schema_version: 1 } }, { id: "event-a2", type: "group", name: "Sermon A", at: 0, event: { schema_version: 1 } }],
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
      headers: [{ id: "event-current", type: "group", name: "Current event", at: 0, event: { schema_version: 1 } }, { id: "event-other", type: "group", name: "Other event", at: 0, event: { schema_version: 1 } }],
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
      headers: [{ id: "event-a", type: "group", name: "Opening A", at: 0, event: { schema_version: 1 } }, { id: "event-a2", type: "group", name: "Sermon A", at: 0, event: { schema_version: 1 } }],
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
      headers: [{ id: "event-a", type: "group", name: "Opening A", at: 0, event: { schema_version: 1 } }, { id: "event-a2", type: "group", name: "Sermon A", at: 0, event: { schema_version: 1 } }],
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

  it("choosing a Bible edition in Library is Library's own: the active edition, and Live's Preview, stay (#447)", async () => {
    const webJohn = { ...john, id: 2, translation_id: 5 }
    mockInvoke.mockImplementation(async (command: string, args?: { translationId?: number }) => {
      if (command === "list_books") return args?.translationId === 5 ? [webJohn] : [john]
      if (command === "get_verse") return args?.translationId === 5 ? { ...bibleVerse, id: 99, translation_id: 5, text: "For God so loved the world (WEB)" } : bibleVerse
      return []
    })
    useBibleStore.setState({
      translations: [
        { id: 4, abbreviation: "KJV", title: "King James Version", language: "en", is_copyrighted: false, is_downloaded: true },
        { id: 5, abbreviation: "WEB", title: "World English Bible", language: "en", is_copyrighted: false, is_downloaded: true },
      ],
      activeTranslationId: 4,
      books: [john],
    })
    // A verse already in Live's Preview, in the active edition: it must stay exactly as it is.
    useBibleStore.setState({ selectedVerse: { ...bibleVerse, text: "Preview verse in KJV" } as never })
    const previewBefore = useBibleStore.getState().selectedVerse
    expect(previewBefore).not.toBeNull()
    await act(async () => {
      root!.render(<LibraryWorkspace />)
    })
    const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent === "Bible")!
    await act(async () => tab.click())
    const edition = document.querySelector<HTMLSelectElement>('[aria-label="Bible edition"]')!
    await act(async () => {
      edition.value = "5"
      edition.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(useBibleStore.getState().activeTranslationId).toBe(4)
    expect(useBibleStore.getState().books).toEqual([john])
    expect(edition.value).toBe("5")

    const reference = document.querySelector<HTMLInputElement>('[aria-label="Scripture reference"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(reference, "John 3:16")
      reference.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Find passage"))!.click())
    expect(mockInvoke).toHaveBeenCalledWith("get_verse", expect.objectContaining({ translationId: 5 }))
    expect(document.body.textContent).toContain("For God so loved the world (WEB)")
    expect(useBibleStore.getState().activeTranslationId).toBe(4)
    expect(useBibleStore.getState().selectedVerse).toEqual(previewBefore)
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

  it("adds straight to the only destination without asking, and does not store it as a choice (#820 F9)", async () => {
    useBibleStore.setState({
      savedPassages: [{ id: "4:43:3:16", translationId: 4, bookNumber: 43, chapter: 3, verse: 16, reference: "John 3:16" }],
    })
    useQueueStore.setState({
      items: [],
      headers: [{ id: "event-only", type: "group", name: "Opening", at: 0, event: { schema_version: 1 } }],
      activeIndex: null,
      addTarget: null,
    })
    await act(async () => root!.render(<LibraryWorkspace />))
    // Nothing to choose: no chooser button, and the bar names where items go.
    expect(button("Choose Library destination")).toBeUndefined()
    expect(document.body.textContent).toContain("Library items go to End of event “Opening”.")
    const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((candidate) => candidate.textContent === "Bible")!
    await act(async () => tab.click())
    await clickButton("Use in service")

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    const queue = useQueueStore.getState()
    expect(queue.items).toHaveLength(1)
    expect(queue.items[0]).toMatchObject({ reference: "John 3:16" })
    expect(queue.headers[0]).toMatchObject({ id: "event-only", at: 0 })
    expect(useLibraryTargetStore.getState().byServiceId["service-a"]).toBeUndefined()
    expect(useShellStore.getState().workspace).toBe("prepare")
  })

  it("still asks when the run of show has more than one place an item can go (#820 F9)", async () => {
    useBibleStore.setState({
      savedPassages: [{ id: "4:43:3:16", translationId: 4, bookNumber: 43, chapter: 3, verse: 16, reference: "John 3:16" }],
    })
    useQueueStore.setState({
      items: [],
      headers: [
        { id: "event-opening", type: "group", name: "Opening", at: 0, event: { schema_version: 1 } },
        { id: "event-sermon", type: "group", name: "Sermon", at: 0, event: { schema_version: 1 } },
      ],
      activeIndex: null,
      addTarget: null,
    })
    await act(async () => root!.render(<LibraryWorkspace />))
    const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((candidate) => candidate.textContent === "Bible")!
    await act(async () => tab.click())
    await clickButton("Use in service")
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(useQueueStore.getState().items).toEqual([])
  })

  it("offers New song only on Songs and Hymns, and New slide only on Slides (#820 F9)", async () => {
    await act(async () => root!.render(<LibraryWorkspace />))
    const headerButtons = () => [...document.querySelectorAll<HTMLButtonElement>("header button")].map((b) => b.textContent?.trim())
    const open = async (label: string) => {
      const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((candidate) => candidate.textContent === label)!
      await act(async () => tab.click())
    }
    for (const [label, expected] of [
      ["Songs & ministrations", "New song"],
      ["Hymn book", "New song"],
      ["Slides & announcements", "New slide"],
    ] as const) {
      await open(label)
      expect(headerButtons()).toContain(expected)
    }
    for (const label of ["Bible", "Pictures & videos", "Sounds", "Import & export"]) {
      await open(label)
      expect(headerButtons()).not.toContain("New song")
      expect(headerButtons()).not.toContain("New slide")
    }
  })
})
