import { clockInstant, clockMinutes, phaseRange, type OutlineHeader, type PhaseRole } from "@/lib/run-of-show"
import { cleanItemTiming, warnMs } from "@/lib/item-timing"
import type { ItemTiming } from "@/types/queue"

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
 * Later rules (#196 R1.2, R2.10, R3.4, R3.8): clock times are on the church's time zone; a hold
 * stops the live item's time running out (it is expected to end later by the time held); a
 * milestone takes no time; a soft end lets an item run longer before it counts as over; the
 * offset can be pushed through everything instead of being absorbed; after a restart the item
 * that was running is flagged as not trusted, and the engine makes up no time for it.
 * The rules are in docs/rhema-studio/25-adr-0004-timing.md.
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
  /** A milestone, a soft end, its own warning. */
  timing?: ItemTiming | null
}

/**
 * How the operator's offset reaches what is still to come (#196 R3.4). "absorb" (the default):
 * pauses take it up and fixed starts keep their time. "push": everything still to come moves by
 * it, pauses and fixed starts too; a hard stop still cuts, and takes up what it cuts.
 */
export type OffsetMode = "absorb" | "push"

/** A hold (wall ms): `until` is null while it is still on. */
export interface HoldSpan {
  since: number
  until: number | null
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
  offsetMode?: OffsetMode
  /** The church's time zone (Setup); "" or absent: this computer's clock. */
  timeZone?: string
  /** The service's holds so far, the one on now last. */
  holds?: HoldSpan[]
  /** The item that was running when Rhema closed unexpectedly, until the operator confirms its time or takes it again. */
  untrustedId?: string | null
  /** When the operator finished the service (wall ms); absent while it runs. */
  finishedAt?: number | null
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
  /** A moment, not a stretch of time: no minutes; passed once something after it has begun. */
  milestone: boolean
  /** Live past its end (its soft end, when it has one), or done after running past it. */
  overrun: boolean
  /** Live or to come with a soft end: when that runs out (wall ms). */
  softEnd: number | null
  /** How long before its end its timer turns amber (ms). */
  warnMs: number
  /** Live: how long it has been on hold (ms); its expected end is that much later. */
  heldMs: number
  /** It was running when Rhema closed unexpectedly: how long it has run can't be trusted. */
  untrusted: boolean
}

/** Expected times for a phase or a group (#196 R1.5), wall ms; null where it has none. */
export interface SectionTiming {
  id: string
  type: "phase" | "group"
  name: string
  role?: PhaseRole
  plannedStart: number | null
  plannedEnd: number | null
  expectedStart: number | null
  expectedEnd: number | null
  state: "upcoming" | "live" | "done"
  /** A loop: it runs until stopped, so it has no end of its own. */
  loop: boolean
}

export interface ServiceTiming {
  start: number
  plannedEnd: number
  expectedEnd: number
  /** Expected minus planned end: positive when running late. */
  lateMs: number
  events: EventTiming[]
  /** Every phase, and each group of the main service, in reading order. */
  sections: SectionTiming[]
  /** A hold is on now. */
  held: boolean
  /** The operator finished the service. */
  finished: boolean
}

const MINUTE = 60_000

