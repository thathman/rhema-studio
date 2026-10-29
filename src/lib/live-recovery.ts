import { invoke } from "@tauri-apps/api/core"
import { load, type Store } from "@tauri-apps/plugin-store"
import { create } from "zustand"
import { enableOutput } from "@/lib/broadcast-output-control"
import { captureSceneAppearance, normalizeScene, sceneForOutput } from "@/lib/scenes"
import { normalizeTheme } from "@/lib/theme-migrations"
import { sourceOf, type LiveSources } from "@/lib/live-sources"
import { outputOnAir } from "@/lib/output-on-air"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useEventClock } from "@/stores/event-clock-store"
import { capJournal, finalizeServiceRun, interruptCurrentServiceRun, useJournalStore, type ServiceRunContext } from "@/stores/journal-store"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"
import { monotonicNow, useTimerStore } from "@/stores/timer-store"
import { elapsedMs } from "@/lib/timer"
import type { JournalEntry } from "@/lib/journal"
import { useNotices, type Notice } from "@/stores/notices-store"
import { useTimingTrust, whilePuttingBack } from "@/stores/timing-trust-store"
import type { BroadcastOutput, BroadcastTheme, Scene, SceneAppearanceSnapshot, VerseRenderData } from "@/types"

type RecoveryThemeSelection = Pick<BroadcastOutput, "themeId" | "themeFor">

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
  /** Immutable scene and look state captured with new v1 snapshots. Missing means a legacy v1 file. */
  sceneSnapshots?: Record<string, { scene: Scene; appearance: SceneAppearanceSnapshot } & RecoveryThemeSelection>
  eventId: string | null
  /** The content moment in that event; older snapshots omit it. */
  eventMomentId?: string | null
  /** The service timer when the snapshot was taken (#196): its length, how far it had run, running or not. */
  timer?: { durationMs: number; elapsedMs: number; running: boolean }
  /** Too big to keep whole: the program and sources were left out (pictures as data). */
  trimmed?: boolean
}

const SOURCE_IDS = ["bible", "song", "hymn", "slide", "picture", "quick"] as const
const CONTENT_TYPES = ["bible", "song", "hymn", "slide", "picture"] as const
const RENDER_KINDS = ["verse", "lyric", "slide", "image"] as const
const IMAGE_FITS = ["cover", "contain", "stretch"] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function stableJSON(value: unknown): string {
  const ordered = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(ordered)
    if (!isRecord(current)) return current
    return Object.fromEntries(Object.keys(current).sort().filter((key) => current[key] !== undefined).map((key) => [key, ordered(current[key])]))
  }
  return JSON.stringify(ordered(value)) ?? "undefined"
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function sameSnapshotValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isOneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === "string" && choices.includes(value as T)
}

function parseVerseRenderData(value: unknown): VerseRenderData | null {
  if (!isRecord(value) || typeof value.reference !== "string" || !Array.isArray(value.segments)) return null
  const segments: VerseRenderData["segments"] = []
  for (const segment of value.segments) {
    if (!isRecord(segment) || typeof segment.text !== "string") return null
    if (segment.verseNumber !== undefined && !isFiniteNumber(segment.verseNumber)) return null
    segments.push({ text: segment.text, ...(segment.verseNumber === undefined ? {} : { verseNumber: segment.verseNumber }) })
  }

  const result: VerseRenderData = { reference: value.reference, segments }
  if (value.kind !== undefined) {
    if (!isOneOf(value.kind, RENDER_KINDS)) return null
    result.kind = value.kind
  }
  if (value.content !== undefined) {
    if (!isOneOf(value.content, CONTENT_TYPES)) return null
    result.content = value.content
  }
  for (const key of ["translationLines", "lines", "secondaryLines"] as const) {
    const lines = value[key]
    if (lines !== undefined) {
      if (!Array.isArray(lines) || !lines.every((line) => typeof line === "string")) return null
      result[key] = [...lines]
    }
  }
  if (value.footer !== undefined) {
    if (typeof value.footer !== "string") return null
    result.footer = value.footer
  }
  if (value.image !== undefined) {
    const image = value.image
    if (!isRecord(image) || typeof image.url !== "string" || !isOneOf(image.fit, IMAGE_FITS) || !isFiniteNumber(image.blur) || !isFiniteNumber(image.brightness) || (image.tint !== null && typeof image.tint !== "string")) return null
    result.image = { url: image.url, fit: image.fit, blur: image.blur, brightness: image.brightness, tint: image.tint }
  }
  if (value.screen !== undefined) {
    if (value.screen !== "black" && value.screen !== "logo") return null
    result.screen = value.screen
  }
  if (value.quick !== undefined) {
    if (typeof value.quick !== "boolean") return null
    result.quick = value.quick
  }
  if (value.quickScreen !== undefined) {
    if (typeof value.quickScreen !== "string") return null
    result.quickScreen = value.quickScreen
  }
  if (value.video !== undefined) {
    const video = value.video
    if (!isRecord(video) || typeof video.url !== "string" || !isOneOf(video.fit, IMAGE_FITS) || typeof video.loop !== "boolean" || typeof video.sound !== "boolean" || typeof video.name !== "string" || !isFiniteNumber(video.token) || (video.paused !== undefined && typeof video.paused !== "boolean")) return null
    result.video = { url: video.url, fit: video.fit, loop: video.loop, sound: video.sound, name: video.name, token: video.token, ...(video.paused === undefined ? {} : { paused: video.paused }) }
  }
  return result
}

