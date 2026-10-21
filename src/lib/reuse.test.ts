import { describe, expect, it } from "vitest"
import { appendInOrder, copyForReuse } from "./reuse"
import type { QueueItem, SlideQueueItem } from "@/types"

const slide = (id: string, title: string): SlideQueueItem => ({ id, kind: "slide", slide: { title, body: "" }, reference: title, confidence: 1, source: "manual", added_at: 0, notes: null })

describe("reuse from an earlier service", () => {
  it("copies the chosen items in order with fresh ids", () => {
    const items = [slide("a", "Welcome"), slide("b", "Offering"), slide("c", "Benediction")]
    const copies = copyForReuse(items, new Set(["c", "a"]), 1000)
    expect(copies.map((c) => c.reference)).toEqual(["Welcome", "Benediction"])
    expect(copies.every((c) => !["a", "b", "c"].includes(c.id))).toBe(true)
    expect(copies.map((c) => c.added_at)).toEqual([1000, 1001])
  })

  it("appends at the end of a top-inserting rundown and counts only what was added", () => {
    let rundown: QueueItem[] = [slide("x", "Existing")]
    const add = (i: QueueItem) => { if (i.reference !== "Refused") rundown = [i, ...rundown] }
    const move = (from: number, to: number) => { const r = [...rundown]; const [m] = r.splice(from, 1); r.splice(to, 0, m); rundown = r }
    const n = appendInOrder([slide("1", "One"), slide("2", "Refused"), slide("3", "Three")], add, () => rundown.length, move)
    expect(n).toBe(2)
    expect(rundown.map((r) => r.reference)).toEqual(["Existing", "One", "Three"])
  })
})
