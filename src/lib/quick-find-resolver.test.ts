import { describe, expect, it } from "vitest"
import { resolveQuickFind } from "./quick-find-resolver"
import type { Book } from "./quick-search"

const books: Book[] = [
  { id: 1, translation_id: 1, book_number: 43, name: "John", abbreviation: "Jn", testament: "NT" },
  { id: 2, translation_id: 1, book_number: 62, name: "I John", abbreviation: "1Jn", testament: "NT" },
  { id: 3, translation_id: 1, book_number: 19, name: "Psalms", abbreviation: "Ps", testament: "OT" },
]

describe("quick find resolver", () => {
  it("prefers a scripture reference", () => {
    const r = resolveQuickFind("1 John 1:1", books)
    expect(r.kind).toBe("reference")
    if (r.kind === "reference") expect(r.reference.book.book_number).toBe(62)
    expect(resolveQuickFind("jn 3 16", books).kind).toBe("reference")
  })

  it("reads hymn numbers with an optional book code", () => {
    expect(resolveQuickFind("245", books)).toEqual({ kind: "hymn", code: null, number: "245" })
    expect(resolveQuickFind("SSS 245", books, ["SSS"])).toEqual({ kind: "hymn", code: "SSS", number: "245" })
    expect(resolveQuickFind("sss245a", books, ["sss"])).toEqual({ kind: "hymn", code: "SSS", number: "245a" })
    expect(resolveQuickFind("SSS 245", books, [])).toEqual({ kind: "text", text: "SSS 245" })
    expect(resolveQuickFind("#12", books)).toEqual({ kind: "hymn", code: null, number: "12" })
  })

  it("falls back to text, and empty stays empty", () => {
    expect(resolveQuickFind("amazing grace", books)).toEqual({ kind: "text", text: "amazing grace" })
    expect(resolveQuickFind("Psalm 23", books, ["SSS"])).toEqual({ kind: "text", text: "Psalm 23" })
    expect(resolveQuickFind("   ", books)).toEqual({ kind: "empty" })
  })

  it("a real hymnbook code wins over a one-chapter book name", () => {
    const jude = { id: 65, translation_id: 1, book_number: 65, name: "Jude", abbreviation: "Jude", testament: "NT" }
    expect(resolveQuickFind("JUDE 5", [jude], ["JUDE"])).toMatchObject({ kind: "hymn", code: "JUDE", number: "5" })
    expect(resolveQuickFind("Jude 5", [jude], [])).toMatchObject({ kind: "reference" })
  })
})

