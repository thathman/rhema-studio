import { forOutputLanguage, isOutputLanguageFallback } from "@/lib/output-language"
import { themeIdFor, themeIdsOf } from "@/lib/output-themes"
import { cameraPathOf, cameraSourceId, feedFrame, withCameraPath, type LiveSources, type StateSources } from "@/lib/live-sources"
import { CONTENT_TYPES } from "@/types/broadcast"
import type { ContentType } from "@/types/broadcast"
import { NO_SIGNALS } from "@/types/scene"
import type { BroadcastOutput, BroadcastTheme, LowerThird, NoSignal, Scene, SceneAppearanceSnapshot, SceneBox, SceneClock, SceneCrop, SceneFrame, SceneLayer, SceneLayerFrame, SceneLayerKind, Ticker, VerseRenderData } from "@/types"
import { elapsedMs, formatMs, remainingMs, type TimerState } from "@/lib/timer"
import { countdownTarget, isCountdownTo, type CountdownTargets } from "@/lib/countdown"

/**
 * Congregation scenes (ADR 0001, ARCH-002): layers of live content, colour, pictures and cameras
 * placed on one frame. A scene is arranged here and its looks come from Design; taking it to an
 * output makes it that output's program.
 */

const KINDS: readonly SceneLayerKind[] = ["feed", "color", "picture", "video", "camera", "clock", "ticker", "lowerThird", "logo"]
const clamp = (n: unknown, lo: number, hi: number, d: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d)

/** A media folder file name: its hash and type (as the host stores it); the only name a browser feed may ask for. */
const MEDIA_FILE = /^[0-9a-f]{64}\.[a-z0-9]{1,8}$/

export const FULL: SceneBox = { x: 0, y: 0, w: 100, h: 100 }

/** The immutable revision on air, falling back to the saved scene for older output records. */
export function sceneForOutput(
  output: Pick<BroadcastOutput, "role" | "sceneId" | "sceneSnapshot">,
  scenes: readonly Scene[],
): Scene | undefined {
  if (!output.sceneId || (output.role ?? "congregation") !== "congregation") return undefined
  if (output.sceneSnapshot?.id === output.sceneId) return output.sceneSnapshot
  return scenes.find((scene) => scene.id === output.sceneId)
}

/** True when the saved scene, one of its looks, or its church logo has changed since Take. */
export function sceneNeedsRefresh(
  output: BroadcastOutput,
  scenes: readonly Scene[],
  themes: readonly BroadcastTheme[],
  logoUrl: string | null,
): boolean {
  if (!output.sceneId) return false
  const taken = output.sceneSnapshot?.id === output.sceneId ? output.sceneSnapshot : null
  const saved = scenes.find((scene) => scene.id === output.sceneId)
  if (!taken || !output.sceneAppearanceSnapshot) return true
  if (output.sceneAppearanceSnapshot.approved?.appearanceComplete === false) return true
  if (saved && taken.updatedAt !== saved.updatedAt) return true

  const usedThemeIds = new Set<string>()
  for (const layer of taken.layers) {
    if (layer.themeId) usedThemeIds.add(layer.themeId)
    else if (["feed", "clock", "camera", "ticker", "lowerThird"].includes(layer.kind)) {
      for (const id of themeIdsOf(output)) usedThemeIds.add(id)
    }
  }
  for (const id of usedThemeIds) {
    const takenTheme = output.sceneAppearanceSnapshot.themes[id]
    const currentTheme = themes.find((theme) => theme.id === id)
    if (!takenTheme || !currentTheme || JSON.stringify(takenTheme) !== JSON.stringify(currentTheme)) return true
  }
  return taken.layers.some((layer) => layer.kind === "logo") && output.sceneAppearanceSnapshot.logoUrl !== logoUrl
}

/** Capture only looks a scene can resolve on this output, including its per-content looks. */
export function captureSceneAppearance(
  scene: Scene,
  output: Pick<BroadcastOutput, "themeId" | "themeFor">,
  themes: readonly BroadcastTheme[],
  logoUrl: string | null,
): SceneAppearanceSnapshot {
  const ids = new Set([
    ...themeIdsOf(output),
    ...scene.layers.flatMap((layer) => layer.themeId ? [layer.themeId] : []),
  ])
  const snapshots: Record<string, BroadcastTheme> = {}
  const fallback = themes.find((candidate) => candidate.id === output.themeId) ?? themes[0]
  for (const id of ids) {
    const theme = themes.find((candidate) => candidate.id === id) ?? fallback
    if (theme) snapshots[id] = JSON.parse(JSON.stringify(theme)) as BroadcastTheme
  }
  return { themes: snapshots, logoUrl }
}

