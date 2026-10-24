// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { TransportBar } from "./transport-bar"
import { remoteActions } from "@/lib/remote-actions"
import { useBibleStore, useBroadcastStore, useQueueStore } from "@/stores"
import type { QueueItem, Verse } from "@/types"

const verse: Verse = { id: 1, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "Jn", chapter: 3, verse: 16, text: "For God so loved the world" }
const item: QueueItem = { id: "it-1", reference: "John 3:16", confidence: 1, source: "manual", added_at: 0, verse }

let el: HTMLDivElement
let root: Root

async function render() {
  el = document.createElement("div")
  document.body.append(el)
  root = createRoot(el)
  await act(async () => root.render(<TransportBar />))
}

const button = (name: string) => el.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!
const click = (name: string) => act(async () => button(name).click())

/** What the reason sr-text and the tooltip say about a control that cannot act. */
function reasonOf(name: string): string | null {
  const b = button(name)
  if (b.getAttribute("aria-disabled") !== "true") return null
  const ids = (b.getAttribute("aria-describedby") ?? "").split(" ")
  const text = ids.map((id) => document.getElementById(id)?.textContent ?? "").find((t) => t === b.title)
  return text ?? null
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useBroadcastStore.setState({ outputs: [], outputStatus: {}, isLive: false, liveVerse: null, liveSourceVerse: null, liveSlide: null, rehearsal: false })
  useQueueStore.setState({ items: [] })
  useBibleStore.setState({ selectedVerse: null, selectedSlide: null })
})

afterEach(() => {
  act(() => root.unmount())
  el.remove()
  vi.restoreAllMocks()
})

