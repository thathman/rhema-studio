import { invoke } from "@tauri-apps/api/core"
import { load, type Store } from "@tauri-apps/plugin-store"
import { create } from "zustand"
import { enableOutput } from "@/lib/broadcast-output-control"
import type { LiveSources } from "@/lib/live-sources"
import { outputOnAir } from "@/lib/output-on-air"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useEventClock } from "@/stores/event-clock-store"
import { useJournalStore } from "@/stores/journal-store"
import { useServiceStore } from "@/stores/service-store"
import type { VerseRenderData } from "@/types"

/**
 * Recovery after Rhema closed unexpectedly mid-service (#246, live safety): what was on the
 * screens is kept in `recovery.json` as it changes; if the last run did not close cleanly, the
 * next start offers to put it back. Nothing goes back on air until the operator chooses it.
 */
export interface LiveSnapshot {
  v: 1
  at: number
  service: { id: string; title: string } | null
  isLive: boolean
  liveVerse: VerseRenderData | null
  liveItemId: string | null
  sources: LiveSources
  /** Outputs that were on, and the scene each showed. */
  outputsOn: string[]
  scenes: Record<string, string>
  eventId: string | null
}

/** Offered for this long after the crash; older is another service. */
const FRESH_MS = 6 * 60 * 60 * 1000
/** Pictures and videos as data can be megabytes: past this the snapshot keeps names, not content. */
const MAX_CHARS = 400_000

export const useRecovery = create<{ offer: LiveSnapshot | null }>(() => ({ offer: null }))

export function takeSnapshot(now = Date.now()): LiveSnapshot {
  const b = useBroadcastStore.getState()
  const current = useServiceStore.getState().current
  const snap: LiveSnapshot = {
    v: 1,
    at: now,
    service: current ? { id: current.id, title: current.title } : null,
    isLive: b.isLive,
    liveVerse: b.isLive ? b.liveVerse : null,
    liveItemId: b.liveItemId,
    sources: b.sources,
    outputsOn: b.outputs.filter((o) => outputOnAir(o, b.outputStatus[o.id])).map((o) => o.id),
    scenes: Object.fromEntries(b.outputs.filter((o) => o.sceneId).map((o) => [o.id, o.sceneId!])),
    eventId: useEventClock.getState().currentId,
  }
  return JSON.stringify(snap).length > MAX_CHARS ? { ...snap, liveVerse: null, sources: {} } : snap
}

/** Whether a snapshot is worth offering: recent, and something was on the screens. */
export function worthOffering(s: LiveSnapshot | null | undefined, now = Date.now()): s is LiveSnapshot {
  return !!s && s.v === 1 && now - s.at < FRESH_MS && now >= s.at && (s.isLive || s.outputsOn.length > 0)
}

/** Put back what was on the screens: the sources, the program, each output and its scene, the event. */
export async function putBack(s: LiveSnapshot): Promise<void> {
  const b = useBroadcastStore.getState()
  useBroadcastStore.setState({ sources: s.sources })
  for (const [outputId, sceneId] of Object.entries(s.scenes)) {
    if (b.scenes.some((x) => x.id === sceneId) && b.outputs.some((o) => o.id === outputId)) b.takeScene(outputId, sceneId)
  }
  if (s.isLive && s.liveVerse) useBroadcastStore.getState().setLiveVerse(s.liveVerse, null, { goLive: true, itemId: s.liveItemId })
  for (const id of s.outputsOn) {
    const output = useBroadcastStore.getState().outputs.find((o) => o.id === id)
    if (output && !outputOnAir(output, useBroadcastStore.getState().outputStatus[id])) await enableOutput(output)
  }
  if (s.eventId && useEventClock.getState().currentId !== s.eventId) useEventClock.getState().start(s.eventId)
  useJournalStore.getState().add({ kind: "recovery", label: `Put back after Rhema closed unexpectedly at ${new Date(s.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` })
  useRecovery.setState({ offer: null })
}

let store: Store | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let last = ""

function save() {
  timer = null
  // Rehearsal is a sandbox, and an open offer still holds the crash's snapshot.
  if (!store || useBroadcastStore.getState().rehearsal || useRecovery.getState().offer) return
  const snap = takeSnapshot()
  const key = JSON.stringify({ ...snap, at: 0 })
  if (key === last) return
  last = key
  void store.set("snapshot", snap).then(() => store?.save()).catch(() => {})
}

const soon = () => { if (!timer) timer = setTimeout(save, 1000) }

/** Read the last snapshot (offer it after an unclean exit), then keep it up to date. */
export async function startLiveRecovery(): Promise<() => void> {
  try {
    store = await load("recovery.json", { autoSave: false, defaults: {} })
    const [unclean, snap] = await Promise.all([invoke<boolean>("last_exit_unclean"), store.get<LiveSnapshot>("snapshot")])
    if (unclean && worthOffering(snap)) useRecovery.setState({ offer: snap })
  } catch {
    // Not under Tauri, or the file is unreadable: nothing to offer.
  }
  const offs = [
    useBroadcastStore.subscribe((s, p) => {
      if (s.isLive !== p.isLive || s.liveVerse !== p.liveVerse || s.sources !== p.sources || s.outputStatus !== p.outputStatus || s.outputs !== p.outputs) soon()
    }),
    useEventClock.subscribe((s, p) => { if (s.currentId !== p.currentId) soon() }),
    useRecovery.subscribe((s, p) => { if (p.offer && !s.offer) soon() }),
  ]
  return () => offs.forEach((off) => off())
}
