import { commentAuthor } from "@/lib/comments"
import type { QueueItem } from "@/types"

/** How many people one item can have (the content crate checks the same). */
export const MAX_ASSIGNEES = 12
/** The longest `prepared_by` the content crate (and so every older build) accepts. */
const PREPARED_BY_CHARS = 60

/** Names as an item keeps them: each one short and clean, no blanks, no repeats (any case), at most 12. */
export function cleanAssignees(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const raw of list) {
    const name = typeof raw === "string" ? commentAuthor(raw) : ""
    if (name && !out.some((n) => n.toLowerCase() === name.toLowerCase())) out.push(name)
  }
  return out.slice(0, MAX_ASSIGNEES)
}

/**
 * The people preparing an item (#299 6.10). An item saved before assignees existed, or by an
 * older build, has only its "prepared by" name: that is its one person.
 */
export function itemAssignees(item: Pick<QueueItem, "assignees" | "prepared_by">): string[] {
  const list = cleanAssignees(item.assignees)
  if (list.length) return list
  const one = commentAuthor(item.prepared_by ?? "")
  return one ? [one] : []
}

/**
 * The names as one "prepared by" line for older builds: "Tolu, Ade", at most 60 characters.
 * When they do not all fit, the whole names that do and how many more: "Tolu, Ade +3".
 */
export function preparedByText(names: string[]): string {
  const all = names.join(", ")
  if (Array.from(all).length <= PREPARED_BY_CHARS) return all
  for (let n = names.length - 1; n >= 1; n--) {
    const text = `${names.slice(0, n).join(", ")} +${names.length - n}`
    if (Array.from(text).length <= PREPARED_BY_CHARS) return text
  }
  return Array.from(`${names[0]}`).slice(0, PREPARED_BY_CHARS).join("").trim()
}

/** The short form for a rundown row: the first name and how many more ("Tolu", "+2"); null with nobody. */
export function assigneesShort(names: string[]): { first: string; more: number } | null {
  return names.length ? { first: names[0], more: names.length - 1 } : null
}

/** The item with these people: the list, and the "prepared by" line older builds still read. */
export function withAssignees<T extends QueueItem>(item: T, names: string[]): T {
  const list = cleanAssignees(names)
  return { ...item, assignees: list.length ? list : null, prepared_by: list.length ? preparedByText(list) : null }
}

/**
 * The people in a saved payload. A list counts only while its "prepared by" line still matches
 * it: an older build edits just that line (keeping the list as it was), and then the line wins.
 */
export function parseAssignees(raw: string | null | undefined, preparedBy: string | null): string[] | null {
  if (!raw) return null
  try {
    const list = cleanAssignees((JSON.parse(raw) as { assignees?: unknown }).assignees)
    return list.length && preparedByText(list) === (preparedBy ?? "") ? list : null
  } catch {
    return null
  }
}

/** Names to offer when adding someone: the desk's own name and everyone already on this service. */
export function knownPeople(items: Pick<QueueItem, "assignees" | "prepared_by">[], operatorName: string): string[] {
  return cleanAssignees([operatorName, ...items.flatMap(itemAssignees)])
}
