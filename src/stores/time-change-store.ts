import { create } from "zustand"

/**
 * Who last changed the service's time, what and when (#196 R2.9): a correction of the service
 * timer, the running-late offset or its mode. The Timekeeper desk (here and on joined desks, from
 * the Live State) shows it, so two timekeepers can see each other's changes. `by` null: the main
 * desk. The service log keeps every change; this is only the latest.
 */
export interface TimeChange {
  /** "+5 min (running 5 min late)", "timer corrected by −1 min". */
  what: string
  by: string | null
  /** Wall ms. */
  at: number
}

interface TimeChangeState {
  last: TimeChange | null
  note: (what: string, by?: string | null, at?: number) => void
  clear: () => void
}

export const useTimeChange = create<TimeChangeState>((set) => ({
  last: null,
  note: (what, by, at = Date.now()) => set({ last: { what: what.slice(0, 120), by: by?.trim() ? by.trim().slice(0, 60) : null, at } }),
  clear: () => set({ last: null }),
}))

/** "+5 min by Desk A at 10:42 (3 min ago)" — `hhmm` formats the time on the church's clock. */
export function timeChangeWords(c: TimeChange, now: number, hhmm: (ms: number) => string): string {
  const ago = Math.max(0, Math.round((now - c.at) / 60_000))
  return `${c.what} · by ${c.by ?? "the main desk"} at ${hhmm(c.at)}${ago >= 1 ? ` (${ago} min ago)` : " (just now)"}`
}
