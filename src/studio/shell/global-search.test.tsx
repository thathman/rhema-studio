// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { GlobalSearch } from "./global-search"
import { useShellStore } from "@/studio/shell-store"
import { useBroadcastStore } from "@/stores/broadcast-store"

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
  useShellStore.setState({ searchOpen: true, pendingFind: null, goRequest: null })
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
  })

  it("offers no handoff for a single letter", () => {
    act(() => root.render(<GlobalSearch />))
    type("a")
    expect(handoff()).toBeUndefined()
  })
})
