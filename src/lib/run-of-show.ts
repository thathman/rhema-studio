import { dayAt } from "@/lib/church-time"

/**
 * The run of show's structure: phases and groups are headers between the rundown's
 * items. A group may carry a versioned event plan; the following items are its moments.
 * `items` stays the ordered list used by Next, Previous, remotes and the stage. Headers
 * save as existing `phase` / `group` rows so older builds can keep unknown event data.
 */
export type PhaseRule = "loop" | "auto_once" | "manual"
export type PhaseRole = "pre" | "warmup" | "main" | "post" | "custom"

/** A saved event cue is a snapshot of a manual action sequence; it never runs from elapsed time. */
export interface RunOfShowEventCue {
  id: string
  name: string
  trigger: "manual"
  /** Kept as strings so a newer build's actions survive a save by this build. */
  steps: string[]
}

/** Versioned plan metadata on a service event. The event's title/id/notes are its header fields. */
export interface RunOfShowEventPlan {
  schema_version: 1
  role?: string
  duration_minutes?: number
  ownership?: string
  cues?: RunOfShowEventCue[]
  /** Deprecated v1 payload key; the parser ignores it because service approval is authoritative. */
  approval?: "draft" | "approved"
  /** Event metadata written by a later build; retained on the next save. */
  payload_extra?: Record<string, unknown>
}

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
  /** Present on an event header. Its following rundown items are the event's moments. */
  event?: RunOfShowEventPlan
}

export interface RunOfShowEvent<T> {
  id: string
  title: string
  role?: string
  duration_minutes?: number
  ownership?: string
  notes?: string | null
  moments: T[]
}

/** A safe point to insert a new event while keeping it inside the chosen phase or event. */
export interface EventInsertionPoint {
  at: number
  /** Insert before this boundary when several headers share the same item index. */
  beforeHeaderId?: string
}

const EVENT_FIELDS = new Set(["schema_version", "role", "duration_minutes", "ownership", "cues", "approval"])

/** Read only this schema version; an unknown or malformed marker remains opaque payload data. */
export function parseRunOfShowEvent(value: unknown): RunOfShowEventPlan | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.schema_version !== 1) return null
  // eslint-disable-next-line no-control-regex
  const text = (v: unknown) => typeof v === "string" && v.trim().length > 0 && v.trim().length <= 60 && !/[\u0000-\u001f\u007f-\u009f]/.test(v) ? v.trim() : undefined
  const role = text(raw.role)
  const ownership = text(raw.ownership)
  if (raw.role !== undefined && !role || raw.ownership !== undefined && !ownership) return null
  const duration = raw.duration_minutes
  if (duration !== undefined && (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0 || duration > 600)) return null
  let cues: RunOfShowEventCue[] | undefined
  if (raw.cues !== undefined) {
    if (!Array.isArray(raw.cues) || raw.cues.length > 12) return null
    const seen = new Set<string>()
    cues = []
    for (const value of raw.cues) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return null
      const cue = value as Record<string, unknown>
      const id = cue.id
      const name = text(cue.name)
      if (typeof id !== "string" || !/^[a-zA-Z0-9._-]{1,80}$/.test(id) || seen.has(id) || !name || cue.trigger !== "manual") return null
      if (!Array.isArray(cue.steps) || cue.steps.length === 0 || cue.steps.length > 12 || cue.steps.some((step) => typeof step !== "string" || step.length === 0 || step.length > 60)) return null
      seen.add(id)
      cues.push({ id, name, trigger: "manual", steps: [...cue.steps] as string[] })
    }
  }
  return {
    schema_version: 1,
    ...(role ? { role } : {}),
    ...(duration !== undefined ? { duration_minutes: duration } : {}),
    ...(ownership ? { ownership } : {}),
    ...(cues !== undefined ? { cues } : {}),
    ...(Object.keys(raw).some((key) => !EVENT_FIELDS.has(key)) ? { payload_extra: Object.fromEntries(Object.entries(raw).filter(([key]) => !EVENT_FIELDS.has(key))) } : {}),
  }
}