function parseScene(value: unknown, expectedId: string): Scene | null {
  if (!isRecord(value) || value.id !== expectedId || typeof value.name !== "string" || typeof value.background !== "string" || !Array.isArray(value.layers) || !isFiniteNumber(value.createdAt) || !isFiniteNumber(value.updatedAt)) return null
  const scene = normalizeScene(value)
  // normalizeScene deliberately repairs ordinary imports. A recovery snapshot must not silently
  // clamp geometry/opacity or sanitize fields into a different approved/on-air design.
  if (!scene || scene.id !== expectedId || scene.layers.length !== value.layers.length || stableJSON(scene) !== stableJSON(value)) return null
  return scene
}

function parseSceneAppearance(value: unknown, allowLegacyMissingMode = false): SceneAppearanceSnapshot | null {
  if (!isRecord(value) || !isRecord(value.themes) || Object.keys(value.themes).length === 0 || (value.logoUrl !== null && typeof value.logoUrl !== "string")) return null
  const themes: Record<string, BroadcastTheme> = {}
  for (const [id, rawTheme] of Object.entries(value.themes)) {
    if (!isRecord(rawTheme) || rawTheme.id !== id || typeof rawTheme.name !== "string" || !isRecord(rawTheme.background) || typeof rawTheme.background.color !== "string" || !isRecord(rawTheme.resolution) || !isFiniteNumber(rawTheme.resolution.width) || !isFiniteNumber(rawTheme.resolution.height) || !isRecord(rawTheme.layout) || !isRecord(rawTheme.verseText) || !isRecord(rawTheme.reference)) return null
    const mode = rawTheme.layout.mode
    let layout = rawTheme.layout
    let themeValue = rawTheme
    if (mode !== "stacked" && mode !== "free") {
      if (!allowLegacyMissingMode || mode !== undefined) return null
      layout = { ...rawTheme.layout, mode: "stacked" }
      themeValue = { ...rawTheme, layout }
    }
    if (layout.mode === "free") {
      for (const key of ["referenceBox", "verseBox"] as const) {
        const box = layout[key]
        if (!isRecord(box) || ![box.x, box.y, box.width, box.height].every(isFiniteNumber)) return null
        const { x, y, width, height } = box as Record<"x" | "y" | "width" | "height", number>
        // The designer contract stores each free-layout value as a percentage in 0..100.
        if (x < 0 || x > 100 || y < 0 || y > 100 || width <= 0 || width > 100 || height <= 0 || height > 100) return null
      }
    }
    const theme = normalizeTheme(themeValue as unknown as BroadcastTheme)
    // New recovery snapshots must preserve the exact captured styling. The legacy output-record
    // fallback remains tolerant because older persisted appearances may need their known defaults.
    if (!allowLegacyMissingMode && stableJSON(theme) !== stableJSON(themeValue)) return null
    themes[id] = theme
  }
  let approved: SceneAppearanceSnapshot["approved"]
  if (value.approved !== undefined) {
    const raw = value.approved
    if (!isRecord(raw) || typeof raw.programId !== "string" || !Number.isSafeInteger(raw.revision) || (raw.revision as number) < 0 || (raw.appearanceComplete !== undefined && typeof raw.appearanceComplete !== "boolean") || (raw.approvedAt !== undefined && raw.approvedAt !== null && typeof raw.approvedAt !== "string") || (raw.approvedBy !== undefined && raw.approvedBy !== null && typeof raw.approvedBy !== "string")) return null
    approved = { programId: raw.programId, revision: raw.revision as number, ...(raw.appearanceComplete === undefined ? {} : { appearanceComplete: raw.appearanceComplete }), ...(raw.approvedAt === undefined ? {} : { approvedAt: raw.approvedAt }), ...(raw.approvedBy === undefined ? {} : { approvedBy: raw.approvedBy }) }
  }
  return { themes, logoUrl: value.logoUrl, ...(approved === undefined ? {} : { approved }) }
}

