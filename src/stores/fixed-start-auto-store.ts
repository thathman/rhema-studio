import { create } from "zustand"
import { serviceTiming, type EventTiming, type TimingInput } from "@/lib/timing-engine"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useEventClock } from "@/stores/event-clock-store"
import { useHold } from "@/stores/hold-store"
import { useJournalStore } from "@/stores/journal-store"
import { runStateNow, timingInputNow } from "@/stores/timing-input"

/**
 * Fixed starts kept by the clock (#196, time-of-day automation; ADR 25 §8), armed by the
 * Timekeeper: the next event, when it has a fixed start, begins on the event clock at that time. The event clock never changes a
 * screen, so neither does this. Under the #246 rules: only while armed by a person; it waits in
 * rehearsal and on a Hold; never late: an event is started within two minutes of its time or not
 * at all; arming is not saved, so a restart leaves it off.
 */
const GRACE_MS = 2 * 60_000

interface FixedStartAutoState {
  armed: { by: string | null; at: number } | null
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
    set({ armed: { by: by ?? null, at: Date.now() }, started: [] })
    log(`${by ? `${by}: ` : ""}fixed starts now begin events on the clock`)
  },
  disarm: (by) => {
    if (!get().armed) return
    set({ armed: null, started: [] })
    log(`${by ? `${by}: ` : ""}fixed starts back to the Timekeeper's hand`)
  },
}))

/**
 * The next event when its fixed start has just come and it may start by itself (ADR 25 §8.9): the
 * first one still to come after the live one, not a milestone, its fixed start after `armedAt` and
 * at most two minutes ago, and not late: as of its fixed start, what runs before it was not
 * expected to run past it (rule 2: then a person starts it when that finishes). Null otherwise.
 */
export function nextDueFixedStart(input: TimingInput, armedAt: number, started: readonly string[]): EventTiming | null {
  const t = serviceTiming(input)
  if (!t) return null
  const now = input.now
  const live = t.events.findIndex((e) => e.state === "live")
  const next = t.events.slice(live + 1).find((e) => e.state === "upcoming")
  if (!next || next.milestone || next.fixedStart === null || started.includes(next.id)) return null
  if (next.fixedStart < armedAt || now < next.fixedStart || now >= next.fixedStart + GRACE_MS) return null
  // Late is judged as the fixed start came (just now, everything after it counts as late).
  const then = serviceTiming({ ...input, now: next.fixedStart - 1 })?.events.find((e) => e.id === next.id)
  return then && !then.conflict ? next : null
}

/**
 * On the app's tick: start the next event when its fixed start has just come, if armed. Only with
 * the event clock in the Timekeeper's hands ("I start each event": the screens would undo it
 * otherwise), only while the service is running and trusted, only the very next event (never
 * skipping one, nor one already late), never a milestone, and only a fixed start that comes after
 * arming (see `nextDueFixedStart`).
 */
export function checkFixedStarts(): void {
  const a = useFixedStartAuto.getState()
  if (!a.armed || useBroadcastStore.getState().rehearsal || useHold.getState().hold) return
  if (useEventClock.getState().mode !== "own" || runStateNow() !== "running") return
  const next = nextDueFixedStart(timingInputNow(), a.armed.at, a.started)
  if (!next) return
  useFixedStartAuto.setState({ started: [...a.started, next.id] })
  useEventClock.getState().start(next.id)
  log(`${next.label} started at its fixed start by the clock${a.armed.by ? ` (armed by ${a.armed.by})` : ""}`)
}
