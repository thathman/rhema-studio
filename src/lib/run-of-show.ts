/**
 * The run of show's structure (issue #193): phases (pre-service loop, warm-up,
 * main service, post-service loop, or named ones) and groups inside them, kept
 * as headers between the rundown's items. `items` stays the plain ordered list
 * everything else uses (Next, Previous, the remote, the stage); a header only
 * says where it sits: before the item at index `at` (at = items.length: after
 * the last). Saved as `phase` / `group` rows in the service.
 */
export type PhaseRule = "loop" | "auto_once" | "manual"
export type PhaseRole = "pre" | "warmup" | "main" | "post" | "custom"

export interface OutlineHeader {
  id: string
  type: "phase" | "group"
  name: string
  /** Before the item at this index. */
  at: number
  notes?: string | null
  /** Phases: how its items run. */
  rule?: PhaseRule
  role?: PhaseRole
  /** Phases: when it starts, 24-hour "HH:MM" (the main service's start). */
  starts_at?: string
  /** Keys this build does not edit, kept as they were. */
  payload_extra?: Record<string, unknown>
}

const shift = (headers: OutlineHeader[], from: number, by: 1 | -1): OutlineHeader[] =>
  headers.map((h) => (h.at > from ? { ...h, at: h.at + by } : h))

/** An item was inserted at `index`: it joins the section whose header sits right above it. */
export function headersAfterInsert(headers: OutlineHeader[], index: number): OutlineHeader[] {
  return shift(headers, index, 1)
}

/** The item at `index` was removed: its section's header stays put, before the next item. */
export function headersAfterRemove(headers: OutlineHeader[], index: number): OutlineHeader[] {
  return shift(headers, index, -1)
}

/** An item moved from `from` to `to` (as the rundown's drag does): removed, then inserted. */
export function headersAfterMove(headers: OutlineHeader[], from: number, to: number): OutlineHeader[] {
  return from === to ? headers : headersAfterInsert(headersAfterRemove(headers, from), to)
}

export type OutlineRow<T> = { header: OutlineHeader } | { item: T; index: number }

/** Headers and items in reading order (headers at the same place keep their own order). */
export function interleave<T>(items: T[], headers: OutlineHeader[]): OutlineRow<T>[] {
  const rows: OutlineRow<T>[] = []
  const byAt = [...headers].map((h, order) => ({ h, order })).sort((a, b) => a.h.at - b.h.at || a.order - b.order)
  let k = 0
  for (let i = 0; i <= items.length; i++) {
    while (k < byAt.length && byAt[k].h.at <= i) rows.push({ header: byAt[k++].h })
    if (i < items.length) rows.push({ item: items[i], index: i })
  }
  return rows
}