function parseThemeSelection(value: unknown): RecoveryThemeSelection | null {
  if (!isRecord(value) || typeof value.themeId !== "string" || !value.themeId.trim()) return null
  let themeFor: RecoveryThemeSelection["themeFor"]
  if (value.themeFor !== undefined) {
    if (!isRecord(value.themeFor)) return null
    themeFor = {}
    for (const [content, themeId] of Object.entries(value.themeFor)) {
      if (!isOneOf(content, CONTENT_TYPES) || typeof themeId !== "string" || !themeId.trim()) return null
      themeFor[content] = themeId
    }
  }
  return { themeId: value.themeId, ...(themeFor === undefined ? {} : { themeFor }) }
}

function appearanceHasSceneThemes(scene: Scene, appearance: SceneAppearanceSnapshot, selection: RecoveryThemeSelection): boolean {
  const required = new Set<string>([selection.themeId, ...Object.values(selection.themeFor ?? {})])
  for (const layer of scene.layers) {
    if (layer.themeId !== undefined) {
      if (typeof layer.themeId !== "string" || !layer.themeId.trim()) return false
      required.add(layer.themeId)
    }
  }
  return [...required].every((id) => Object.hasOwn(appearance.themes, id))
}

/** Built-in themes from older app versions omitted the now-explicit stacked/free mode. */
function canonicalCapturedAppearance(value: SceneAppearanceSnapshot): SceneAppearanceSnapshot | null {
  if (!isRecord(value.themes)) return null
  const themes: Record<string, unknown> = {}
  for (const [id, rawTheme] of Object.entries(value.themes)) {
    if (!isRecord(rawTheme) || !isRecord(rawTheme.layout)) return null
    const mode = rawTheme.layout.mode
    if (mode === undefined) themes[id] = { ...rawTheme, layout: { ...rawTheme.layout, mode: "stacked" } }
    else themes[id] = rawTheme
  }
  return parseSceneAppearance({ ...value, themes })
}

function parseSceneSnapshot(value: unknown, expectedId: string): { scene: Scene; appearance: SceneAppearanceSnapshot } & RecoveryThemeSelection | null {
  if (!isRecord(value)) return null
  const scene = parseScene(value.scene, expectedId)
  if (!scene) return null
  const appearance = parseSceneAppearance(value.appearance)
  const themeSelection = parseThemeSelection(value)
  if (!appearance || !themeSelection || !appearanceHasSceneThemes(scene, appearance, themeSelection)) return null
  return { scene, appearance, ...themeSelection }
}

/** Validate and copy data read from recovery.json before any field reaches the live stores. */
export function parseLiveSnapshot(value: unknown): LiveSnapshot | null {
  if (!isRecord(value) || value.v !== 1 || !isFiniteNumber(value.at) || typeof value.isLive !== "boolean") return null
  let service: LiveSnapshot["service"] = null
  if (value.service !== null) {
    if (!isRecord(value.service) || typeof value.service.id !== "string" || typeof value.service.title !== "string") return null
    service = { id: value.service.id, title: value.service.title }
  }
  let liveVerse: VerseRenderData | null = null
  if (value.liveVerse !== null) {
    const parsed = parseVerseRenderData(value.liveVerse)
    if (!parsed) return null
    liveVerse = parsed
  }
  if (value.liveItemId !== null && typeof value.liveItemId !== "string") return null
  if (!isRecord(value.sources)) return null
  const sources: LiveSources = {}
  for (const [id, source] of Object.entries(value.sources)) {
    if (!isOneOf(id, SOURCE_IDS) || !isRecord(source)) return null
    const parsedValue = parseVerseRenderData(source.value)
    if (!parsedValue || (source.itemId !== null && typeof source.itemId !== "string") || !isFiniteNumber(source.revision) || !isFiniteNumber(source.activatedAt) || typeof source.on !== "boolean" || (source.by !== undefined && typeof source.by !== "string")) return null
    sources[id] = { value: parsedValue, itemId: source.itemId, revision: source.revision, activatedAt: source.activatedAt, on: source.on, ...(source.by === undefined ? {} : { by: source.by }) }
  }
  if (!Array.isArray(value.outputsOn) || !value.outputsOn.every((id) => typeof id === "string" && id.length > 0) || new Set(value.outputsOn).size !== value.outputsOn.length) return null
  if (!isRecord(value.scenes)) return null
  const sceneEntries: [string, string][] = []
  for (const [outputId, sceneId] of Object.entries(value.scenes)) {
    if (typeof sceneId !== "string" || sceneId.length === 0) return null
    sceneEntries.push([outputId, sceneId])
  }
  let sceneSnapshots: LiveSnapshot["sceneSnapshots"]
  if (value.sceneSnapshots !== undefined) {
    if (!isRecord(value.sceneSnapshots)) return null
    sceneSnapshots = {}
    for (const [outputId, rawSnapshot] of Object.entries(value.sceneSnapshots)) {
      const sceneId = (value.scenes as Record<string, unknown>)[outputId]
      if (typeof sceneId !== "string") return null
      const snapshot = parseSceneSnapshot(rawSnapshot, sceneId)
      if (!snapshot) return null
      sceneSnapshots[outputId] = snapshot
    }
  }
  if (value.eventId !== null && typeof value.eventId !== "string") return null
  if (value.eventMomentId !== undefined && value.eventMomentId !== null && typeof value.eventMomentId !== "string") return null
  let timer: LiveSnapshot["timer"]
  if (value.timer !== undefined) {
    const savedTimer = value.timer
    if (!isRecord(savedTimer) || !isFiniteNumber(savedTimer.durationMs) || savedTimer.durationMs < 0 || !isFiniteNumber(savedTimer.elapsedMs) || savedTimer.elapsedMs < 0 || typeof savedTimer.running !== "boolean") return null
    timer = { durationMs: savedTimer.durationMs, elapsedMs: savedTimer.elapsedMs, running: savedTimer.running }
  }
  if (value.trimmed !== undefined && typeof value.trimmed !== "boolean") return null
  // A live snapshot without its program is valid only when takeSnapshot explicitly marked it
  // as trimmed. Treat an otherwise incomplete payload as damaged rather than a successful restore.
  if (value.isLive && liveVerse === null && value.trimmed !== true) return null
  if (sceneSnapshots !== undefined && value.trimmed !== true && Object.keys(value.scenes).some((outputId) => !Object.hasOwn(sceneSnapshots, outputId))) return null

  return {
    v: 1,
    at: value.at,
    service,
    isLive: value.isLive,
    liveVerse,
    liveItemId: value.liveItemId,
    sources,
    outputsOn: [...value.outputsOn],
    scenes: Object.fromEntries(sceneEntries),
    ...(sceneSnapshots === undefined ? {} : { sceneSnapshots }),
    eventId: value.eventId,
    // Older v1 snapshots did not keep the selected moment separately.
    eventMomentId: value.eventMomentId ?? null,
    ...(timer === undefined ? {} : { timer }),
    ...(value.trimmed === undefined ? {} : { trimmed: value.trimmed }),
  }
}