let seq = 0
const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `layer-${Date.now()}-${++seq}`)

const LAYER_NAMES: Record<SceneLayerKind, string> = { feed: "Live content", color: "Colour", picture: "Picture", video: "Video", camera: "Camera", clock: "Clock", ticker: "Ticker", lowerThird: "Lower third", logo: "Logo" }

/** Where a new layer of a kind goes when nothing says: the ticker along the bottom, the logo in the top-right corner, the rest full frame. */
export function layerBox(kind: SceneLayerKind): SceneBox {
  if (kind === "ticker") return { x: 0, y: 92, w: 100, h: 8 }
  if (kind === "logo") return { x: 84, y: 4, w: 12, h: 12 }
  return { ...FULL }
}

export function newLayer(kind: SceneLayerKind, patch: Partial<SceneLayer> = {}): SceneLayer {
  return { id: newId(), name: LAYER_NAMES[kind], kind, box: layerBox(kind), opacity: 1, visible: true, ...(kind === "color" ? { color: "#101820" } : {}), ...patch }
}

export interface ScenePreset {
  id: string
  name: string
  description: string
  layers: () => SceneLayer[]
  /** A preset the church saved from one of its scenes (it can be renamed and deleted). */
  own?: boolean
  background?: string
  fadeMs?: number
}

/** Ready-made arrangements; each is an ordinary scene once added. */
export const SCENE_PRESETS: ScenePreset[] = [
  { id: "full", name: "Full screen", description: "Whatever is put on air, full screen", layers: () => [newLayer("feed", { name: "On air" })] },
  { id: "bible-lyrics", name: "Bible and lyrics", description: "The verse on the left, the song or hymn on the right", layers: () => [
    newLayer("color", { name: "Background" }),
    newLayer("feed", { name: "Bible", shows: ["bible"], box: { x: 2, y: 10, w: 47, h: 80 } }),
    newLayer("feed", { name: "Lyrics", shows: ["song", "hymn"], box: { x: 51, y: 10, w: 47, h: 80 } }),
  ] },
  { id: "picture-lyrics", name: "Lyrics on a picture", description: "A picture behind, the words in the lower third", layers: () => [
    newLayer("picture", { name: "Picture" }),
    newLayer("feed", { name: "Lyrics", shows: ["song", "hymn"], box: { x: 0, y: 66, w: 100, h: 34 } }),
  ] },
  { id: "camera-bible", name: "Camera with the Bible", description: "A camera full screen, the verse along the bottom", layers: () => [
    newLayer("camera", { name: "Pulpit camera" }),
    newLayer("feed", { name: "Bible", shows: ["bible"], box: { x: 0, y: 70, w: 100, h: 30 } }),
  ] },
  { id: "full-camera", name: "Full camera", description: "One camera, full screen", layers: () => [newLayer("camera", { name: "Camera" })] },
  { id: "pip-camera", name: "Camera in a corner", description: "Whatever is on air, with a small camera in the top-right corner", layers: () => [
    newLayer("feed", { name: "On air" }),
    newLayer("camera", { name: "Pulpit camera", box: { x: 70, y: 4, w: 26, h: 26 } }),
  ] },
  { id: "sermon-split", name: "Sermon split", description: "The preacher's camera on the left, the verse on the right", layers: () => [
    newLayer("color", { name: "Background" }),
    newLayer("camera", { name: "Pulpit camera", box: { x: 0, y: 25, w: 50, h: 50 } }),
    newLayer("feed", { name: "Bible", shows: ["bible"], box: { x: 50, y: 25, w: 50, h: 50 } }),
  ] },
  { id: "welcome", name: "Welcome", description: "The church logo, a countdown to the service and the ticker", layers: () => [
    newLayer("color", { name: "Background" }),
    newLayer("logo", { box: { x: 35, y: 10, w: 30, h: 30 } }),
    newLayer("clock", { name: "Countdown to the service", clockShows: "until", box: { x: 25, y: 46, w: 50, h: 26 } }),
    newLayer("ticker"),
  ] },
  { id: "lyrics-video", name: "Lyrics on video", description: "A looping video behind (no sound), the words in the lower third", layers: () => [
    newLayer("video", { name: "Video background" }),
    newLayer("feed", { name: "Lyrics", shows: ["song", "hymn"], box: { x: 0, y: 66, w: 100, h: 34 }, fadeMs: 300 }),
  ] },
  // Added after the first ones; ids are kept as they are, new ones go at the end (#208 U3).
  { id: "closing-announcements", name: "Closing announcements", description: "The announcement slides large, the church logo in the corner and the ticker along the bottom", layers: () => [
    newLayer("color", { name: "Background" }),
    newLayer("feed", { name: "Announcements", shows: ["slide", "picture"], box: { x: 4, y: 6, w: 92, h: 82 } }),
    newLayer("logo", { box: { x: 86, y: 4, w: 10, h: 10 } }),
    newLayer("ticker"),
  ] },
  { id: "countdown-camera", name: "Countdown over a live camera", description: "A camera full screen, darkened a little, with the countdown to the service over it", layers: () => [
    newLayer("camera", { name: "Camera" }),
    newLayer("color", { name: "Darken the camera", color: "#000000", opacity: 0.35 }),
    newLayer("clock", { name: "Countdown to the service", clockShows: "until", box: { x: 25, y: 37, w: 50, h: 26 } }),
  ] },
]

