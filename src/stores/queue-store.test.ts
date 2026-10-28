import { beforeEach, describe, expect, it } from "vitest"
import { useQueueStore } from "./queue-store"
import type { QueueItem, VerseQueueItem, Verse } from "@/types"

function makeVerse(overrides: Partial<Verse> = {}): Verse {
  return {
    id: 1,
    translation_id: 1,
    book_number: 43,
    book_name: "John",
    book_abbreviation: "Jn",
    chapter: 3,
    verse: 16,
    text: "For God so loved the world",
    ...overrides,
  }
}

function makeItem(overrides: Partial<VerseQueueItem> = {}, verse: Partial<Verse> = {}): VerseQueueItem {
  return {
    id: "item-1",
    verse: makeVerse(verse),
    reference: "John 3:16",
    confidence: 1,
    source: "manual",
    added_at: 0,
    ...overrides,
  }
}

beforeEach(() => {
  useQueueStore.setState({ items: [], headers: [], activeIndex: null, highlightedId: null, addTarget: null })
})

const slide = (id: string): QueueItem => ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0 })

describe("addItem", () => {
  it("prepends a new item", () => {
    useQueueStore.getState().addItem(makeItem({ id: "a" }))
    useQueueStore.getState().addItem(makeItem({ id: "b" }, { verse: 17 }))

    const items = useQueueStore.getState().items as VerseQueueItem[]
    expect(items.map((i) => i.id)).toEqual(["b", "a"])
  })

  it("returns the inserted id and places an item at the start by default", () => {
    useQueueStore.setState({ items: [slide("existing")] })
    expect(useQueueStore.getState().addItem(slide("new"))).toBe("new")
    expect(useQueueStore.getState().items.map((item) => item.id)).toEqual(["new", "existing"])
  })

  it("appends without moving existing items when no section is selected", () => {
    useQueueStore.setState({ items: [slide("a"), slide("b")] })
    expect(useQueueStore.getState().addItem(slide("new"), "end")).toBe("new")
    expect(useQueueStore.getState().items.map((item) => item.id)).toEqual(["a", "b", "new"])
  })

  it("inserts at the end of a selected middle phase by stable item id", () => {
    useQueueStore.setState({
      items: [slide("pre"), slide("main-a"), slide("main-b"), slide("post")],
      headers: [
        { id: "pre", type: "phase", name: "Before", at: 0 },
        { id: "main", type: "phase", name: "Main", at: 1 },
        { id: "post", type: "phase", name: "After", at: 3 },
      ],
      addTarget: "main",
    })
    const insertedId = useQueueStore.getState().addItem(slide("new"), "end")!
    expect(useQueueStore.getState().items.map((item) => item.id)).toEqual(["pre", "main-a", "main-b", insertedId, "post"])
    expect(useQueueStore.getState().headers.map(({ id, at }) => [id, at])).toEqual([["pre", 0], ["main", 1], ["post", 4]])
  })

  it("inserts at the end of a nested group without crossing the next group", () => {
    useQueueStore.setState({
      items: [slide("phase-item"), slide("group-item"), slide("nested-item"), slide("next-group-item")],
      headers: [
        { id: "phase", type: "phase", name: "Main", at: 0 },
        { id: "group", type: "group", name: "Worship", at: 1 },
        { id: "nested", type: "group", name: "Songs", at: 2 },
        { id: "next-group", type: "group", name: "Sermon", at: 3 },
      ],
      addTarget: "nested",
    })
    const insertedId = useQueueStore.getState().addItem(slide("new"), "end")!
    expect(useQueueStore.getState().items.map((item) => item.id)).toEqual(["phase-item", "group-item", "nested-item", insertedId, "next-group-item"])
    expect(useQueueStore.getState().headers.map(({ id, at }) => [id, at])).toEqual([["phase", 0], ["group", 1], ["nested", 2], ["next-group", 4]])
  })

  it("drops an exact duplicate that adds no text", () => {
    useQueueStore.getState().addItem(makeItem({ id: "a" }))
    useQueueStore.getState().addItem(makeItem({ id: "b" }))

    const items = useQueueStore.getState().items as VerseQueueItem[]
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe("a")
  })

  it("backfills text on a duplicate when the existing item has no text", () => {
    useQueueStore.getState().addItem(makeItem({ id: "a" }, { text: "" }))
    useQueueStore
      .getState()
      .addItem(makeItem({ id: "b", added_at: 99 }, { text: "For God so loved the world" }))

    const items = useQueueStore.getState().items as VerseQueueItem[]
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe("a")
    expect(items[0].added_at).toBe(0)
    expect(items[0].verse.text).toBe("For God so loved the world")
  })

  it("does not overwrite existing text on a duplicate", () => {
    useQueueStore.getState().addItem(makeItem({ id: "a" }, { text: "original text" }))
    useQueueStore.getState().addItem(makeItem({ id: "b" }, { text: "different text" }))

    expect((useQueueStore.getState().items[0] as VerseQueueItem).verse.text).toBe("original text")
  })
})

describe("backfillText", () => {
  it("fills empty text", () => {
    useQueueStore.getState().addItem(makeItem({ id: "a" }, { text: "" }))
    useQueueStore.getState().backfillText("a", "For God so loved the world")

    expect((useQueueStore.getState().items[0] as VerseQueueItem).verse.text).toBe(
      "For God so loved the world",
    )
  })

  it("never overwrites non-empty text", () => {
    useQueueStore.getState().addItem(makeItem({ id: "a" }, { text: "original text" }))
    useQueueStore.getState().backfillText("a", "different text")

    expect((useQueueStore.getState().items[0] as VerseQueueItem).verse.text).toBe("original text")
  })

  it("ignores unknown ids and empty text", () => {
    useQueueStore.getState().addItem(makeItem({ id: "a" }, { text: "" }))
    useQueueStore.getState().backfillText("missing", "text")
    useQueueStore.getState().backfillText("a", "")

    expect((useQueueStore.getState().items[0] as VerseQueueItem).verse.text).toBe("")
  })

  it("keeps the active position on the same item when items are added, removed or reordered (RG-03)", () => {
    const v = (id: string, n: number) => ({ id, verse: { id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "", chapter: 1, verse: n, text: "" }, reference: `John 1:${n}`, confidence: 1, source: "manual", added_at: 0 }) as VerseQueueItem
    useQueueStore.setState({ items: [v("a", 1), v("b", 2), v("c", 3)], activeIndex: 1 })
    useQueueStore.getState().addItem(v("new", 9))
    expect(useQueueStore.getState().items[useQueueStore.getState().activeIndex ?? -1].id).toBe("b")
    useQueueStore.getState().removeItem("a")
    expect(useQueueStore.getState().items[useQueueStore.getState().activeIndex ?? -1].id).toBe("b")
    useQueueStore.getState().reorderItems(2, 0)
    expect(useQueueStore.getState().items[useQueueStore.getState().activeIndex ?? -1].id).toBe("b")
    // Removing the item on screen: no active item, but its neighbours are kept for Next/Previous.
    const before = useQueueStore.getState().items.map((i) => i.id)
    const at = before.indexOf("b")
    useQueueStore.getState().removeItem("b")
    expect(useQueueStore.getState().activeIndex).toBe(at > 0 ? at - 1 : null) // displays read "next" as the item that followed
    expect(useQueueStore.getState().removedActive).toEqual({ prevId: before[at - 1] ?? null, nextId: before[at + 1] ?? null })
  })
})
