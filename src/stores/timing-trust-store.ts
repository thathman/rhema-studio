import { create } from "zustand"
import { useJournalStore } from "@/stores/journal-store"
import { useServiceStore } from "@/stores/service-store"

/**
 * Whether the running item's time can be trusted (#196 R3.8). After Rhema closed unexpectedly
 * mid-service, the item that was running is flagged: its start is in the service log, but nobody
 * knows exactly when Rhema stopped, so how long it has run is not known. It stays flagged until
 * the operator confirms the time ("The time is right") or takes the item again, and no time is
 * made up for it meanwhile. Nothing goes on a screen either way.
 */
export interface Untrusted {
  itemId: string
  label: string
  /** The last moment the closed run is known to have been working (wall ms). */
  lastSeen: number
  /** When this run started again (wall ms). */
  restartedAt: number
}

interface TrustState {
  untrusted: Untrusted | null
  /** The operator says the time is right: the reason it can't be, else null. */
  confirm: (by?: string) => string | null
}

export const useTimingTrust = create<TrustState>((set, get) => ({
  untrusted: null,
  confirm: (by) => {
    const u = get().untrusted
    if (!u) return "Nothing to confirm."
    set({ untrusted: null })
    useJournalStore.getState().add({ kind: "timing", label: `${by ? `${by}: ` : ""}time for ${u.label} confirmed after Rhema Studio restarted` })
    return null
  },
}))

// Putting the screens back starts the same event again; that is not the operator taking it again.
let puttingBack = false
export function whilePuttingBack(fn: () => void): void {
  puttingBack = true
  try {
    fn()
  } finally {
    puttingBack = false
  }
}

// Taken again by the operator: its time counts from a moment that is known.
useJournalStore.subscribe((s, p) => {
  const u = useTimingTrust.getState().untrusted
  if (!u || puttingBack || s.entries === p.entries) return
  const added = s.entries.slice(s.entries.length - Math.max(0, s.entries.length - p.entries.length))
  if (added.some((e) => e.kind === "event" && e.itemId === u.itemId && e.at >= u.restartedAt)) useTimingTrust.setState({ untrusted: null })
})

// Another service opened: the flag was about the last one.
useServiceStore.subscribe((s, p) => { if (s.current?.id !== p.current?.id) useTimingTrust.setState({ untrusted: null }) })