/** The main service's timing, or null without a main phase and start time. */
export function serviceTiming(input: TimingInput): ServiceTiming | null {
  const { items, headers, firstOnAir, onAirMs, now } = input
  const zone = input.timeZone ?? ""
  const holds = input.holds ?? []
  const held = holds.some((h) => h.until === null)
  const finished = typeof input.finishedAt === "number"
  // Time on hold between two instants.
  const heldIn = (from: number, to: number) => holds.reduce((sum, h) => sum + Math.max(0, Math.min(h.until ?? now, to) - Math.max(h.since, from)), 0)
  const main = headers.find((h) => h.type === "phase" && h.role === "main") ?? headers.find((h) => h.type === "phase" && h.rule === "manual")
  const startMinutes = clockMinutes(main?.starts_at)
  const range = main ? phaseRange(items.length, headers, main.id) : null
  if (!main || startMinutes === null || !range) return null
  const list = items.slice(range.start, range.end)
  // Once begun, the start is the one nearest when it began (a 23:30 service still running at 00:10).
  const began = Math.min(...list.flatMap((i) => (firstOnAir.has(i.id) ? [firstOnAir.get(i.id)!] : [])))
  const start = clockInstant(startMinutes, Number.isFinite(began) ? began : now, zone)
  let liveAt = finished ? -1 : list.findIndex((i) => i.id === input.liveItemId)
  // The last item that has been on air (or is now): anything before it that never was, was skipped.
  const lastOn = (live: number) => list.reduce((last, i, k) => (k === live || firstOnAir.has(i.id) ? k : last), -1)
  // After a restart, the item running when Rhema closed is still the one happening, if nothing
  // has started since and nothing says it ended; its start is in the log, its run time is not trusted.
  const untrustedAt = input.untrustedId ? list.findIndex((i) => i.id === input.untrustedId && firstOnAir.has(i.id)) : -1
  if (liveAt === -1 && !finished && !input.liveItemId && untrustedAt !== -1 && untrustedAt === lastOn(-1)) liveAt = untrustedAt
  // The time now matters once the service has begun. Before that (planning on Thursday for Sunday,
  // or rehearsing in the evening) what is expected is the plan, not "12 h late"; a hold on now
  // means nothing still to come can start before now either.
  const begun = liveAt !== -1 || list.some((i) => firstOnAir.has(i.id))
  const lastAired = lastOn(liveAt)
  // Finished: whatever never went on air was skipped.
  const cutoff = finished ? list.length : lastAired
  const floor = begun || held ? now : -Infinity
  const adjustMs = (input.adjustMinutes ?? 0) * MINUTE
  const push = input.offsetMode === "push"
  const events: EventTiming[] = []
  let planned = start
  // Before anything has gone on air the service starts at its time, or now if that has passed.
  let cursor = start
  // The same, without the operator's offset: a fixed start waits only for what really runs late.
  let real = start
  let adjusted = false
  // Pushing: how much of the offset still moves what is to come (a hard stop takes some up).
  let carried = 0
  list.forEach((item, k) => {
    const rules = cleanItemTiming(item.timing)
    const milestone = rules?.milestone === true
    const ms = milestone ? 0 : (item.planned_minutes ?? 0) * MINUTE
    const softMs = rules?.soft_end_minutes ? Math.max(ms, rules.soft_end_minutes * MINUTE) : ms
    const fixedAt = clockMinutes(item.starts_at)
    // Nearest the end of the item before: "starts at 00:05" after a 23:50 item is that night's.
    const fixedStart = fixedAt === null ? null : clockInstant(fixedAt, planned, zone)
    const plannedStart = fixedStart ?? planned + gapMinutes(item.gap_minutes) * MINUTE
    const gapMs = Math.max(0, plannedStart - planned)
    const endBy = clockMinutes(item.end_by)
    // Nearest the item's planned start: "end by 00:15" after a 23:50 start is that night's.
    const hardStop = endBy === null ? null : clockInstant(endBy, plannedStart, zone)
    const fit = (from: number) => (hardStop !== null && from + ms > hardStop ? Math.max(from, hardStop) : from + ms)
    const actualStart = firstOnAir.get(item.id) ?? null
    const passed = actualStart === null && k < cutoff
    // A milestone something after it has begun was reached, not skipped.
    const state: EventState = k === liveAt ? "live" : actualStart !== null && (liveAt === -1 || k < liveAt) ? "done" : passed ? (milestone && k < lastAired ? "done" : "skipped") : "upcoming"
    let expectedStart: number
    let expectedEnd: number
    let absorbedMs = 0
    let heldMs = 0
    if (state === "skipped" || (state === "done" && actualStart === null)) {
      expectedStart = cursor
      expectedEnd = cursor
    } else if (state === "done") {
      expectedStart = actualStart!
      expectedEnd = actualStart! + (onAirMs.get(item.id) ?? 0)
    } else if (state === "live") {
      expectedStart = actualStart ?? now
      // Held while it runs: its time does not run out meanwhile.
      heldMs = heldIn(expectedStart, now)
      expectedEnd = milestone ? expectedStart : Math.max(expectedStart + ms + heldMs, now)
    } else {
      if (!adjusted) {
        if (push) carried = adjustMs
        else cursor += adjustMs
        adjusted = true
      }
      // Linked: late by less than the pause, it starts on plan; early, the pause is kept.
      const linked = (after: number) => Math.max(after - planned > 0 ? Math.max(after, plannedStart) : after + gapMs, floor)
      if (push) {
        // Worked out without the offset, then moved by all of it that is still carried.
        const base = fixedStart !== null ? Math.max(fixedStart, real, floor) : linked(real)
        expectedStart = Math.max(base + carried, floor)
        absorbedMs = gapMs - Math.min(gapMs, Math.max(0, base - real))
        real = fit(base)
      } else {
        expectedStart = fixedStart !== null ? Math.max(fixedStart, real, floor) : linked(cursor)
        absorbedMs = gapMs - Math.min(gapMs, Math.max(0, expectedStart - cursor))
        real = fit(fixedStart !== null ? expectedStart : linked(real))
      }
      expectedEnd = expectedStart + ms
    }
    let squeezed = false
    if (hardStop !== null && state !== "done" && state !== "skipped" && expectedEnd > hardStop) {
      expectedEnd = Math.max(expectedStart, hardStop)
      squeezed = true
    }
    if (push && state === "upcoming") carried = expectedEnd - real
    const conflict = state === "upcoming" && fixedStart !== null && expectedStart > fixedStart
    const overrun = ms > 0 && (state === "live" ? now > expectedStart + heldMs + softMs : state === "done" && actualStart !== null && (onAirMs.get(item.id) ?? 0) > softMs)
    const softEnd = rules?.soft_end_minutes && (state === "live" || state === "upcoming") ? expectedStart + heldMs + softMs : null
    events.push({
      id: item.id, index: range.start + k, label: item.reference, plannedStart, plannedEnd: plannedStart + ms, expectedStart, expectedEnd, actualStart, state, hardStop, squeezed, fixedStart, conflict, gapMs, absorbedMs,
      milestone, overrun, softEnd, warnMs: warnMs(rules), heldMs, untrusted: k === untrustedAt,
    })
    planned = plannedStart + ms
    cursor = expectedEnd
    if (state !== "upcoming") real = expectedEnd
  })
  const expectedEnd = events.length ? events[events.length - 1].expectedEnd : Math.max(start, now)
  const timing: ServiceTiming = { start, plannedEnd: planned, expectedEnd, lateMs: expectedEnd - planned, events, sections: [], held, finished }
  timing.sections = sectionTimings(input, main, timing, heldIn)
  return timing
}

