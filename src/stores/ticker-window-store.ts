import { create } from "zustand"
import { CUE_ACTIONS } from "@/lib/cues"
import { dayAt, validTimeZone } from "@/lib/church-time"
import { actingAs, useBroadcastStore } from "@/stores/broadcast-store"
import { useHold } from "@/stores/hold-store"
import { useJournalStore } from "@/stores/journal-store"
import { useSettingsStore } from "@/stores/settings-store"

/**
 * The ticker on a clock window (#187), armed by an operator in Live: it is taken at `from` (at
 * once when armed inside the window) and stopped at `until`, then the window is over. Under the
 * #246 rules for anything the clock does: only while armed by a person; it waits in rehearsal and
 * on a Hold; never late: the window is today's (a computer asleep past it ends it unfired), and
 * arming is not saved, so a restart leaves nothing armed. It only stops the ticker it took.
 */
interface TickerWindowState {
  armed: { from: string; until: string; fromAt: number; untilAt: number; by: string | null } | null
  /** When the ticker the window took started (its identity): only that one is stopped at `until`. */
  mine: number | null
  /** The window's From has been acted on (taken, or found already on). */
  started: boolean
  /** Arm a window ("HH:MM" on the church's clock, `from` before `until`, today). Null when armed, else why not. */
  arm: (from: string, until: string, by?: string, now?: number) => string | null
  disarm: (by?: string) => void
}

const minutes = (t: string) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null)
const zone = () => validTimeZone(useSettingsStore.getState().setup.timeZone)
const log = (label: string) => useJournalStore.getState().add({ kind: "timing", label })

export const useTickerWindow = create<TickerWindowState>((set, get) => ({
  armed: null,
  mine: null,
  started: false,
  arm: (from, until, by, now = Date.now()) => {
    const a = minutes(from), b = minutes(until)
    if (a === null || b === null) return "give both times as HH:MM"
    if (b <= a) return "the ticker must stop after it starts (on the same day)"
    if (!useBroadcastStore.getState().tickerItems.some((i) => i.trim())) return "type the ticker's words first"
    const fromAt = dayAt(now, 0, a, zone()), untilAt = dayAt(now, 0, b, zone())
    if (now >= untilAt) return `${until} has passed today`
    set({ armed: { from, until, fromAt, untilAt, by: by ?? null }, mine: null, started: false })
    log(`${by ? `${by}: ` : ""}ticker armed for ${from}–${until}`)
    checkTickerWindow(now)
    return null
  },
  disarm: (by) => {
    if (!get().armed) return
    set({ armed: null, mine: null, started: false })
    log(`${by ? `${by}: ` : ""}ticker window disarmed`)
  },
}))

const actor = () => `Ticker window${useTickerWindow.getState().armed?.by ? ` (armed by ${useTickerWindow.getState().armed!.by})` : ""}`

/** On the app's tick: take or stop the ticker as an armed window says. */
export function checkTickerWindow(now = Date.now()): void {
  const w = useTickerWindow.getState()
  if (!w.armed) return
  const b = useBroadcastStore.getState()
  // In rehearsal it waits, at either end (the real ticker comes back when rehearsal ends).
  if (b.rehearsal) return
  if (now >= w.armed.untilAt) {
    // Only the ticker it took, still the same one (an operator's own is left on).
    if (w.mine !== null && b.ticker?.startedAt === w.mine) actingAs(actor(), () => void CUE_ACTIONS["ticker.stop"].run())
    const { from, until } = w.armed
    useTickerWindow.setState({ armed: null, mine: null, started: false })
    log(`ticker window ${from}–${until} ${w.started ? "ended" : "passed without going on"}`)
    return
  }
  // On a Hold the clock's moves wait, as loops and timed moves do.
  if (now >= w.armed.fromAt && !w.started && !useHold.getState().hold) {
    useTickerWindow.setState({ started: true })
    // Already on (an operator took it): the window leaves it, and leaves it on at Until.
    if (b.ticker) return
    const by = actor()
    void actingAs(by, () => CUE_ACTIONS["ticker.take"].run()).then(() => {
      // The one that went on now is the window's (none, if the words were cleared meanwhile).
      const t = useBroadcastStore.getState().ticker
      if (t && useTickerWindow.getState().armed) useTickerWindow.setState({ mine: t.startedAt })
    })
  }
}
