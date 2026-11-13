import { create } from "zustand"
import { serviceTiming } from "@/lib/timing-engine"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useEventClock } from "@/stores/event-clock-store"
import { useHold } from "@/stores/hold-store"
import { useJournalStore } from "@/stores/journal-store"
import { timingInputNow } from "@/stores/timing-input"

/**
 * Fixed starts kept by the clock (#196, time-of-day automation), armed by the Timekeeper: an event
 * with a fixed start begins on the event clock at that time. The event clock never changes a
 * screen, so neither does this. Under the #246 rules: only while armed by a person; it waits in
 * rehearsal and on a Hold; never late: an event is started within two minutes of its time or not
 * at all; arming is not saved, so a restart leaves it off.
 */
const GRACE_MS = 2 * 60_000

interface FixedStartAutoState {
  armed: { by: string | null } | null
  /** Events already started by it (each once). */
  started: string[]
  arm: (by?: string) => void
  disarm: (by?: string) => void
}

const log = (label: string) => useJournalStore.getState().add({ kind: "timing", label })

export const useFixedStartAuto = create<FixedStartAutoState>((set, get) => ({
  armed: null,
  started: [],
  arm: (by) => {
    if (get().armed) return
    set({ armed: { by: by ?? null }, started: [] })
    log(`${by ? `${by}: ` : ""}fixed starts now begin events on the clock`)
  },
  disarm: (by) => {
    if (!get().armed) return
    set({ armed: null, started: [] })
    log(`${by ? `${by}: ` : ""}fixed starts back to the Timekeeper's hand`)
  },
}))

/** On the app's tick: start the event whose fixed start has just come, if armed. */
export function checkFixedStarts(): void {
  const a = useFixedStartAuto.getState()
  if (!a.armed || useBroadcastStore.getState().rehearsal || useHold.getState().hold) return
  const input = timingInputNow()
  const t = serviceTiming(input)
  if (!t) return
  const now = input.now
  const due = t.events.find((e) => e.state === "upcoming" && e.fixedStart !== null && now >= e.fixedStart && now < e.fixedStart + GRACE_MS && !a.started.includes(e.id))
  if (!due || useEventClock.getState().currentId === due.id) return
  useFixedStartAuto.setState({ started: [...a.started, due.id] })
  useEventClock.getState().start(due.id)
  log(`${due.label} started at its fixed start by the clock${a.armed.by ? ` (armed by ${a.armed.by})` : ""}`)
}
