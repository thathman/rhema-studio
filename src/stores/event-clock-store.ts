import { create } from "zustand"
import { SERVICE_FINISHED, serviceFinishedAt } from "@/lib/journal"
import { runState, transition } from "@/lib/timing-state"
import { isSkipped, runOfShowClockRows, type RunOfShowClockRow } from "@/lib/run-of-show"
import type { QueueItem } from "@/types"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useHold } from "@/stores/hold-store"
import { useJournalStore } from "@/stores/journal-store"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"

/**
 * The event clock (ADR 0001, #246 C03): which planned event is happening, kept apart from what the
 * screens show. `currentMomentId` tracks the queue content within that event for moment-specific
 * cues and previews. Starting an event, activating content and taking a scene are different acts.
 * Services without event headers keep the legacy one-item-per-event behavior.
 */
export type EventClockMode = "screens" | "own"

interface EventClockState {
  mode: EventClockMode
  /** A Run of Show event header ID, or a legacy item ID when no event header owns it. */
  currentId: string | null
  /** The active content moment, independent from the event timer. */
  currentMomentId: string | null
  setMode: (mode: EventClockMode) => void
  /** Start an event ID or the item ID of one of its moments. */
  start: (id: string, momentId?: string | null) => void
  /** Start the event again even when it is the one happening, resetting the known start instant. */
  retake: (id: string, momentId?: string | null) => void
  /** The service is over: the reason it can't be now, else null. `by`: a joined desk. */
  finish: (by?: string) => string | null
  next: () => void
  previous: () => void
}

type ClockTarget = RunOfShowClockRow<QueueItem>

function rowsNow() {
  const { items, headers } = useQueueStore.getState()
  return { ...runOfShowClockRows(items, headers), items }
}

function resolve(id: string, requestedMomentId?: string | null): { target: ClockTarget; momentId: string | null } | null {
  const { rows, items } = rowsNow()
  const target = rows.find((row) => row.id === id) ?? rows.find((row) => row.moments.some((moment) => moment.id === id))
  if (!target) return null
  const momentId = requestedMomentId !== undefined
    ? (requestedMomentId && target.moments.some((moment) => moment.id === requestedMomentId) ? requestedMomentId : null)
    : target.id === id && target.kind === "event"
      ? null
      : target.moments.find((moment) => moment.id === id)?.id ?? (target.kind === "item" && items.some((item) => item.id === id) ? id : null)
  return { target, momentId }
}

function step(offset: 1 | -1) {
  const { rows, headers } = rowsNow()
  const at = rows.findIndex((row) => row.id === useEventClock.getState().currentId)
  let index = at === -1 ? (offset === 1 ? 0 : -1) : at + offset
  while (index >= 0 && index < rows.length && isSkipped(rows, headers, index)) index += offset
  const target = rows[index]
  if (target) useEventClock.getState().start(target.id)
}

export const useEventClock = create<EventClockState>((set, get) => ({
  mode: "screens",
  currentId: null,
  currentMomentId: null,
  setMode: (mode) => set({ mode }),
  start: (id, requestedMomentId) => {
    const resolved = resolve(id, requestedMomentId)
    if (!resolved || useBroadcastStore.getState().rehearsal) return
    const { target, momentId: requested } = resolved
    const previous = get()
    const momentId = requestedMomentId === undefined && target.id === previous.currentId && target.id === id
      ? previous.currentMomentId
      : requested
    if (previous.currentId === target.id) {
      if (previous.currentMomentId === momentId) return
      set({ currentMomentId: momentId })
      const moment = target.moments.find((candidate) => candidate.id === momentId)
      if (moment) useJournalStore.getState().add({ kind: "moment", label: moment.reference, itemId: moment.id, eventId: target.id })
      return
    }
    begin(target, momentId, set)
  },
  retake: (id, requestedMomentId) => {
    const resolved = resolve(id, requestedMomentId)
    if (!resolved || useBroadcastStore.getState().rehearsal) return
    const { target } = resolved
    const momentId = requestedMomentId === undefined && target.id === id && target.kind === "event" && target.id === get().currentId
      ? get().currentMomentId
      : resolved.momentId
    begin(target, momentId, set)
  },
  finish: (by) => {
    if (useBroadcastStore.getState().rehearsal) return "Not in rehearsal."
    const entries = useJournalStore.getState().entries
    const begun = entries.some((entry) => entry.kind === "event" && (entry.eventId || entry.itemId))
    const move = transition(runState({ begun, held: useHold.getState().hold !== null, untrusted: false, finished: serviceFinishedAt(entries) !== null }), "finish")
    if (!move.ok) return move.reason
    set({ currentId: null, currentMomentId: null })
    useJournalStore.getState().add({ kind: "event", label: by ? `${by}: ${SERVICE_FINISHED}` : SERVICE_FINISHED, ...(by ? { by } : {}) })
    return null
  },
  next: () => step(1),
  previous: () => step(-1),
}))

function begin(target: ClockTarget, momentId: string | null, set: (state: Partial<EventClockState>) => void) {
  if (useBroadcastStore.getState().rehearsal) return
  set({ currentId: target.id, currentMomentId: momentId })
  useJournalStore.getState().add({ kind: "event", label: target.reference, eventId: target.id, itemId: momentId })
}

// Following the screens: an item's content going on air starts its containing event by default;
// moving to another moment inside the same event updates only the moment and never restarts time.
useBroadcastStore.subscribe((state, previous) => {
  if (state.liveItemId === previous.liveItemId && state.isLive === previous.isLive && state.liveVerse === previous.liveVerse && state.rehearsal === previous.rehearsal) return
  if (useEventClock.getState().mode !== "screens" || state.rehearsal || !state.isLive || !state.liveItemId) return
  if (state.liveVerse?.quick || state.liveVerse?.screen) return
  useEventClock.getState().start(state.liveItemId)
})

// Another service opened: no event of it has started yet.
useServiceStore.subscribe((state, previous) => {
  if (state.current?.id !== previous.current?.id) useEventClock.setState({ currentId: null, currentMomentId: null })
})
