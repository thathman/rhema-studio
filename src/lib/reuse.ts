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
