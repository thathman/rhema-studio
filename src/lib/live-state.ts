import { invoke } from "@tauri-apps/api/core"
import { eventStarts, eventTimes } from "@/lib/journal"
import { CONTENT_TYPES } from "@/types/broadcast"
import { serviceTiming } from "@/lib/timing-engine"
import { tickerForScreens, timerForScreens, useBroadcastStore } from "@/stores/broadcast-store"
import { cameraSourceId, tickerWords, timerWords } from "@/lib/live-sources"
import { cameraSending, useRouterHealth } from "@/lib/cameras"
import { useEventClock } from "@/stores/event-clock-store"
import { useJournalStore } from "@/stores/journal-store"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useNotices, type Notice } from "@/stores/notices-store"
import { useServiceOffset } from "@/stores/service-offset-store"
import { useHold } from "@/stores/hold-store"
import { useVoice, type VoicePerson } from "@/lib/voice"
import { monotonicNow, useTimerStore } from "@/stores/timer-store"
import { elapsedMs } from "@/lib/timer"

/**
 * The host's Live State for joined computers (Host/Join, ARCH-004; ADR 0001): what is on the
 * screens, each live source, the event clock, the run of show and its timing. One shape, version 1;
 * the host's LAN server hands it on to paired devices only. No secrets, no pictures.
 */
export interface LiveStateV1 {
  v: 1
  at: number
  church: string
  /** The service open on the host (#246 C16): a desk tags each command with its id, so the host refuses one meant for another service. id and revision are absent from older hosts. */
  service: { id?: string; title: string; revision?: number } | null
  program: { onAir: boolean; reference: string | null; rehearsal: boolean }
  /**
   * Each live source; `activatedAt` and `by` (who activated it) are absent from older hosts. After the
   * content sources: "ticker", "timer" and each "camera:<name>" (reference: the ticker's first words,
   * the timer's state, the camera's name), with `state`: running / paused / off, or sending /
   * not-sending / router-off / hidden (a camera hidden from scenes; absent before the router answers).
   */
  sources: { id: string; reference: string; on: boolean; revision: number; activatedAt?: number; by?: string; state?: string }[]
  event: { mode: "screens" | "own"; currentId: string | null }
  rundown: { id: string; reference: string; plannedMinutes: number | null }[]
  /** offsetMinutes: the shared running-late offset and who set it (#196). */
  timing: { plannedEnd: number; expectedEnd: number; lateMs: number; offsetMinutes?: number; offsetBy?: string | null } | null
  stageMessage: string
  /** The service timer (#196 R5) when this was sent: a desk counts on from when it arrived. */
  timer?: { durationMs: number; elapsedMs: number; running: boolean }
  /** Congregation scenes and outputs, for a screens operator. */
  scenes: { id: string; name: string }[]
  outputs: { id: string; name: string; sceneId: string | null }[]
  /**
   * Production notices (Rhema Comms), newest first. The host's server passes each paired desk only
   * those for it (everyone, its role, its name, or sent by it); the main desk has them all.
   */
  notices: Notice[]
  /** The paired desks' names, so a notice can go to one person (Comms). Absent from older hosts. */
  crew?: string[]
  /** The talk channel (Rhema Comms voice): who is in it, holding Talk, audible now. */
  voice?: VoicePerson[]
  /** Desks the main desk has taken back control from (#243), by name: each shows "Paused by the main desk". Absent from older hosts. */
  paused?: string[]
  /** A hold in the service (#196 R3): its reason, since when (host wall ms) and which desk held it. Null when not held; absent from older hosts. */
  hold?: { reason: string; since: number; by?: string } | null
  /** How often the host sends this at the least (ms), so a desk can tell a quiet host from a lost one. Absent from older hosts. */
  heartbeatMs?: number
}

/** The host sends its Live State at least this often, changed or not (on the app's one-second tick). */
export const LIVE_HEARTBEAT_MS = 2_000

export function buildLiveState(now = Date.now()): LiveStateV1 {
  const b = useBroadcastStore.getState()
  const q = useQueueStore.getState()
  const clock = useEventClock.getState()
  const entries = useJournalStore.getState().entries
  const timing = serviceTiming({ items: q.items, headers: q.headers, firstOnAir: eventStarts(entries), onAirMs: eventTimes(entries, Math.max(monotonicNow(), entries.at(-1)?.mono ?? 0)), liveItemId: clock.currentId, now, adjustMinutes: useServiceOffset.getState().minutes })
  const current = useServiceStore.getState().current
  return {
    v: 1,
    at: now,
    church: useSettingsStore.getState().brandKit.churchName.trim(),
    service: current ? { id: current.id, title: current.title, revision: current.revision } : null,
    program: { onAir: b.isLive, reference: b.isLive ? (b.liveVerse?.reference || null) : null, rehearsal: b.rehearsal },
    sources: [
      ...[...CONTENT_TYPES, "quick" as const].flatMap((id) => {
        const s = b.sources[id]
        return s ? [{ id, reference: s.value.reference, on: s.on, revision: s.revision, activatedAt: s.activatedAt, ...(s.by ? { by: s.by } : {}) }] : []
      }),
      ...stateSourceRows(),
    ],
    event: { mode: clock.mode, currentId: clock.currentId },
    rundown: q.items.map((i) => ({ id: i.id, reference: i.reference, plannedMinutes: i.planned_minutes ?? null })),
    timing: timing ? { plannedEnd: timing.plannedEnd, expectedEnd: timing.expectedEnd, lateMs: timing.lateMs, offsetMinutes: useServiceOffset.getState().minutes, offsetBy: useServiceOffset.getState().by } : null,
    stageMessage: b.stageMessage,
    timer: (() => { const t = useTimerStore.getState().timer; return { durationMs: t.durationMs, elapsedMs: Math.round(elapsedMs(t, monotonicNow())), running: t.startedAt !== null } })(),
    scenes: b.scenes.map((s) => ({ id: s.id, name: s.name })),
    outputs: b.outputs.filter((o) => (o.role ?? "congregation") === "congregation").map((o) => ({ id: o.id, name: o.name, sceneId: o.sceneId ?? null })),
    notices: useNotices.getState().notices.slice(0, 50),
    crew: useSettingsStore.getState().remoteDevices.map((d) => d.name),
    voice: voiceCrew(),
    paused: useSettingsStore.getState().remoteDevices.filter((d) => d.paused === true).map((d) => d.name),
    hold: (() => { const h = useHold.getState().hold; return h ? { reason: h.reason, since: h.since, ...(h.by ? { by: h.by } : {}) } : null })(),
    heartbeatMs: LIVE_HEARTBEAT_MS,
  }
}