/** Offered for this long after the crash; older is another service. */
const FRESH_MS = 6 * 60 * 60 * 1000
/** Pictures and videos as data can be megabytes: past this the snapshot keeps names, not content. */
const MAX_CHARS = 400_000

/**
 * The offer after a crash. "Not now" only hides the banner (`dismissed`): the Desk menu keeps a way
 * to put the screens back for the rest of this run, and saving starts again so a second crash is
 * covered by what is on the screens now.
 */
export const useRecovery = create<{ offer: LiveSnapshot | null; dismissed: boolean; damaged: boolean; restoreError: string | null }>(() => ({ offer: null, dismissed: false, damaged: false, restoreError: null }))

/** "Not now" on the banner: hide it, keep the offer for the Desk menu. */
export function dismissRecovery(): void {
  useRecovery.setState({ dismissed: true })
}

/** Explicitly continue with the state that could be recovered after a partial attempt. */
export function acceptPartialRecovery(): void {
  const { offer, restoreError } = useRecovery.getState()
  if (!offer || !restoreError) return
  useJournalStore.getState().add({ kind: "recovery", label: `Continued after incomplete recovery: ${restoreError}` })
  useRecovery.setState({ offer: null, dismissed: false, damaged: false, restoreError: null })
}

/** Dismiss the notice that a saved snapshot could not be trusted or restored. */
export function dismissRecoveryDamage(): void {
  useRecovery.setState({ damaged: false })
}

/** The service log as kept for recovery (#196 R3): what happened, and when, survives a crash. */
export interface KeptJournal {
  v: 1 | 2
  at: number
  entries: JournalEntry[]
  startItemIds: string[] | null
  /** Version 2 captures service ownership and the time of its durable checkpoint. */
  runContext?: ServiceRunContext
  runStatus?: "none" | "active" | "interrupted" | "finished"
  finalizedLogId?: string | null
  checkpointMono?: number
}

/**
 * The service log from the run that closed unexpectedly, back in this run: history only, nothing
 * goes on a screen. Its monotonic times are moved onto this run's clock all by the same amount.
 * Version 2 stops the last active duration at the saved checkpoint, so time spent offline is unknown.
 * Anything this run logged already (a scene put back at start-up) stays, after them. Only once,
 * and only if recent.
 */
