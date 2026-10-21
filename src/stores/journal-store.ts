import { create } from "zustand"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import { monotonicNow } from "@/stores/timer-store"
import { invoke } from "@tauri-apps/api/core"
import { formatJournal, type JournalEntry } from "@/lib/journal"
import { plannedMs } from "@/lib/service-timing"
import { useSettingsStore } from "@/stores/settings-store"

interface JournalState {
  entries: JournalEntry[]
  /** The rundown's item ids when the service first went on air (this run, since the log was last started): the plan. */
  startItemIds: string[] | null
  /** Entries ever added this run, and how many there were when the log was last kept. */
  added: number
  keptAt: number
  add: (entry: Omit<JournalEntry, "at" | "mono">) => void
  clear: () => void
}

/** The service journal for this run of the app. Not persisted (AR-001 first slice). */
export const useJournalStore = create<JournalState>((set) => ({
  entries: [],
  startItemIds: null,
  added: 0,
  keptAt: 0,
  add: (entry) => set((s) => ({ entries: [...s.entries, { ...entry, at: Date.now(), mono: monotonicNow() }].slice(-2000), added: s.added + 1 })),
  clear: () => set((s) => ({ entries: [], startItemIds: null, keptAt: s.added })),
}))

/** The log as text (no transcript): what Keep log and Save log write. */
export function journalText(): string {
  const current = useServiceStore.getState().current
  const operator = useSettingsStore.getState().operatorName.trim()
  const items = useQueueStore.getState().items
  const { entries, startItemIds: start } = useJournalStore.getState()
  return formatJournal(
    `${current?.title ?? "Service"}${operator ? ` — operator: ${operator}` : ""}`,
    entries,
    monotonicNow(),
    new Map(items.map((i) => [i.id, plannedMs(i)])),
    // Added on the day: not in the rundown when the service first went on air (saving does not change that).
    items.map((i) => ({ id: i.id, label: i.reference, inserted: start ? !start.includes(i.id) : false })),
  )
}

/** Something was logged since the log was last kept. */
export const journalUnkept = () => useJournalStore.getState().added > useJournalStore.getState().keptAt

/** Keep the log in the library (Earlier logs); `extra` is appended (the transcript, when ticked). */
export async function keepJournal(extra = ""): Promise<void> {
  const current = useServiceStore.getState().current
  const added = useJournalStore.getState().added
  const title = `${current?.title ?? "Service"} — ${new Date().toLocaleDateString()}`
  await invoke("content_save_service_log", { programId: current?.id ?? null, title, body: journalText() + extra })
  useJournalStore.setState({ keptAt: added })
}

/** What the congregation saw when rehearsal started: rehearsal ends by sending what is live now. */
let seenBeforeRehearsal: { isLive: boolean; liveVerse: Aired["liveVerse"]; liveItemId: string | null } | null = null

// Record every change of what is on air, from the one store that owns it.
useBroadcastStore.subscribe((s, prev) => {
  const add = useJournalStore.getState().add
  if (s.rehearsal !== prev.rehearsal) add({ kind: "rehearsal", label: s.rehearsal ? "on" : "off" })
  if (s.stageMessage !== prev.stageMessage && s.stageMessage) add({ kind: "message", label: s.stageMessage })
  if (s.rehearsal && !prev.rehearsal) seenBeforeRehearsal = { isLive: prev.isLive, liveVerse: prev.liveVerse, liveItemId: prev.liveItemId }
  if (s.rehearsal) return
  // Rehearsal off sends what is live now to the congregation: that is what they see from here (AR-001).
  if (prev.rehearsal) {
    const before = seenBeforeRehearsal
    seenBeforeRehearsal = null
    if (before && before.isLive === s.isLive && before.liveVerse === s.liveVerse) return
    if (s.isLive && s.liveVerse && !isQuick(s)) notePlan()
    if (s.isLive && s.liveVerse) add({ kind: isQuick(s) ? "quick" : "live", label: labelOf(s), itemId: s.liveItemId })
    else if (before?.isLive) add({ kind: "clear", label: labelOf(before), itemId: before.liveItemId })
    return
  }
  const wentOff = prev.isLive && !s.isLive
  const wentOn = s.isLive && (!prev.isLive || s.liveVerse !== prev.liveVerse)
  if (wentOff) add({ kind: "clear", label: labelOf(prev), itemId: prev.liveItemId })
  if (wentOn) {
    if (!isQuick(s)) notePlan()
    const restored = prev.liveVerse === s.liveVerse && !prev.isLive
    add({ kind: restored ? "restore" : isQuick(s) ? "quick" : "live", label: labelOf(s), itemId: s.liveItemId })
  }
})

/** The first time service content goes on air (not a quick screen), the rundown as it stands is the plan. */
function notePlan() {
  if (useJournalStore.getState().startItemIds === null) useJournalStore.setState({ startItemIds: useQueueStore.getState().items.map((i) => i.id) })
}

// Another service opened: its plan is taken when it first goes on air.
useServiceStore.subscribe((s, prev) => {
  if (s.current?.id !== prev.current?.id) useJournalStore.setState({ startItemIds: null })
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
