import type { CountdownCounts, CountdownFrame, CountdownLook, CountdownStep } from "@/types"
import { formatMs } from "@/lib/timer"

/**
 * The countdown display (owner request 2026-10-24): one big time for the stage, a confidence
 * monitor or the back of the hall, whose whole screen changes colour in steps as time runs out
 * (black, then amber at 25 %, red at 10 %, "Time's up" with a gentle pulse at 0) and counts on
 * as "+0:42" when over. Pure: the host builds a frame, every screen works out the rest by itself.
 */

/** The pulse's speed. Accessibility: nothing on a screen may flash more than 3 times a second. */
export const PULSE_HZ = 1
export const MAX_FLASH_HZ = 3
/** How far the pulse darkens the background at its deepest (0–1): gentle, never black to colour. */
export const PULSE_DEPTH = 0.3
/** How long a change of step takes to blend in (ms). */
export const FADE_MS = 300
export const MAX_STEPS = 6

export const DEFAULT_COUNTDOWN_STEPS: readonly CountdownStep[] = [
  { when: "percent", at: 25, background: "#d97706", text: "#000000", message: "", pulse: false },
  { when: "percent", at: 10, background: "#c81e1e", text: "#ffffff", message: "Please wrap up", pulse: false },
  { when: "time", at: 0, background: "#c81e1e", text: "#ffffff", message: "Time's up", pulse: true },
]

export const DEFAULT_COUNTDOWN_LOOK: CountdownLook = {
  counts: "timer",
  auxLabel: "",
  until: "",
  leadMinutes: 10,
  background: "#000000",
  text: "#ffffff",
  steps: DEFAULT_COUNTDOWN_STEPS.map((s) => ({ ...s })),
  showMessage: true,
  showItem: true,
  showNext: false,
  showClock: true,
}

const COUNTS: readonly CountdownCounts[] = ["timer", "item", "aux", "until", "start"]
const hex = (v: unknown, fallback: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback)
const flag = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback)
const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback)
const text = (v: unknown, most: number) => (typeof v === "string" ? v.trim().slice(0, most) : "")

function normalizeStep(raw: unknown): CountdownStep | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Partial<CountdownStep>
  const when = r.when === "time" ? "time" : r.when === "percent" ? "percent" : null
  if (!when) return null
  return {
    when,
    at: when === "percent" ? Math.round(num(r.at, 0, 100, 10)) : Math.round(num(r.at, 0, 10 * 3600, 60)),
    background: hex(r.background, "#000000"),
    text: hex(r.text, "#ffffff"),
    message: text(r.message, 80),
    pulse: flag(r.pulse, false),
  }
}

/** A saved or partial countdown look, made whole and kept in range (a newer build's extras dropped). */
export function normalizeCountdownLook(raw: Partial<CountdownLook> | null | undefined): CountdownLook {
  const d = DEFAULT_COUNTDOWN_LOOK
  const r = raw ?? {}
  return {
    counts: COUNTS.includes(r.counts as CountdownCounts) ? (r.counts as CountdownCounts) : d.counts,
    auxLabel: text(r.auxLabel, 40),
    until: typeof r.until === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(r.until) ? r.until : "",
    leadMinutes: Math.round(num(r.leadMinutes, 1, 240, d.leadMinutes)),
    background: hex(r.background, d.background),
    text: hex(r.text, d.text),
    steps: Array.isArray(r.steps) ? r.steps.map(normalizeStep).filter((s): s is CountdownStep => s !== null).slice(0, MAX_STEPS) : d.steps.map((s) => ({ ...s })),
    showMessage: flag(r.showMessage, d.showMessage),
    showItem: flag(r.showItem, d.showItem),
    showNext: flag(r.showNext, d.showNext),
    showClock: flag(r.showClock, d.showClock),
  }
}

/**
 * When each step comes on, as ms left. With the item's own warning (Prepare → Timing, #196 R1.3),
 * the first step after the start (the one coming on earliest, above 0) comes on then instead.
 */
