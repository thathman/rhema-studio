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

/** What the congregation saw when rehearsal started: rehearsal ends by sending what is live now. */
let seenBeforeRehearsal: { isLive: boolean; liveVerse: unknown } | null = null

// Record every change of what is on air, from the one store that owns it.
useBroadcastStore.subscribe((s, prev) => {
  const add = useJournalStore.getState().add
  if (s.rehearsal !== prev.rehearsal) add({ kind: "rehearsal", label: s.rehearsal ? "on" : "off" })
  if (s.stageMessage !== prev.stageMessage && s.stageMessage) add({ kind: "message", label: s.stageMessage })
  if (s.rehearsal && !prev.rehearsal) seenBeforeRehearsal = { isLive: prev.isLive, liveVerse: prev.liveVerse }
  if (s.rehearsal) return
  // Rehearsal off sends what is live now to the congregation: that is what they see from here (AR-001).
  if (prev.rehearsal) {
    const before = seenBeforeRehearsal
    seenBeforeRehearsal = null
    if (before && before.isLive === s.isLive && before.liveVerse === s.liveVerse) return
    if (s.isLive && s.liveVerse) add({ kind: isQuick(s) ? "quick" : "live", label: labelOf(s), itemId: s.liveItemId })
    else if (before?.isLive) add({ kind: "clear", label: "", itemId: null })
    return
  }
  const wentOff = prev.isLive && !s.isLive
  const wentOn = s.isLive && (!prev.isLive || s.liveVerse !== prev.liveVerse)
  if (wentOff) add({ kind: "clear", label: labelOf(prev), itemId: prev.liveItemId })
  if (wentOn) {
    const restored = prev.liveVerse === s.liveVerse && !prev.isLive
    add({ kind: restored ? "restore" : isQuick(s) ? "quick" : "live", label: labelOf(s), itemId: s.liveItemId })
  }
})

type Aired = { liveVerse: { reference: string; lines?: string[]; screen?: "black" | "logo"; quick?: boolean } | null; heldLive?: unknown; liveItemId?: string | null }

/** A quick screen, whether or not something was live to come back to. */
const isQuick = (s: Aired) => Boolean(s.liveVerse?.quick || s.liveVerse?.screen || (s.heldLive && s.liveItemId === null))

function labelOf(s: Aired): string {
  if (!s.liveVerse) return ""
  if (s.liveVerse.screen === "black") return "Black screen"
  if (s.liveVerse.screen === "logo") return "Logo"
  return s.liveVerse.reference || s.liveVerse.lines?.[0] || "slide"
}
