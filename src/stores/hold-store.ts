import { create } from "zustand"
import { formatMs } from "@/lib/timer"
import { actingAs, useBroadcastStore } from "@/stores/broadcast-store"
import { useJournalStore } from "@/stores/journal-store"

/**
 * A hold in the service (issue #196 R3): "Waiting for the pastor". The reason goes in the service
 * log and on the stage display; loops and timed moves wait (they carry on at Resume). Nothing on
 * the congregation's screen changes.
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
  /** `by`: the joined desk asking (its name goes in the log line). */
  start: (reason: string, by?: string) => void
  resume: (by?: string) => void
}

// The stage message the hold put up, so Resume clears it only if nobody changed it since.
let heldMessage: string | null = null

export const useHold = create<HoldState>((set, get) => ({
  hold: null,
  start: (raw, by) => {
    if (get().hold) return
    const reason = raw.replace(/\s+/g, " ").trim().slice(0, 80) || "On hold"
    set({ hold: { reason, since: Date.now(), ...(by ? { by } : {}) } })
    useJournalStore.getState().add({ kind: "timing", label: `${by ? `${by}: ` : ""}hold: ${reason}` })
    heldMessage = `On hold: ${reason}`
    // The stage message is the hold's: recorded as the asking desk's, not this desk's operator's.
    const message = heldMessage
    actingAs(by, () => useBroadcastStore.getState().setStageMessage(message))
  },
  resume: (by) => {
    const h = get().hold
    if (!h) return
    if (heldMessage !== null && useBroadcastStore.getState().stageMessage === heldMessage) actingAs(by, () => useBroadcastStore.getState().setStageMessage(""))
    heldMessage = null
    useJournalStore.getState().add({ kind: "timing", label: `${by ? `${by}: ` : ""}resumed after ${formatMs(Date.now() - h.since)}` })
    set({ hold: null })
  },
}))
