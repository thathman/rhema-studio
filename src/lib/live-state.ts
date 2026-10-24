import { invoke } from "@tauri-apps/api/core"
import { eventStarts, eventTimes } from "@/lib/journal"
import { CONTENT_TYPES } from "@/types/broadcast"
import { serviceTiming, type EventState, type ServiceTiming } from "@/lib/timing-engine"
import { tickerForScreens, timerForScreens, useBroadcastStore } from "@/stores/broadcast-store"
import { cameraSourceId, lowerThirdWords, tickerWords, timerWords } from "@/lib/live-sources"
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
import { sharedChurchLook, type ChurchLook } from "@/lib/church-look"

/**
 * The host's Live State for joined computers (Host/Join, ARCH-004; ADR 0001): what is on the
 * screens, each live source, the event clock, the run of show and its timing. One shape, version 1;
 * the host's LAN server hands it on to paired devices only. No secrets; the one picture is the
 * church logo in `churchLook`, and only when it is small.
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
   * content sources: "ticker", "timer", "lowerThird", "stage" and each "camera:<name>" (reference: the
   * ticker's first words, the timer's state, the lower third's lines, the stage message, the camera's
   * name), with `state`: running / paused / off, up / down (lower third, stage message), or sending /
   * not-sending / router-off / hidden (a camera hidden from scenes; absent before the router answers).
   * "lowerThird" and "stage" are absent from older hosts.
   */
  sources: { id: string; reference: string; on: boolean; revision: number; activatedAt?: number; by?: string; state?: string }[]
  event: { mode: "screens" | "own"; currentId: string | null }
  /** Each item; `time` for those in the main service once it has a start time (#196 R4; absent from older hosts). */
  rundown: { id: string; reference: string; plannedMinutes: number | null; time?: RundownTime }[]
  /** offsetMinutes: the shared running-late offset and who set it (#196). */
  timing: { plannedEnd: number; expectedEnd: number; lateMs: number; offsetMinutes?: number; offsetBy?: string | null } | null
  stageMessage: string
  /** The service timer (#196 R5) when this was sent: a desk counts on from when it arrived. `revision`: one more for each start, pause or correction (#196 R7; absent from older hosts). */
  timer?: { durationMs: number; elapsedMs: number; running: boolean; revision?: number }
  /**
   * Congregation scenes and outputs, for a screens operator. An output's `sceneRevision` and `sceneBy`:
   * its last scene Take or release on the host, and who did it (#243 EX.1; absent from older hosts
   * and before the first Take).
   */
  scenes: { id: string; name: string }[]
  outputs: { id: string; name: string; sceneId: string | null; sceneRevision?: number; sceneBy?: string }[]
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
  /**
   * The church look (#298 E4): the host's Brand Kit and the themes made from it, with a revision. A
   * joined desk offers it ("The host's church look changed") and uses it only when its operator
   * says so. Absent from older hosts.
   */
  churchLook?: ChurchLook
  /**
   * Added by the host's server, not the app (#196 R7): a revision for each part of the service a
   * desk can change ("event", "offset", "timer", "hold", "source:<id>", "output:<id>"). A desk sends
   * them back with each command, and the host refuses one for a part someone changed since.
   * Absent from older hosts.
   */
  revisions?: Record<string, number>
}

/**
 * An item's times in the run of show (#196 R4), host wall ms, for a desk's read-only cuesheet:
 * planned and expected start and end, when it went on air (and for how long, once done), its
 * state, its "end by" and whether that cuts it short; a fixed start (plan[0] is then that time) and
 * whether it is expected late for it; the pause before it and how much of it lateness takes up.
 * Older desks ignore the newer fields.
 */
export interface RundownTime {
  plan: [number, number]
  expected: [number, number]
  actual?: number
  ranMs?: number
  state: EventState
  endBy?: number
  cut?: true
  fixed?: true
  conflict?: true
  /** The planned pause before it and how much of it lateness is expected to take up (ms), when it has one. */
  pause?: [number, number]
}

/** The run of show's times by item id, as the Live State carries them. */
export function rundownTimes(timing: ServiceTiming | null, onAirMs: Map<string, number>): Map<string, RundownTime> {
  const out = new Map<string, RundownTime>()
  for (const e of timing?.events ?? []) {
    out.set(e.id, {
      plan: [e.plannedStart, e.plannedEnd],
      expected: [e.expectedStart, e.expectedEnd],
      ...(e.actualStart !== null ? { actual: e.actualStart } : {}),
      ...(e.state === "done" ? { ranMs: Math.round(onAirMs.get(e.id) ?? 0) } : {}),
      state: e.state,
      ...(e.hardStop !== null ? { endBy: e.hardStop } : {}),
      ...(e.squeezed ? { cut: true as const } : {}),
      ...(e.fixedStart !== null ? { fixed: true as const } : {}),
      ...(e.conflict ? { conflict: true as const } : {}),
      ...(e.gapMs > 0 ? { pause: [e.gapMs, e.absorbedMs] as [number, number] } : {}),
    })
  }
  return out
}

