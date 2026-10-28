import { beforeEach, describe, expect, it, vi } from "vitest"
import { useQueueStore } from "./queue-store"
import { interleave, projectRunOfShowEvents, type OutlineHeader } from "@/lib/run-of-show"
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
  it("moves selected items before a stable item id across phases in one undoable edit", () => {
    useQueueStore.setState({
      items: [...q().items, slide("e"), slide("f")],
      headers: [
        phase("p1", 0),
        { id: "event1", type: "group", name: "Event 1", at: 1, event: { schema_version: 1 } },
        { id: "moments", type: "group", name: "Moments", at: 2 },
        { id: "event2", type: "group", name: "Event 2", at: 4, event: { schema_version: 1 } },
        phase("p2", 5),
      ],
    })

    q().moveItemsToTarget(["a", "c"], { kind: "before", itemId: "e" })

    expect(ids()).toEqual(["b", "d", "a", "c", "e", "f"])
    expect(q().headers.find((h) => h.id === "event2")?.at).toBe(2)
    expect(q().headers.find((h) => h.id === "p2")?.at).toBe(5)
    expect(q().past).toHaveLength(1)

    q().undo()
    expect(ids()).toEqual(["a", "b", "c", "d", "e", "f"])
    expect(q().headers.find((h) => h.id === "event2")?.at).toBe(4)
    q().redo()
    expect(ids()).toEqual(["b", "d", "a", "c", "e", "f"])
  })

  it("moves an item into a nested group by header id and keeps the active item selected", () => {
    useQueueStore.setState({ headers: [phase("p1", 0), { id: "event", type: "group", name: "Sermon", at: 0, event: { schema_version: 1 } }, { id: "moments", type: "group", name: "Bible moments", at: 1 }, phase("p2", 3)] })
    q().setActive(1)

    q().moveItemsToTarget(["a"], { kind: "section", headerId: "moments" })

    expect(ids()).toEqual(["b", "c", "a", "d"])
    expect(q().headers.find((h) => h.id === "p2")?.at).toBe(3)
    expect(q().items[q().activeIndex ?? -1].id).toBe("b")
    expect(q().past).toHaveLength(1)
    q().undo()
    expect(ids()).toEqual(["a", "b", "c", "d"])
    expect(q().headers.find((h) => h.id === "p2")?.at).toBe(3)
    expect(q().items[q().activeIndex ?? -1].id).toBe("b")
  })

  it("moving to an event end keeps a same-index following phase's nested group attached", () => {
    useQueueStore.setState({ headers: [
      phase("main", 0),
      { id: "event", type: "group", name: "Event", at: 0, event: { schema_version: 1 } },
      phase("post", 2),
      { id: "post-group", type: "group", name: "Post group", at: 2 },
    ] })
    q().moveItemsToTarget(["d"], { kind: "section", headerId: "event" })
    expect(ids()).toEqual(["a", "b", "d", "c"])
    expect(q().headers.map(({ id, at }) => [id, at])).toEqual([
      ["main", 0], ["event", 0], ["post", 3], ["post-group", 3],
    ])
  })

  it("moves an event with its moments and nested groups into another phase as one undoable edit", () => {
    const event = { id: "event1", type: "group" as const, name: "Opening prayer", at: 0, event: { schema_version: 1 as const, duration_minutes: 15 } }
    const nested = { id: "event1-scripture", type: "group" as const, name: "Scripture moments", at: 1 }
    useQueueStore.setState({
      items: [slide("prayer"), slide("verse"), slide("sermon"), slide("quiz")],
      headers: [
        phase("pre", 0),
        event,
        nested,
        phase("main", 2),
        { id: "event2", type: "group", name: "Sermon", at: 2, event: { schema_version: 1, duration_minutes: 40 } },
        phase("post", 4),
      ],
      activeIndex: 1,
    })
    const before = { items: q().items, headers: q().headers }

    q().moveEventToTarget("event1", { kind: "phase", phaseId: "main" })

    expect(ids()).toEqual(["sermon", "quiz", "prayer", "verse"])
    expect(q().headers.map(({ id, at }) => [id, at])).toEqual([
      ["pre", 0], ["main", 0], ["event2", 0], ["event1", 2], ["event1-scripture", 3], ["post", 4],
    ])
    expect(q().headers.find((header) => header.id === "event1")?.event?.duration_minutes).toBe(15)
    expect(q().items[q().activeIndex ?? -1].id).toBe("verse")
    expect(q().past).toHaveLength(1)

    q().undo()
    expect(q().items).toEqual(before.items)
    expect(q().headers).toEqual(before.headers)
    q().redo()
    expect(ids()).toEqual(["sermon", "quiz", "prayer", "verse"])
  })


})


