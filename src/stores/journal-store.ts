import { create } from "zustand"
import { cameraChangeBetween, useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import { monotonicNow } from "@/stores/timer-store"
import { invoke } from "@tauri-apps/api/core"
import { formatJournal, type JournalEntry } from "@/lib/journal"
import { plannedMs } from "@/lib/service-timing"
import { useSettingsStore } from "@/stores/settings-store"
import { CONTENT_NAMES } from "@/lib/content-names"
import { lowerThirdWords, tickerWords, type SourceId, type StateSource, type StateSourceId } from "@/lib/live-sources"
import { cameraWords } from "@/lib/show-health"
import { sceneForOutput } from "@/lib/scenes"
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
    set((s) => ({ entries: capJournal([...s.entries, { ...entry, at: Date.now(), mono: monotonicNow() }]), added: s.added + 1 }))
  },
  clear: () => set((s) => ({ entries: [], startItemIds: null, keptAt: s.added })),
}))

/** The most entries the log keeps in this run. */
export const JOURNAL_MAX = 2000

/**
 * The last 2000 entries, except that an event's start is never dropped: the run of show's actual
 * times and durations are worked out from those alone (#196 R7), and a long service with a verse
 * stepped every few seconds would otherwise lose its first items and call them skipped. There are
 * only ever as many of them as items started; past that, the oldest go after all.
 */
export function capJournal(entries: JournalEntry[]): JournalEntry[] {
  let drop = entries.length - JOURNAL_MAX
  if (drop <= 0) return entries
  const kept = entries.filter((e) => (drop > 0 && e.kind !== "event" ? (drop--, false) : true))
  return kept.length > JOURNAL_MAX ? kept.slice(-JOURNAL_MAX) : kept
}

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

/**
 * Keep the log in the library (Earlier logs); `transcript` (what was said, when ticked) is kept
 * apart from the log, so the church's retention removes only it (#246 C17).
 */
