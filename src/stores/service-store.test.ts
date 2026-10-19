import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ProgramWithItems, QueueItem } from "@/types"

const mockInvoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

import { useServiceStore, toProgramItems, toQueueItems, rundownSignature } from "./service-store"
import { useQueueStore } from "./queue-store"
import { useBibleStore } from "./bible-store"

const program = {
  id: "p1",
  title: "Sunday",
  service_date: "2026-10-25",
  revision: 1,
  created_at: "",
  updated_at: "",
  item_count: 2,
}

const stored: ProgramWithItems = {
  program,
  items: [
    { id: "i1", program_id: "p1", position: 0, kind: "verse", reference: "Psalms 23:1", book_number: 19, chapter: 23, verse: 1, notes: null },
    { id: "i2", program_id: "p1", position: 1, kind: "verse", reference: "John 3:16", book_number: 43, chapter: 3, verse: 16, notes: null },
  ],
}

const queueItem = (ref: string, b: number, c: number, v: number): QueueItem => ({
  id: crypto.randomUUID(),
  verse: { id: 0, translation_id: 1, book_number: b, book_name: ref.split(" ")[0], book_abbreviation: "", chapter: c, verse: v, text: "t" },
  reference: ref,
  confidence: 1,
  source: "manual",
  added_at: 0,
})

beforeEach(() => {
  mockInvoke.mockReset()
  useQueueStore.setState({ items: [], activeIndex: null })
  useBibleStore.setState({ activeTranslationId: 1 })
  useServiceStore.setState({ programs: [], current: null, dirty: false, loading: false, saving: false, error: null })
})

describe("conversions", () => {
  it("round-trips rundown items to program items and back", () => {
    const items = [queueItem("Psalms 23:1", 19, 23, 1), queueItem("John 3:16", 43, 3, 16)]
    const out = toProgramItems(items)
    expect(out).toEqual([
      { kind: "verse", reference: "Psalms 23:1", book_number: 19, chapter: 23, verse: 1, notes: null },
      { kind: "verse", reference: "John 3:16", book_number: 43, chapter: 3, verse: 16, notes: null },
    ])
    const back = toQueueItems(stored, 1)
    expect(back.map((i) => i.reference)).toEqual(["Psalms 23:1", "John 3:16"])
    expect(back[0].verse).toMatchObject({ book_number: 19, chapter: 23, verse: 1, book_name: "Psalms", text: "" })
    expect(back[0].id).toBe("i1")
  })

  it("signature ignores verse text but not order", () => {
    const a = [queueItem("A 1:1", 1, 1, 1), queueItem("B 2:2", 2, 2, 2)]
    const b = a.map((i) => ({ ...i, verse: { ...i.verse, text: "changed" } }))
    expect(rundownSignature(a)).toBe(rundownSignature(b))
    expect(rundownSignature([a[1], a[0]])).not.toBe(rundownSignature(a))
  })
})

describe("service store", () => {
  it("openProgram loads the rundown, backfills text and stays clean", async () => {
    mockInvoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "content_get_program") return stored
      if (cmd === "get_verse") return { id: 1, translation_id: 1, book_number: args.bookNumber, book_name: "x", book_abbreviation: "", chapter: args.chapter, verse: args.verse, text: `text ${args.verse}` }
      return null
    })
    expect(await useServiceStore.getState().openProgram("p1")).toBe(true)
    const q = useQueueStore.getState().items
    expect(q.map((i) => i.reference)).toEqual(["Psalms 23:1", "John 3:16"])
    expect(q[1].verse.text).toBe("text 16")
    expect(useServiceStore.getState().current?.id).toBe("p1")
    expect(useServiceStore.getState().dirty).toBe(false)
  })

  it("editing the rundown marks the service dirty; saving clears it", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "content_get_program") return stored
      if (cmd === "content_replace_items") return { ...stored, program: { ...program, revision: 2, item_count: 3 } }
      return null
    })
    await useServiceStore.getState().openProgram("p1")
    useQueueStore.getState().addItem(queueItem("Romans 8:28", 45, 8, 28))
    expect(useServiceStore.getState().dirty).toBe(true)

    expect(await useServiceStore.getState().saveCurrent()).toBe(true)
    const call = mockInvoke.mock.calls.find((c) => c[0] === "content_replace_items")!
    expect((call[1] as { items: unknown[] }).items).toHaveLength(3)
    expect(useServiceStore.getState().dirty).toBe(false)
    expect(useServiceStore.getState().current?.revision).toBe(2)
  })

  it("a missing service reports an error instead of throwing", async () => {
    mockInvoke.mockResolvedValue(null)
    expect(await useServiceStore.getState().openProgram("gone")).toBe(false)
    expect(useServiceStore.getState().error).toMatch(/no longer exists/)
  })

  it("backend failure surfaces as error and keeps state", async () => {
    mockInvoke.mockRejectedValue(new Error("Content database is not available"))
    await useServiceStore.getState().loadPrograms()
    expect(useServiceStore.getState().error).toMatch(/not available/)
    expect(useServiceStore.getState().programs).toEqual([])
  })
})
