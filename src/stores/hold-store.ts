import { create } from "zustand"
import { serviceFinishedAt } from "@/lib/journal"
import { formatMs } from "@/lib/timer"
import type { HoldSpan } from "@/lib/timing-engine"
import { runState, transition } from "@/lib/timing-state"
import { actingAs, useBroadcastStore } from "@/stores/broadcast-store"
import { useJournalStore } from "@/stores/journal-store"
import { useServiceStore } from "@/stores/service-store"

/**
 * A hold in the service (issue #196 R3): "Waiting for the pastor". The reason goes in the service
 * log and on the stage display; loops and timed moves wait (they carry on at Resume). Nothing on
 * the congregation's screen changes. The service's expected times count the time held (#196 R2.10):
 * the live item's time does not run out while the service waits.
 */
export interface Hold {
  reason: string
  /** Wall ms. */
  since: number
  /** The joined desk that held it (#196); absent when held here. */
  by?: string
}

interface HoldState {
  hold: Hold | null
  /** This service's holds that have ended (wall ms), for its expected times. */
  past: HoldSpan[]
  /** `by`: the joined desk asking (its name goes in the log line). Refused once the service has finished: the reason, else null. */
  start: (reason: string, by?: string) => string | null
  resume: (by?: string) => void
}

/** Every hold of this service so far, the one on now last (`until` null). */
export function holdSpans(s: Pick<HoldState, "hold" | "past"> = useHold.getState()): HoldSpan[] {
  return s.hold ? [...s.past, { since: s.hold.since, until: null }] : s.past
}

// The stage message the hold put up, so Resume clears it only if nobody changed it since.
let heldMessage: string | null = null

export const useHold = create<HoldState>((set, get) => ({
  hold: null,
  past: [],
  start: (raw, by) => {
    if (get().hold) return "Already on hold."
    // The run state (#196 R3.7): a finished service has nothing to hold.
    const finished = serviceFinishedAt(useJournalStore.getState().entries) !== null
    const move = transition(runState({ begun: true, held: false, untrusted: false, finished }), "hold")
    if (!move.ok) return move.reason
    const reason = raw.replace(/\s+/g, " ").trim().slice(0, 80) || "On hold"
    set({ hold: { reason, since: Date.now(), ...(by ? { by } : {}) } })
    useJournalStore.getState().add({ kind: "timing", label: `${by ? `${by}: ` : ""}hold: ${reason}` })
    heldMessage = `On hold: ${reason}`
    // The stage message is the hold's: recorded as the asking desk's, not this desk's operator's.
    const message = heldMessage
    actingAs(by, () => useBroadcastStore.getState().setStageMessage(message))
    return null
  },
  resume: (by) => {
    const h = get().hold
    if (!h) return
    if (heldMessage !== null && useBroadcastStore.getState().stageMessage === heldMessage) actingAs(by, () => useBroadcastStore.getState().setStageMessage(""))
    heldMessage = null
    useJournalStore.getState().add({ kind: "timing", label: `${by ? `${by}: ` : ""}resumed after ${formatMs(Date.now() - h.since)}` })
    set((s) => ({ hold: null, past: [...s.past, { since: h.since, until: Date.now() }].slice(-50) }))
  },
}))

// Another service opened: its holds are not this one's.
useServiceStore.subscribe((s, p) => { if (s.current?.id !== p.current?.id) useHold.setState({ past: [] }) })
