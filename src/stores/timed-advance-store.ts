import { create } from "zustand"
import { presentQueueItem } from "@/lib/remote-actions"
import { phaseAt } from "@/lib/run-of-show"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { usePhaseRun } from "@/stores/phase-run-store"
import { useQueueStore } from "@/stores/queue-store"
import { useHold } from "@/stores/hold-store"

/**
 * Timed moves in the service (issue #193): an item marked to move on by itself goes to the next
 * item of its phase after its planned minutes, but only while the operator has timed moves on in
 * Present (off at every start). Never across a phase, never inside a phase that runs by itself,
 * and anything the operator does to what is live cancels the pending move. Rehearsal neither makes
 * nor cancels a move on air: it waits and is made after rehearsal if it came due (ADR 0001).
 */
interface TimedAdvanceState {
  on: boolean
  /** The pending move, epoch ms (null when none). */
  dueAt: number | null
  setOn: (on: boolean) => void
}

let timer: ReturnType<typeof setTimeout> | null = null
// The pending move, so a late timer can be caught up (see catchUpTimedAdvance).
let move: (() => void) | null = null

/** Where the live item moves on to by itself, or null. */
export function timedNext(): { index: number; ms: number; itemId: string } | null {
  const b = useBroadcastStore.getState()
  if (!b.isLive || !b.liveItemId || usePhaseRun.getState().run) return null
  const { items, headers } = useQueueStore.getState()
  const index = items.findIndex((i) => i.id === b.liveItemId)
  const item = items[index]
  if (!item?.auto_advance || !item.planned_minutes || index + 1 >= items.length) return null
  const phase = phaseAt(headers, index)
  if (phase && phase.rule && phase.rule !== "manual") return null
  if (phaseAt(headers, index + 1) !== phase) return null
  return { index: index + 1, ms: item.planned_minutes * 60_000, itemId: item.id }
}

function reconsider() {
  if (timer) clearTimeout(timer)
  timer = null
  move = null
  const next = useTimedAdvance.getState().on ? timedNext() : null
  useTimedAdvance.setState({ dueAt: next ? Date.now() + next.ms : null })
  if (!next) return
  const go = () => {
    timer = null
    // On hold or in rehearsal: the move waits and is made at Resume or after rehearsal.
    if (useHold.getState().hold || useBroadcastStore.getState().rehearsal) return
    move = null
    useTimedAdvance.setState({ dueAt: null })
    const b = useBroadcastStore.getState()
    if (useTimedAdvance.getState().on && b.isLive && b.liveItemId === next.itemId) void presentQueueItem(next.index, 0, undefined, { automatic: true })
  }
  move = go
  timer = setTimeout(go, next.ms)
}

/** On the app's tick: make a move whose timer is late (held back while the window is hidden). */
export function catchUpTimedAdvance(now = Date.now()) {
  const due = useTimedAdvance.getState().dueAt
  if (!move || due === null || now < due || useHold.getState().hold || useBroadcastStore.getState().rehearsal) return
  if (timer) clearTimeout(timer)
  move()
}

export const useTimedAdvance = create<TimedAdvanceState>((set) => ({
  on: false,
  dueAt: null,
  setOn: (on) => {
    set({ on })
    reconsider()
  },
}))

// A new item on air, off air, or a phase starting or stopping: the pending move is looked at again.
useBroadcastStore.subscribe((s, prev) => {
  if (s.rehearsal !== prev.rehearsal) {
    // After rehearsal: the move on air is made if it came due; Show this live put up something
    // else, so the move is looked at again for it.
    if (!s.rehearsal) {
      const r = s.rehearsalReturn ?? prev.rehearsalReturn
      if (r && (r.liveItemId !== s.liveItemId || r.isLive !== s.isLive)) reconsider()
      else catchUpTimedAdvance()
    }
    return
  }
  if (s.rehearsal) return
  if (s.liveItemId !== prev.liveItemId || s.isLive !== prev.isLive) reconsider()
})
usePhaseRun.subscribe((s, prev) => {
  if (!!s.run !== !!prev.run) reconsider()
})

// Resume after a hold: a move that came due meanwhile is made now.
useHold.subscribe((s, prev) => { if (prev.hold && !s.hold) catchUpTimedAdvance() })
