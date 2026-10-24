import { clockInstant, clockMinutes, phaseRange, type OutlineHeader } from "@/lib/run-of-show"

/**
 * The run of show's timing engine (issue #196, R1/R3): pure and deterministic, from an explicit
 * snapshot and the time now. Three schedules stay apart and the plan is never rewritten:
 * - planned: from the main service's start time and each item's planned minutes;
 * - actual: when items really went on air and for how long (the service log);
 * - expected: what happened so far, the live item's remaining time, then the plan for the rest;
 *   until the service has begun it is the plan itself, whatever the time now.
 * An item that never went on air while a later one did is skipped: it takes no expected time, and
 * what is expected carries on from the item live (or done) after it.
 * An item's "end by" is a hard stop: the time it may take is cut to fit, and flagged.
 * An item follows the one before it (linked), unless it has a fixed start: then it is expected at
 * that clock time however early or late what comes before runs, and the operator's offset does not
 * move it; when what runs before it goes past that time, it starts once that ends and says so.
 * A pause before an item (its gap) takes up lateness first: only what is left of it is waited out,
 * and only lateness beyond it pushes the item. The free time before a fixed start works the same.
 * The rules are in docs/rhema-studio/24-adr-0003-timing.md.
 */
export interface TimingItem {
  id: string
  reference: string
  planned_minutes?: number | null
  end_by?: string | null
  /** A fixed start, 24-hour "HH:MM"; absent: it follows the item before. */
  starts_at?: string | null
  /** A planned pause before it, in minutes. */
  gap_minutes?: number | null
}

export interface TimingInput {
  items: TimingItem[]
  headers: OutlineHeader[]
  /** When each item first went on air (wall ms). */
  firstOnAir: Map<string, number>
  /** Total time on air per item (ms), the live one up to now. */
  onAirMs: Map<string, number>
  liveItemId: string | null
  /** Wall ms. Planned times fall nearest it, or nearest when the service began once it has. */
  now: number
  /** The operator's own correction for what is still to come (±5 min), in minutes. */
  adjustMinutes?: number
}

export type EventState = "done" | "live" | "upcoming" | "skipped"

export interface EventTiming {
  id: string
  index: number
  label: string
  plannedStart: number
  plannedEnd: number
  expectedStart: number
  expectedEnd: number
  actualStart: number | null
  state: EventState
  /** Its "end by" as an instant, when set. */
  hardStop: number | null
  /** The expected time was cut to finish by the hard stop. */
  squeezed: boolean
  /** Its fixed start as an instant (then also its planned start), when it has one. */
  fixedStart: number | null
  /** Still to come and expected after its fixed start: what runs before it goes past that time. */
  conflict: boolean
  /** The planned pause before it (ms): its own gap, or the free time before its fixed start. */
  gapMs: number
  /** How much of that pause lateness is expected to take up (ms); 0 unless it is still to come. */
  absorbedMs: number
}

export interface ServiceTiming {
  start: number
  plannedEnd: number
  expectedEnd: number
  /** Expected minus planned end: positive when running late. */
  lateMs: number
  events: EventTiming[]
}

const MINUTE = 60_000

