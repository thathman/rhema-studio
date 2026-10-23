import { create } from "zustand"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import { monotonicNow } from "@/stores/timer-store"
import { invoke } from "@tauri-apps/api/core"
import { formatJournal, type JournalEntry } from "@/lib/journal"
import { plannedMs } from "@/lib/service-timing"
import { useSettingsStore } from "@/stores/settings-store"
import { CONTENT_NAMES } from "@/lib/content-names"
import type { SourceId } from "@/lib/live-sources"
import type { ContentType } from "@/types/broadcast"

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
  // Rehearsal is a sandbox (ADR 0001): only its start and end are part of the service's history.
  add: (entry) => {
    if (entry.kind !== "rehearsal" && useBroadcastStore.getState().rehearsal) return
    set((s) => ({ entries: [...s.entries, { ...entry, at: Date.now(), mono: monotonicNow() }].slice(-2000), added: s.added + 1 }))
  },
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

/** Rundown items got new ids (a new service from them): the log follows. */
export function remapJournalItemIds(re: (id: string | null | undefined) => string | null): void {
  useJournalStore.setState((j) => ({ entries: j.entries.map((e) => (e.itemId ? { ...e, itemId: re(e.itemId) } : e)) }))
  if (seenBeforeRehearsal) seenBeforeRehearsal = { ...seenBeforeRehearsal, liveItemId: re(seenBeforeRehearsal.liveItemId) }
}

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
    if (s.isLive && s.liveVerse) add({ kind: isQuick(s) ? "quick" : "live", label: labelOf(s), itemId: s.liveItemId, ...sourceOf(s) })
    else if (before?.isLive) add({ kind: "clear", label: labelOf(before), itemId: before.liveItemId, ...sourceOf(before) })
    return
  }
  const wentOff = prev.isLive && !s.isLive
  const wentOn = s.isLive && (!prev.isLive || s.liveVerse !== prev.liveVerse)
  if (wentOff) add({ kind: "clear", label: labelOf(prev), itemId: prev.liveItemId, ...sourceOf(prev) })
  if (wentOn) {
    if (!isQuick(s)) notePlan()
    const restored = prev.liveVerse === s.liveVerse && !prev.isLive
    add({ kind: restored ? "restore" : isQuick(s) ? "quick" : "live", label: labelOf(s), itemId: s.liveItemId, ...sourceOf(s) })
  }
})

// A scene taken to an output or released from it (ARCH-002; #246 C17).
useBroadcastStore.subscribe((s, prev) => {
  if (s.outputs === prev.outputs) return
  for (const o of s.outputs) {
    const was = prev.outputs.find((x) => x.id === o.id)
    if (!was || was.sceneId === o.sceneId) continue
    const name = o.sceneId ? s.scenes.find((x) => x.id === o.sceneId)?.name ?? "a scene" : null
    useJournalStore.getState().add({ kind: "scene", label: name ? `${o.name}: ${name}` : `${o.name}: back to its own feed` })
  }
})

// A live source changing without the program (ADR 0001): a heard verse while a hymn is up, a source
// taken off or put back.
useBroadcastStore.subscribe((s, prev) => {
  if (s.sources === prev.sources) return
  const ids = new Set([...Object.keys(prev.sources), ...Object.keys(s.sources)]) as Set<SourceId>
  for (const id of ids) {
    // Quick screens (Black, Logo…) are program entries already.
    if (id === "quick") continue
    const a = prev.sources[id]
    const b = s.sources[id]
    // The program's own source: its live / clear / restore entry already says so.
    if ((b && b.value === s.liveVerse) || (a && (a.value === s.liveVerse || a.value === prev.liveVerse))) continue
    const name = CONTENT_NAMES[id]
    if (b?.on && (!a?.on || a.revision !== b.revision)) {
      const back = a && !a.on && a.revision === b.revision
      useJournalStore.getState().add({ kind: "source", label: `${name}${back ? " back" : ""}: ${b.value.reference}`, itemId: b.itemId, source: name })
    } else if (a?.on && !b?.on) {
      useJournalStore.getState().add({ kind: "source", label: `${name} off: ${a.value.reference}`, itemId: a.itemId, source: name })
    }
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

type Aired = { liveVerse: { reference: string; lines?: string[]; screen?: "black" | "logo"; quick?: boolean; content?: ContentType } | null; heldLive?: unknown; liveItemId?: string | null }

/** The source tag for a program entry: what kind of content it was (not a quick screen). */
function sourceOf(s: Aired): { source?: string } {
  const c = s.liveVerse?.content
  return c && !isQuick(s) ? { source: CONTENT_NAMES[c] } : {}
}

/** A quick screen, whether or not something was live to come back to. */
const isQuick = (s: Aired) => Boolean(s.liveVerse?.quick || s.liveVerse?.screen || (s.heldLive && s.liveItemId === null))

function labelOf(s: Aired): string {
  if (!s.liveVerse) return ""
  if (s.liveVerse.screen === "black") return "Black screen"
  if (s.liveVerse.screen === "logo") return "Logo"
  // A picture or a QR slide has no words of its own: the log names its rundown item.
  const item = s.liveItemId ? useQueueStore.getState().items.find((i) => i.id === s.liveItemId)?.reference : undefined
  return s.liveVerse.reference || s.liveVerse.lines?.[0] || item || "slide"
}
