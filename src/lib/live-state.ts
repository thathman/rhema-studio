import { invoke } from "@tauri-apps/api/core"
import { eventStarts, eventTimes } from "@/lib/journal"
import { CONTENT_TYPES } from "@/types/broadcast"
import { serviceTiming } from "@/lib/timing-engine"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useEventClock } from "@/stores/event-clock-store"
import { useJournalStore } from "@/stores/journal-store"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useNotices, type Notice } from "@/stores/notices-store"
import { useVoice, type VoicePerson } from "@/lib/voice"
import { monotonicNow } from "@/stores/timer-store"

/**
 * The host's Live State for joined computers (Host/Join, ARCH-004; ADR 0001): what is on the
 * screens, each live source, the event clock, the run of show and its timing. One shape, version 1;
 * the host's LAN server hands it on to paired devices only. No secrets, no pictures.
 */
export interface LiveStateV1 {
  v: 1
  at: number
  church: string
  service: { title: string } | null
  program: { onAir: boolean; reference: string | null; rehearsal: boolean }
  sources: { id: string; reference: string; on: boolean; revision: number }[]
  event: { mode: "screens" | "own"; currentId: string | null }
  rundown: { id: string; reference: string; plannedMinutes: number | null }[]
  timing: { plannedEnd: number; expectedEnd: number; lateMs: number } | null
  stageMessage: string
  /** Congregation scenes and outputs, for a screens operator. */
  scenes: { id: string; name: string }[]
  outputs: { id: string; name: string; sceneId: string | null }[]
  /** Production notices (Rhema Comms), newest first; each desk shows those for it. */
  notices: Notice[]
  /** The talk channel (Rhema Comms voice): who is in it, holding Talk, audible now. */
  voice?: VoicePerson[]
}

export function buildLiveState(now = Date.now()): LiveStateV1 {
  const b = useBroadcastStore.getState()
  const q = useQueueStore.getState()
  const clock = useEventClock.getState()
  const entries = useJournalStore.getState().entries
  const timing = serviceTiming({ items: q.items, headers: q.headers, firstOnAir: eventStarts(entries), onAirMs: eventTimes(entries, Math.max(monotonicNow(), entries.at(-1)?.mono ?? 0)), liveItemId: clock.currentId, now })
  const current = useServiceStore.getState().current
  return {
    v: 1,
    at: now,
    church: useSettingsStore.getState().brandKit.churchName.trim(),
    service: current ? { title: current.title } : null,
    program: { onAir: b.isLive, reference: b.isLive ? (b.liveVerse?.reference || null) : null, rehearsal: b.rehearsal },
    sources: [...CONTENT_TYPES, "quick" as const].flatMap((id) => {
      const s = b.sources[id]
      return s ? [{ id, reference: s.value.reference, on: s.on, revision: s.revision }] : []
    }),
    event: { mode: clock.mode, currentId: clock.currentId },
    rundown: q.items.map((i) => ({ id: i.id, reference: i.reference, plannedMinutes: i.planned_minutes ?? null })),
    timing: timing ? { plannedEnd: timing.plannedEnd, expectedEnd: timing.expectedEnd, lateMs: timing.lateMs } : null,
    stageMessage: b.stageMessage,
    scenes: b.scenes.map((s) => ({ id: s.id, name: s.name })),
    outputs: b.outputs.filter((o) => (o.role ?? "congregation") === "congregation").map((o) => ({ id: o.id, name: o.name, sceneId: o.sceneId ?? null })),
    notices: useNotices.getState().notices.slice(0, 50),
    voice: voiceCrew(),
  }
}

let queued = false
let last = ""
let lastAt = 0

/** Publish now if it changed (the "at" stamp aside). */
export function publishLiveState(): void {
  const state = buildLiveState()
  const key = JSON.stringify({ ...state, at: 0 })
  if (key === last) return
  last = key
  lastAt = Date.now()
  void invoke("publish_live_state", { json: JSON.stringify(state) }).catch(() => {})
}

/**
 * Changes in one turn are published once, at the end of it: a microtask, not a timer, because the
 * main window is often hidden behind the outputs and WebKit holds its timers back there.
 */
function soon() {
  if (queued) return
  queued = true
  queueMicrotask(() => {
    queued = false
    publishLiveState()
  })
}

/** On the app's one-second tick (src/lib/app-tick.ts): timing moves on even when nothing else does. */
export function refreshLiveState(now = Date.now()): void {
  if (now - lastAt >= 15_000) publishLiveState()
}

/** Keep the host's Live State current: on any change that it shows (and every 15 s via the app tick). */
export function startLiveStatePublisher(): () => void {
  const subs = [
    useBroadcastStore.subscribe((s, p) => {
      if (s.isLive !== p.isLive || s.liveVerse !== p.liveVerse || s.sources !== p.sources || s.rehearsal !== p.rehearsal || s.stageMessage !== p.stageMessage || s.scenes !== p.scenes || s.outputs !== p.outputs) soon()
    }),
    useEventClock.subscribe(soon),
    useQueueStore.subscribe((s, p) => { if (s.items !== p.items || s.headers !== p.headers) soon() }),
    useJournalStore.subscribe((s, p) => { if (s.entries !== p.entries) soon() }),
    useServiceStore.subscribe((s, p) => { if (s.current !== p.current) soon() }),
    useNotices.subscribe((s, p) => { if (s.notices !== p.notices) soon() }),
    useVoice.subscribe(() => soon()),
  ]
  soon()
  return () => subs.forEach((u) => u())
}

/** The talk channel as joined desks see it: the main desk first (when it talks), then each desk. */
function voiceCrew(): VoicePerson[] {
  const v = useVoice.getState()
  const operator = useSettingsStore.getState().operatorName.trim()
  const host = v.hostTalking || v.hostSpeaking ? [{ name: operator ? `${operator} (main desk)` : "Main desk", talk: v.hostTalkTo, talking: v.hostTalking, speaking: v.hostSpeaking }] : []
  return [...host, ...v.peers]
}