export function restoreJournal(kept: KeptJournal | null | undefined, now = Date.now(), nowMono = monotonicNow(), unclean = true): boolean {
  const j = useJournalStore.getState()
  const durableRun = kept?.v === 2 && !!kept.runContext
  if (!kept || (kept.v !== 1 && kept.v !== 2) || !kept.entries?.length || (!durableRun && now - kept.at >= FRESH_MS) || now < kept.at || j.entries.some((e) => e.kind === "recovery")) return false
  const base = now - nowMono
  const last = kept.entries.at(-1)!
  const shift = kept.v === 2 && typeof kept.checkpointMono === "number"
    ? nowMono - kept.checkpointMono
    : typeof last.mono === "number" ? last.at - base - last.mono : null
  const entries = kept.entries.map((e) => ({ ...e, mono: shift !== null && typeof e.mono === "number" ? e.mono + shift : e.at - base }))
  const boundary: JournalEntry = {
    kind: "recovery",
    label: unclean
      ? `Last confirmed service activity before Rhema Studio closed unexpectedly at ${new Date(kept.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}; time after this point is unknown`
      : `Last confirmed service activity at ${new Date(kept.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}; the run ended without Finish, and later time is unknown`,
    at: kept.at,
    mono: kept.v === 2 && typeof kept.checkpointMono === "number" ? nowMono : entries.at(-1)?.mono ?? nowMono,
  }
  const currentBase = j.entries[0]?.mono
  const currentShift = currentBase === undefined ? 0 : Math.max(0, boundary.mono - currentBase)
  const currentEntries = currentShift ? j.entries.map((entry) => ({ ...entry, mono: entry.mono + currentShift })) : j.entries
  useJournalStore.setState({ entries: capJournal([...entries, boundary, ...currentEntries]), startItemIds: j.startItemIds?.length ? j.startItemIds : kept.startItemIds, added: j.added + entries.length + 1, ...(kept.v === 2 && kept.runContext ? { runContext: kept.runContext, runStatus: kept.runStatus === "finished" ? "finished" as const : "interrupted" as const, finalizedLogId: kept.finalizedLogId ?? null } : {}) })
  j.add({ kind: "recovery", label: "Service journal restored for review; nothing was put on a screen" })
  // The item that was running then (#196 R3.8): its start is known, how long it has run is not,
  // until the operator confirms the time or takes it again. A finished service had none running.
  const lastEvent = [...kept.entries].reverse().find((e) => e.kind === "event")
  const eventId = lastEvent?.eventId ?? lastEvent?.itemId
  if (lastEvent && eventId) useTimingTrust.setState({ untrusted: { itemId: lastEvent.itemId ?? eventId, eventId, label: lastEvent.label, lastSeen: kept.at, restartedAt: now } })
  return true
}

/** Production notices as kept for recovery (Rhema Comms, #251): the last 100 and which were read. */
export interface KeptNotices {
  v: 1
  at: number
  notices: Notice[]
  read: string[]
}

let noticesBack = false
/**
 * The notices from the run that closed unexpectedly, back on the main desk (and so on each joined
 * desk again), with their answers: as the service log, only after an unclean exit, only if recent,
 * and only once. Any sent since stay first; none is sent again or shown anywhere new.
 */
export function restoreNotices(kept: KeptNotices | null | undefined, now = Date.now()): boolean {
  if (!kept || kept.v !== 1 || !Array.isArray(kept.notices) || !kept.notices.length || now - kept.at >= FRESH_MS || now < kept.at || noticesBack) return false
  noticesBack = true
  useNotices.getState().restore(kept.notices, Array.isArray(kept.read) ? kept.read : [])
  return true
}

export function takeSnapshot(now = Date.now()): LiveSnapshot {
  const b = useBroadcastStore.getState()
  const current = useServiceStore.getState().current
  const sceneOutputs = b.outputs.filter((o) => o.sceneId && (o.role ?? "congregation") === "congregation")
  const snap: LiveSnapshot = {
    v: 1,
    at: now,
    service: current ? { id: current.id, title: current.title } : null,
    isLive: b.isLive,
    liveVerse: b.isLive ? b.liveVerse : null,
    liveItemId: b.liveItemId,
    sources: b.sources,
    outputsOn: b.outputs.filter((o) => outputOnAir(o, b.outputStatus[o.id])).map((o) => o.id),
    scenes: Object.fromEntries(sceneOutputs.map((o) => [o.id, o.sceneId!])),
    sceneSnapshots: Object.fromEntries(sceneOutputs.flatMap((o) => {
      const scene = sceneForOutput(o, b.scenes)
      if (!scene) return []
      const rawAppearance = o.sceneAppearanceSnapshot ?? captureSceneAppearance(scene, o, b.themes, useSettingsStore.getState().brandKit.logoUrl)
      const appearance = canonicalCapturedAppearance(rawAppearance)
      const themeSelection = parseThemeSelection({ themeId: o.themeId, ...(o.themeFor === undefined ? {} : { themeFor: o.themeFor }) })
      if (!appearance || !themeSelection || !appearanceHasSceneThemes(scene, appearance, themeSelection)) return []
      return [[o.id, { scene: structuredClone(scene), appearance: structuredClone(appearance), ...structuredClone(themeSelection) }]]
    })),
    eventId: useEventClock.getState().currentId,
    eventMomentId: useEventClock.getState().currentMomentId,
    timer: (() => {
      const t = useTimerStore.getState().timer
      return t.durationMs || t.startedAt !== null || t.accumulatedMs ? { durationMs: t.durationMs, elapsedMs: Math.round(elapsedMs(t, monotonicNow())), running: t.startedAt !== null } : undefined
    })(),
  }
  return JSON.stringify(snap).length > MAX_CHARS ? { ...snap, liveVerse: null, sources: {}, sceneSnapshots: {}, trimmed: true } : snap
}

