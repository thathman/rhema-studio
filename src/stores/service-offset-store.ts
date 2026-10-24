import { create } from "zustand"
import type { OffsetMode } from "@/lib/timing-engine"
import { useJournalStore } from "@/stores/journal-store"
import { useServiceStore } from "@/stores/service-store"

/**
 * Running late or early (#196 R2.9 / R3): one shared offset for the whole service, in minutes,
 * set from Prepare, Production's Timekeeper or a joined Timekeeper desk. It moves only what is
 * expected (the plan stays as prepared), reaches the stage finish, the Live State and every desk,
 * and each change is in the service log with who made it.
 */
interface OffsetState {
  minutes: number
  by: string | null
  /**
   * How it reaches what is still to come (#196 R3.4): taken up by pauses, with fixed starts keeping
   * their time ("absorb", as before), or pushed through everything ("push"). A choice for the
   * running service, kept when another service opens.
   */
  mode: OffsetMode
  setMode: (mode: OffsetMode, by?: string) => void
  /** Move the offset by `delta` minutes (−120 … +240 in all). */
  adjust: (delta: number, by?: string) => void
  reset: (by?: string) => void
}

const clamp = (m: number) => Math.max(-120, Math.min(240, Math.round(m)))
const words = (m: number) => (m === 0 ? "on schedule" : m > 0 ? `running ${m} min late` : `running ${-m} min early`)

export const useServiceOffset = create<OffsetState>((set, get) => ({
  minutes: 0,
  by: null,
  mode: "absorb",
  setMode: (mode, by) => {
    if (mode === get().mode) return
    set({ mode })
    useJournalStore.getState().add({ kind: "timing", label: `${by ? `${by}: ` : ""}${mode === "push" ? "lateness now pushes everything still to come, pauses and fixed starts too" : "pauses take up lateness again, and fixed starts keep their time"}` })
  },
  adjust: (delta, by) => {
    const minutes = clamp(get().minutes + delta)
    if (minutes === get().minutes) return
    set({ minutes, by: by ?? null })
    useJournalStore.getState().add({ kind: "timing", label: `${by ? `${by}: ` : ""}${words(minutes)} (${delta > 0 ? "+" : "−"}${Math.abs(delta)} min)` })
  },
  reset: (by) => {
    if (get().minutes === 0) return
    set({ minutes: 0, by: by ?? null })
    useJournalStore.getState().add({ kind: "timing", label: `${by ? `${by}: ` : ""}back on schedule` })
  },
}))

// Another service opened: its own timing, not the last one's lateness.
useServiceStore.subscribe((s, p) => { if (s.current?.id !== p.current?.id) useServiceOffset.setState({ minutes: 0, by: null }) })

export { words as offsetWords }