/** The main service's timing, or null without a main phase and start time. */
export function serviceTiming(input: TimingInput): ServiceTiming | null {
  const { items, headers, firstOnAir, onAirMs, liveItemId, now } = input
  const main = headers.find((h) => h.type === "phase" && h.role === "main") ?? headers.find((h) => h.type === "phase" && h.rule === "manual")
  const startMinutes = clockMinutes(main?.starts_at)
  const range = main ? phaseRange(items.length, headers, main.id) : null
  if (!main || startMinutes === null || !range) return null
  const list = items.slice(range.start, range.end)
  // Once begun, the start is the one nearest when it began (a 23:30 service still running at 00:10).
  const began = Math.min(...list.flatMap((i) => (firstOnAir.has(i.id) ? [firstOnAir.get(i.id)!] : [])))
  const start = clockInstant(startMinutes, Number.isFinite(began) ? began : now)
  const liveAt = list.findIndex((i) => i.id === liveItemId)
  // The time now matters once the service has begun. Before that (planning on Thursday for Sunday,
  // or rehearsing in the evening) what is expected is the plan, not "12 h late".
  const begun = liveAt !== -1 || list.some((i) => firstOnAir.has(i.id))
  // The last item that has been on air (or is now): anything before it that never was, was skipped.
  const lastAired = list.reduce((last, i, k) => (k === liveAt || firstOnAir.has(i.id) ? k : last), -1)
  const events: EventTiming[] = []
  let planned = start
  // Before anything has gone on air the service starts at its time, or now if that has passed.
  let cursor = start
  // The same, without the operator's offset: a fixed start waits only for what really runs late.
  let real = start
  let adjusted = false
  list.forEach((item, k) => {
    const ms = (item.planned_minutes ?? 0) * MINUTE
    const fixedAt = clockMinutes(item.starts_at)
    // Nearest the end of the item before: "starts at 00:05" after a 23:50 item is that night's.
    const fixedStart = fixedAt === null ? null : clockInstant(fixedAt, planned)
    const plannedStart = fixedStart ?? planned + gapMinutes(item.gap_minutes) * MINUTE
    const gapMs = Math.max(0, plannedStart - planned)
    const endBy = clockMinutes(item.end_by)
    // Nearest the item's planned start: "end by 00:15" after a 23:50 start is that night's.
    const hardStop = endBy === null ? null : clockInstant(endBy, plannedStart)
    const fit = (from: number) => (hardStop !== null && from + ms > hardStop ? Math.max(from, hardStop) : from + ms)
    const actualStart = firstOnAir.get(item.id) ?? null
    const state: EventState = k === liveAt ? "live" : actualStart !== null && (liveAt === -1 || k < liveAt) ? "done" : actualStart === null && k < lastAired ? "skipped" : "upcoming"
    let expectedStart: number
    let expectedEnd: number
    let absorbedMs = 0
    if (state === "skipped") {
      expectedStart = cursor
      expectedEnd = cursor
    } else if (state === "done") {
      expectedStart = actualStart!
      expectedEnd = actualStart! + (onAirMs.get(item.id) ?? 0)
    } else if (state === "live") {
      expectedStart = actualStart ?? now
      expectedEnd = Math.max(expectedStart + ms, now)
    } else {
      if (!adjusted) {
        cursor += (input.adjustMinutes ?? 0) * MINUTE
        adjusted = true
      }
      const floor = begun ? now : -Infinity
      // Linked: late by less than the pause, it starts on plan; early, the pause is kept.
      const linked = (after: number) => Math.max(after - planned > 0 ? Math.max(after, plannedStart) : after + gapMs, floor)
      expectedStart = fixedStart !== null ? Math.max(fixedStart, real, floor) : linked(cursor)
      absorbedMs = gapMs - Math.min(gapMs, Math.max(0, expectedStart - cursor))
      real = fit(fixedStart !== null ? expectedStart : linked(real))
      expectedEnd = expectedStart + ms
    }
    let squeezed = false
    if (hardStop !== null && state !== "done" && state !== "skipped" && expectedEnd > hardStop) {
      expectedEnd = Math.max(expectedStart, hardStop)
      squeezed = true
    }
    const conflict = state === "upcoming" && fixedStart !== null && expectedStart > fixedStart
    events.push({ id: item.id, index: range.start + k, label: item.reference, plannedStart, plannedEnd: plannedStart + ms, expectedStart, expectedEnd, actualStart, state, hardStop, squeezed, fixedStart, conflict, gapMs, absorbedMs })
    planned = plannedStart + ms
    cursor = expectedEnd
    if (state !== "upcoming") real = expectedEnd
  })
  const expectedEnd = events.length ? events[events.length - 1].expectedEnd : Math.max(start, now)
  return { start, plannedEnd: planned, expectedEnd, lateMs: expectedEnd - planned, events }
}

/** A pause as saved: minutes above 0, at most 600; anything else is none. */
export function gapMinutes(m: number | null | undefined): number {
  return typeof m === "number" && m > 0 && m <= 600 ? m : 0
}