describe("stable movement boundaries", () => {
  const event = (id: string, at: number): OutlineHeader => ({
    id, type: "group", name: id, at, notes: "keep notes", payload_extra: { future: id },
    event: { schema_version: 1, role: "Prayer", duration_minutes: 15, ownership: "Pastor", payload_extra: { future: id } },
  })
  const rows = () => interleave(q().items, q().headers).map((r) => "header" in r ? r.header.id : r.item.id)
  const members = () => Object.fromEntries(projectRunOfShowEvents(q().items, q().headers).map((e) => [e.id, e.moments.map((m) => m.id)]))

  it("moves empty events and their empty groups across equal-position phases without taking other moments", () => {
    const headers = [phase("pre", 0), event("empty", 0), { id: "nested", type: "group" as const, name: "nested", at: 0 },
      phase("main", 0), event("service", 0), event("response", 2), phase("post", 4)]
    useQueueStore.setState({ headers, activeIndex: 2 })
    const before = { items: q().items, headers: q().headers }
    q().moveEventToTarget("empty", { kind: "event", eventId: "service", placement: "after" })
    expect(rows()).toEqual(["pre", "main", "service", "a", "b", "empty", "nested", "response", "c", "d", "post"])
    expect(members()).toEqual({ service: ["a", "b"], empty: [], response: ["c", "d"] })
    expect(q().headers.find((h) => h.id === "empty")).toEqual({ ...headers[1], at: 2 })
    expect(q().items[q().activeIndex!].id).toBe("c")
    expect(q().past).toHaveLength(1)
    q().undo()
    expect(q().items).toEqual(before.items)
    expect(q().headers).toEqual(before.headers)
    q().redo()
    expect(members()).toEqual({ service: ["a", "b"], empty: [], response: ["c", "d"] })
  })

  it("moves events in both directions, across phases and into empty phases with membership intact", () => {
    useQueueStore.setState({ headers: [phase("pre", 0), event("first", 0),
      { id: "nested", type: "group", name: "nested", at: 1 }, phase("main", 2), event("second", 2), phase("post", 4)], activeIndex: 1 })
    const before = { items: q().items, headers: q().headers }
    q().moveEvent("second", -1)
    expect(rows()).toEqual(["pre", "second", "c", "d", "first", "a", "nested", "b", "main", "post"])
    expect(members()).toEqual({ second: ["c", "d"], first: ["a", "b"] })
    q().undo()
    expect(q().headers).toEqual(before.headers)
    q().moveEvent("first", 1)
    expect(rows()).toEqual(["pre", "main", "second", "c", "d", "first", "a", "nested", "b", "post"])
    q().moveEventToTarget("first", { kind: "phase", phaseId: "post" })
    expect(rows()).toEqual(["pre", "main", "second", "c", "d", "post", "first", "a", "nested", "b"])
    expect(members()).toEqual({ second: ["c", "d"], first: ["a", "b"] })
    expect(q().items[q().activeIndex!].id).toBe("b")
    for (const item of q().items) expect(item).toBe(before.items.find((i) => i.id === item.id))
    q().undo()
    q().undo()
    expect(q().items).toEqual(before.items)
    expect(q().headers).toEqual(before.headers)
  })

  it("preserves unrelated events when items move before/after stable targets in rundown order", () => {
    useQueueStore.setState({ headers: [phase("main", 0), event("first", 0), event("second", 2)], activeIndex: 3 })
    q().moveItemsToTarget(["b", "a", "b", "missing"], { kind: "after", itemId: "c" })
    expect(ids()).toEqual(["c", "a", "b", "d"])
    expect(members()).toEqual({ first: [], second: ["c", "a", "b", "d"] })
    expect(q().items[q().activeIndex!].id).toBe("d")
    expect(q().past).toHaveLength(1)
    q().undo()
    expect(members()).toEqual({ first: ["a", "b"], second: ["c", "d"] })
    q().moveItemsToTarget(["d"], { kind: "before", itemId: "a" })
    expect(members()).toEqual({ first: ["d", "a", "b"], second: ["c"] })
  })

  it("ignores missing, self and unchanged targets without consuming history or Redo", () => {
    useQueueStore.setState({ headers: [event("first", 0), event("second", 2)] })
    q().moveEvent("first", 1)
    q().undo()
    const before = q()
    q().moveItemsToTarget(["missing"], { kind: "before", itemId: "a" })
    q().moveItemsToTarget(["a"], { kind: "before", itemId: "missing" })
    q().moveItemsToTarget(["a"], { kind: "after", itemId: "a" })
    q().moveItemsToTarget(["a"], { kind: "section", headerId: "missing" })
    q().moveItemsToTarget(["b"], { kind: "after", itemId: "a" })
    q().moveEventToTarget("first", { kind: "event", eventId: "first", placement: "after" })
    q().moveEventToTarget("first", { kind: "event", eventId: "second", placement: "before" })
    q().moveEventToTarget("first", { kind: "phase", phaseId: "missing" })
    q().moveEventToTarget("missing", { kind: "event", eventId: "first", placement: "after" })
    q().moveEvent("first", -1)
    q().moveEvent("second", 1)
    q().reorderItems(-1, 2)
    q().reorderItems(0, 99)
    expect(q()).toBe(before)
    expect(q().future).toHaveLength(1)
  })
})
