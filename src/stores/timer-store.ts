import { create } from "zustand"
import { adjust, idleTimer, pause, reset, setDuration, start, type TimerState } from "@/lib/timer"
import { useTimeChange } from "@/stores/time-change-store"

/** The clock the engine runs on: monotonic, immune to wall-clock changes. */
export const monotonicNow = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now())

/**
 * Wall-clock time for a monotonic reading, for showing clock times only
 * ("Planned end 11:45", "by 12:15"). The anchor is checked every few
 * seconds: after the laptop sleeps (the monotonic clock stops on macOS) or
 * the system clock is set, displayed times follow the real clock again.
 * The timer itself stays monotonic (FR-07).
 */
let wallAtMonoZero = Date.now() - monotonicNow()
export const wallAt = (mono: number): number => wallAtMonoZero + mono
export function refreshWallAnchor(): void {
  const fresh = Date.now() - monotonicNow()
  if (Math.abs(fresh - wallAtMonoZero) > 2000) wallAtMonoZero = fresh
}
if (typeof window !== "undefined") {
  setInterval(refreshWallAnchor, 5000)
  window.addEventListener?.("focus", refreshWallAnchor)
  document.addEventListener?.("visibilitychange", refreshWallAnchor)
}

interface TimerStoreState {
  /** One service timer for now: the sermon or the whole service. */
  timer: TimerState
  /** Bumped by the ticker so chips re-render; the engine itself needs no ticks. */
  tick: number
  start: () => void
  pause: () => void
  reset: () => void
  setDurationMinutes: (minutes: number) => void
  /** Manual correction (FR-07); the caller records it in the service log (this store must not import the journal: import cycle). */
  adjustMinutes: (minutes: number, by?: string | null) => void
}

let ticker: ReturnType<typeof setInterval> | null = null
function ensureTicker(running: boolean) {
  if (running && !ticker) ticker = setInterval(() => useTimerStore.setState((s) => ({ tick: s.tick + 1 })), 500)
  if (!running && ticker) {
    clearInterval(ticker)
    ticker = null
  }
}

export const useTimerStore = create<TimerStoreState>((set, get) => ({
  timer: idleTimer(0),
  tick: 0,
  start: () => {
    set({ timer: start(get().timer, monotonicNow()) })
    ensureTicker(true)
  },
  pause: () => {
    set({ timer: pause(get().timer, monotonicNow()) })
    ensureTicker(false)
  },
  reset: () => {
    set({ timer: reset(get().timer) })
    ensureTicker(false)
  },
  setDurationMinutes: (minutes) => set({ timer: setDuration(get().timer, minutes * 60_000) }),
  adjustMinutes: (minutes, by) => {
    set({ timer: adjust(get().timer, minutes * 60_000, monotonicNow()) })
    // Who changed the time last, for the Timekeeper desks (#196 R2.9).
    if (minutes) useTimeChange.getState().note(`timer corrected by ${minutes > 0 ? "+" : "−"}${Math.abs(minutes)} min`, by)
  },
}))
