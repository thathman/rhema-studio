import { dayAt } from "@/lib/church-time"

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
  /** Loop phases: seconds each item stays up while the phase runs by itself (3–3600). */
  advance_seconds?: number
  /** Phases: skipped for this service (#193). Its items stay, but Present passes over them like hidden ones. */
  disabled?: boolean
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

/**
 * Whether Present passes over the item at `index` (#193): it is hidden, or its phase is skipped for
 * this service. It stays in the service (and in Prepare); Next, Previous, timed moves and phase
 * runs step over it, Present's running order leaves it out, and it takes no planned time.
 */
export function isSkipped(items: ReadonlyArray<{ hidden?: boolean | null }>, headers: OutlineHeader[], index: number): boolean {
  return !!items[index]?.hidden || !!phaseAt(headers, index)?.disabled
}

/** The items as the plan counts them: a skipped one keeps its place but takes no time and has no fixed start. */
export function timedItems<T extends { hidden?: boolean | null; planned_minutes?: number | null; starts_at?: string | null; gap_minutes?: number | null }>(items: T[], headers: OutlineHeader[]): T[] {
  if (!items.some((_, i) => isSkipped(items, headers, i))) return items
  return items.map((it, i) => (isSkipped(items, headers, i) ? { ...it, planned_minutes: null, starts_at: null, gap_minutes: null } : it))
}

/** The items with every one Present passes over marked hidden (a skipped phase's too), for views that know only items (the stage's Next). */
export function markSkipped<T extends { hidden?: boolean | null }>(items: T[], headers: OutlineHeader[]): T[] {
  if (!headers.some((h) => h.disabled)) return items
  return items.map((it, i) => (!it.hidden && isSkipped(items, headers, i) ? { ...it, hidden: true } : it))
}

/** A church-named phase (#193) before the item at `at`: run by hand until its rule is changed. */
export function newPhase(at: number, name = "New phase", newId: () => string = () => crypto.randomUUID()): OutlineHeader {
  return { id: newId(), type: "phase", name, at, rule: "manual", role: "custom" }
}

/** Each header's item count and planned minutes, by header id. Skipped items count, but take no minutes. */
export function sectionSummaries(rawItems: Array<{ planned_minutes?: number | null; hidden?: boolean | null }>, headers: OutlineHeader[]): Record<string, SectionSummary> {
  const items = timedItems(rawItems, headers)
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

/**
 * The instant (wall ms) of a clock time nearest `ref`: yesterday's, today's or tomorrow's, so a
 * service around midnight keeps its times on the right day. Calendar days, not 24 h, so the
 * 23- and 25-hour days of a clock change land on the right local time. `zone`: the church's time
 * zone (#196 R1.1); "" is this computer's clock.
 */
export function clockInstant(minutes: number, ref: number, zone = ""): number {
  let best = NaN
  for (const days of [-1, 0, 1]) {
    const t = dayAt(ref, days, minutes, zone)
    if (Number.isNaN(best) || Math.abs(t - ref) < Math.abs(best - ref)) best = t
  }
  return best
}

/** Minutes after midnight to "HH:MM" (wrapping past midnight). */
export function clockText(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}

/**
 * A duration as typed (#196 R4): "35" or "35m" (minutes), "4.5", "4:30" (min:sec), "1:10:00"
 * (h:mm:ss), "1h10", "1h 10m", "90s". Minutes, to the second, at most 600; null when it is not a
 * duration (or is empty or zero).
 */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, "")
  let sec: number
  let m: RegExpExecArray | null
  if ((m = /^(\d+(?:[.,]\d+)?)m?(?:in)?$/.exec(t))) sec = Number(m[1].replace(",", ".")) * 60
  else if ((m = /^(\d+):([0-5]\d)$/.exec(t))) sec = Number(m[1]) * 60 + Number(m[2])
  else if ((m = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(t))) sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
  else if ((m = /^(?:(\d+)h)?(?:(\d+)m(?:in)?)?(?:(\d+)s)?$/.exec(t)) && t) sec = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
  else if ((m = /^(\d+)h(\d+)$/.exec(t))) sec = Number(m[1]) * 3600 + Number(m[2]) * 60
  else return null
  const min = Math.round(sec) / 60
  return min > 0 && min <= 600 ? min : null
}

/** A duration in minutes as it is typed back: "35", "4:30", "1:10:00". */
export function formatDuration(minutes: number): string {
  const s = Math.round(minutes * 60)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
  return sec ? `${m}:${String(sec).padStart(2, "0")}` : String(m)
}

export interface TimelineRow {
  kind: "milestone" | "item"
  label: string
  time: string
  minutes?: number
  /** Items: the planned pause before it (its gap, or the free time before its fixed start), minutes. */
  pause?: number
  /** Items: it has a fixed start. */
  fixed?: boolean
  /** The item's index in the rundown. */
  index?: number
}