describe("Present's transport bar", () => {
  it("each button runs the same action as before (the keyboard's and the remotes')", async () => {
    const calls = {
      prev: vi.spyOn(remoteActions, "queuePrev").mockImplementation(() => Promise.resolve()),
      next: vi.spyOn(remoteActions, "queueNext").mockImplementation(() => Promise.resolve()),
      versePrev: vi.spyOn(remoteActions, "versePrev").mockImplementation(() => Promise.resolve()),
      verseNext: vi.spyOn(remoteActions, "verseNext").mockImplementation(() => Promise.resolve()),
      take: vi.spyOn(remoteActions, "sendToLive").mockImplementation(() => Promise.resolve()),
      onAir: vi.spyOn(remoteActions, "toggleOnAir").mockImplementation(() => {}),
    }
    useQueueStore.setState({ items: [item] })
    useBibleStore.setState({ selectedVerse: verse })
    useBroadcastStore.setState({ isLive: true, liveVerse: { reference: "John 3:16", segments: [], content: "bible" }, liveSourceVerse: verse })
    await render()

    await click("Previous")
    await click("Next")
    await click("Previous verse")
    await click("Next verse")
    await click("Take live")
    await click("Clear")
    expect(calls.prev).toHaveBeenCalledTimes(1)
    expect(calls.next).toHaveBeenCalledTimes(1)
    expect(calls.versePrev).toHaveBeenCalledTimes(1)
    expect(calls.verseNext).toHaveBeenCalledTimes(1)
    expect(calls.take).toHaveBeenCalledTimes(1)
    expect(calls.onAir).toHaveBeenCalledWith(false)

    // Cleared: Restore brings it back.
    await act(async () => useBroadcastStore.setState({ isLive: false }))
    await click("Restore")
    expect(calls.onAir).toHaveBeenLastCalledWith(true)
  })

  it("controls that cannot act say why, and a click on them does nothing", async () => {
    const take = vi.spyOn(remoteActions, "sendToLive").mockImplementation(() => Promise.resolve())
    const next = vi.spyOn(remoteActions, "queueNext").mockImplementation(() => Promise.resolve())
    const onAir = vi.spyOn(remoteActions, "toggleOnAir").mockImplementation(() => {})
    await render()

    expect(reasonOf("Previous")).toMatch(/running order is empty/)
    expect(reasonOf("Next")).toMatch(/running order is empty/)
    expect(reasonOf("Previous verse")).toMatch(/Nothing has been live yet/)
    expect(reasonOf("Next verse")).toMatch(/Nothing has been live yet/)
    expect(reasonOf("Take live")).toMatch(/Nothing in Preview/)
    expect(reasonOf("Clear")).toMatch(/Nothing is on the screens/)
    expect(reasonOf("Restore")).toMatch(/Nothing was cleared/)
    // Still focusable, so a keyboard or screen-reader user can find out why.
    expect(button("Take live").disabled).toBe(false)

    await click("Take live")
    await click("Next")
    await click("Clear")
    expect(take).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
    expect(onAir).not.toHaveBeenCalled()

    // On air: Clear can act, Restore says it is already up.
    await act(async () => useBroadcastStore.setState({ isLive: true, liveVerse: { reference: "John 3:16", segments: [], content: "bible" }, liveSourceVerse: verse }))
    expect(reasonOf("Clear")).toBeNull()
    expect(reasonOf("Restore")).toMatch(/Already on the screens/)
    expect(reasonOf("Next verse")).toBeNull()
  })

  it("with a song, slide or quick screen up, the verse buttons say why and do nothing (#299 5.3)", async () => {
    const versePrev = vi.spyOn(remoteActions, "versePrev").mockImplementation(() => Promise.resolve())
    const verseNext = vi.spyOn(remoteActions, "verseNext").mockImplementation(() => Promise.resolve())
    useQueueStore.setState({ items: [item] })
    // A song on air: there is no Bible reading for the verse steps to continue.
    useBroadcastStore.setState({ isLive: true, liveVerse: { reference: "Amazing Grace", segments: [], content: "song" } as never, liveSourceVerse: null, liveSlide: { itemId: "song-1", songId: "s1", index: 0, total: 4 } as never })
    await render()
    expect(reasonOf("Next verse")).toMatch(/^A song is on air: verse steps continue a Bible reading/)
    expect(reasonOf("Previous verse")).toMatch(/^A song is on air/)
    await click("Next verse")
    await click("Previous verse")
    expect(verseNext).not.toHaveBeenCalled()
    expect(versePrev).not.toHaveBeenCalled()

    await act(async () => useBroadcastStore.setState({ liveSlide: null, liveVerse: { reference: "", segments: [], lines: ["Please stand"], quickScreen: "stand" } as never }))
    expect(reasonOf("Next verse")).toMatch(/^A quick screen is on air: .*Press Back/)
    await act(async () => useBroadcastStore.setState({ isLive: false, liveVerse: { reference: "Notices", segments: [], lines: ["Notices"] } as never }))
    expect(reasonOf("Next verse")).toMatch(/^A slide or picture was the last thing shown/)

    // A Bible reading: they continue it.
    await act(async () => useBroadcastStore.setState({ isLive: true, liveVerse: { reference: "John 3:16", segments: [], content: "bible" }, liveSourceVerse: verse }))
    expect(reasonOf("Next verse")).toBeNull()
    await click("Next verse")
    expect(verseNext).toHaveBeenCalledTimes(1)
  })

  it("has one Take live, which says what it puts up and where", async () => {
    useBibleStore.setState({ selectedVerse: verse })
    await render()
    const toolbar = el.querySelector('[role="toolbar"][aria-label="Presentation controls"]')!
    const names = [...toolbar.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))
    expect(names.filter((n) => n === "Take live")).toHaveLength(1)
    expect(names).not.toContain("Show live")

    const target = () => document.getElementById(button("Take live").getAttribute("aria-describedby")!)!.textContent
    expect(target()).toContain("John 3:16")
    expect(target()).toContain("no screen is on")

    await act(async () => useBroadcastStore.setState({ rehearsal: true }))
    expect(target()).toContain("this console only (rehearsal)")
  })
})