export function newScene(name: string, preset: ScenePreset = SCENE_PRESETS[0]): Scene {
  const now = Date.now()
  return { id: newId(), name: name.trim().slice(0, 80) || preset.name, background: preset.background ?? "#000000", layers: preset.layers(), ...(preset.fadeMs ? { fadeMs: preset.fadeMs } : {}), createdAt: now, updatedAt: now }
}

/**
 * A church's own preset, saved from a scene: its arrangement with new ids and without held copies
 * (a preset starts every new scene following live).
 */
export function presetFromScene(scene: Scene, name: string): Scene {
  const now = Date.now()
  return { ...scene, id: newId(), name: name.trim().slice(0, 80) || scene.name, layers: scene.layers.map((l) => ({ ...l, id: newId(), held: undefined })), createdAt: now, updatedAt: now }
}

/** A saved preset as the composer's new-scene menu offers it, beside the built-in ones. */
export function ownPreset(p: Scene): ScenePreset {
  return { id: p.id, name: p.name, description: "Your preset", own: true, background: p.background, fadeMs: p.fadeMs, layers: () => p.layers.map((l) => ({ ...l, id: newId() })) }
}

/**
 * Which sources a scene draws in boxes of its own. A scene with a ticker layer (shown or hidden)
 * owns the ticker on its output, and one with a lower-third layer owns the lower third: the output
 * then never also draws them over the whole frame.
 */
export function sceneOwns(scene: Pick<Scene, "layers"> | undefined): { ticker: boolean; lowerThird: boolean } {
  return { ticker: !!scene?.layers.some((l) => l.kind === "ticker"), lowerThird: !!scene?.layers.some((l) => l.kind === "lowerThird") }
}

/** A copy with new ids (Duplicate). */
export function copyScene(scene: Scene, name: string): Scene {
  const now = Date.now()
  return { ...scene, id: newId(), name: name.trim().slice(0, 80) || `${scene.name} copy`, layers: scene.layers.map((l) => ({ ...l, id: newId() })), createdAt: now, updatedAt: now }
}

function box(raw: unknown): SceneBox {
  const b = (raw ?? {}) as Partial<SceneBox>
  const x = clamp(b.x, 0, 100, 0)
  const y = clamp(b.y, 0, 100, 0)
  return { x, y, w: clamp(b.w, 1, 100 - x, 100 - x), h: clamp(b.h, 1, 100 - y, 100 - y) }
}

function crop(raw: unknown): SceneCrop | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const c = raw as Partial<SceneCrop>
  const l = clamp(c.l, 0, 90, 0), t = clamp(c.t, 0, 90, 0)
  return { l, t, r: clamp(c.r, 0, 90 - l, 0), b: clamp(c.b, 0, 90 - t, 0) }
}

