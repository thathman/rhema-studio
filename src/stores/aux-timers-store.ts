import { create } from "zustand"
import { formatMs, idleTimer, isRunning, pause, remainingMs, reset, start, timerTone, type TimerState } from "@/lib/timer"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { monotonicNow } from "@/stores/timer-store"
import type { StageAux } from "@/types"

/**
 * Auxiliary timers (issue #196 R2.5): a few named countdowns beside the service timer, e.g.
 * "Communion prep" or "Interpreter", each started, paused and reset on its own and never coupled
 * to the service timer. Any of them can show on the stage display. For this session only.
 */
export interface AuxTimer {
  id: string
  label: string
  timer: TimerState
  onStage: boolean
}

export const MAX_AUX_TIMERS = 4

interface AuxTimersState {
  timers: AuxTimer[]
  /** Bumped twice a second while one runs, so views re-render. */
  tick: number
  add: (label: string, minutes: number) => void
  remove: (id: string) => void
  toggle: (id: string) => void
  reset: (id: string) => void
  setOnStage: (id: string, onStage: boolean) => void
}

let ticker: ReturnType<typeof setInterval> | null = null
let lastStage = ""

/** The stage display's line for the timers marked to show there, sent only when it changes. */
export function stageAuxLines(timers: AuxTimer[], now: number): StageAux[] {
  return timers.filter((t) => t.onStage).map((t) => ({ label: t.label, text: formatMs(remainingMs(t.timer, now)), tone: timerTone(t.timer, now) }))
}

function pushStage() {
  const lines = stageAuxLines(useAuxTimers.getState().timers, monotonicNow())
  const key = JSON.stringify(lines)
  if (key === lastStage) return
  lastStage = key
  useBroadcastStore.getState().setStageAux(lines)
}

function retick() {
  const running = useAuxTimers.getState().timers.some((t) => isRunning(t.timer))
  if (running && !ticker) ticker = setInterval(() => { useAuxTimers.setState((s) => ({ tick: s.tick + 1 })); pushStage() }, 500)
  if (!running && ticker) {
    clearInterval(ticker)
    ticker = null
  }
  pushStage()
}

const update = (id: string, f: (t: AuxTimer) => AuxTimer) => {
  useAuxTimers.setState((s) => ({ timers: s.timers.map((t) => (t.id === id ? f(t) : t)) }))
  retick()
}

export const useAuxTimers = create<AuxTimersState>((set) => ({
  timers: [],
  tick: 0,
  add: (label, minutes) => {
    const name = label.trim().slice(0, 40)
    const ms = Math.round(Math.min(600, Math.max(0.5, minutes)) * 60_000)
    if (!name) return
    set((s) => (s.timers.length >= MAX_AUX_TIMERS ? s : { timers: [...s.timers, { id: crypto.randomUUID(), label: name, timer: idleTimer(ms), onStage: false }] }))
    retick()
  },
  remove: (id) => {
    set((s) => ({ timers: s.timers.filter((t) => t.id !== id) }))
    retick()
  },
  toggle: (id) => update(id, (t) => ({ ...t, timer: isRunning(t.timer) ? pause(t.timer, monotonicNow()) : start(t.timer, monotonicNow()) })),
  reset: (id) => update(id, (t) => ({ ...t, timer: reset(t.timer) })),
  setOnStage: (id, onStage) => update(id, (t) => ({ ...t, onStage })),
}))
