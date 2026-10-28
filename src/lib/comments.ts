import type { ItemComment, QueueItem } from "@/types"

/** Limits the content crate also enforces (CL-007). */
export const MAX_COMMENTS = 100
/** Deleted comments remain in service files as audit records. */
export const MAX_COMMENT_HISTORY = 1000
export const MAX_COMMENT_CHARS = 1000

// eslint-disable-next-line no-control-regex
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g
const cut = (s: string, n: number) => Array.from(s).slice(0, n).join("")
const hasControl = (s: string) => Array.from(s).some((ch) => {
  const cp = ch.codePointAt(0)!
  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)
})

/** A name as comments store it: control characters out, spaces collapsed, at most 60 characters. */
export const commentAuthor = (raw: string) => cut(raw.replace(CONTROL, " ").replace(/\s+/g, " ").trim(), 60).trim()

/** Keep legacy service comments addressable across saves and copies until they have a UUID. */
function legacyCommentId(by: string, at: string, text: string, occurrence: number): string {
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(`${by}\0${at}\0${text}\0${occurrence}`)) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return `legacy-${hash.toString(16).padStart(16, "0")}`
}

/** Comments as the crate accepts them: trimmed, control characters removed, cut to size, the newest 100. */
export function cleanComments(list: unknown): ItemComment[] {
  if (!Array.isArray(list)) return []
  const out: ItemComment[] = []
  const legacyOccurrences = new Map<string, number>()
  for (const c of list) {
    if (typeof c !== "object" || c === null) continue
    const raw = c as Record<string, unknown>
    const { by, at, text } = raw
    if (typeof text !== "string" || typeof at !== "string" || Number.isNaN(Date.parse(at))) continue
    const body = cut(text.replace(CONTROL_EXCEPT_NEWLINE, " ").trim(), MAX_COMMENT_CHARS).trim()
    if (!body) continue
    const name = commentAuthor(typeof by === "string" ? by : "") || "Unnamed"
    const time = cut(at, 40)
    const legacyKey = JSON.stringify([name, time, body])
    const occurrence = legacyOccurrences.get(legacyKey) ?? 0
    legacyOccurrences.set(legacyKey, occurrence + 1)
    const id = typeof raw.id === "string" && raw.id.length > 0 && Array.from(raw.id).length <= 80 && !hasControl(raw.id)
      ? raw.id
      : legacyCommentId(name, time, body, occurrence)
    const comment: ItemComment = { id, by: name, at: time, text: body }
    if (typeof raw.deleted_by === "string") comment.deleted_by = commentAuthor(raw.deleted_by) || "Unknown"
    if (typeof raw.deleted_at === "string") comment.deleted_at = cut(raw.deleted_at, 40)
    out.push(comment)
  }
  return out
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

/** A comment's stable identity; keep the old key for records created before IDs existed. */
export const commentKey = (c: ItemComment) => c.id ? `comment:${c.id}` : `${c.at}|${c.by}`

/** Preserve read receipts saved by older versions while disambiguating comments with stable IDs. */
export function commentWasSeen(seen: ReadonlySet<string>, c: ItemComment): boolean {
  return seen.has(commentKey(c)) || seen.has(`${c.at}|${c.by}`)
}

export const commentDeleted = (c: ItemComment) => c.deleted_at !== undefined || c.deleted_by !== undefined

/** A comment's author may remove it; an unnamed legacy author cannot be distinguished safely. */
export function canDeleteComment(c: ItemComment, actor: string): boolean {
  const author = commentAuthor(c.by).toLowerCase()
  const acting = commentAuthor(actor).toLowerCase()
  return !commentDeleted(c) && !!author && author !== "unnamed" && !!acting && acting === author
}

export function tombstoneComment(c: ItemComment, actor: string, at = new Date().toISOString()): ItemComment | null {
  if (!canDeleteComment(c, actor)) return null
  return { ...c, deleted_by: commentAuthor(actor), deleted_at: at }
}

/**
 * Comments this computer has not read yet. Read comments are remembered by
 * their identity, not by service or clock, so they stay read in a newer
 * copy opened from the church folder, a duplicate or a template, and a
 * computer whose clock is off cannot hide them. Comments written here are
 * marked read as they are written; with a name set, that person's comments
 * from another computer do not count either.
 */
export function unreadComments(items: QueueItem[], seen: ReadonlySet<string>, me: string): Array<{ item: QueueItem; comment: ItemComment }> {
  const mine = commentAuthor(me).toLowerCase()
  return items.flatMap((item) =>
    (item.comments ?? [])
      .filter((c) => !commentDeleted(c) && !commentWasSeen(seen, c) && !(mine && c.by.trim().toLowerCase() === mine))
      .map((comment) => ({ item, comment })),
  )
}