/** Whether a snapshot is worth offering: recent, and something was on the screens. */
export function worthOffering(value: unknown, now = Date.now()): boolean {
  const s = parseLiveSnapshot(value)
  return !!s && now - s.at < FRESH_MS && now >= s.at && (s.isLive || s.outputsOn.length > 0)
}

/** Put back what was on the screens: the sources, the program, each output and its scene, the event. */
export async function putBack(value: unknown): Promise<boolean> {
  useRecovery.setState({ restoreError: null })
  const s = parseLiveSnapshot(value)
  if (!s) {
    useRecovery.setState({ offer: null, dismissed: false, damaged: true, restoreError: null })
    return false
  }
  // A trimmed snapshot has no sources: leave what is on now alone. When the live verse and its
  // source match, share that value object so noteSources does not create a new activation revision.
  let restoredSources = s.sources
  if (s.isLive && s.liveVerse) {
    const id = sourceOf(s.liveVerse)
    const source = s.sources[id]
    if (source && sameSnapshotValue(source.value, s.liveVerse)) {
      restoredSources = { ...s.sources, [id]: { ...source, value: s.liveVerse } }
    }
  }
  const beforeRestore = useBroadcastStore.getState()
  const sourcesAlreadyRestored = sameSnapshotValue(beforeRestore.sources, restoredSources)
  const liveAlreadyRestored = !!s.isLive && !!s.liveVerse && beforeRestore.isLive && beforeRestore.liveItemId === s.liveItemId && sameSnapshotValue(beforeRestore.liveVerse, s.liveVerse)
  if (!s.trimmed && !sourcesAlreadyRestored) useBroadcastStore.setState({ sources: restoredSources })
  const missingOutputs = new Set<string>()
  const failedOutputs = new Set<string>()
  const missingScenes = new Set<string>()
  const failedScenes = new Set<string>()
  const scenesNotRestored = new Set<string>()
  for (const [outputId, sceneId] of Object.entries(s.scenes)) {
    const current = useBroadcastStore.getState()
    const output = current.outputs.find((o) => o.id === outputId)
    if (!output) {
      missingOutputs.add(outputId)
      scenesNotRestored.add(outputId)
      continue
    }
    if ((output.role ?? "congregation") !== "congregation") {
      failedScenes.add(output.name)
      scenesNotRestored.add(outputId)
      continue
    }
    const captured = s.sceneSnapshots?.[outputId]
    let scene: Scene | null = null
    let appearance: SceneAppearanceSnapshot | null = null
    let themeSelection: RecoveryThemeSelection | null = null
    if (captured?.scene.id === sceneId) {
      scene = captured.scene
      appearance = captured.appearance
      themeSelection = { themeId: captured.themeId, ...(captured.themeFor === undefined ? {} : { themeFor: captured.themeFor }) }
    } else if (s.sceneSnapshots === undefined && !s.trimmed) {
      // Legacy v1 snapshots contain only the ID. Use the immutable on-output snapshot persisted
      // alongside the output, and its matching appearance capture; never resolve the ID against
      // the mutable reusable-scene library or the current look values.
      scene = parseScene(output.sceneSnapshot, sceneId)
      appearance = output.sceneAppearanceSnapshot ? parseSceneAppearance(output.sceneAppearanceSnapshot, true) : null
      themeSelection = parseThemeSelection({ themeId: output.themeId, ...(output.themeFor === undefined ? {} : { themeFor: output.themeFor }) })
    }

    if (!scene || !appearance || !themeSelection || !appearanceHasSceneThemes(scene, appearance, themeSelection)) {
      missingScenes.add(`${output.name} (ID: ${sceneId})`)
      scenesNotRestored.add(outputId)
      continue
    }

    const currentOutput = useBroadcastStore.getState().outputs.find((o) => o.id === outputId)
    const alreadyRestored = !!currentOutput && currentOutput.sceneId === sceneId &&
      stableJSON(currentOutput.sceneSnapshot) === stableJSON(scene) &&
      stableJSON(currentOutput.sceneAppearanceSnapshot) === stableJSON(appearance) &&
      currentOutput.themeId === themeSelection.themeId &&
      stableJSON(currentOutput.themeFor ?? {}) === stableJSON(themeSelection.themeFor ?? {})
    if (!alreadyRestored) {
      useBroadcastStore.getState().restoreSceneSnapshot(outputId, scene, appearance, themeSelection)
      const restored = useBroadcastStore.getState().outputs.find((o) => o.id === outputId)
      const restoreSucceeded = !!restored && restored.sceneId === sceneId &&
        stableJSON(restored.sceneSnapshot) === stableJSON(scene) &&
        stableJSON(restored.sceneAppearanceSnapshot) === stableJSON(appearance) &&
        restored.themeId === themeSelection.themeId &&
        stableJSON(restored.themeFor ?? {}) === stableJSON(themeSelection.themeFor ?? {})
      if (!restoreSucceeded) {
        failedScenes.add(output.name)
        scenesNotRestored.add(outputId)
      }
    }
  }
  if (s.isLive && s.liveVerse && !liveAlreadyRestored) useBroadcastStore.getState().setLiveVerse(s.liveVerse, null, { goLive: true, itemId: s.liveItemId })
  for (const id of s.outputsOn) {
    // Trimmed recovery omits live content and sources; no output can be safely re-enabled.
    if (s.trimmed) continue
    if (scenesNotRestored.has(id)) continue
    const output = useBroadcastStore.getState().outputs.find((o) => o.id === id)
    if (!output) {
      missingOutputs.add(id)
      continue
    }
    if (!outputOnAir(output, useBroadcastStore.getState().outputStatus[id]) && !(await enableOutput(output))) {
      failedOutputs.add(output.name)
    }
  }

  // Program state, clocks and timers are independent recovery records. Restore them on the first
  // explicit attempt even if an output is unavailable; the guards make a retry idempotent.
  if (s.eventId && (useEventClock.getState().currentId !== s.eventId || useEventClock.getState().currentMomentId !== (s.eventMomentId ?? null))) {
    whilePuttingBack(() => useEventClock.getState().start(s.eventId!, s.eventMomentId ?? null))
  }
  const now = useTimerStore.getState().timer
  if (s.timer && now.startedAt === null && now.accumulatedMs === 0) {
    const ran = s.timer.elapsedMs + (s.timer.running ? Math.max(0, Date.now() - s.at) : 0)
    useTimerStore.setState({ timer: { durationMs: s.timer.durationMs, accumulatedMs: ran, startedAt: null } })
    if (s.timer.running) useTimerStore.getState().start()
  }

  const problems: string[] = []
  if (missingOutputs.size) problems.push(`Saved output configuration is no longer available for ${[...missingOutputs].join(", ")}. Restore the output or continue with the available state.`)
  if (failedOutputs.size) problems.push(`Could not start outputs: ${[...failedOutputs].join(", ")}. Check the display or device connection, then try again.`)
  if (missingScenes.size) problems.push(`The saved scene is no longer available for ${[...missingScenes].join(", ")}. Choose a replacement scene or continue with the available state.`)
  if (failedScenes.size) problems.push(`Could not select saved scenes for ${[...failedScenes].join(", ")}. Choose a scene or continue with the available state.`)
  if (s.trimmed) problems.push("This recovery snapshot was shortened to fit storage; its live content and source state are missing. Activate or select content manually before continuing.")
  if (problems.length) {
    useRecovery.setState({
      dismissed: false,
      restoreError: problems.join(" "),
    })
    return false
  }
  useJournalStore.getState().add({ kind: "recovery", label: `Put back after Rhema Studio closed unexpectedly at ${new Date(s.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` })
  useRecovery.setState({ offer: null, dismissed: false, damaged: false, restoreError: null })
  return true
}

