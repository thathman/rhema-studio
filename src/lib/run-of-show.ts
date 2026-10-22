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

export interface SectionSummary {
  /** Items under the header (for a phase: down to the next phase; a group: to the next header). */
  count: number
  /** Their planned minutes. */
  minutes: number
}

/** Each header's item count and planned minutes, by header id. */
export function sectionSummaries(items: Array<{ planned_minutes?: number | null }>, headers: OutlineHeader[]): Record<string, SectionSummary> {
  const sorted = [...headers].map((h, order) => ({ h, order })).sort((a, b) => a.h.at - b.h.at || a.order - b.order).map((x) => x.h)
  const out: Record<string, SectionSummary> = {}
  sorted.forEach((h, k) => {
    // A phase runs to the next phase; a group to the next header of either kind.
    const end = sorted.slice(k + 1).find((n) => (h.type === "phase" ? n.type === "phase" : true))?.at ?? items.length
    const slice = items.slice(h.at, end)
    out[h.id] = { count: slice.length, minutes: slice.reduce((m, i) => m + (i.planned_minutes ?? 0), 0) }
  })
  return out
}

/** The four phases of a church event, the main service holding what is there. */
export function defaultPhases(itemCount: number, newId: () => string = () => crypto.randomUUID()): OutlineHeader[] {
  return [
    { id: newId(), type: "phase", name: "Pre-service loop", at: 0, rule: "loop", role: "pre" },
    { id: newId(), type: "phase", name: "Warm-up", at: 0, rule: "auto_once", role: "warmup" },
    { id: newId(), type: "phase", name: "Main service", at: 0, rule: "manual", role: "main" },
    { id: newId(), type: "phase", name: "Post-service loop", at: itemCount, rule: "loop", role: "post" },
  ]
}

/** How a phase runs, for its chip and strip. */
export const RULE_LABEL: Record<PhaseRule, { chip: string; says: string }> = {
  loop: { chip: "Loop", says: "Repeats until stopped" },
  auto_once: { chip: "Auto · once", says: "Runs once, timed to finish at the start" },
  manual: { chip: "Manual", says: "You move on, item by item" },
}
