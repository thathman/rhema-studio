import { clockMinutes, phaseRange, type OutlineHeader } from "@/lib/run-of-show"

/**
 * The run of show's timing engine (issue #196, R1/R3): pure and deterministic, from an explicit
 * snapshot and the time now. Three schedules stay apart and the plan is never rewritten:
 * - planned: from the main service's start time and each item's planned minutes;
 * - actual: when items really went on air and for how long (the service log);
 * - expected: what happened so far, the live item's remaining time, then the plan for the rest.
 * An item's "end by" is a hard stop: the time it may take is cut to fit, and flagged.
 */
export interface TimingItem {
  id: string
  reference: string
  planned_minutes?: number | null
  end_by?: string | null
}

export interface TimingInput {
  items: TimingItem[]
  headers: OutlineHeader[]
  /** When each item first went on air (wall ms). */
  firstOnAir: Map<string, number>
  /** Total time on air per item (ms), the live one up to now. */
  onAirMs: Map<string, number>
  liveItemId: string | null
  /** Wall ms. Planned times fall on this day. */
  now: number
  /** The operator's own correction for what is still to come (±5 min), in minutes. */
  adjustMinutes?: number
}

export type EventState = "done" | "live" | "upcoming"

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

function onDay(now: number, minutes: number): number {
  const d = new Date(now)
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  return d.getTime()
}

/** The main service's timing, or null without a main phase and start time. */
export function serviceTiming(input: TimingInput): ServiceTiming | null {
  const { items, headers, firstOnAir, onAirMs, liveItemId, now } = input
  const main = headers.find((h) => h.type === "phase" && h.role === "main") ?? headers.find((h) => h.type === "phase" && h.rule === "manual")
  const startMinutes = clockMinutes(main?.starts_at)
  const range = main ? phaseRange(items.length, headers, main.id) : null
  if (!main || startMinutes === null || !range) return null
  const start = onDay(now, startMinutes)
  const list = items.slice(range.start, range.end)
  const liveAt = list.findIndex((i) => i.id === liveItemId)
  const events: EventTiming[] = []
  let planned = start
  // Before anything has gone on air the service starts at its time, or now if that has passed.
  let cursor = start
  let adjusted = false
  list.forEach((item, k) => {
    const ms = (item.planned_minutes ?? 0) * MINUTE
    const endBy = clockMinutes(item.end_by)
    const hardStop = endBy === null ? null : onDay(now, endBy)
    const actualStart = firstOnAir.get(item.id) ?? null
    const state: EventState = k === liveAt ? "live" : actualStart !== null && (liveAt === -1 || k < liveAt) ? "done" : "upcoming"
    let expectedStart: number
    let expectedEnd: number
    if (state === "done") {
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
      expectedStart = Math.max(cursor, now)
      expectedEnd = expectedStart + ms
    }
    let squeezed = false
    if (hardStop !== null && state !== "done" && expectedEnd > hardStop) {
      expectedEnd = Math.max(expectedStart, hardStop)
      squeezed = true
    }
    events.push({ id: item.id, index: range.start + k, label: item.reference, plannedStart: planned, plannedEnd: planned + ms, expectedStart, expectedEnd, actualStart, state, hardStop, squeezed })
    planned += ms
    cursor = expectedEnd
  })
  const expectedEnd = events.length ? events[events.length - 1].expectedEnd : Math.max(start, now)
  return { start, plannedEnd: planned, expectedEnd, lateMs: expectedEnd - planned, events }
}