let store: Store | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let last = ""

function save(evenInRehearsal = false) {
  timer = null
  // Rehearsal is a sandbox, and an open offer still holds the crash's snapshot (kept in memory once put off).
  const r = useRecovery.getState()
  if (!store || (useBroadcastStore.getState().rehearsal && !evenInRehearsal) || (r.offer && !r.dismissed)) return
  const snap = takeSnapshot()
  const key = JSON.stringify({ ...snap, at: 0 })
  if (key === last) return
  last = key
  void store.set("snapshot", snap).then(() => store?.save()).catch(() => {})
}

const soon = () => { if (!timer) timer = setTimeout(save, 1000) }

let journalTimer: ReturnType<typeof setTimeout> | null = null
function saveJournal() {
  journalTimer = null
  if (!store) return
  void writeJournalRecovery().catch((error: unknown) => {
    useJournalStore.setState({ checkpointStatus: "error", checkpointError: `Local recovery could not be written: ${String(error)}` })
  })
}

async function writeJournalRecovery(): Promise<void> {
  if (!store) throw new Error("Local recovery storage is not ready")
  const { entries, startItemIds, runContext, runStatus, finalizedLogId } = useJournalStore.getState()
  const kept: KeptJournal = { v: 2, at: Date.now(), checkpointMono: monotonicNow(), entries, startItemIds, runStatus, finalizedLogId, ...(runContext ? { runContext } : {}) }
  await store.set("journal", kept)
  await store.save()
}

/** Write the latest journal before closing or relying on offline recovery. */
export async function flushJournalRecovery(): Promise<void> {
  if (journalTimer) {
    clearTimeout(journalTimer)
    journalTimer = null
  }
  await writeJournalRecovery()
}