export function stepThresholds(steps: readonly CountdownStep[], totalMs: number, warnMs?: number): number[] {
  const at = steps.map((s) => (s.when === "percent" ? (totalMs * s.at) / 100 : s.at * 1000))
  if (warnMs !== undefined && warnMs > 0) {
    let first = -1
    at.forEach((t, i) => { if (t > 0 && t < totalMs && (first === -1 || t > at[first])) first = i })
    if (first !== -1) at[first] = warnMs
  }
  return at
}

/**
 * The step on with `leftMs` to go (its index), or -1 for the starting colours. The step that came
 * on last wins (the one with the least time left), whatever order the list is in; two at the same
 * time: the later in the list. No length (counting up) or nothing to count: no steps.
 */
export function activeStep(steps: readonly CountdownStep[], totalMs: number, leftMs: number, warnMs?: number): number {
  if (!(totalMs > 0) || !Number.isFinite(leftMs)) return -1
  const at = stepThresholds(steps, totalMs, warnMs)
  let best = -1
  at.forEach((t, i) => { if (leftMs <= t && (best === -1 || t <= at[best])) best = i })
  return best
}

/** The time left now: from the end instant while it runs, else as held. */
export function countdownLeft(f: Pick<CountdownFrame, "endsAt" | "leftMs">, now: number): number {
  return f.endsAt === null ? f.leftMs : f.endsAt - now
}

/**
 * The big time: "9:59" counting down (rounded up, so it says 1:00 as the minute-left step comes on
 * and 0:00 exactly at the end), "+0:42" over; counting up (no length) the time so far.
 */
export function countdownText(totalMs: number, leftMs: number): string {
  if (!(totalMs > 0)) return formatMs(Math.max(0, -leftMs))
  if (leftMs >= 0) return formatMs(leftMs + 999)
  return -leftMs < 1000 ? "0:00" : `+${formatMs(-leftMs)}`
}

/** How deep the pulse is at a moment, 0–1: one smooth rise and fall a second (`PULSE_HZ`). */
export function pulseLevel(ms: number): number {
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * ms * PULSE_HZ) / 1000)
}

export interface CountdownLookNow {
  background: string
  text: string
  /** The step's message, or "" */
  message: string
  pulse: boolean
  step: number
  time: string
  leftMs: number
  over: boolean
  running: boolean
}

/** Everything the screen shows at `now` (the host's clock), before blending and the pulse. */
export function countdownNow(f: CountdownFrame, now: number): CountdownLookNow {
  const running = f.endsAt !== null && !f.idle
  const leftMs = f.idle ? 0 : countdownLeft(f, now)
  const step = f.idle ? -1 : activeStep(f.look.steps, f.totalMs, leftMs, f.warnMs)
  const s = step === -1 ? null : f.look.steps[step]
  return {
    background: s?.background ?? f.look.background,
    text: s?.text ?? f.look.text,
    message: s?.message ?? "",
    // Held still (paused, or before it starts): nothing moves on the screen.
    pulse: !!s?.pulse && running,
    step,
    time: f.idle ? "–:––" : countdownText(f.totalMs, leftMs),
    leftMs,
    over: f.totalMs > 0 && leftMs < 0,
    running,
  }
}

/** When the big time next changes (ms from now), so a screen redraws once a second, on the second. */
export function nextChangeIn(f: CountdownFrame, now: number): number {
  if (f.endsAt === null || f.idle) return Infinity
  const left = f.endsAt - now
  const into = ((left % 1000) + 1000) % 1000
  return into === 0 ? 1000 : into
}

const channels = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
const toHex = (v: number[]) => `#${v.map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, "0")).join("")}`

/** Between two #rrggbb colours: t = 0 is `a`, 1 is `b`. */
export function mixColour(a: string, b: string, t: number): string {
  const x = channels(a), y = channels(b)
  return toHex(x.map((v, i) => v + (y[i] - v) * Math.min(1, Math.max(0, t))))
}

/** The background with the pulse applied at `ms`. */
export function pulsed(background: string, ms: number): string {
  return mixColour(background, "#000000", PULSE_DEPTH * pulseLevel(ms))
}

/**
 * A screen's blend from one step's colours to the next (`FADE_MS`): kept per screen, it remembers
 * what it showed and when the colours last changed. `moving` says the screen should redraw soon.
 */
