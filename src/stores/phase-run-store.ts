import { create } from "zustand"
import { presentQueueItem } from "@/lib/remote-actions"
import { clockInstant, clockMinutes, dwellSeconds, nextInPhase, phaseRange, planTimeline } from "@/lib/run-of-show"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { useHold } from "@/stores/hold-store"

/**
 * A loop or run-once phase running by itself in Present (issue #193). Nothing runs until the
 * operator starts it; every step is an ordinary go-live of the next item in the phase. Taking
 * anything else, Clear, Black or a quick screen stops it at once, so it never fights the operator.
 * The main service is never run this way. A run started on air waits while rehearsal is on and
 * carries on after; one started in rehearsal belongs to it and ends with it (ADR 0001).
 */
export interface PhaseRun {
  headerId: string
  /** The item this run put on air (null while a warm-up waits for its time). */
  itemId: string | null
  /** A warm-up started early waits until it is due: epoch ms. */
  startsAt: number | null
  /** When the next item goes up, epoch ms (null on the last item of a run-once phase). */
  nextAt: number | null
  /** Started in rehearsal: it runs only there. */
  rehearsal?: boolean
}

interface PhaseRunState {
  run: PhaseRun | null
  start: (headerId: string) => void
  stop: () => void
}

let timer: ReturnType<typeof setTimeout> | null = null
// The pending step and when it is due, so a late timer can be caught up (see catchUpPhaseRun).
let pending: { at: number; fn: () => void } | null = null
// While the run itself is going live, the live item changing is not the operator's doing.
let presenting = false

/** A step waits on hold, and while the app is not where the run was started (on air or in rehearsal). */
function waiting(): boolean {
  const run = usePhaseRun.getState().run
  return !!useHold.getState().hold || (!!run && !!run.rehearsal !== useBroadcastStore.getState().rehearsal)
}

function later(ms: number, fn: () => void) {
  if (timer) clearTimeout(timer)
  const step = { at: Date.now() + Math.max(0, ms), fn }
  pending = step
  timer = setTimeout(() => {
    timer = null
    // On hold (or in rehearsal for a run on air): the step waits (still pending) and runs later.
    if (waiting()) return
    if (pending === step) pending = null
    fn()
  }, Math.max(0, ms))
}

/** On the app's tick: run a step whose timer is late (held back while the window is hidden). */
export function catchUpPhaseRun(now = Date.now()) {
  if (!pending || now < pending.at || waiting()) return
  const { fn } = pending
  pending = null
  if (timer) clearTimeout(timer)
  timer = null
  fn()
}

/** Epoch ms when the warm-up should begin (timed to end at the service start), if still ahead: the nearest such time, so a watchnight's 23:55 or 00:30 arms. */
function warmupDue(now: number): number | null {
  const { items, headers } = useQueueStore.getState()
  const at = clockMinutes(planTimeline(items, headers)?.warmupStart)
  if (at === null) return null
  const due = clockInstant(at, now)
  return due > now ? due : null
}

async function step(run: PhaseRun) {
  const { items, headers } = useQueueStore.getState()
  const header = headers.find((h) => h.id === run.headerId)
  const range = phaseRange(items.length, headers, run.headerId)
  if (!header?.rule || header.rule === "manual" || !range) return usePhaseRun.getState().stop()
  const current = run.itemId ? items.findIndex((i) => i.id === run.itemId) : -1
  const index = run.itemId ? nextInPhase(header.rule, range.start, range.end, current) : range.end > range.start ? range.start : null
  if (index === null) return usePhaseRun.getState().stop()
  // A loop of one item keeps it up (a video does not restart); it looks again later in case items were added.
  if (index === current) return later(dwellSeconds(header, items[index].planned_minutes) * 1000, () => { if (usePhaseRun.getState().run === run) void step(run) })
  const item = items[index]
  presenting = true
  try {
    await presentQueueItem(index)
  } finally {
    presenting = false
  }
  if (usePhaseRun.getState().run !== run) return
  // Held for approval, or it failed: stop rather than try again by itself.
  const b = useBroadcastStore.getState()
  if (!b.isLive || b.liveItemId !== item.id) return usePhaseRun.getState().stop()
  const ms = dwellSeconds(header, item.planned_minutes) * 1000
  const more = nextInPhase(header.rule, range.start, range.end, index) !== null
  const next: PhaseRun = { headerId: run.headerId, itemId: item.id, startsAt: null, nextAt: more ? Date.now() + ms : null, ...(run.rehearsal ? { rehearsal: true } : {}) }
  usePhaseRun.setState({ run: next })
  later(ms, () => { if (usePhaseRun.getState().run === next) void step(next) })
}

export const usePhaseRun = create<PhaseRunState>((set, get) => ({
  run: null,
  start: (headerId) => {
    get().stop()
    const header = useQueueStore.getState().headers.find((h) => h.id === headerId)
    if (header?.type !== "phase" || (header.rule !== "loop" && header.rule !== "auto_once")) return
    const due = header.role === "warmup" && header.rule === "auto_once" ? warmupDue(Date.now()) : null
    const run: PhaseRun = { headerId, itemId: null, startsAt: due, nextAt: null, ...(useBroadcastStore.getState().rehearsal ? { rehearsal: true } : {}) }
    set({ run })
    if (due) later(due - Date.now(), () => { if (get().run === run) void step(run) })
    else void step(run)
  },
  stop: () => {
    if (timer) clearTimeout(timer)
    timer = null
    pending = null
    if (get().run) set({ run: null })
  },
}))

// The operator took over: something else went live, or the output went off air.
useBroadcastStore.subscribe((s, prev) => {
  const run = usePhaseRun.getState().run
  if (s.rehearsal !== prev.rehearsal) {
    // Leaving rehearsal ends a run started there. A run on air carries on (a step due meanwhile runs
    // now), unless Show this live put something else up: that is the operator taking over.
    if (!s.rehearsal && run?.rehearsal) usePhaseRun.getState().stop()
    else if (!s.rehearsal && run?.itemId && (!s.isLive || s.liveItemId !== run.itemId)) usePhaseRun.getState().stop()
    else if (!s.rehearsal) catchUpPhaseRun()
    return
  }
  // What rehearsal shows is not the operator taking over a run on air.
  if (!run?.itemId || presenting || !!run.rehearsal !== s.rehearsal) return
  if ((prev.isLive && !s.isLive) || s.liveItemId !== run.itemId) usePhaseRun.getState().stop()
})

// Resume after a hold: a step that came due meanwhile runs now.
useHold.subscribe((s, prev) => { if (prev.hold && !s.hold) catchUpPhaseRun() })