/** A scene as saved, made safe to use (a damaged or newer file never breaks an output). */
export function normalizeScene(raw: unknown): Scene | null {
  if (!raw || typeof raw !== "object") return null
  const s = raw as Partial<Scene>
  if (typeof s.id !== "string" || !s.id) return null
  const layers = (Array.isArray(s.layers) ? s.layers : []).flatMap((l): SceneLayer[] => {
    if (!l || typeof l !== "object" || typeof l.id !== "string" || !KINDS.includes(l.kind)) return []
    const shows = Array.isArray(l.shows) ? l.shows.filter((k): k is ContentType => (CONTENT_TYPES as readonly string[]).includes(k)) : undefined
    const clockShows = l.clockShows === "time" || l.clockShows === "until" || l.clockShows === "countdown" ? l.clockShows : undefined
    const countdownTo = isCountdownTo(l.countdownTo) ? l.countdownTo : undefined
    const until = typeof l.until === "string" && /^\d{1,2}:\d{2}$/.test(l.until) ? l.until : undefined
    const cameraUrl = typeof l.cameraUrl === "string" && /^https?:\/\//.test(l.cameraUrl.trim()) ? l.cameraUrl.trim().slice(0, 300) : undefined
    const cameraFallback = typeof l.cameraFallback === "string" && l.cameraFallback.trim() ? l.cameraFallback.trim().slice(0, 120) : undefined
    // What a camera's box shows while it is not sending: absent stays absent (colour bars).
    const noSignal = l.kind === "camera" && NO_SIGNALS.includes(l.noSignal as NoSignal) ? l.noSignal : undefined
    const noSignalName = l.kind === "camera" && l.noSignalName === true ? true : undefined
    const language = l.language === "both" || l.language === "first" || l.language === "second" ? l.language : undefined
    const videoUrl = typeof l.videoUrl === "string" && l.videoUrl && l.videoUrl.length <= 4000 ? l.videoUrl : undefined
    const mediaFile = typeof l.mediaFile === "string" && MEDIA_FILE.test(l.mediaFile) ? l.mediaFile : undefined
    const fadeMs = clamp(l.fadeMs, 0, 3000, 0)
    return [{ ...l, clockShows, until, countdownTo, cameraUrl, cameraFallback, noSignal, noSignalName, language, videoUrl, mediaFile, fadeMs: fadeMs > 0 ? fadeMs : undefined, name: typeof l.name === "string" ? l.name.slice(0, 80) : "Layer", shows: shows?.length ? shows : undefined, box: box(l.box), crop: crop(l.crop), opacity: clamp(l.opacity, 0, 1, 1), visible: l.visible !== false }]
  })
  return { id: s.id, name: typeof s.name === "string" && s.name.trim() ? s.name.slice(0, 80) : "Scene", background: typeof s.background === "string" ? s.background : "#000000", layers, ...(clamp(s.fadeMs, 0, 3000, 0) > 0 ? { fadeMs: clamp(s.fadeMs, 0, 3000, 0) } : {}), createdAt: clamp(s.createdAt, 0, Number.MAX_SAFE_INTEGER, 0), updatedAt: clamp(s.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0), ...(typeof s.updatedBy === "string" ? { updatedBy: s.updatedBy.trim().slice(0, 60) || null } : s.updatedBy === null ? { updatedBy: null } : {}), ...(typeof s.libraryLookId === "string" && s.libraryLookId ? { libraryLookId: s.libraryLookId } : {}) }
}

interface LiveState {
  isLive: boolean
  liveVerse: VerseRenderData | null
  sources: LiveSources
  /** Cameras hidden from scenes (a camera's hold): their layers show the fallback. */
  stateSources?: StateSources
  themes: BroadcastTheme[]
  /** The service timer for clock layers; absent or null: not set. */
  clock?: SceneClock | null
  /** Wall-clock ms for "count down to a time" (default: now). */
  now?: number
  /** What "time until" clocks count down to (the run of show's next item and milestones). */
  countdowns?: CountdownTargets | null
  /** The running ticker, for ticker layers (null or absent: none runs). */
  ticker?: Ticker | null
  /** The lower third on air for this output, for lower-third layers. */
  overlay?: LowerThird | null
  /** The church's Brand Kit logo (a data URL), for logo layers. */
  logoUrl?: string | null
  /** A camera's name (Live → Production tools → Cameras) for its stream address, for the colour bars' ident; absent: the layer's name. */
  cameraLabel?: (url: string) => string | undefined
  /** A camera's backup camera (Live → Production tools → Cameras), by the router's names (#213). */
  cameraBackup?: (name: string) => string | undefined
  /** What the router says of a camera that is down: not sending, frozen (connected, nothing arriving) or the router is off; undefined: sending, or not known. */
  cameraDown?: (name: string) => CameraDown | undefined
}