let queued = false
let last = ""
let lastAt = 0

/** Publish now if it changed (the "at" stamp aside), or anyway (`force`: the heartbeat). */
export function publishLiveState(force = false): void {
  const state = buildLiveState()
  const key = JSON.stringify({ ...state, at: 0 })
  if (key === last && !force) return
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

/**
 * On the app's one-second tick (src/lib/app-tick.ts): timing moves on even when nothing else does,
 * and a desk hears from the host every couple of seconds, so it can tell when it stops (#196 R5).
 */
export function refreshLiveState(now = Date.now()): void {
  if (now - lastAt >= LIVE_HEARTBEAT_MS) publishLiveState(true)
}

/** Keep the host's Live State current: on any change that it shows (and every 15 s via the app tick). */
export function startLiveStatePublisher(): () => void {
  const subs = [
    useBroadcastStore.subscribe((s, p) => {
      if (s.isLive !== p.isLive || s.liveVerse !== p.liveVerse || s.sources !== p.sources || s.stateSources !== p.stateSources || s.rehearsal !== p.rehearsal || s.stageMessage !== p.stageMessage || s.scenes !== p.scenes || s.outputs !== p.outputs) soon()
    }),
    useEventClock.subscribe(soon),
    useQueueStore.subscribe((s, p) => { if (s.items !== p.items || s.headers !== p.headers) soon() }),
    useJournalStore.subscribe((s, p) => { if (s.entries !== p.entries) soon() }),
    useServiceStore.subscribe((s, p) => { if (s.current !== p.current) soon() }),
    useNotices.subscribe((s, p) => { if (s.notices !== p.notices) soon() }),
    useServiceOffset.subscribe(() => soon()),
    useHold.subscribe((s, p) => { if (s.hold !== p.hold) soon() }),
    useTimerStore.subscribe((s, p) => { if (s.timer !== p.timer) soon() }),
    useVoice.subscribe(() => soon()),
    useSettingsStore.subscribe((s, p) => { if (s.remoteDevices !== p.remoteDevices || s.cameras !== p.cameras) soon() }),
    useRouterHealth.subscribe(() => soon()),
  ]
  soon()
  return () => subs.forEach((u) => u())
}

/** The ticker, the service timer and each camera, as the real screens have them (never rehearsal's). */
function stateSourceRows(): LiveStateV1["sources"] {
  const b = useBroadcastStore.getState()
  const st = b.stateSources
  const rows: LiveStateV1["sources"] = []
  const meta = (x: { revision: number; activatedAt: number; by?: string }) => ({ revision: x.revision, activatedAt: x.activatedAt, ...(x.by ? { by: x.by } : {}) })
  if (st.ticker) {
    const t = st.ticker.on ? tickerForScreens(b) : st.ticker.ticker
    rows.push({ id: "ticker", reference: tickerWords(t), on: st.ticker.on, ...meta(st.ticker), state: !st.ticker.on ? "off" : t?.pausedAt ? "paused" : "running" })
  }
  if (st.timer) {
    // Running: a desk counts on from the timer field; paused, the time it stopped at.
    const words = st.timer.on ? "Running" : `Paused · ${timerWords(timerForScreens(b), monotonicNow())}`
    rows.push({ id: "timer", reference: words, on: st.timer.on, ...meta(st.timer), state: st.timer.on ? "running" : "paused" })
  }
  const health = useRouterHealth.getState()
  for (const cam of useSettingsStore.getState().cameras) {
    const id = cameraSourceId(cam.name)
    const x = st[id]
    const sending = cameraSending(health, cam.name)
    const state = x?.on === false ? "hidden" : sending
    rows.push({ id, reference: cam.label, on: x?.on !== false, ...(x ? meta(x) : { revision: 0 }), ...(state ? { state } : {}) })
  }
  return rows
}

/** The talk channel as joined desks see it: the main desk first (when it talks), then each desk. */
function voiceCrew(): VoicePerson[] {
  const v = useVoice.getState()
  const operator = useSettingsStore.getState().operatorName.trim()
  const host = v.hostTalking || v.hostSpeaking ? [{ name: operator ? `${operator} (main desk)` : "Main desk", talk: v.hostTalkTo, talking: v.hostTalking, speaking: v.hostSpeaking }] : []
  return [...host, ...v.peers]
}
