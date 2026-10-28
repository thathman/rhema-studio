// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

// jsdom has no ResizeObserver (the drag-and-drop library needs one at import) or CSS.escape.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  ;(globalThis as { CSS?: { escape: (s: string) => string } }).CSS ??= { escape: (s: string) => s }
})

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), emit: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { QueueItem, SongWithSections } from "@/types"
import { useQueueStore } from "@/stores/queue-store"
import { useSongStore } from "@/stores/song-store"
import { useSettingsStore } from "@/stores/settings-store"
import { AssigneesInput } from "./item-editor-parts"
import { RundownList } from "@/studio/present/rundown-list"

/** #299 6.10: an item's people are chips in its editor, and short in the order of service. */
const slide = (extra: Partial<QueueItem> = {}) => ({ id: "s", kind: "slide", slide: { title: "Notices", body: "" }, reference: "Notices", confidence: 1, source: "manual", added_at: 0, ...extra }) as QueueItem
const item = () => useQueueStore.getState().items[0]

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ""
})

async function render(node: React.ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const el = document.body.appendChild(document.createElement("div"))
  root = createRoot(el)
  await act(async () => root!.render(node))
  return el
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
const key = (input: HTMLInputElement, k: string) => act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })) })

describe("an item's people", () => {
  it("an older item's 'prepared by' shows as its one person; Enter adds a name, × removes one", async () => {
    useQueueStore.setState({ items: [slide({ prepared_by: "Tolu" })], headers: [] })
    const el = await render(<AssigneesInput item={item()} />)
    expect(el.textContent).toContain("Tolu")
    const input = el.querySelector<HTMLInputElement>('[aria-label="Add a person to Notices"]')!
    await type(input, "Ade")
    await key(input, "Enter")
    expect(item()).toMatchObject({ assignees: ["Tolu", "Ade"], prepared_by: "Tolu, Ade" })
    await act(async () => root!.render(<AssigneesInput item={item()} />))
    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Remove Tolu from Notices"]')!.click())
    expect(item()).toMatchObject({ assignees: ["Ade"], prepared_by: "Ade" })
  })

  it("a pasted 'Tolu, Ade' is two people, and names on the service and the desk's own are offered", async () => {
    useSettingsStore.setState({ operatorName: "Bisi" })
    useQueueStore.setState({ items: [slide(), slide({ id: "t", reference: "Offering", prepared_by: "Kemi" })], headers: [] })
    const el = await render(<AssigneesInput item={item()} />)
    expect([...el.querySelectorAll("datalist option")].map((o) => o.getAttribute("value"))).toEqual(["Bisi", "Kemi"])
    const input = el.querySelector<HTMLInputElement>('[aria-label="Add a person to Notices"]')!
    await type(input, "Tolu, Ade")
    await act(async () => { input.focus(); input.blur() })
    expect(item().assignees).toEqual(["Tolu", "Ade"])
    useSettingsStore.setState({ operatorName: "" })
  })

  it("the order of service shows the first name and how many more", async () => {
    useQueueStore.setState({ items: [slide({ assignees: ["Tolu", "Ade", "Bisi"], prepared_by: "Tolu, Ade, Bisi" })], headers: [] })
    const el = await render(<RundownList mode="prepare" />)
    const mark = el.querySelector('[title="Prepared by Tolu, Ade, Bisi"]')!
    expect(mark.textContent).toBe("· Tolu+2")
  })

  it("announces a legacy numbered hymn as a hymn in the Prepare rundown", async () => {
    const libraryHymn = {
      song: { tags: "cacghb" },
      sections: [],
      arrangements: [],
      numbers: [{ hymnbook_id: "cac", hymnbook_code: "CAC", number: "245" }],
    } as unknown as SongWithSections
    const legacyHymn = {
      id: "legacy-hymn", kind: "song", song: { song_id: "legacy-hymn", title: "Grace", arrangement_id: null, languages: ["en"] },
      reference: "Grace", confidence: 1, source: "manual", added_at: 0,
    } as QueueItem
    useSongStore.setState({ songs: { "legacy-hymn": libraryHymn } })
    useQueueStore.setState({ items: [legacyHymn], headers: [], activeIndex: null })

    const el = await render(<RundownList mode="prepare" />)
    expect(el.textContent).toContain("Hymn · CAC 245")
    expect(el.querySelector('[aria-label="Hymn"]')).not.toBeNull()
  })

  it("keeps a numbered hymn visibly distinct in the Prepare rundown", async () => {
    const hymn = {
      id: "hymn-245", kind: "song", song: { song_id: "cac-245", title: "Grace", hymn: true, hymn_numbers: ["CAC 245"], arrangement_id: null, languages: ["en"] },
      reference: "Grace", confidence: 1, source: "manual", added_at: 0,
    } as QueueItem
    useQueueStore.setState({ items: [hymn], headers: [], activeIndex: null })
    const el = await render(<RundownList mode="prepare" />)
    expect(el.textContent).toContain("Hymn · CAC 245")
  })
})