/** A pause as saved: minutes above 0, at most 600; anything else is none. */
export function gapMinutes(m: number | null | undefined): number {
  return typeof m === "number" && m > 0 && m <= 600 ? m : 0
}

const minutesOf = (i: TimingItem) => (cleanItemTiming(i.timing)?.milestone ? 0 : (i.planned_minutes ?? 0) * MINUTE)

function sectionState(events: EventTiming[]): SectionTiming["state"] {
  if (events.some((e) => e.state === "live")) return "live"
  const over = events.filter((e) => e.state === "done" || e.state === "skipped").length
  return events.length && over === events.length ? "done" : over > 0 ? "live" : "upcoming"
}

/**
 * Each phase's and each main-service group's expected times (#196 R1.5). The main service's and its
 * groups' come from its items. A run-once phase before it (the warm-up) is planned to end as it
 * starts; a phase after it follows it. A loop runs until stopped: its end is when the next phase
 * begins, and nothing after a loop has a time of its own.
 */
function sectionTimings(input: TimingInput, main: OutlineHeader, t: ServiceTiming, heldIn: (from: number, to: number) => number): SectionTiming[] {
  const { items, headers, firstOnAir, onAirMs, now } = input
  const sorted = [...headers].map((h, order) => ({ h, order })).sort((a, b) => a.h.at - b.h.at || a.order - b.order).map((x) => x.h)
  const phases = sorted.filter((h) => h.type === "phase")
  const out = new Map<string, SectionTiming>()
  const mainEvents = t.events
  const mainBegan = mainEvents.find((e) => e.actualStart !== null)?.actualStart ?? null
  out.set(main.id, {
    id: main.id, type: "phase", name: main.name, role: main.role, plannedStart: t.start, plannedEnd: t.plannedEnd,
    expectedStart: mainBegan ?? mainEvents[0]?.expectedStart ?? t.start, expectedEnd: t.expectedEnd,
    state: t.finished ? "done" : sectionState(mainEvents), loop: false,
  })
  // A plain group ends at the next header; an event group includes any nested moment groups.
  const mainRange = phaseRange(items.length, headers, main.id)!
  sorted.forEach((g, k) => {
    if (g.type !== "group" || g.at < mainRange.start || g.at >= mainRange.end) return
    const end = Math.min(sorted.slice(k + 1).find((next) => g.event ? next.type === "phase" || !!next.event : true)?.at ?? items.length, mainRange.end)
    const evs = mainEvents.filter((e) => e.index >= g.at && e.index < end)
    if (!evs.length) return
    const first = evs.find((e) => e.state !== "skipped") ?? evs[0]
    out.set(g.id, { id: g.id, type: "group", name: g.name, plannedStart: evs[0].plannedStart, plannedEnd: evs.at(-1)!.plannedEnd, expectedStart: first.expectedStart, expectedEnd: evs.at(-1)!.expectedEnd, state: t.finished ? "done" : sectionState(evs), loop: false })
  })
  // A phase's own items: who began when, and when what is left of it is expected to end, from `from`.
  const run = (r: { start: number; end: number }, from: number) => {
    let cur = from
    let first: number | null = null
    for (const i of items.slice(r.start, r.end)) {
      const at = firstOnAir.get(i.id)
      if (i.id === input.liveItemId) {
        const s = at ?? now
        first ??= s
        cur = Math.max(s + minutesOf(i) + heldIn(s, now), now)
      } else if (at !== undefined) {
        first ??= at
        cur = at + (onAirMs.get(i.id) ?? 0)
      } else cur = (first !== null ? Math.max(cur, now) : cur) + minutesOf(i)
    }
    return { first, end: cur, live: items.slice(r.start, r.end).some((i) => i.id === input.liveItemId) }
  }
  const at = phases.indexOf(main)
  // After the main service, in order.
  let prevPlanned: number | null = t.plannedEnd
  let prevExpected: number | null = t.expectedEnd
  for (const p of phases.slice(at + 1)) {
    const r = phaseRange(items.length, headers, p.id)!
    const loop = p.rule === "loop"
    const mins = items.slice(r.start, r.end).reduce((m, i) => m + minutesOf(i), 0)
    const ran = run(r, prevExpected ?? now)
    const expectedStart: number | null = ran.first ?? prevExpected
    out.set(p.id, {
      id: p.id, type: "phase", name: p.name, role: p.role, loop,
      plannedStart: prevPlanned, plannedEnd: loop || prevPlanned === null ? null : prevPlanned + mins,
      expectedStart, expectedEnd: loop || expectedStart === null ? null : ran.end,
      state: ran.live ? "live" : ran.first !== null ? "done" : "upcoming",
    })
    prevPlanned = loop || prevPlanned === null ? null : prevPlanned + mins
    prevExpected = loop || expectedStart === null ? null : ran.end
  }
  // Before it, backwards: each ends as the phase after it begins.
  let nextPlanned: number | null = t.start
  let nextExpected: number | null = out.get(main.id)!.expectedStart
  let nextBegan: number | null = mainBegan
  for (const p of phases.slice(0, Math.max(0, at)).reverse()) {
    const r = phaseRange(items.length, headers, p.id)!
    const loop = p.rule === "loop"
    const mins = items.slice(r.start, r.end).reduce((m, i) => m + minutesOf(i), 0)
    const plannedStart: number | null = loop || nextPlanned === null ? null : nextPlanned - mins
    const ran = run(r, plannedStart ?? now)
    // Over once what follows it has begun: it ended then.
    const done = nextBegan !== null && !ran.live
    const expectedStart: number | null = ran.first ?? plannedStart
    const expectedEnd: number | null = done ? nextBegan : loop ? nextExpected : ran.first !== null ? ran.end : nextExpected
    out.set(p.id, { id: p.id, type: "phase", name: p.name, role: p.role, loop, plannedStart, plannedEnd: nextPlanned, expectedStart, expectedEnd, state: ran.live ? "live" : done ? "done" : "upcoming" })
    nextPlanned = plannedStart
    nextExpected = expectedStart
    nextBegan = ran.first ?? nextBegan
  }
  return sorted.flatMap((h) => out.get(h.id) ?? [])
}
