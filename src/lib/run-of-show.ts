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

/** Where an item appended to a section goes: the end of that phase or group. */
export function sectionEnd(itemCount: number, headers: OutlineHeader[], headerId: string): number {
  const sorted = sortHeaders(headers)
  const k = sorted.findIndex((h) => h.id === headerId)
  if (k === -1) return 0
  const h = sorted[k]
  return sorted.slice(k + 1).find((n) => (h.type === "phase" ? n.type === "phase" : true))?.at ?? itemCount
}

/**
 * An item appended at `index` to the section of `headerId`: headers after that section move down
 * even when they sat at `index` (a plain insert would leave them above it, and the item in the
 * next section).
 */
export function headersAfterAppend(headers: OutlineHeader[], index: number, headerId: string): OutlineHeader[] {
  const sorted = sortHeaders(headers)
  const k = sorted.findIndex((h) => h.id === headerId)
  const after = new Set(sorted.slice(k + 1).filter((h) => h.at === index).map((h) => h.id))
  return headers.map((h) => (h.at > index || after.has(h.id) ? { ...h, at: h.at + 1 } : h))
}

function sortHeaders(headers: OutlineHeader[]): OutlineHeader[] {
  return [...headers].map((h, order) => ({ h, order })).sort((a, b) => a.h.at - b.h.at || a.order - b.order).map((x) => x.h)
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

/** "HH:MM" to minutes after midnight (null when not a time). */
export function clockMinutes(t: string | undefined | null): number | null {
  const m = t ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t) : null
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** Minutes after midnight to "HH:MM" (wrapping past midnight). */
export function clockText(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}

export interface TimelineRow {
  kind: "milestone" | "item"
  label: string
  time: string
  minutes?: number
  /** The item's index in the rundown. */
  index?: number
}

export interface Timeline {
  start: string
  warmupStart: string | null
  finish: string
  rows: TimelineRow[]
}

/**
 * The planned day from the main service's start time: when the warm-up begins (timed to end at the
 * start), each main-service item's planned time, and the projected finish, `delay` minutes later
 * than planned when running late (the plan itself does not change). Null without a start time.
 */
export function planTimeline(items: Array<{ reference: string; planned_minutes?: number | null }>, headers: OutlineHeader[], delay = 0): Timeline | null {
  const main = headers.find((h) => h.type === "phase" && h.role === "main") ?? headers.find((h) => h.type === "phase" && h.rule === "manual")
  const start = clockMinutes(main?.starts_at)
  if (!main || start === null) return null
  const sums = sectionSummaries(items, headers)
  const warm = headers.find((h) => h.type === "phase" && h.role === "warmup")
  const warmMinutes = warm ? sums[warm.id]?.minutes ?? 0 : 0
  const phases = [...headers].filter((h) => h.type === "phase").sort((a, b) => a.at - b.at)
  const end = phases.find((p) => p.at > main.at || (p.at === main.at && headers.indexOf(p) > headers.indexOf(main)))?.at ?? items.length
  const rows: TimelineRow[] = []
  if (warm && warmMinutes > 0) rows.push({ kind: "milestone", label: `${warm.name} begins`, time: clockText(start - warmMinutes) })
  rows.push({ kind: "milestone", label: `${main.name} begins`, time: clockText(start) })
  let t = start
  for (let i = main.at; i < end; i++) {
    const minutes = items[i].planned_minutes ?? 0
    rows.push({ kind: "item", label: items[i].reference, time: clockText(t), minutes, index: i })
    t += minutes
  }
  rows.push({ kind: "milestone", label: `${main.name} ends`, time: clockText(t + delay) })
  return { start: clockText(start), warmupStart: warm && warmMinutes > 0 ? clockText(start - warmMinutes) : null, finish: clockText(t + delay), rows }
}
