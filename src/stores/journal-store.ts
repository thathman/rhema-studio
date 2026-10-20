import { create } from "zustand"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { monotonicNow } from "@/stores/timer-store"
import type { JournalEntry } from "@/lib/journal"

interface JournalState {
  entries: JournalEntry[]
  add: (entry: Omit<JournalEntry, "at" | "mono">) => void
  clear: () => void
}

/** The service journal for this run of the app. Not persisted (AR-001 first slice). */
export const useJournalStore = create<JournalState>((set) => ({
  entries: [],
  add: (entry) => set((s) => ({ entries: [...s.entries, { ...entry, at: Date.now(), mono: monotonicNow() }].slice(-2000) })),
  clear: () => set({ entries: [] }),
}))

// Record every change of what is on air, from the one store that owns it.
useBroadcastStore.subscribe((s, prev) => {
  const add = useJournalStore.getState().add
  if (s.rehearsal !== prev.rehearsal) add({ kind: "rehearsal", label: s.rehearsal ? "on" : "off" })
  if (s.stageMessage !== prev.stageMessage && s.stageMessage) add({ kind: "message", label: s.stageMessage })
  if (s.rehearsal) return
  const wentOff = prev.isLive && !s.isLive
  const wentOn = s.isLive && (!prev.isLive || s.liveVerse !== prev.liveVerse)
  if (wentOff) add({ kind: "clear", label: labelOf(prev), itemId: prev.liveItemId })
  if (wentOn) {
    const restored = prev.liveVerse === s.liveVerse && !prev.isLive
    const quick = s.heldLive !== null && s.liveItemId === null
    add({ kind: restored ? "restore" : quick ? "quick" : "live", label: labelOf(s), itemId: s.liveItemId })
  }
})

function labelOf(s: { liveVerse: { reference: string; lines?: string[] } | null }): string {
  return s.liveVerse ? s.liveVerse.reference || s.liveVerse.lines?.[0] || "slide" : ""
}