export async function keepJournal(transcript = ""): Promise<void> {
  const current = useServiceStore.getState().current
  const added = useJournalStore.getState().added
  const title = `${current?.title ?? "Service"} — ${new Date().toLocaleDateString()}`
  await invoke("content_save_service_log", { programId: current?.id ?? null, title, body: journalText(), transcript: transcript || null })
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

// A scene taken to an output or released from it (ARCH-002; #246 C17), with who did it (#243 EX.1).
// Each Take is told once: the revision last told, by output.
const toldTakes = new Map<string, number>()
useBroadcastStore.subscribe((s, prev) => {
  if (s.outputs === prev.outputs) return
  for (const o of s.outputs) {
    const was = prev.outputs.find((x) => x.id === o.id)
    if (!was) continue
    const take = s.sceneTakes[o.id]
    const own = take && toldTakes.get(o.id) !== take.revision && take.sceneId === (o.sceneId ?? null) ? take : undefined
    if (was.sceneId === o.sceneId && !own && was.sceneSnapshot?.updatedAt === o.sceneSnapshot?.updatedAt) continue
    const name = o.sceneId ? sceneForOutput(o, s.scenes)?.name ?? "a scene" : null
    // The Take (or release) that made this change; none when a scene was deleted or rehearsal ended.
    if (own) toldTakes.set(o.id, own.revision)
    const by = own?.by ? ` · by ${own.by}` : ""
    useJournalStore.getState().add({
      kind: "scene",
      label: name ? `${o.name}: ${was.sceneId === o.sceneId ? `refreshed ${name}` : name}${by}` : `${o.name}: back to its own feed${by}`,
      outputId: o.id,
      ...(o.sceneId ? { sceneId: o.sceneId } : {}),
      ...(own ? { revision: own.revision, ...(own.by ? { by: own.by } : {}) } : {}),
    })
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
    // The program's own source: its live / clear / restore entry already says so. A new value that is
    // not the program's was activated on its own (on the Bible feeds only), even over the program's.
    const ownActivation = !!b?.on && a?.revision !== b.revision && b.value !== s.liveVerse
    if (!ownActivation && ((b && b.value === s.liveVerse) || (a && (a.value === s.liveVerse || a.value === prev.liveVerse)))) {
      // The program's own activation: its live entry (written just before) gets who and the revision (#243 EX.1).
      if (b?.on && a?.revision !== b.revision && b.value === s.liveVerse) noteWho(b.revision, b.by)
      continue
    }
    const name = CONTENT_NAMES[id]
    if (b?.on && (!a?.on || a.revision !== b.revision)) {
      const back = a && !a.on && a.revision === b.revision
      useJournalStore.getState().add({ kind: "source", label: `${name}${back ? " back" : ""}: ${b.value.reference}${b.by && !back ? ` · by ${b.by}` : ""}`, itemId: b.itemId, source: name, revision: b.revision, ...(b.by ? { by: b.by } : {}) })
    } else if (a?.on && !b?.on) {
      useJournalStore.getState().add({ kind: "source", label: `${name} off: ${a.value.reference}`, itemId: a.itemId, source: name, revision: a.revision })
    }
  }
})

// The ticker, the service timer and the cameras as live sources (ADR 0001): each change, with who.
useBroadcastStore.subscribe((s, prev) => {
  if (s.stateSources === prev.stateSources) return
  const add = useJournalStore.getState().add
  for (const [id, b] of Object.entries(s.stateSources) as [StateSourceId, StateSource][]) {
    const a = prev.stateSources[id]
    if (a?.revision === b.revision) continue
    const by = b.by ? ` · by ${b.by}` : ""
    // Who and which revision, as fields as well as in the words (#243 EX.1).
    const meta = { revision: b.revision, ...(b.by ? { by: b.by } : {}) }
    if (id === "timer") {
      // As the timer's other entries: "Femi: timer paused".
      const verb = b.on ? (a ? "resumed" : "started") : "paused"
      add({ kind: "timing", label: `${b.by ? `${b.by}: ` : ""}timer ${verb}`, ...meta })
    } else if (id === "ticker") {
      const words = tickerWords(b.on ? s.ticker : b.ticker)
      const held = !!s.ticker?.pausedAt
      const verb = !b.on ? "off" : a && !a.on ? "back" : a?.on && held !== !!prev.ticker?.pausedAt ? (held ? "held still" : "moving again") : "on"
      add({ kind: "source", label: `Ticker ${verb}${words ? `: ${words}` : ""}${by}`, source: "Ticker", ...meta })
    } else if (id === "lowerThird") {
      const words = lowerThirdWords(b.lowerThird)
      const verb = !b.on ? "down" : a && !a.on && a.lowerThird === b.lowerThird ? "back" : "up"
      add({ kind: "source", label: `Lower third ${verb}${words ? `: ${words}` : ""}${by}`, source: "Lower third", ...meta })
    } else if (id === "stage") {
      // As before: the message itself is the entry; clearing it is one too now.
      add(b.on ? { kind: "message", label: `${b.message ?? s.stageMessage}${by}`, ...meta } : { kind: "message", label: `cleared${b.message ? `: ${b.message}` : ""}${by}`, ...meta })
    } else {
      const name = id.slice("camera:".length)
      const cameras = useSettingsStore.getState().cameras
      const own = cameras.find((c) => c.name === name)
      const label = own?.label ?? name
      // Retry, backup and Freeze are controls, not a hide or a restore (#213): "Pulpit camera: frozen · by Tolu".
      const change = a?.on === b.on || !a ? cameraChangeBetween(a, b) : null
      if (change) {
        const backup = own?.backup ? cameraWords(cameras.find((c) => c.name === own.backup)?.label ?? own.backup) : "its backup"
        const words = { retry: "retried", backup: `switched to backup ${backup}`, unbackup: "back on its own camera", freeze: "frozen", unfreeze: "unfrozen" }[change]
        add({ kind: "source", label: `${cameraWords(label)}: ${words}${by}`, source: "Cameras", ...meta })
        continue
      }
      add({ kind: "source", label: `${cameraWords(label)} ${b.on ? "back in scenes" : "hidden from scenes"}${by}`, source: "Cameras", ...meta })
    }
  }
})

/** The newest entry, when it is the program going on air and says nothing yet of who: it gets who and the revision. */
function noteWho(revision: number, by: string | undefined) {
  useJournalStore.setState((j) => {
    const last = j.entries.at(-1)
    if (!last || last.kind !== "live" || last.revision !== undefined) return j
    return { entries: [...j.entries.slice(0, -1), { ...last, revision, ...(by ? { by } : {}) }] }
  })
}

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
