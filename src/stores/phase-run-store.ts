import { create } from "zustand"
import { presentQueueItem } from "@/lib/remote-actions"
import { clockMinutes, dwellSeconds, nextInPhase, phaseRange, planTimeline } from "@/lib/run-of-show"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"

/**
 * A loop or run-once phase running by itself in Present (issue #193). Nothing runs until the
 * operator starts it; every step is an ordinary go-live of the next item in the phase. Taking
 * anything else, Clear, Black or a quick screen stops it at once, so it never fights the operator.
 * The main service is never run this way.
 */
export interface PhaseRun {
  headerId: string
  /** The item this run put on air (null while a warm-up waits for its time). */
  itemId: string | null
  /** A warm-up started early waits until it is due: epoch ms. */
  startsAt: number | null
  /** When the next item goes up, epoch ms (null on the last item of a run-once phase). */
  nextAt: number | null
}

interface PhaseRunState {
  run: PhaseRun | null
  start: (headerId: string) => void
  stop: () => void
}

let timer: ReturnType<typeof setTimeout> | null = null
// While the run itself is going live, the live item changing is not the operator's doing.
let presenting = false

function later(ms: number, fn: () => void) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { timer = null; fn() }, Math.max(0, ms))
}

/** Epoch ms when the warm-up should begin today (timed to end at the service start), if still ahead. */
function warmupDue(now: number): number | null {
  const { items, headers } = useQueueStore.getState()
  const at = clockMinutes(planTimeline(items, headers)?.warmupStart)
  if (at === null) return null
  const d = new Date(now)
  d.setHours(Math.floor(at / 60), at % 60, 0, 0)
  return d.getTime() > now ? d.getTime() : null
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
  const next: PhaseRun = { headerId: run.headerId, itemId: item.id, startsAt: null, nextAt: more ? Date.now() + ms : null }
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
    const run: PhaseRun = { headerId, itemId: null, startsAt: due, nextAt: null }
    set({ run })
    if (due) later(due - Date.now(), () => { if (get().run === run) void step(run) })
    else void step(run)
  },
  stop: () => {
    if (timer) clearTimeout(timer)
    timer = null
    if (get().run) set({ run: null })
  },
}))

// The operator took over: something else went live, or the output went off air.
useBroadcastStore.subscribe((s, prev) => {
  const run = usePhaseRun.getState().run
  if (!run?.itemId || presenting) return
  if ((prev.isLive && !s.isLive) || s.liveItemId !== run.itemId) usePhaseRun.getState().stop()
})
