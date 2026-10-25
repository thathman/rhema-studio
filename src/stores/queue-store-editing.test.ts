import { beforeEach, describe, expect, it, vi } from "vitest"
import { useQueueStore } from "./queue-store"
import type { OutlineHeader } from "@/lib/run-of-show"
import type { QueueItem } from "@/types"

const slide = (id: string, extra: Partial<QueueItem> = {}): QueueItem =>
  ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0, ...extra }) as QueueItem
const ids = () => useQueueStore.getState().items.map((i) => i.id)
const q = () => useQueueStore.getState()
const phase = (id: string, at: number): OutlineHeader => ({ id, type: "phase", name: id, at, rule: "manual", role: "custom" })

beforeEach(() => {
  vi.useRealTimers()
  useQueueStore.setState({ items: [slide("a"), slide("b"), slide("c"), slide("d")], headers: [], activeIndex: null, removedActive: null, addTarget: null })
  q().resetHistory()
})

describe("undo and redo of the run of show (#193)", () => {
  it("undoes and redoes a removal, a move and a header change; a new edit clears Redo", () => {
    q().removeItem("b")
    q().reorderItems(0, 2)
    expect(ids()).toEqual(["c", "d", "a"])
    q().undo()
    expect(ids()).toEqual(["a", "c", "d"])
    q().undo()
    expect(ids()).toEqual(["a", "b", "c", "d"])
    expect(q().past).toHaveLength(0)
    q().redo()
    expect(ids()).toEqual(["a", "c", "d"])
    q().setHeaders([phase("p", 1)])
    expect(q().future).toHaveLength(0)
    q().undo()
    expect(q().headers).toEqual([])
  })

  it("typing in one item is one step; another item's edit is its own", () => {
    vi.useFakeTimers()
    for (const n of ["N", "No", "Not"]) q().updateItem("a", (i) => ({ ...i, notes: n }))
    q().updateItem("b", (i) => ({ ...i, notes: "x" }))
    expect(q().past).toHaveLength(2)
    q().undo()
    q().undo()
    expect(q().items[0].notes).toBeUndefined()
    // A pause makes the next edit of the same item a step of its own.
    q().updateItem("a", (i) => ({ ...i, notes: "1" }))
    vi.advanceTimersByTime(1500)
    q().updateItem("a", (i) => ({ ...i, notes: "2" }))
    expect(q().past).toHaveLength(2)
  })

  it("keeps the active item where it is, and changes nothing that is not the order of service", () => {
    q().setActive(2) // c
    q().removeItem("a")
    expect(q().activeIndex).toBe(1)
    q().undo()
    expect(q().activeIndex).toBe(2)
    expect(q().items[q().activeIndex!].id).toBe("c")
    // Selecting the active item is not an edit.
    q().setActive(0)
    expect(q().past).toHaveLength(0)
  })

  it("filling in a verse's words (after a service opens) is not a step to undo", () => {
    useQueueStore.setState({ items: [{ id: "v", verse: { id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "", chapter: 3, verse: 16, text: "" }, reference: "John 3:16", confidence: 1, source: "manual", added_at: 0 }] })
    q().backfillText("v", "For God so loved")
    expect(q().past).toHaveLength(0)
  })

  it("forgets the history when asked (another service opened)", () => {
    q().removeItem("a")
    q().resetHistory()
    q().undo()
    expect(ids()).toEqual(["b", "c", "d"])
  })
})

describe("copy and paste (#193)", () => {
  it("pastes copies with new ids after the item, inside its section, and in another service", () => {
    useQueueStore.setState({ headers: [phase("p1", 0), phase("p2", 2)] })
    q().copyItems(["a", "b"])
    expect(q().clipboardCount).toBe(2)
    const pasted = q().pasteItems(1) // after b, the last item of p1
    expect(pasted).toHaveLength(2)
    expect(ids().slice(0, 4)).toEqual(["a", "b", ...pasted])
    expect(q().items[2].reference).toBe("a")
    // p2 still starts at c.
    expect(q().headers.find((h) => h.id === "p2")!.at).toBe(4)
    // Another service: the copies go to the top (nothing picked).
    useQueueStore.setState({ items: [slide("x")], headers: [] })
    const again = q().pasteItems(null)
    expect(ids()).toEqual([...again, "x"])
    expect(new Set([...pasted, ...again]).size).toBe(4)
    q().undo()
    expect(ids()).toEqual(["x"])
  })

  it("pastes at the end of the section being added to, in the order copied", () => {
    useQueueStore.setState({ headers: [phase("p1", 0), phase("p2", 2)], addTarget: "p1" })
    q().copyItems(["c", "d"])
    q().pasteItems(null)
    expect(q().items.map((i) => i.reference)).toEqual(["a", "b", "c", "d", "c", "d"])
    expect(q().headers.find((h) => h.id === "p2")!.at).toBe(4)
  })
})

describe("several items at once (#193)", () => {
  it("hides and shows; removes in one step", () => {
    q().setHidden(["a", "c"], true)
    expect(q().items.filter((i) => i.hidden).map((i) => i.id)).toEqual(["a", "c"])
    q().setHidden(["a"], false)
    expect(q().items[0].hidden).toBeNull()
    q().removeItems(["b", "d"])
    expect(ids()).toEqual(["a", "c"])
    q().undo()
    expect(ids()).toEqual(["a", "b", "c", "d"])
  })

  it("moves a block up and down, stopping at the ends", () => {
    q().moveItems(["b", "c"], -1)
    expect(ids()).toEqual(["b", "c", "a", "d"])
    q().moveItems(["b", "c"], -1)
    expect(ids()).toEqual(["b", "c", "a", "d"])
    q().moveItems(["b", "d"], 1)
    expect(ids()).toEqual(["c", "b", "a", "d"])
  })

  it("moves items to the end of another phase, keeping their order and the headers", () => {
    useQueueStore.setState({ headers: [phase("p1", 0), phase("p2", 2)] })
    q().moveToSection(["a", "b"], "p2")
    expect(ids()).toEqual(["c", "d", "a", "b"])
    expect(q().headers.find((h) => h.id === "p2")!.at).toBe(0)
    q().moveToSection(["d"], "p1")
    expect(ids()).toEqual(["d", "c", "a", "b"])
    expect(q().headers.find((h) => h.id === "p2")!.at).toBe(1)
  })
})
