// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { lookupOnHost } = vi.hoisted(() => ({ lookupOnHost: vi.fn() }))
vi.mock("@/stores/join-store", () => ({ lookupOnHost }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { EditorLibraryPreview } from "@/studio/production/editor-library-preview"
import { useBibleStore } from "@/stores/bible-store"

const originalBooks = useBibleStore.getState().books
let root: ReturnType<typeof createRoot> | null = null
let element: HTMLDivElement
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const click = async (button: HTMLButtonElement) => act(async () => {
  if (button.type === "submit" && button.form) button.form.requestSubmit()
  else button.click()
})
const type = async (input: HTMLInputElement | HTMLSelectElement, value: string) => act(async () => {
  const proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }))
})

beforeEach(async () => {
  lookupOnHost.mockReset()
  lookupOnHost.mockImplementation(async (asked: { what: string }) => {
    if (asked.what === "translations") return { active: 1, translations: [{ id: 1, abbreviation: "KJV", name: "King James Version", language: "en" }, { id: 2, abbreviation: "YOR", name: "Bibeli Mimo", language: "yo" }] }
    if (asked.what === "search") return { verses: [{ book: 43, bookName: "John", chapter: 3, verse: 16, text: "For God so loved the world" }] }
    if (asked.what === "chapter") return { verses: [16, 17, 18].map((verse) => ({ book: 43, bookName: "John", chapter: 3, verse, text: `Verse ${verse}` })) }
    if (asked.what === "songs") return { songs: [{ id: "song-1", title: "Great Is Thy Faithfulness", numbers: ["CAC 12"], firstLine: "Great is thy faithfulness", hymn: false }] }
    return {}
  })
  element = document.createElement("div")
  root = createRoot(element)
  await act(async () => root!.render(<EditorLibraryPreview />))
})

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = null
  useBibleStore.setState({ books: originalBooks })
  document.body.replaceChildren()
})

describe("joined Editor Library preview", () => {
  it("searches the host Bible and shows selected verses privately", async () => {
    expect(lookupOnHost).toHaveBeenCalledWith({ what: "translations" })
    await type(element.querySelector<HTMLInputElement>('[aria-label="Editor Scripture reference or words"]')!, "God so loved")
    await click(element.querySelector<HTMLButtonElement>('[aria-label="Find in host Bible"]')!)

    expect(lookupOnHost).toHaveBeenCalledWith({ what: "search", query: "God so loved", translation: 1 })
    expect(element.textContent).toContain("John 3:16")
    await click(element.querySelector<HTMLButtonElement>('[aria-label="Editor Scripture results"] button')!)

    expect(lookupOnHost).toHaveBeenCalledWith({ what: "chapter", translation: 1, book: 43, chapter: 3 })
    expect(element.querySelector('[aria-label="Selected Scripture preview"]')?.textContent).toContain("Verse 16")
    expect(element.querySelector('[aria-label="Selected Scripture preview"]')?.textContent).toContain("KJV")
    expect(element.textContent).toContain("nothing sent to the host")
  })

  it("searches the host song library and makes the limited summary scope clear", async () => {
    await type(element.querySelector<HTMLInputElement>('[aria-label="Editor song title, words or hymn number"]')!, "CAC 12")
    await click(element.querySelector<HTMLButtonElement>('[aria-label="Find in host songs"]')!)

    expect(lookupOnHost).toHaveBeenCalledWith({ what: "songs", query: "CAC 12" })
    await click(element.querySelector<HTMLButtonElement>('[aria-label="Editor song results"] button')!)
    const preview = element.querySelector('[aria-label="Selected song preview"]')
    expect(preview?.textContent).toContain("Great Is Thy Faithfulness")
    expect(preview?.textContent).toContain("Full arrangement preview and service draft submission are not part of this joined Editor view yet.")
    expect(element.textContent).toContain("Searching and selecting never changes the service, host Preview, Program, or outputs.")
  })

  it("ignores an older Scripture lookup that returns after a newer search", async () => {
    let resolveOlder!: (value: { verses: { book: number; bookName: string; chapter: number; verse: number; text: string }[] }) => void
    const older = new Promise<{ verses: { book: number; bookName: string; chapter: number; verse: number; text: string }[] }>((resolve) => { resolveOlder = resolve })
    lookupOnHost.mockImplementation((asked: { what: string; query?: string; translation?: number }) => {
      if (asked.what === "translations") return Promise.resolve({ active: 1, translations: [{ id: 1, abbreviation: "KJV", name: "King James Version", language: "en" }, { id: 2, abbreviation: "YOR", name: "Bibeli Mimo", language: "yo" }] })
      if (asked.what === "search" && asked.query === "older") return older
      if (asked.what === "search") return Promise.resolve({ verses: [{ book: 43, bookName: "John", chapter: 3, verse: 17, text: "Newer result" }] })
      return Promise.resolve({})
    })

    const input = element.querySelector<HTMLInputElement>('[aria-label="Editor Scripture reference or words"]')!
    await type(input, "older")
    await click(element.querySelector<HTMLButtonElement>('[aria-label="Find in host Bible"]')!)
    const translation = element.querySelector<HTMLSelectElement>('[aria-label="Editor Bible translation"]')!
    await type(translation, "2")
    expect(element.querySelector<HTMLButtonElement>('[aria-label="Find in host Bible"]')!.disabled).toBe(false)
    await type(input, "newer")
    await click(element.querySelector<HTMLButtonElement>('[aria-label="Find in host Bible"]')!)
    expect(lookupOnHost).toHaveBeenCalledWith({ what: "search", query: "newer", translation: 2 })
    expect(element.textContent).toContain("John 3:17")

    await act(async () => { resolveOlder({ verses: [{ book: 43, bookName: "John", chapter: 3, verse: 16, text: "Older result" }] }); await older })
    expect(element.textContent).toContain("John 3:17")
    expect(element.textContent).not.toContain("Older result")
  })

  it("explains when a typed verse reference cannot be mapped by the local book index", async () => {
    useBibleStore.setState({ books: [] })
    await type(element.querySelector<HTMLInputElement>('[aria-label="Editor Scripture reference or words"]')!, "John 3:16")
    await click(element.querySelector<HTMLButtonElement>('[aria-label="Find in host Bible"]')!)
    expect(element.textContent).toContain("This computer could not match that reference to a Bible book")
    expect(lookupOnHost).not.toHaveBeenCalledWith({ what: "search", query: "John 3:16", translation: 1 })
  })

  it("surfaces host authorization and lookup failures without inventing results", async () => {
    lookupOnHost.mockRejectedValueOnce(new Error("This desk may not look in the host's Bible"))
    await type(element.querySelector<HTMLInputElement>('[aria-label="Editor Scripture reference or words"]')!, "John 3")
    await click(element.querySelector<HTMLButtonElement>('[aria-label="Find in host Bible"]')!)
    expect(element.textContent).toContain("This desk may not look in the host's Bible")
    expect(element.querySelector('[aria-label="Editor Scripture results"]')).toBeNull()
  })
})