/** A camera the router says cannot be shown now (#213). */
export type CameraDown = "not-sending" | "frozen" | "router-off"

/**
 * A countdown to a time of day ("10:00", the service start): today's, or tomorrow's once today's
 * is more than 12 hours gone. It stops at 0:00 on the screens.
 */
export function untilClock(until: string | undefined, now: number): SceneClock | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(until ?? "")
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  const d = new Date(now)
  d.setHours(Number(m[1]), Number(m[2]), 0, 0)
  if (now - d.getTime() > 12 * 3_600_000) d.setDate(d.getDate() + 1)
  return { mode: "down", at: d.getTime(), text: "" }
}

/**
 * A countdown to the run of show's next item or a milestone (#196 R2); null when there is none
 * (the last item is on, or the service has no start time), and the layer then shows nothing.
 */
export function countdownClock(targets: CountdownTargets | null | undefined, to: SceneLayer["countdownTo"]): SceneClock | null {
  const target = countdownTarget(targets, to ?? "next")
  return target ? { mode: "down", at: target.at, text: "" } : null
}

/** The service timer as a clock layer shows it; null when there is nothing to show. */
export function sceneClock(t: TimerState, mono: number, wall: number): SceneClock | null {
  const running = t.startedAt !== null
  if (t.durationMs > 0) return running ? { mode: "down", at: wall + remainingMs(t, mono), text: "" } : { mode: "still", at: 0, text: formatMs(Math.max(0, remainingMs(t, mono))) }
  if (running) return { mode: "up", at: wall - elapsedMs(t, mono), text: "" }
  return t.accumulatedMs > 0 ? { mode: "still", at: 0, text: formatMs(t.accumulatedMs) } : null
}

/** The time a clock layer shows now; a countdown stops at 0:00 for the congregation. */
export function clockText(c: SceneClock, wall: number): string {
  if (c.mode === "time") return new Date(wall).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  if (c.mode === "down") return formatMs(Math.max(0, c.at - wall + 999))
  if (c.mode === "up") return formatMs(Math.max(0, wall - c.at))
  return c.text
}

/** What one feed layer shows, and in which look, on this output. */
export function layerContent(s: LiveState, output: Pick<BroadcastOutput, "themeId" | "themeFor" | "language" | "sceneAppearanceSnapshot">, layer: SceneLayer): { verse: VerseRenderData | null; theme: BroadcastTheme | undefined } {
  const shown = layer.held !== undefined && layer.held !== null ? layer.held : feedFrame(s, layer.shows)
  const themeId = layer.themeId ?? themeIdFor(output, shown?.content)
  const theme = output.sceneAppearanceSnapshot?.themes[themeId] ?? output.sceneAppearanceSnapshot?.themes[output.themeId] ?? s.themes.find((t) => t.id === themeId) ?? s.themes.find((t) => t.id === output.themeId) ?? s.themes[0]
  return { verse: shown ? forOutputLanguage(shown, layer.language ?? output.language) : null, theme }
}

/** Whether visible text in a taken scene falls back because a selected second language is absent. */
export function sceneHasLanguageFallback(
  s: Pick<LiveState, "isLive" | "liveVerse" | "sources">,
  output: Pick<BroadcastOutput, "language" | "shows">,
  scene: Pick<Scene, "layers">,
  overlay: LowerThird | null,
  shown: VerseRenderData | null,
  outputOverlayVisible: boolean,
): boolean {
  const feedFallback = scene.layers.some((layer) =>
    layer.visible && layer.kind === "feed" &&
    isOutputLanguageFallback(layer.held ?? feedFrame(s, layer.shows), layer.language ?? output.language),
  )
  const hasVisibleOverlay = outputOverlayVisible || scene.layers.some((layer) => layer.visible && layer.kind === "lowerThird")
  const overlayFallback = !!overlay?.follow && hasVisibleOverlay &&
    isOutputLanguageFallback(shown, output.language)
  return feedFallback || overlayFallback
}