let noticesTimer: ReturnType<typeof setTimeout> | null = null
function saveNotices() {
  noticesTimer = null
  if (!store) return
  const { notices, read } = useNotices.getState()
  const ids = new Set(notices.map((n) => n.id))
  const kept: KeptNotices = { v: 1, at: Date.now(), notices: notices.slice(0, 100), read: read.filter((id) => ids.has(id)) }
  void store.set("notices", kept).then(() => store?.save()).catch(() => {})
}

/** Read the last snapshot (offer it after an unclean exit), then keep it up to date. */
export async function startLiveRecovery(): Promise<() => void> {
  useRecovery.setState({ offer: null, dismissed: false, damaged: false, restoreError: null })
  let unclean = false
  try {
    unclean = await invoke<boolean>("last_exit_unclean")
  } catch {
    // Not under Tauri: there is no confirmed crash recovery to offer.
  }
  let recoveryReadable = true
  try {
    store = await load("recovery.json", { autoSave: false, defaults: {} })
    if (unclean) {
      const rawSnapshot = await store.get<unknown>("snapshot")
      const snapshot = rawSnapshot == null ? null : parseLiveSnapshot(rawSnapshot)
      if (rawSnapshot != null && !snapshot) {
        recoveryReadable = false
      } else if (snapshot && worthOffering(snapshot)) {
        useRecovery.setState({ offer: snapshot })
      }
    }
  } catch {
    recoveryReadable = false
  }
  if (unclean && !recoveryReadable) {
    useRecovery.setState({ offer: null, dismissed: false, damaged: true, restoreError: null })
  }
  if (store) {
    // History is independent from the visual snapshot. A damaged Live snapshot never suppresses
    // recovery of the separate journal; restoring it cannot put anything on a screen.
    try {
      const kept = await store.get<KeptJournal>("journal")
      const pendingRun = kept?.v === 2 && !!kept.runContext && !kept.finalizedLogId
      const restored = (unclean || pendingRun) ? restoreJournal(kept, Date.now(), monotonicNow(), unclean) : false
      const recovered = useJournalStore.getState()
      if (restored && recovered.runContext) {
        try { await flushJournalRecovery() } catch (error) {
          useJournalStore.setState({ checkpointStatus: "error", checkpointError: `Recovered journal could not be kept locally: ${String(error)}` })
        }
        const pendingFinish = recovered.runStatus === "finished" && !recovered.finalizedLogId
        const work = pendingFinish ? finalizeServiceRun() : recovered.runStatus !== "finished" ? interruptCurrentServiceRun() : Promise.resolve()
        void work.catch((error: unknown) => {
          useJournalStore.setState({ checkpointStatus: "error", checkpointError: `Recovered service run could not be saved: ${String(error)}` })
        })
      }
    } catch { /* Keep startup available if the journal is damaged. */ }
    if (unclean) try { restoreNotices(await store.get<KeptNotices>("notices")) } catch { /* Keep startup available if notices are damaged. */ }
  }
  const offs = [
    useBroadcastStore.subscribe((s, p) => {
      // Rehearsal starting: keep what was really on the screens up to now (a change in the last
      // second would otherwise be lost while rehearsal stops saving).
      if (s.rehearsal && !p.rehearsal) {
        if (timer) clearTimeout(timer)
        save(true)
        return
      }
      if (s.isLive !== p.isLive || s.liveVerse !== p.liveVerse || s.sources !== p.sources || s.outputStatus !== p.outputStatus || s.outputs !== p.outputs) soon()
    }),
    useEventClock.subscribe((s, p) => { if (s.currentId !== p.currentId || s.currentMomentId !== p.currentMomentId) soon() }),
    // Started, paused, reset or corrected (not every tick: a running timer is worked out from the time).
    useTimerStore.subscribe((s, p) => { if (s.timer !== p.timer) soon() }),
    useRecovery.subscribe((s, p) => { if ((p.offer && !s.offer) || (s.dismissed && !p.dismissed)) soon() }),
    // Keep the local recovery copy close to the last recorded change.
    useJournalStore.subscribe((s, p) => { if ((s.entries !== p.entries || s.runContext !== p.runContext || s.runStatus !== p.runStatus || s.finalizedLogId !== p.finalizedLogId) && !journalTimer) journalTimer = setTimeout(saveJournal, 200) }),
    // Notices and their answers, the same way.
    useNotices.subscribe((s, p) => { if ((s.notices !== p.notices || s.read !== p.read) && !noticesTimer) noticesTimer = setTimeout(saveNotices, 3000) }),
  ]
  return () => {
    offs.forEach((off) => off())
    if (timer) clearTimeout(timer)
    if (journalTimer) clearTimeout(journalTimer)
    if (noticesTimer) clearTimeout(noticesTimer)
    timer = null
    journalTimer = null
    noticesTimer = null
  }
}