/** A section boundary: an event may contain ordinary groups; a group ends at the next header. */
function sectionEndAt(headers: OutlineHeader[], sortedIndex: number, itemCount: number): number {
  const h = headers[sortedIndex]
  const boundary = headers.slice(sortedIndex + 1).find((next) =>
    h.type === "phase" ? next.type === "phase" : h.event ? next.type === "phase" || !!next.event : true,
  )
  return boundary?.at ?? itemCount
}

/** Project legacy ordered rows into the event → moments model without rewriting their item ids. */
export function projectRunOfShowEvents<T>(items: T[], headers: OutlineHeader[]): RunOfShowEvent<T>[] {
  const sorted = sortHeaders(headers)
  return sorted.flatMap((h, index) => {
    if (!h.event) return []
    const end = sectionEndAt(sorted, index, items.length)
    return [{
      id: h.id,
      title: h.name,
      ...(h.event.role ? { role: h.event.role } : {}),
      ...(h.event.duration_minutes !== undefined ? { duration_minutes: h.event.duration_minutes } : {}),
      ...(h.event.ownership ? { ownership: h.event.ownership } : {}),
      notes: h.notes,
      moments: items.slice(h.at, end),
    }]
  })
}

export interface RunOfShowClockRow<T> {
  id: string
  reference: string
  kind: "event" | "item"
  /** The event's approved estimate, or the sum of its moments when no event estimate is set. */
  planned_minutes: number | null
  starts_at?: string | null
  end_by?: string | null
  gap_minutes?: number | null
  timing?: { milestone?: boolean; soft_end_minutes?: number; warn_minutes?: number } | null
  hidden?: boolean | null
  /** Original moment records; an ordinary legacy row contains itself. */
  moments: T[]
  /** The first queue index represented by this clock row. */
  sourceAt: number
}

type ClockItem = {
  id: string
  reference: string
  planned_minutes?: number | null
  starts_at?: string | null
  end_by?: string | null
  gap_minutes?: number | null
  timing?: RunOfShowClockRow<unknown>["timing"]
  hidden?: boolean | null
}

/**
 * Project the ordered content rows into the events a Timekeeper starts. A versioned event owns its
 * moments and its planned length; services without event headers retain one clock row per item.
 * Phase and ordinary group boundaries are projected onto the resulting event order for timing.
 */
export function runOfShowClockRows<T extends ClockItem>(items: T[], headers: OutlineHeader[]): { rows: RunOfShowClockRow<T>[]; headers: OutlineHeader[] } {
  const sorted = sortHeaders(headers)
  const eventHeaders = sorted.filter((h) => h.event)
  const ranges = eventHeaders.map((header) => ({ header, start: header.at, end: sectionEndAt(sorted, sorted.indexOf(header), items.length) }))
  const candidates: Array<{ row: RunOfShowClockRow<T>; order: number }> = []

  for (const range of ranges) {
    const moments = items.slice(range.start, range.end)
    const total = moments.reduce((sum, item) => sum + (item.planned_minutes ?? 0), 0)
    candidates.push({
      order: headers.indexOf(range.header),
      row: {
        id: range.header.id,
        reference: range.header.name,
        kind: "event",
        planned_minutes: range.header.event!.duration_minutes ?? (total > 0 ? total : null),
        moments,
        sourceAt: range.start,
      },
    })
  }

  items.forEach((item, index) => {
    if (ranges.some((range) => index >= range.start && index < range.end)) return
    candidates.push({
      order: headers.length + index,
      row: {
        id: item.id,
        reference: item.reference,
        kind: "item",
        planned_minutes: item.planned_minutes ?? null,
        ...(item.starts_at !== undefined ? { starts_at: item.starts_at } : {}),
        ...(item.end_by !== undefined ? { end_by: item.end_by } : {}),
        ...(item.gap_minutes !== undefined ? { gap_minutes: item.gap_minutes } : {}),
        ...(item.timing !== undefined ? { timing: item.timing } : {}),
        ...(item.hidden !== undefined ? { hidden: item.hidden } : {}),
        moments: [item],
        sourceAt: index,
      },
    })
  })

  candidates.sort((a, b) => a.row.sourceAt - b.row.sourceAt || a.order - b.order)
  const rows = candidates.map(({ row }) => row)
  const projectedHeaders = headers.flatMap((header, order) => {
    if (header.event || (header.type === "group" && ranges.some((range) => header.id !== range.header.id && header.at >= range.start && header.at < range.end))) return []
    const at = candidates.filter((candidate) => candidate.row.sourceAt < header.at || (candidate.row.sourceAt === header.at && candidate.order < order)).length
    return [{ ...header, at }]
  })
  return { rows, headers: projectedHeaders }
}

