import type { ItemComment, QueueItem } from "@/types"

/** Limits the content crate also enforces (CL-007). */
export const MAX_COMMENTS = 100
export const MAX_COMMENT_CHARS = 1000

// eslint-disable-next-line no-control-regex
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g
const cut = (s: string, n: number) => Array.from(s).slice(0, n).join("")

/** Comments as the crate accepts them: trimmed, control characters removed, cut to size, the newest 100. */
export function cleanComments(list: unknown): ItemComment[] {
  if (!Array.isArray(list)) return []
  const out: ItemComment[] = []
  for (const c of list) {
    if (typeof c !== "object" || c === null) continue
    const { by, at, text } = c as Record<string, unknown>
    if (typeof text !== "string" || typeof at !== "string" || Number.isNaN(Date.parse(at))) continue
    const body = cut(text.replace(CONTROL_EXCEPT_NEWLINE, " ").trim(), MAX_COMMENT_CHARS).trim()
    if (!body) continue
    const name = cut((typeof by === "string" ? by : "").replace(CONTROL, " ").replace(/\s+/g, " ").trim(), 60).trim() || "Unnamed"
    out.push({ by: name, at: cut(at, 40), text: body })
  }
  return out.slice(-MAX_COMMENTS)
}

/** `comments` from any item's payload. */
export function parseComments(raw: string | null | undefined): ItemComment[] | null {
  if (!raw) return null
  try {
    const list = cleanComments((JSON.parse(raw) as { comments?: unknown }).comments)
    return list.length ? list : null
  } catch {
    return null
  }
}

/** A comment's identity across computers and copies of a service: when it was written, and by whom. */
export const commentKey = (c: ItemComment) => `${c.at}|${c.by}`

/**
 * Comments this computer has not read yet. Read comments are remembered by
 * their identity, not by service or clock, so they stay read in a newer
 * copy opened from the church folder, a duplicate or a template, and a
 * computer whose clock is off cannot hide them. Comments written here are
 * marked read as they are written; with a name set, that person's comments
 * from another computer do not count either.
 */
export function unreadComments(items: QueueItem[], seen: ReadonlySet<string>, me: string): Array<{ item: QueueItem; comment: ItemComment }> {
  const mine = me.trim().toLowerCase()
  return items.flatMap((item) =>
    (item.comments ?? [])
      .filter((c) => !seen.has(commentKey(c)) && !(mine && c.by.trim().toLowerCase() === mine))
      .map((comment) => ({ item, comment })),
  )
}
