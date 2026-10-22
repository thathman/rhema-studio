import { create } from "zustand"
import { formatMs } from "@/lib/timer"
import { useBroadcastStore } from "@/stores/broadcast-store"
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
}

interface HoldState {
  hold: Hold | null
  start: (reason: string) => void
  resume: () => void
}

// The stage message the hold put up, so Resume clears it only if nobody changed it since.
let heldMessage: string | null = null

export const useHold = create<HoldState>((set, get) => ({
  hold: null,
  start: (raw) => {
    if (get().hold) return
    const reason = raw.replace(/\s+/g, " ").trim().slice(0, 80) || "On hold"
    set({ hold: { reason, since: Date.now() } })
    useJournalStore.getState().add({ kind: "timing", label: `hold: ${reason}` })
    heldMessage = `On hold: ${reason}`
    useBroadcastStore.getState().setStageMessage(heldMessage)
  },
  resume: () => {
    const h = get().hold
    if (!h) return
    if (heldMessage !== null && useBroadcastStore.getState().stageMessage === heldMessage) useBroadcastStore.getState().setStageMessage("")
    heldMessage = null
    useJournalStore.getState().add({ kind: "timing", label: `resumed after ${formatMs(Date.now() - h.since)}` })
    set({ hold: null })
  },
}))