export class CountdownFade {
  private from = { background: "", text: "" }
  private to = { background: "", text: "" }
  private start = -Infinity

  colours(target: { background: string; text: string }, at: number): { background: string; text: string; moving: boolean } {
    if (!this.to.background) {
      this.from = this.to = { ...target }
      this.start = -Infinity
    } else if (target.background !== this.to.background || target.text !== this.to.text) {
      this.from = this.colours(this.to, at)
      this.to = { ...target }
      this.start = at
    }
    const t = (at - this.start) / FADE_MS
    if (t >= 1) return { ...this.to, moving: false }
    return { background: mixColour(this.from.background, this.to.background, t), text: mixColour(this.from.text, this.to.text, t), moving: true }
  }
}

/** What the look counts, in words, for the designer and the outputs list. */
export function countsName(look: Pick<CountdownLook, "counts" | "auxLabel" | "until">): string {
  switch (look.counts) {
    case "timer": return "The service timer"
    case "item": return "The item on now"
    case "aux": return look.auxLabel ? `The extra timer “${look.auxLabel}”` : "An extra timer"
    case "until": return look.until ? `Time until ${look.until}` : "Time until a time of day"
    case "start": return "Time until the service starts"
  }
}

/** The host's side: the service timer as a countdown frame's counting part. `mono` and `wall` are the same moment. */
export interface Counting {
  label: string
  totalMs: number
  endsAt: number | null
  leftMs: number
  idle?: string
  warnMs?: number
}

/** A timer (the service timer or an extra one) as counting: running, held or not set. */
export function timerCounting(label: string, t: { durationMs: number; startedAt: number | null; accumulatedMs: number }, mono: number, wall: number): Counting {
  const elapsed = t.accumulatedMs + (t.startedAt === null ? 0 : Math.max(0, mono - t.startedAt))
  const leftMs = t.durationMs - elapsed
  return { label, totalMs: t.durationMs, endsAt: t.startedAt === null ? null : wall + leftMs, leftMs }
}

/** Counting to an instant (a time of day, the service start), the percentages over `leadMinutes` before it. */
export function instantCounting(label: string, at: number, leadMinutes: number): Counting {
  return { label, totalMs: leadMinutes * 60_000, endsAt: at, leftMs: 0 }
}

/**
 * The instant of "HH:MM" next: today's, or tomorrow's once today's is more than 12 hours gone (as
 * the clock layers count). `zone`: the church's time zone ("" = this computer's).
 */
export function untilInstant(until: string, now: number, zone = ""): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(until)
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  const d = new Date(now)
  d.setHours(Number(m[1]), Number(m[2]), 0, 0)
  let at = d.getTime()
  if (zone) {
    // The same clock time in the church's zone: shift by the difference between the two clocks now.
    const there = new Date(new Date(now).toLocaleString("en-US", { timeZone: zone }))
    const here = new Date(new Date(now).toLocaleString("en-US"))
    at -= there.getTime() - here.getTime()
  }
  if (now - at > 12 * 3_600_000) at += 24 * 3_600_000
  return at
}

/** The countdown frame for a stage output with the countdown layout. */
export function countdownFrame(look: CountdownLook, counting: Counting, extra: { item: string | null; next: string | null; zone: string }): CountdownFrame {
  return {
    look,
    label: counting.label,
    totalMs: Math.max(0, counting.totalMs),
    endsAt: counting.endsAt,
    leftMs: counting.leftMs,
    ...(counting.idle ? { idle: counting.idle } : {}),
    ...(counting.warnMs ? { warnMs: counting.warnMs } : {}),
    item: extra.item,
    next: extra.next,
    zone: extra.zone,
  }
}

/** An item's own warning in minutes (Prepare → Timing, #196 R1.3), read from it when a build sets one. */
export function itemWarnMs(item: unknown): number | undefined {
  const w = (item as { timing?: { warn_minutes?: unknown } } | null | undefined)?.timing?.warn_minutes
  return typeof w === "number" && Number.isFinite(w) && w > 0 && w <= 120 ? Math.round(w * 60_000) : undefined
}

/**
 * What the host keeps for countdown displays beside the service timer (kept by
 * stores/countdown-sources.ts): the extra timers, the item on now and the service start.
 */