const shift = (headers: OutlineHeader[], from: number, by: 1 | -1): OutlineHeader[] =>
  headers.map((h) => (h.at > from ? { ...h, at: h.at + by } : h))

/** An item was inserted at `index`: it joins the section whose header sits right above it. */
export function headersAfterInsert(headers: OutlineHeader[], index: number): OutlineHeader[] {
  return shift(headers, index, 1)
}

/** Where an item appended to a section goes: the end of that phase, event or group. */
export function sectionEnd(itemCount: number, headers: OutlineHeader[], headerId: string): number {
  return sectionInsertionPoint(itemCount, headers, headerId).at
}

/** Where a new event belongs at the end of a phase/event/group, including same-index header order. */
export function sectionInsertionPoint(itemCount: number, headers: OutlineHeader[], headerId: string): EventInsertionPoint {
  const sorted = sortHeaders(headers)
  const k = sorted.findIndex((h) => h.id === headerId)
  if (k === -1) return { at: 0 }
  const target = sorted[k]
  const boundary = sorted.slice(k + 1).find((next) =>
    target.type === "phase" ? next.type === "phase" : target.event ? next.type === "phase" || !!next.event : true,
  )
  return { at: boundary?.at ?? itemCount, ...(boundary ? { beforeHeaderId: boundary.id } : {}) }
}

/**
 * An item appended at `index` to the section of `headerId`: headers after that section move down
 * even when they sat at `index` (a plain insert would leave them above it, and the item in the
 * next section).
 */
export function headersAfterAppend(headers: OutlineHeader[], index: number, headerId: string): OutlineHeader[] {
  const sorted = sortHeaders(headers)
  const k = sorted.findIndex((h) => h.id === headerId)
  const target = sorted[k]
  const after = new Set(sorted.slice(k + 1).filter((h) => h.at === index && (target?.event ? h.type === "phase" || !!h.event : true)).map((h) => h.id))
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
  /** Items under the header: phases to next phase, events to next event/phase, groups to next header. */
  count: number
  /** Their planned minutes. */
  minutes: number
  /** Phase-only breakdown when the phase contains event headers. */
  eventCount?: number
  /** Queue items owned by those events. */
  momentCount?: number
  /** Queue items in the phase but outside its events. */
  looseItemCount?: number
}

/**
 * Whether Present passes over the item at `index` (#193): it is hidden, or its phase is skipped for
 * this service. It stays in the service (and in Prepare); Next, Previous, timed moves and phase
 * runs step over it, Present's running order leaves it out, and it takes no planned time.
 */
export function isSkipped(items: ReadonlyArray<{ hidden?: boolean | null }>, headers: OutlineHeader[], index: number): boolean {
  return !!items[index]?.hidden || !!phaseAt(headers, index)?.disabled
}

export interface VisibleRunItem<T> {
  item: T
  index: number
  kind: "item" | "moment"
  label: string
}

/** The first item Present can reach from an index, in either direction. */
export function visibleRunItemFrom<T extends { hidden?: boolean | null; kind?: string; reference: string }>(
  items: ReadonlyArray<T>, headers: OutlineHeader[], startIndex: number, direction: 1 | -1,
): VisibleRunItem<T> | null {
  for (let index = startIndex; index >= 0 && index < items.length; index += direction) {
    if (isSkipped(items, headers, index)) continue
    const item = items[index]
    const kind = item.kind === "cue" ? "moment" : "item"
    return { item, index, kind, label: kind === "moment" ? `Moment · ${item.reference}` : item.reference }
  }
  return null
}

/** The next visible rundown entry after the active index, or the first when nothing is active. */
export function nextVisibleItem<T extends { hidden?: boolean | null; kind?: string; reference: string }>(
  items: ReadonlyArray<T>, headers: OutlineHeader[], afterIndex: number | null,
): VisibleRunItem<T> | null {
  return visibleRunItemFrom(items, headers, (afterIndex ?? -1) + 1, 1)
}

