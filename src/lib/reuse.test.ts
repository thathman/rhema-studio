import { describe, expect, it } from "vitest"
import { copyForReuse } from "./reuse"
import type { SlideQueueItem } from "@/types"

const slide = (id: string, title: string): SlideQueueItem => ({ id, kind: "slide", slide: { title, body: "" }, reference: title, confidence: 1, source: "manual", added_at: 0, notes: null })

describe("reuse from an earlier service", () => {
  it("copies the chosen items in order with fresh ids", () => {
    const items = [slide("a", "Welcome"), slide("b", "Offering"), slide("c", "Benediction")]
    const copies = copyForReuse(items, new Set(["c", "a"]), 1000)
    expect(copies.map((c) => c.reference)).toEqual(["Welcome", "Benediction"])
    expect(copies.every((c) => !["a", "b", "c"].includes(c.id))).toBe(true)
    expect(copies.map((c) => c.added_at)).toEqual([1000, 1001])
  })
})
