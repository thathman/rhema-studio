/**
 * A countdown/elapsed timer that only ever reads a monotonic clock, so a
 * wall-clock change (NTP step, DST, someone fixing the laptop's clock during
 * the service) cannot move it. Pure: every function takes `now` from the
 * clock the caller chooses; the store passes `performance.now()`.
 */
export interface TimerState {
  /** Planned length in ms; 0 means "count up only". */
  durationMs: number
  /** Monotonic time the current run started, or null while paused/stopped. */
  startedAt: number | null
  /** Elapsed ms accumulated before the current run. */
  accumulatedMs: number
}

export const idleTimer = (durationMs = 0): TimerState => ({ durationMs, startedAt: null, accumulatedMs: 0 })

export const isRunning = (t: TimerState): boolean => t.startedAt !== null

export function elapsedMs(t: TimerState, now: number): number {
  return t.accumulatedMs + (t.startedAt === null ? 0 : Math.max(0, now - t.startedAt))
}

/** Negative once the planned length has passed (overrun). */
export function remainingMs(t: TimerState, now: number): number {
  return t.durationMs - elapsedMs(t, now)
}

export function start(t: TimerState, now: number): TimerState {
  return t.startedAt === null ? { ...t, startedAt: now } : t
}

export function pause(t: TimerState, now: number): TimerState {
  return t.startedAt === null ? t : { ...t, accumulatedMs: elapsedMs(t, now), startedAt: null }
}

export function reset(t: TimerState): TimerState {
  return { ...t, startedAt: null, accumulatedMs: 0 }
}

/**
 * Correct the elapsed time by `deltaMs` (the timer was started late, or
 * left running too long). Never below zero.
 */
export function adjust(t: TimerState, deltaMs: number, now: number): TimerState {
  const running = t.startedAt === null ? 0 : Math.max(0, now - t.startedAt)
  return { ...t, accumulatedMs: Math.max(-running, t.accumulatedMs + Math.round(deltaMs)) }
}

export function setDuration(t: TimerState, durationMs: number): TimerState {
  return { ...t, durationMs: Math.max(0, Math.round(durationMs)) }
}

/** "12:34", "1:02:03", or "−0:45" when over. */
export function formatMs(ms: number): string {
  const sign = ms < 0 ? "−" : ""
  const total = Math.floor(Math.abs(ms) / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m)
  return `${sign}${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`
}

/** Which colour the chip should take: fine, under two minutes (or the item's own warning, #196 R1.3), or over. */
export function timerTone(t: TimerState, now: number, warnMs = 120_000): "ok" | "warn" | "over" {
  if (t.durationMs === 0) return "ok"
  const left = remainingMs(t, now)
  if (left < 0) return "over"
  return left <= warnMs ? "warn" : "ok"
}
