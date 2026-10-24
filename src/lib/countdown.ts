import type { CountdownTo, StageAux } from "@/types"
import { clockAt } from "@/lib/church-time"
import { formatMs } from "@/lib/timer"
import type { ServiceTiming } from "@/lib/timing-engine"

/**
 * "Time until" clocks (#196 R2): from the run of show's timing, when the next item is expected to
 * start, when the main service is expected to end, and each item's "end by". Instants (wall ms), so
 * a service around midnight counts down across it. Pure: the host works these out once and every
 * clock (scene layers, the stage, Timekeeper, the chime) counts to the same moment.
 */
export interface CountdownTarget {
  /** What it counts down to, as a picker and the stage name it ("Sermon", "End of the main service"). */
  label: string
  at: number
}

export interface CountdownTargets {
  /** The next item still to come; null once the last item is on (or none is left). */
  next: CountdownTarget | null
  /** The main service's expected end. */
  end: CountdownTarget | null
  /** Each item with an "end by", by item id. */
  endBy: Record<string, CountdownTarget>
}

export const NO_COUNTDOWNS: CountdownTargets = { next: null, end: null, endBy: {} }

/** `zone`: the church's time zone for the "end by" times in the labels ("" = this computer's). */
export function countdownTargets(timing: ServiceTiming | null, zone = ""): CountdownTargets {
  if (!timing) return NO_COUNTDOWNS
  // Skipped items are never next; neither is anything done or on now.
  const next = timing.events.find((e) => e.state === "upcoming")
  const endBy: Record<string, CountdownTarget> = {}
  for (const e of timing.events) if (e.hardStop !== null) endBy[e.id] = { label: `${e.label} · end by ${clockAt(e.hardStop, zone)}`, at: e.hardStop }
  return { next: next ? { label: next.label, at: next.expectedStart } : null, end: { label: "End of the main service", at: timing.expectedEnd }, endBy }
}

export function isCountdownTo(v: unknown): v is CountdownTo {
  return v === "next" || v === "end" || (typeof v === "string" && /^endby:.{1,120}$/.test(v))
}

export function countdownTarget(targets: CountdownTargets | null | undefined, to: CountdownTo | undefined): CountdownTarget | null {
  if (!targets || !to) return null
  if (to === "next") return targets.next
  if (to === "end") return targets.end
  return targets.endBy[to.slice("endby:".length)] ?? null
}

/** What a picker offers: the next item, the service end, then each "end by" in the run of show. */
export function countdownChoices(targets: CountdownTargets | null | undefined): { value: CountdownTo; label: string }[] {
  return [
    { value: "next", label: "The next item" },
    { value: "end", label: "The end of the main service" },
    ...Object.entries(targets?.endBy ?? {}).map(([id, t]) => ({ value: `endby:${id}` as CountdownTo, label: t.label })),
  ]
}

/**
 * Keep a target that is already due where it was: while the item on now runs over, the next one is
 * expected "now", every time it is worked out. Holding the moment it first became due keeps the
 * clocks still (no frames resent every few seconds) and lets a private view say how long it is over.
 */
export function steadyTarget(prev: CountdownTarget | null, next: CountdownTarget | null, now: number): CountdownTarget | null {
  return prev && next && prev.label === next.label && prev.at <= now && next.at <= now ? prev : next
}

export function steadyTargets(prev: CountdownTargets | null, next: CountdownTargets, now: number): CountdownTargets {
  if (!prev) return next
  return { next: steadyTarget(prev.next, next.next, now), end: steadyTarget(prev.end, next.end, now), endBy: next.endBy }
}

/**
 * A countdown as a private view (the stage, Timekeeper) words it: "Next: Sermon in 3:12", and once
 * due "Next: Sermon 0:45 over". The congregation's clock layers stop at 0:00 instead.
 */
export function countdownLine(to: CountdownTo, target: CountdownTarget, now: number): StageAux {
  const left = target.at - now
  const name = to === "next" ? `Next: ${target.label}` : target.label
  if (left <= -1000) return { label: name, text: `${formatMs(-left)} over`, tone: "over" }
  return { label: `${name} in`, text: formatMs(Math.max(0, left) + 999), tone: left <= 120_000 ? "warn" : "ok" }
}

export type Chime = "before" | "zero"

/** A chime missed by more than this (the computer asleep, the window held back) is let go, not played late. */
const CHIME_LATE_MS = 10_000

/**
 * Which chimes are due as the time moves from `from` to `now`: `minutes` before `at` (when more than
 * 0) and at `at` itself. Each is due once, as the time passes it.
 */
export function chimesDue(at: number, minutes: number, from: number, now: number): Chime[] {
  const due: Chime[] = []
  const passed = (t: number) => from < t && t <= now && now - t <= CHIME_LATE_MS
  if (minutes > 0 && passed(at - minutes * 60_000)) due.push("before")
  if (passed(at)) due.push("zero")
  return due
}
