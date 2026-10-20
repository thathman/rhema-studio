import { create } from "zustand"
import { idleTimer, pause, reset, setDuration, start, type TimerState } from "@/lib/timer"

/** The clock the engine runs on: monotonic, immune to wall-clock changes. */
export const monotonicNow = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now())

interface TimerStoreState {
  /** One service timer for now: the sermon or the whole service. */
  timer: TimerState
  /** Bumped by the ticker so chips re-render; the engine itself needs no ticks. */
  tick: number
  start: () => void
  pause: () => void
  reset: () => void
  setDurationMinutes: (minutes: number) => void
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
}))
