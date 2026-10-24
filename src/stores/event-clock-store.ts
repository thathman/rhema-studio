import { create } from "zustand"
import { SERVICE_FINISHED, serviceFinishedAt } from "@/lib/journal"
import { runState, transition } from "@/lib/timing-state"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useHold } from "@/stores/hold-store"
import { useJournalStore } from "@/stores/journal-store"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"

/**
 * The event clock (ADR 0001, #246 C03): which run-of-show event is happening, kept apart from what
 * the screens show. Starting an event, activating content and taking a scene are different actions.
 * "screens" (the default): an item's content going on air starts its event, as before. "own": only
 * the timekeeper starts events (Production → Timekeeper), and showing content starts none. Rehearsal
 * and quick screens never start an event. Each start is an "event" entry in the service log.
 * Finishing the service (#196 R3.7) is one more, with no item: what never started was skipped.
 */
export type EventClockMode = "screens" | "own"

interface EventClockState {
  mode: EventClockMode
  /** The event happening now (a rundown item id), or null before the service. */
  currentId: string | null
  setMode: (mode: EventClockMode) => void
  start: (itemId: string) => void
  /** Start the event again even when it is the one happening (after a restart, so its time counts from a moment that is known). */
  retake: (itemId: string) => void
  /** The service is over: the reason it can't be now, else null. `by`: a joined desk. */
  finish: (by?: string) => string | null
  next: () => void
  previous: () => void
}

function step(offset: 1 | -1) {
  const { items } = useQueueStore.getState()
  const at = items.findIndex((i) => i.id === useEventClock.getState().currentId)
  const to = items[at === -1 ? (offset === 1 ? 0 : -1) : at + offset]
  if (to) useEventClock.getState().start(to.id)
}

export const useEventClock = create<EventClockState>((set, get) => ({
  mode: "screens",
  currentId: null,
  setMode: (mode) => set({ mode }),
  start: (itemId) => {
    if (get().currentId === itemId) return
    get().retake(itemId)
  },
  retake: (itemId) => {
    const item = useQueueStore.getState().items.find((i) => i.id === itemId)
    if (!item || useBroadcastStore.getState().rehearsal) return
    set({ currentId: itemId })
    useJournalStore.getState().add({ kind: "event", label: item.reference, itemId })
  },
  finish: (by) => {
    if (useBroadcastStore.getState().rehearsal) return "Not in rehearsal."
    const entries = useJournalStore.getState().entries
    const begun = entries.some((e) => e.kind === "event" && e.itemId)
    const move = transition(runState({ begun, held: useHold.getState().hold !== null, untrusted: false, finished: serviceFinishedAt(entries) !== null }), "finish")
    if (!move.ok) return move.reason
    set({ currentId: null })
    useJournalStore.getState().add({ kind: "event", label: by ? `${by}: ${SERVICE_FINISHED}` : SERVICE_FINISHED, ...(by ? { by } : {}) })
    return null
  },
  next: () => step(1),
  previous: () => step(-1),
}))

// Following the screens: an item's own content going on air starts its event (not in rehearsal,
// not a quick screen; Restore and Back keep the same event).
useBroadcastStore.subscribe((s) => {
  if (useEventClock.getState().mode !== "screens" || s.rehearsal || !s.isLive || !s.liveItemId) return
  if (s.liveVerse?.quick || s.liveVerse?.screen) return
  useEventClock.getState().start(s.liveItemId)
})

// Another service opened: no event of it has started yet.
useServiceStore.subscribe((s, prev) => {
  if (s.current?.id !== prev.current?.id) useEventClock.setState({ currentId: null })
})