/** A short fingerprint of a text, so a frame can say "this layer shows something new" without carrying it twice. */
function fingerprint(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** What a layer shows, as a key: when it changes, a layer with a fade cross-fades to the new content. */
function contentKey(f: SceneLayerFrame): string {
  if (f.kind === "feed") return f.verse ? fingerprint(`${f.theme?.id}|${JSON.stringify(f.verse, (_k, v: unknown) => (typeof v === "string" && v.length > 256 ? `${v.length}:${v.slice(-64)}` : v))}`) : ""
  if (f.kind === "picture" || f.kind === "logo") return f.imageUrl ? fingerprint(`${f.imageUrl.length}:${f.imageUrl.slice(-64)}`) : ""
  if (f.kind === "video") return f.mediaFile ?? f.videoUrl ?? ""
  if (f.kind === "camera") return f.cameraUrl ?? f.fallback ?? ""
  // A clock's time moves by itself: only starting, stopping or a different kind of clock is new.
  if (f.kind === "clock") return f.clock?.mode ?? ""
  return f.color ?? ""
}

/** The kinds a layer fade applies to: the ticker and lower third have their own movement. */
export const FADES = (kind: SceneLayerKind) => kind !== "ticker" && kind !== "lowerThird"

/**
 * The frame an output draws for a scene. `preview` adds labels for what the composer shows but an
 * output never draws (a camera that is not connected yet).
 */
export function sceneFrame(s: LiveState, output: Pick<BroadcastOutput, "themeId" | "themeFor" | "language" | "cameraFallback" | "sceneAppearanceSnapshot">, scene: Scene, preview = false): SceneFrame {
  // The ticker and lower third fall back to the output's verse font, as they do over the whole frame.
  const themeForId = (id: string | undefined) => (id ? output.sceneAppearanceSnapshot?.themes[id] : undefined) ?? (id ? s.themes.find((t) => t.id === id) : undefined) ?? s.themes[0]
  const font = () => themeForId(output.themeId)?.verseText?.fontFamily
  return {
    sceneId: scene.id,
    background: scene.background,
    ...(scene.fadeMs ? { fadeMs: scene.fadeMs } : {}),
    layers: scene.layers.filter((l) => l.visible).map((l): SceneLayerFrame => {
      const f = layerFrame(l)
      return l.fadeMs && FADES(l.kind) ? { ...f, fadeMs: l.fadeMs, key: contentKey(f) } : f
    }),
  }

  function layerFrame(l: SceneLayer): SceneLayerFrame {
    const base = { id: l.id, kind: l.kind, box: l.box, crop: l.crop, opacity: l.opacity }
    if (l.kind === "feed") return { ...base, ...layerContent(s, output, l) }
    if (l.kind === "color") return { ...base, color: l.color ?? "#000000" }
    if (l.kind === "picture") return { ...base, imageUrl: l.imageUrl ?? null, ...(preview && !l.imageUrl ? { label: "Choose a picture" } : {}) }
    // A video plays on each output (a window from the media folder, a browser feed from the host), looped and silent.
    if (l.kind === "video") return { ...base, ...(l.videoUrl ? { videoUrl: l.videoUrl } : {}), ...(l.mediaFile ? { mediaFile: l.mediaFile } : {}), ...(preview ? { label: l.videoUrl ? `${l.name} · video` : "Choose a video" } : {}) }
    if (l.kind === "logo") {
      const logoUrl = output.sceneAppearanceSnapshot ? output.sceneAppearanceSnapshot.logoUrl : s.logoUrl
      return { ...base, imageUrl: logoUrl, ...(preview && !logoUrl ? { label: "Add the church logo in Design → Brand Kit" } : {}) }
    }
    if (l.kind === "ticker") return { ...base, ticker: s.ticker ?? null, fontFamily: font(), ...(preview && !s.ticker ? { label: `${l.name} · shows when the ticker runs` } : {}) }
    if (l.kind === "lowerThird") return { ...base, overlay: s.overlay ?? null, fontFamily: font(), ...(preview && !s.overlay ? { label: `${l.name} · shows when a lower third is up` } : {}) }
    if (l.kind === "clock") {
      const theme = themeForId(l.themeId ?? output.themeId)
      const clock = l.clockShows === "time" ? { mode: "time" as const, at: 0, text: "" } : l.clockShows === "until" ? untilClock(l.until, s.now ?? Date.now()) : l.clockShows === "countdown" ? countdownClock(s.countdowns, l.countdownTo) : (s.clock ?? null)
      const missing = l.clockShows === "until" ? "choose the time to count down to" : l.clockShows === "countdown" ? ((l.countdownTo ?? "next") === "next" ? "no next item in the run of show now" : "not in the run of show now") : "set the service timer in Present"
      return { ...base, theme, clock, ...(preview && !clock ? { label: `${l.name} · ${missing}` } : {}) }
    }
    // A camera: its stream, played by each output from the church network. One hidden from scenes
    // (Present → Sources) is not played: its box shows the fallback, the scene itself unchanged.
    // Until it sends, its box shows colour bars (with the camera's name, if asked), static, its words or nothing.
    const play = cameraPlay(s, output, l)
    const own = output.cameraFallback && output.cameraFallback.mode !== "camera" ? output.cameraFallback : undefined
    const noSignal = own ? (own.mode as NonNullable<SceneLayer["noSignal"]>) : (l.noSignal ?? "bars")
    const words = own ? own.words?.trim() : l.cameraFallback
    const fallback = noSignal === "words" && words ? { fallback: words, theme: themeForId(l.themeId ?? output.themeId) } : {}
    const ident = noSignal === "bars" && (own ? own.name : l.noSignalName) ? { ident: (l.cameraUrl && s.cameraLabel?.(l.cameraUrl)) || l.name } : {}
    const label = !l.cameraUrl ? `${l.name} · choose a camera` : play.instead ? `${l.name} · ${play.instead}` : play.url ? `${l.name} · camera` : `${l.name} · hidden from scenes`
    return { ...base, ...(play.url ? { cameraUrl: play.url } : {}), noSignal, ...fallback, ...ident, ...(play.retry ? { retry: play.retry } : {}), ...(play.hold ? { hold: true } : {}), ...(play.stale ? { stale: true } : {}), ...(preview ? { label } : {}) }
  }
}

/**
 * What a camera layer plays on one output (#213 operator controls): its camera; its backup while
 * the operator switched to it; nothing while it is hidden from scenes; or this output's other
 * camera while the one it would play is down (hidden, not sending or frozen) and that one sends.
 * With the Retry count (a new one restarts the screens' readers), Freeze, and `stale` when the
 * router says the camera it plays is connected but sending nothing (the screens then show the
 * fallback, not a frozen picture passed off as live).
 */
export function cameraPlay(s: Pick<LiveState, "stateSources" | "cameraBackup" | "cameraDown" | "cameraLabel">, output: Pick<BroadcastOutput, "cameraFallback">, l: Pick<SceneLayer, "cameraUrl">): { url?: string; retry?: number; hold?: boolean; stale?: boolean; instead?: string } {
  if (!l.cameraUrl) return {}
  const name = cameraPathOf(l.cameraUrl)
  const ctl = (n: string | null) => (n ? s.stateSources?.[cameraSourceId(n)] : undefined)
  const own = ctl(name)
  const called = (n: string) => s.cameraLabel?.(withCameraPath(l.cameraUrl!, n)) ?? n
  const hidden = own?.on === false
  const backup = own?.backup && name ? s.cameraBackup?.(name) : undefined
  let url: string | undefined = hidden ? undefined : backup ? withCameraPath(l.cameraUrl, backup) : l.cameraUrl
  let playing = hidden ? null : (backup ?? name)
  let instead = hidden ? "hidden from scenes" : backup ? `on its backup (${called(backup)})` : undefined
  const down = playing ? s.cameraDown?.(playing) : undefined
  // This output's other camera, while the one it would play is down and that one is not.
  const other = output.cameraFallback?.mode === "camera" ? output.cameraFallback.camera : undefined
  if (other && name && other !== playing && (hidden || down) && !s.cameraDown?.(other) && ctl(other)?.on !== false) {
    url = withCameraPath(l.cameraUrl, other)
    playing = other
    instead = `${called(other)} instead (this output's fallback)`
  }
  const now = ctl(playing)
  const retry = (own?.retry ?? 0) + (playing && playing !== name ? (now?.retry ?? 0) : 0)
  const hold = !!(own?.hold || (playing !== name && now?.hold))
  const stale = !!playing && s.cameraDown?.(playing) === "frozen"
  return { ...(url ? { url } : {}), ...(retry ? { retry } : {}), ...(hold && url ? { hold } : {}), ...(stale && url ? { stale } : {}), ...(instead ? { instead } : {}) }
}
