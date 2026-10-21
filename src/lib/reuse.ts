import type { QueueItem } from "@/types"

/**
 * Copies of the chosen items of an earlier service, in that service's order,
 * each with a fresh id so they never collide with the open service's items.
 */
export function copyForReuse(items: QueueItem[], chosen: Set<string>, now = Date.now()): QueueItem[] {
  return items
    .filter((i) => chosen.has(i.id))
    .map((i, n) => ({ ...i, id: crypto.randomUUID(), added_at: now + n }) as QueueItem)
}

/** Append items at the end of a rundown that `add` inserts at the top (the queue store's convention). */
export function appendInOrder(copies: QueueItem[], add: (item: QueueItem) => void, count: () => number, moveToEnd: (from: number, to: number) => void): number {
  let added = 0
  for (const c of copies) {
    const before = count()
    add(c)
    const after = count()
    if (after > before) {
      moveToEnd(0, after - 1)
      added++
    }
  }
  return added
}
