import { beforeEach, describe, expect, it } from "vitest"
import { useQueueStore } from "./queue-store"
import type { VerseQueueItem } from "@/types"
import type { Verse } from "@/types"

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
  useQueueStore.setState({ items: [], activeIndex: null, highlightedId: null })
})

describe("addItem", () => {
  it("prepends a new item", () => {
    useQueueStore.getState().addItem(makeItem({ id: "a" }))
    useQueueStore.getState().addItem(makeItem({ id: "b" }, { verse: 17 }))

    const items = useQueueStore.getState().items as VerseQueueItem[]
    expect(items.map((i) => i.id)).toEqual(["b", "a"])
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