export interface CountdownSources {
  /** The extra timers (Production → Timekeeper), each as counting, labelled with its name. */
  aux: Counting[]
  /** The item on now: its planned minutes from when it started (an "end by" cuts it short). */
  item: Counting | null
  /** The item on now's own warning, ms before its end, when it has one. */
  itemWarnMs?: number
  /** The main service's planned start (the host's clock, ms), from the run of show. */
  start: number | null
}

export const NO_COUNTDOWN_SOURCES: CountdownSources = { aux: [], item: null, start: null }

const hhmm = (ms: number, zone: string) => {
  try {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...(zone ? { timeZone: zone } : {}) })
  } catch {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }
}

/**
 * What the look counts right now, from the host's state. `mono` and `wall` are the same moment on
 * the timer's clock and the wall clock; `zone` the church's time zone ("" = this computer's).
 */
export function lookCounting(
  look: CountdownLook,
  sources: CountdownSources,
  timer: { durationMs: number; startedAt: number | null; accumulatedMs: number },
  mono: number,
  wall: number,
  zone = "",
): Counting {
  const idle = (label: string, why: string): Counting => ({ label, totalMs: 0, endsAt: null, leftMs: 0, idle: why })
  switch (look.counts) {
    case "timer": {
      if (timer.durationMs === 0 && timer.startedAt === null && timer.accumulatedMs === 0) return idle("Service timer", "Set the service timer in Present")
      // The item on now's own warning applies to the service timer too, as on its chip.
      const c = timerCounting("Service timer", timer, mono, wall)
      return sources.itemWarnMs ? { ...c, warnMs: sources.itemWarnMs } : c
    }
    case "item":
      if (!sources.item) return idle("The item on now", "No item with planned minutes is on now")
      return sources.itemWarnMs ? { ...sources.item, warnMs: sources.itemWarnMs } : sources.item
    case "aux": {
      const name = look.auxLabel.trim().toLowerCase()
      const t = name ? sources.aux.find((a) => a.label.trim().toLowerCase() === name) : sources.aux[0]
      if (t) return t
      return idle(look.auxLabel || "Extra timer", look.auxLabel ? `No extra timer called “${look.auxLabel}” (Production → Timekeeper)` : "Add an extra timer in Production → Timekeeper")
    }
    case "until": {
      const at = untilInstant(look.until, wall, zone)
      return at === null ? idle("Time until", "Choose the time to count down to (Design → Countdown)") : instantCounting(`Until ${look.until}`, at, look.leadMinutes)
    }
    case "start":
      return sources.start === null ? idle("Service starts", "The run of show has no start time") : instantCounting(`Service starts ${hhmm(sources.start, zone)}`, sources.start, look.leadMinutes)
  }
}

/**
 * The item on now as counting (from the run of show's timing): its planned minutes from when it
 * went on air, cut short by its "end by". None when nothing is on, or it has no minutes planned.
 */
export function itemCounting(timing: { events: readonly { state: string; label: string; plannedStart: number; plannedEnd: number; actualStart: number | null; hardStop: number | null }[] } | null): Counting | null {
  const live = timing?.events.find((e) => e.state === "live")
  if (!live) return null
  const planned = live.plannedEnd - live.plannedStart
  if (!(planned > 0)) return null
  if (live.actualStart === null) return { label: live.label, totalMs: planned, endsAt: null, leftMs: planned }
  const end = live.hardStop !== null ? Math.max(live.actualStart, Math.min(live.hardStop, live.actualStart + planned)) : live.actualStart + planned
  const total = end - live.actualStart
  return total > 0 ? { label: live.label, totalMs: total, endsAt: end, leftMs: 0 } : null
}

/** "1:30" (minutes and seconds) or "90" (seconds) as seconds; null when it is not a time. */
export function parseTimeLeft(text: string): number | null {
  const t = text.trim()
  const m = /^(\d{1,3}):([0-5]\d)$/.exec(t)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  return /^\d{1,5}$/.test(t) ? Number(t) : null
}

/** Seconds as "m:ss" ("1:00", "0:00"). */
export const timeLeftText = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
