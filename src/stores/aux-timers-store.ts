import { create } from "zustand"
import { formatMs, idleTimer, isRunning, pause, remainingMs, reset, start, timerTone, type TimerState } from "@/lib/timer"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { monotonicNow } from "@/stores/timer-store"
import type { StageAux } from "@/types"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore, type ServiceTimerPlan } from "@/stores/settings-store"
import { useJournalStore } from "@/stores/journal-store"

/**
 * Auxiliary timers (issue #196 R2.5): a few named countdowns beside the service timer, e.g.
 * "Communion prep" or "Interpreter", each started, paused and reset on its own and never coupled
 * to the service timer. Any of them can show on the stage display. Each may belong to a desk role
 * (`owner`): besides the timekeeping desks, that role's joined desk may run it. With a saved
 * service open, the timers (names, lengths, owners, on stage; not how far they have run) are kept
 * with it and come back when it is opened again; without one they last for this session.
 */
export interface AuxTimer {
  id: string
  label: string
  timer: TimerState
  onStage: boolean
  /** A desk role ("worship", "stage"…) that may run it too; "": only the timekeeping desks and the main desk. */
  owner: string
}

/** The timers as a service keeps them. */
export const timerPlans = (timers: AuxTimer[]): ServiceTimerPlan[] =>
  timers.map((t) => ({ id: t.id, label: t.label, minutes: Math.round((t.timer.durationMs / 60_000) * 100) / 100, ...(t.owner ? { owner: t.owner } : {}), ...(t.onStage ? { onStage: true } : {}) }))

/** A service's saved timers, ready to start. */
export const timersFromPlans = (plans: ServiceTimerPlan[]): AuxTimer[] =>
  plans.slice(0, MAX_AUX_TIMERS).map((p) => ({ id: p.id, label: p.label.trim().slice(0, 40), timer: idleTimer(Math.round(Math.min(600, Math.max(0.5, p.minutes)) * 60_000)), onStage: p.onStage === true, owner: typeof p.owner === "string" ? p.owner.slice(0, 40) : "" }))

/** Whether a desk with this role may run a timer with this owner (the host's server checks the same). */
export function mayRunAuxTimer(role: string | undefined, owner: string): boolean {
  return role === "timekeeper" || role === "present" || role === "configure" || (!!owner && role === owner)
}

export const MAX_AUX_TIMERS = 4

interface AuxTimersState {
  timers: AuxTimer[]
  /** Bumped twice a second while one runs, so views re-render. */
  tick: number
  add: (label: string, minutes: number, owner?: string) => void
  setOwner: (id: string, owner: string) => void
  /** From a joined desk (the host's server checked its role first): start, pause or reset one, logged with who. */
  remote: (id: string, action: string, by?: string) => void
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

/** Keep the open service's timers (what they are, not how far they ran) with it. */
function save() {
  const id = useServiceStore.getState().current?.id
  if (!id) return
  const plans = timerPlans(useAuxTimers.getState().timers)
  if (JSON.stringify(plans) !== JSON.stringify(useSettingsStore.getState().serviceTimers[id] ?? [])) useSettingsStore.getState().setServiceTimers(id, plans)
}

export const useAuxTimers = create<AuxTimersState>((set) => ({
  timers: [],
  tick: 0,
  add: (label, minutes, owner = "") => {
    const name = label.trim().slice(0, 40)
    const ms = Math.round(Math.min(600, Math.max(0.5, minutes)) * 60_000)
    if (!name) return
    set((s) => (s.timers.length >= MAX_AUX_TIMERS ? s : { timers: [...s.timers, { id: crypto.randomUUID(), label: name, timer: idleTimer(ms), onStage: false, owner: owner.slice(0, 40) }] }))
    retick()
    save()
  },
  remove: (id) => {
    set((s) => ({ timers: s.timers.filter((t) => t.id !== id) }))
    retick()
    save()
  },
  toggle: (id) => update(id, (t) => ({ ...t, timer: isRunning(t.timer) ? pause(t.timer, monotonicNow()) : start(t.timer, monotonicNow()) })),
  reset: (id) => update(id, (t) => ({ ...t, timer: reset(t.timer) })),
  setOnStage: (id, onStage) => { update(id, (t) => ({ ...t, onStage })); save() },
  setOwner: (id, owner) => { update(id, (t) => ({ ...t, owner: owner.slice(0, 40) })); save() },
  remote: (id, action, by) => {
    const t = useAuxTimers.getState().timers.find((x) => x.id === id)
    if (!t) return
    const running = isRunning(t.timer)
    if (action === "start" && !running) update(id, (x) => ({ ...x, timer: start(x.timer, monotonicNow()) }))
    else if (action === "pause" && running) update(id, (x) => ({ ...x, timer: pause(x.timer, monotonicNow()) }))
    else if (action === "reset") update(id, (x) => ({ ...x, timer: reset(x.timer) }))
    else return
    useJournalStore.getState().add({ kind: "timing", label: `${by ? `${by}: ` : ""}extra timer “${t.label}” ${action === "start" ? "started" : action === "pause" ? "paused" : "reset"}` })
  },
}))

/** The open service's saved timers, when another service opens (the last one's are let go). */
function loadFor(serviceId: string | null) {
  const plans = serviceId ? useSettingsStore.getState().serviceTimers[serviceId] ?? [] : []
  useAuxTimers.setState({ timers: timersFromPlans(plans) })
  retick()
}
useServiceStore.subscribe((s, p) => {
  if (s.current?.id === p.current?.id) return
  // Closing a service keeps its timers on screen for the rest of the session.
  if (s.current) loadFor(s.current.id)
})
// The settings are read after a service may already be open: its timers come in then (never over ones already added).
useSettingsStore.subscribe((s, p) => {
  const id = useServiceStore.getState().current?.id
  if (!id || s.serviceTimers === p.serviceTimers || useAuxTimers.getState().timers.length > 0) return
  if (s.serviceTimers[id]?.length) loadFor(id)
})
