import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Verse } from "@/types"

const verse = (b: number, c: number, v: number): Verse => ({ id: b * 1000 + v, translation_id: 1, book_number: b, book_name: b === 19 ? "Psalms" : b === 43 ? "John" : "Romans", book_abbreviation: "", chapter: c, verse: v, text: `text ${c}:${v}` })
// The edition on this computer has no Romans: that passage is left out.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (cmd: string, a: Record<string, number>) => (cmd === "get_verse" ? (a.bookNumber === 45 ? null : verse(a.bookNumber, a.chapter, a.verse)) : null)) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

const { sampleServiceItems, startSampleService, sampleRefusal } = await import("./sample-service")
const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useQueueStore } = await import("@/stores/queue-store")
const { useServiceStore } = await import("@/stores/service-store")

/** A sample service to try Rhema with (#298 S4.5, S7.7b). */
beforeEach(() => {
  useBroadcastStore.setState({ isLive: false, rehearsal: false })
  useServiceStore.setState({ current: null, dirty: false })
  useQueueStore.setState({ items: [], headers: [], activeIndex: null })
})

describe("the sample service", () => {
  it("is slides and Bible passages only: no song words, nothing claimed as saved", () => {
    const items = sampleServiceItems([verse(43, 3, 16)], 0)
    expect(items.some((i) => i.kind === "song")).toBe(false)
    expect(items.map((i) => i.reference)).toEqual(["Welcome", "John 3:16", "Notices", "Go in peace"])
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
  })

  it("opens as an unsaved rundown with the passages this computer has", async () => {
    expect(await startSampleService()).toBe("started")
    const { items } = useQueueStore.getState()
    expect(items.map((i) => i.reference)).toEqual(["Welcome", "Psalms 100:1", "Psalms 23:1", "Notices", "John 3:16", "Go in peace"])
    expect(useServiceStore.getState().current).toBeNull()
    // Nothing went on a screen.
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })

  it("never replaces unsaved work or a rundown on screen, and waits while something is live", async () => {
    useServiceStore.setState({ current: { id: "p1" } as never, dirty: true })
    expect(await startSampleService()).toBe("unsaved")
    useServiceStore.setState({ current: null, dirty: false })
    const mine = sampleServiceItems([], 0).slice(0, 1)
    useQueueStore.setState({ items: mine })
    expect(await startSampleService()).toBe("unsaved")
    expect(useQueueStore.getState().items).toBe(mine)
    useQueueStore.setState({ items: [] })
    useBroadcastStore.setState({ isLive: true })
    expect(await startSampleService()).toBe("live")
    expect(sampleRefusal("live")).toContain("Not while something is live")
  })
})