export interface Timeline {
  start: string
  warmupStart: string | null
  finish: string
  rows: TimelineRow[]
}

type Timed = { reference: string; planned_minutes?: number | null; starts_at?: string | null; gap_minutes?: number | null; hidden?: boolean | null }

/**
 * When an item is planned to start, in minutes from the first day's midnight, after an item planned
 * to end at `after`: its fixed start (the one nearest `after`, so 00:05 after 23:50 is that night's),
 * or `after` plus its pause.
 */
export function plannedStartMinutes(after: number, item: { starts_at?: string | null; gap_minutes?: number | null }): number {
  const fixed = clockMinutes(item.starts_at)
  if (fixed === null) return after + (typeof item.gap_minutes === "number" && item.gap_minutes > 0 && item.gap_minutes <= 600 ? item.gap_minutes : 0)
  return fixed + Math.round((after - fixed) / 1440) * 1440
}

/**
 * The planned day from the main service's start time: when the warm-up begins (timed to end at the
 * start), each main-service item's planned time, and the projected finish, `delay` minutes later
 * than planned when running late (the plan itself does not change). Null without a start time.
 */
export function planTimeline(rawItems: Timed[], headers: OutlineHeader[], delay = 0): Timeline | null {
  const items = timedItems(rawItems, headers)
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
    if (isSkipped(items, headers, i)) continue
    const minutes = items[i].planned_minutes ?? 0
    const from = plannedStartMinutes(t, items[i])
    rows.push({ kind: "item", label: items[i].reference, time: clockText(from), minutes, index: i, ...(from > t ? { pause: from - t } : {}), ...(clockMinutes(items[i].starts_at) !== null ? { fixed: true } : {}) })
    t = from + minutes
  }
  rows.push({ kind: "milestone", label: `${main.name} ends`, time: clockText(t + delay) })
  return { start: clockText(start), warmupStart: warm && warmMinutes > 0 ? clockText(start - warmMinutes) : null, finish: clockText(t + delay), rows }
}

/** Each item's planned clock time: the main service's from the timeline, the warm-up's from its own start. */
export function plannedTimes(items: Timed[], headers: OutlineHeader[]): Map<number, string> {
  const plan = planTimeline(items, headers)
  const at = new Map((plan?.rows ?? []).flatMap((r) => (r.index === undefined ? [] : [[r.index, r.time] as const])))
  const warm = headers.find((h) => h.type === "phase" && h.role === "warmup")
  const range = warm ? phaseRange(items.length, headers, warm.id) : null
  let t = clockMinutes(plan?.warmupStart)
  if (range && t !== null) {
    for (let i = range.start; i < range.end; i++) {
      if (isSkipped(items, headers, i)) continue
      at.set(i, clockText(t))
      t += items[i].planned_minutes ?? 0
    }
  }
  return at
}

/** A loop item with no seconds of its own and no planned minutes stays up this long. */
export const DEFAULT_ADVANCE_SECONDS = 10

/** The rundown indexes a phase covers: [start, end). */
export function phaseRange(itemCount: number, headers: OutlineHeader[], headerId: string): { start: number; end: number } | null {
  const h = headers.find((x) => x.id === headerId && x.type === "phase")
  return h ? { start: h.at, end: sectionEnd(itemCount, headers, headerId) } : null
}

/**
 * How long an item stays up while its phase runs by itself. A loop uses the phase's seconds;
 * a run-once phase (the warm-up) uses each item's planned minutes, so it ends on time.
 */
export function dwellSeconds(header: OutlineHeader, plannedMinutes: number | null | undefined): number {
  const planned = plannedMinutes ? plannedMinutes * 60 : null
  return header.rule === "loop"
    ? header.advance_seconds ?? planned ?? DEFAULT_ADVANCE_SECONDS
    : planned ?? header.advance_seconds ?? DEFAULT_ADVANCE_SECONDS
}

/**
 * The item after `current` in a running phase: a loop wraps to its first item, a run-once phase
 * ends (null). Items `skip` says no to (hidden ones, cue-only moments) are passed over.
 */
export function nextInPhase(rule: PhaseRule, start: number, end: number, current: number, skip: (index: number) => boolean = () => false): number | null {
  const plain = (c: number): number | null => {
    if (end <= start) return null
    if (c < start || c >= end) return start
    if (c + 1 < end) return c + 1
    return rule === "loop" ? start : null
  }
  let at = current
  for (let n = 0; n <= end - start; n++) {
    const next = plain(at)
    if (next === null || !skip(next)) return next
    // Wrapped round to where it began: nothing in the phase may run.
    if (next === current) return null
    at = next
  }
  return null
}

/** The phase an item sits in: the last phase header at or above it (null outside any phase). */
export function phaseAt(headers: OutlineHeader[], index: number): OutlineHeader | null {
  let found: OutlineHeader | null = null
  for (const h of sortHeaders(headers)) if (h.type === "phase" && h.at <= index) found = h
  return found
}
