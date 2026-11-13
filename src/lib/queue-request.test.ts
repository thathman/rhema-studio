import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@/lib/song-request", () => ({
  findSongByTitle: async (title: string) => ({ id: "s1", title, primary_language: "en", languages: ["en"], numbers: [], tags: "" }),
}))

import { queueRequest } from "@/lib/queue-request"
import { useQueueStore } from "@/stores/queue-store"
import type { QueueItem } from "@/types"

const slide = (id: string) => ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0 }) as QueueItem

describe("a desk's request queued into the plan's event (#409)", () => {
  it("goes at the end of the named event, and the main desk's own section choice stays", async () => {
    useQueueStore.setState({
      items: [slide("Welcome"), slide("Prayer"), slide("Sermon notes")],
      headers: [
        { id: "main", type: "phase", name: "Main service", at: 0, rule: "manual" },
        { id: "opening", type: "group", name: "Opening", at: 0, event: { schema_version: 1 } },
        { id: "sermon", type: "group", name: "Sermon", at: 2, event: { schema_version: 1 } },
      ],
      addTarget: "main", activeIndex: null,
    })
    expect(await queueRequest({ kind: "song", value: "Abide with me" }, "opening")).toBeNull()
    const q = useQueueStore.getState()
    expect(q.items.map((i) => i.reference)).toEqual(["Welcome", "Prayer", "Abide with me", "Sermon notes"])
    expect(q.headers.find((h) => h.id === "sermon")?.at).toBe(3)
    expect(q.addTarget).toBe("main")
  })

  it("an event no longer in the plan, or not an event, is refused with why; none chosen goes where any added item goes", async () => {
    useQueueStore.setState({ items: [slide("Welcome")], headers: [{ id: "main", type: "phase", name: "Main service", at: 0, rule: "manual" }], addTarget: null, activeIndex: null })
    expect(await queueRequest({ kind: "song", value: "Abide with me" }, "gone")).toBe("that event is no longer in the plan")
    expect(await queueRequest({ kind: "song", value: "Abide with me" }, "main")).toBe("that event is no longer in the plan")
    expect(await queueRequest({ kind: "song", value: "Amazing grace" }, null)).toBeNull()
    expect(useQueueStore.getState().items.map((i) => i.reference)).toEqual(["Amazing grace", "Welcome"])
  })
})