/** The host sends its Live State at least this often, changed or not (on the app's one-second tick). */
export const LIVE_HEARTBEAT_MS = 2_000

export function buildLiveState(now = Date.now()): LiveStateV1 {
  const b = useBroadcastStore.getState()
  const q = useQueueStore.getState()
  const clock = useEventClock.getState()
  const entries = useJournalStore.getState().entries
  const onAirMs = eventTimes(entries, Math.max(monotonicNow(), entries.at(-1)?.mono ?? 0))
  const timing = serviceTiming({ items: q.items, headers: q.headers, firstOnAir: eventStarts(entries), onAirMs, liveItemId: clock.currentId, now, adjustMinutes: useServiceOffset.getState().minutes })
  const times = rundownTimes(timing, onAirMs)
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
    rundown: q.items.map((i) => { const time = times.get(i.id); return { id: i.id, reference: i.reference, plannedMinutes: i.planned_minutes ?? null, ...(time ? { time } : {}) } }),
    timing: timing ? { plannedEnd: timing.plannedEnd, expectedEnd: timing.expectedEnd, lateMs: timing.lateMs, offsetMinutes: useServiceOffset.getState().minutes, offsetBy: useServiceOffset.getState().by } : null,
    stageMessage: b.stageMessage,
    timer: (() => { const t = useTimerStore.getState().timer; return { durationMs: t.durationMs, elapsedMs: Math.round(elapsedMs(t, monotonicNow())), running: t.startedAt !== null, revision: timerRevision } })(),
    scenes: b.scenes.map((s) => ({ id: s.id, name: s.name })),
    outputs: b.outputs.filter((o) => (o.role ?? "congregation") === "congregation").map((o) => {
      const take = b.sceneTakes[o.id]
      return { id: o.id, name: o.name, sceneId: o.sceneId ?? null, ...(take ? { sceneRevision: take.revision, ...(take.by ? { sceneBy: take.by } : {}) } : {}) }
    }),
    notices: useNotices.getState().notices.slice(0, 50),
    crew: useSettingsStore.getState().remoteDevices.map((d) => d.name),
    voice: voiceCrew(),
    paused: useSettingsStore.getState().remoteDevices.filter((d) => d.paused === true).map((d) => d.name),
    hold: (() => { const h = useHold.getState().hold; return h ? { reason: h.reason, since: h.since, ...(h.by ? { by: h.by } : {}) } : null })(),
    heartbeatMs: LIVE_HEARTBEAT_MS,
    churchLook: sharedChurchLook(useSettingsStore.getState().brandKit, b.themes),
  }
}

// Each start, pause or correction of the service timer, counted: a running timer's time moves on by
// itself, so this is how the host's server tells that someone changed it (#196 R7).
let timerRevision = 0
useTimerStore.subscribe((s, p) => { if (s.timer !== p.timer) timerRevision++ })

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
      if (s.isLive !== p.isLive || s.liveVerse !== p.liveVerse || s.sources !== p.sources || s.stateSources !== p.stateSources || s.rehearsal !== p.rehearsal || s.stageMessage !== p.stageMessage || s.scenes !== p.scenes || s.outputs !== p.outputs || s.themes !== p.themes) soon()
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
    useSettingsStore.subscribe((s, p) => { if (s.remoteDevices !== p.remoteDevices || s.cameras !== p.cameras || s.brandKit !== p.brandKit) soon() }),
    useRouterHealth.subscribe(() => soon()),
  ]
  soon()
  return () => subs.forEach((u) => u())
}

/** The ticker, the service timer, the lower third, the stage message and each camera, as the real screens have them (never rehearsal's). */
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
  if (st.lowerThird) rows.push({ id: "lowerThird", reference: lowerThirdWords(st.lowerThird.lowerThird), on: st.lowerThird.on, ...meta(st.lowerThird), state: st.lowerThird.on ? "up" : "down" })
  if (st.stage) rows.push({ id: "stage", reference: st.stage.message ?? "", on: st.stage.on, ...meta(st.stage), state: st.stage.on ? "up" : "down" })
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

/**
 * The talk channel as joined desks see it: the main desk first (when it talks), then each desk, by
 * name only (the key ids the main desk routes by stay on it).
 */
function voiceCrew(): VoicePerson[] {
  const v = useVoice.getState()
  const operator = useSettingsStore.getState().operatorName.trim()
  const host = v.hostTalking || v.hostSpeaking ? [{ name: operator ? `${operator} (main desk)` : "Main desk", talk: v.hostTalkTo, talking: v.hostTalking, speaking: v.hostSpeaking }] : []
  return [...host, ...v.peers.map((p) => ({ name: p.name, talk: p.talk, talking: p.talking, speaking: p.speaking }))]
}
