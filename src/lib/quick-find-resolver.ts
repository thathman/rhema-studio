import { parseTypedReference, type Book, type TypedReference } from "@/lib/quick-search"

export type QuickFindQuery =
  | { kind: "reference"; reference: TypedReference }
  | { kind: "hymn"; code: string | null; number: string }
  | { kind: "text"; text: string }
  | { kind: "empty" }

/**
 * One box, three meanings. A full scripture reference wins ("1 John 1:1" is a
 * verse, not hymn 1); then a hymn number, bare ("245", "#12a") or with the
 * code of a hymnbook the church has ("SSS 245"); everything else is text
 * searched in verses and songs ("Psalm 23" stays text unless a book is
 * coded PSALM).
 */
export function resolveQuickFind(raw: string, books: Book[], hymnbookCodes: string[] = []): QuickFindQuery {
  const q = raw.trim()
  if (!q) return { kind: "empty" }
  const reference = parseTypedReference(q, books)
  if (reference) return { kind: "reference", reference }
  const hymn = q.match(/^(?:([A-Za-z]{1,6})\s*)?#?(\d{1,5}[a-z]?)$/)
  if (hymn) {
    const code = hymn[1]?.toUpperCase() ?? null
    if (code === null || hymnbookCodes.some((c) => c.toUpperCase() === code)) {
      return { kind: "hymn", code, number: hymn[2].toLowerCase() }
    }
  }
  return { kind: "text", text: q }
}
