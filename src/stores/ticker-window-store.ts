import { create } from "zustand"
import { CUE_ACTIONS } from "@/lib/cues"
import { minutesOfDay, validTimeZone } from "@/lib/church-time"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useJournalStore } from "@/stores/journal-store"
import { useSettingsStore } from "@/stores/settings-store"

/**
 * The ticker on a clock window (#187), armed by an operator in Live: it is taken at `from` (at
 * once when armed inside the window) and stopped at `until`, then the window is over. Under the
 * #246 rules for anything the clock does: only while armed by a person, never in rehearsal, and
 * never late: arming is not saved, so a restart leaves nothing armed. It only stops a ticker it took.
 */
interface TickerWindowState {
  armed: { from: string; until: string; by: string | null } | null
  /** The window took the ticker (so it may stop it). */
  took: boolean
  /** The window's From has been acted on (taken, or found already on). */
  started: boolean
  /** Arm a window ("HH:MM" on the church's clock, `from` before `until`, the same day). Null when armed, else why not. */
  arm: (from: string, until: string, by?: string, now?: number) => string | null
  disarm: (by?: string) => void
}

const minutes = (t: string) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null)
const zone = () => validTimeZone(useSettingsStore.getState().setup.timeZone)

export const useTickerWindow = create<TickerWindowState>((set, get) => ({
  armed: null,
  took: false,
  started: false,
  arm: (from, until, by, now = Date.now()) => {
    const a = minutes(from), b = minutes(until)
    if (a === null || b === null) return "give both times as HH:MM"
    if (b <= a) return "the ticker must stop after it starts (on the same day)"
    if (minutesOfDay(now, zone()) >= b) return `${until} has passed today`
    set({ armed: { from, until, by: by ?? null }, took: false, started: false })
    useJournalStore.getState().add({ kind: "remote", label: `${by ? `${by}: ` : ""}ticker armed for ${from}–${until}` })
    checkTickerWindow(now)
    return null
  },
  disarm: (by) => {
    if (!get().armed) return
    set({ armed: null, took: false, started: false })
    useJournalStore.getState().add({ kind: "remote", label: `${by ? `${by}: ` : ""}ticker window disarmed` })
  },
}))

/** On the app's tick: take or stop the ticker as an armed window says. */
export function checkTickerWindow(now = Date.now()): void {
  const w = useTickerWindow.getState()
  if (!w.armed) return
  const b = useBroadcastStore.getState()
  const m = minutesOfDay(now, zone())
  const from = minutes(w.armed.from)!, until = minutes(w.armed.until)!
  if (m >= until) {
    if (w.took && b.ticker && !b.rehearsal) void CUE_ACTIONS["ticker.stop"].run()
    useTickerWindow.setState({ armed: null, took: false, started: false })
    useJournalStore.getState().add({ kind: "remote", label: `ticker window ${w.armed.from}–${w.armed.until} ended` })
    return
  }
  // Never in rehearsal (it would put the ticker on the real screens' plan): it waits.
  if (m >= from && !w.took && !w.started && !b.rehearsal) {
    // Already on (an operator took it): the window leaves it, and leaves it on at Until.
    useTickerWindow.setState({ started: true, took: !b.ticker })
    if (!b.ticker) void CUE_ACTIONS["ticker.take"].run()
  }
}
