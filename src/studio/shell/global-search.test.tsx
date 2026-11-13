// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { GlobalSearch } from "./global-search"
import { useShellStore } from "@/studio/shell-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useBibleStore } from "@/stores/bible-store"
import { useQueueStore } from "@/stores/queue-store"
import { useRundownSelection } from "@/studio/prepare/rundown-selection"
import type { SlideQueueItem } from "@/types"

/**
 * #407: Find anything hands scripture, hymn and song searches to Live's Quick find. It must say
 * so (Live, previews only) and nothing it does may put anything on screen.
 */
let element: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  element = document.createElement("div")
  document.body.appendChild(element)
  root = createRoot(element)
  useShellStore.setState({ searchOpen: true, pendingFind: null, libraryFind: null, goRequest: null })
})

afterEach(() => {
  act(() => root.unmount())
  element.remove()
  document.body.innerHTML = ""
})

function type(text: string) {
  const input = document.querySelector<HTMLInputElement>("[cmdk-input]")!
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    set.call(input, text)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

const handoff = () => [...document.querySelectorAll("[cmdk-item]")].find((el) => el.textContent?.includes("Quick find"))

describe("Find anything (Cmd/Ctrl+K) and scripture, hymns and songs (#407)", () => {
  it("names Live and says its results are previews, never Present", () => {
    act(() => root.render(<GlobalSearch />))
    type("245")
    const row = handoff()
    expect(row?.textContent).toContain("Search “245” in Live’s Quick find")
    expect(row?.textContent).toContain("preview only")
    expect(document.body.textContent).not.toContain("in Present")
  })

  it("opens Live with the words for Quick find and puts nothing on screen", () => {
    const liveBefore = useBroadcastStore.getState().liveItemId
    act(() => root.render(<GlobalSearch />))
    type("jn 3 16")
    act(() => (handoff() as HTMLElement).click())
    const shell = useShellStore.getState()
    expect(shell.pendingFind).toBe("jn 3 16")
    expect(shell.goRequest).toBe("present")
    expect(shell.searchOpen).toBe(false)
    expect(useBroadcastStore.getState().liveItemId).toBe(liveBefore)
  })

  it("finds hymns, songs and scripture in the Library, leaving Live alone (#407)", () => {
    const liveBefore = useBroadcastStore.getState().liveItemId
    act(() => root.render(<GlobalSearch />))
    type("abide with me")
    const row = [...document.querySelectorAll("[cmdk-item]")].find((el) => el.textContent?.includes("in the Hymn book")) as HTMLElement
    expect(row.textContent).toContain("Find “abide with me” in the Hymn book")
    expect([...document.querySelectorAll("[cmdk-item]")].some((el) => el.textContent?.includes("in Songs"))).toBe(true)
    // Words without a number are not a Bible reference.
    expect([...document.querySelectorAll("[cmdk-item]")].some((el) => el.textContent?.includes("in the Bible"))).toBe(false)
    act(() => row.click())
    expect(useShellStore.getState()).toMatchObject({ libraryFind: { section: "hymns", query: "abide with me" }, librarySection: "hymns", goRequest: "library", pendingFind: null, searchOpen: false })
    expect(useBroadcastStore.getState().liveItemId).toBe(liveBefore)
  })

  it("offers the Bible for a reference", () => {
    act(() => root.render(<GlobalSearch />))
    type("jn 3 16")
    expect([...document.querySelectorAll("[cmdk-item]")].some((el) => el.textContent?.includes("Find “jn 3 16” in the Bible"))).toBe(true)
  })

  it("goes straight to a Library section by the words people use (#402)", () => {
    act(() => root.render(<GlobalSearch />))
    type("announcement")
    const row = [...document.querySelectorAll("[cmdk-item]")].find((el) => el.textContent?.includes("Slides & announcements")) as HTMLElement
    expect(row).toBeTruthy()
    act(() => row.click())
    // goTo, so leaving Design still asks about an unsaved draft (app-shell's go()).
    expect(useShellStore.getState()).toMatchObject({ goRequest: "library", librarySection: "slides", searchOpen: false })
    useShellStore.setState({ searchOpen: true })
    act(() => root.render(<GlobalSearch />))
    type("hymn book")
    act(() => ([...document.querySelectorAll("[cmdk-item]")].find((el) => el.textContent?.includes("Hymn book")) as HTMLElement).click())
    expect(useShellStore.getState().librarySection).toBe("hymns")
    useShellStore.setState({ searchOpen: true })
    act(() => root.render(<GlobalSearch />))
    type("sounds")
    act(() => ([...document.querySelectorAll("[cmdk-item]")].find((el) => el.textContent?.includes("Sounds")) as HTMLElement).click())
    expect(useShellStore.getState().librarySection).toBe("audio")
  })

  it("offers no handoff for a single letter", () => {
    act(() => root.render(<GlobalSearch />))
    type("a")
    expect(handoff()).toBeUndefined()
  })

  const welcome: SlideQueueItem = { id: "item-yo", kind: "slide", slide: { title: "Ẹ káàbọ̀", body: "" }, reference: "Ìjọsìn Yorùbá", confidence: 1, source: "manual", added_at: 0 }
  const serviceRow = () => [...document.querySelectorAll("[cmdk-item]")].find((el) => el.textContent?.includes("Ìjọsìn Yorùbá")) as HTMLElement | undefined

  it("finds Yorùbá words typed without their accents", () => {
    useQueueStore.setState({ items: [welcome], headers: [] })
    act(() => root.render(<GlobalSearch />))
    type("ijosin yoruba")
    expect(serviceRow()).toBeTruthy()
  })

  it("opens a service item in Prepare from anywhere but Live, leaving Live's Preview alone (#447)", () => {
    useQueueStore.setState({ items: [welcome], headers: [] })
    useBibleStore.setState({ selectedVerse: null, selectedSlide: null, selectedQueueItemId: null })
    useRundownSelection.setState({ focusId: null })
    useShellStore.setState({ workspace: "home" })
    act(() => root.render(<GlobalSearch />))
    type("ijosin")
    expect(serviceRow()?.textContent).toContain("open in Prepare")
    act(() => serviceRow()!.click())
    expect(useRundownSelection.getState().focusId).toBe(welcome.id)
    expect(useShellStore.getState().goRequest).toBe("prepare")
    expect(useBibleStore.getState().selectedSlide).toBeNull()
  })

  it("names each service item with its event, and finds it by the event (#404)", () => {
    useQueueStore.setState({ items: [welcome], headers: [{ id: "e1", type: "group", name: "Opening prayer", at: 0, event: { schema_version: 1 } }] })
    useShellStore.setState({ workspace: "home" })
    act(() => root.render(<GlobalSearch />))
    type("opening prayer")
    expect(serviceRow()?.textContent).toContain(`Opening prayer · ${welcome.reference}`)
  })

  it("cues a service item in Live's Preview when chosen in Live, and never Program", () => {
    useQueueStore.setState({ items: [welcome], headers: [] })
    useBibleStore.setState({ selectedVerse: null, selectedSlide: null, selectedQueueItemId: null })
    useShellStore.setState({ workspace: "present" })
    const liveBefore = useBroadcastStore.getState().liveItemId
    act(() => root.render(<GlobalSearch />))
    type("ijosin")
    expect(serviceRow()?.textContent).toContain("Live preview")
    act(() => serviceRow()!.click())
    expect(useBibleStore.getState().selectedQueueItemId).toBe(welcome.id)
    expect(useBroadcastStore.getState().liveItemId).toBe(liveBefore)
  })
})