/** The previous visible rundown entry before the active index. */
export function previousVisibleItem<T extends { hidden?: boolean | null; kind?: string; reference: string }>(
  items: ReadonlyArray<T>, headers: OutlineHeader[], beforeIndex: number,
): VisibleRunItem<T> | null {
  return visibleRunItemFrom(items, headers, beforeIndex - 1, -1)
}

/** The items as the plan counts them: a skipped one keeps its place but takes no time and has no fixed start. */
export function timedItems<T extends { hidden?: boolean | null; planned_minutes?: number | null; starts_at?: string | null; gap_minutes?: number | null }>(items: T[], headers: OutlineHeader[]): T[] {
  if (!items.some((_, i) => isSkipped(items, headers, i))) return items
  return items.map((it, i) => (isSkipped(items, headers, i) ? { ...it, planned_minutes: null, starts_at: null, gap_minutes: null } : it))
}

/** Mark skipped entries as hidden for consumers that only receive items, without the phase headers. */
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
  const sorted = [...headers].map((h, order) => ({ h, order })).sort((a, b) => a.h.at - b.h.at || a.order - b.order).map((x) => x.h)
  const clock = runOfShowClockRows(rawItems.map((item, index) => ({ ...item, id: String(index), reference: "" })), headers)
  const clockItems = timedItems(clock.rows, clock.headers)
  const out: Record<string, SectionSummary> = {}
  sorted.forEach((h, k) => {
    const end = sectionEndAt(sorted, k, rawItems.length)
    const slice = rawItems.slice(h.at, end)
    const nextPhaseIndex = h.type === "phase" ? sorted.findIndex((candidate, index) => index > k && candidate.type === "phase") : -1
    const phaseEvents = h.type === "phase"
      ? sorted.slice(k + 1, nextPhaseIndex === -1 ? sorted.length : nextPhaseIndex)
        .map((candidate, index) => ({ candidate, index: k + 1 + index }))
        .filter(({ candidate }) => !!candidate.event)
      : []
    const momentCount = phaseEvents.reduce((sum, { candidate, index }) => {
      const eventEnd = sectionEndAt(sorted, index, rawItems.length)
      return sum + Math.max(0, Math.min(end, eventEnd) - Math.max(h.at, candidate.at))
    }, 0)
    const nestedMomentGroup = h.type === "group" && sorted.some((event) => event.event && h.at >= event.at && h.at < sectionEndAt(sorted, sorted.indexOf(event), rawItems.length))
    const minutes = h.event
      ? phaseAt(headers, h.at)?.disabled ? 0 : h.event.duration_minutes ?? slice.reduce((sum, item) => sum + (item.planned_minutes ?? 0), 0)
      : nestedMomentGroup
        ? slice.reduce((sum, item, offset) => sum + (isSkipped(rawItems, headers, h.at + offset) ? 0 : item.planned_minutes ?? 0), 0)
        : clockItems.filter((item) => item.sourceAt >= h.at && item.sourceAt < end).reduce((sum, item) => sum + (item.planned_minutes ?? 0), 0)
    out[h.id] = {
      count: slice.length,
      minutes,
      ...(phaseEvents.length > 0 ? {
        eventCount: phaseEvents.length,
        momentCount,
        looseItemCount: Math.max(0, slice.length - momentCount),
      } : {}),
    }
  })
  return out
}

/** A new event begins as a draft plan; taking one of its moments never approves the service. */
export function newRunOfShowEvent(
  at: number,
  newId: () => string = () => crypto.randomUUID(),
  details: { title?: string; role?: string } = {},
): OutlineHeader {
  return {
    id: newId(),
    type: "group",
    name: details.title?.trim() || "New event",
    at,
    event: { schema_version: 1, ...(details.role?.trim() ? { role: details.role.trim() } : {}) },
  }
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

/** Keep existing event/group headers inside Main service when adding phases. */
export function organiseHeadersIntoDefaultPhases(headers: OutlineHeader[], itemCount: number, newId?: () => string): OutlineHeader[] {
  const phases = defaultPhases(itemCount, newId)
  const postIndex = phases.findIndex((phase) => phase.role === "post")
  return postIndex < 0
    ? [...phases, ...headers]
    : [...phases.slice(0, postIndex), ...headers, ...phases.slice(postIndex)]
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
