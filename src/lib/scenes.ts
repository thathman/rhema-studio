import { forOutputLanguage } from "@/lib/output-language"
import { themeIdFor } from "@/lib/output-themes"
import { feedFrame, type LiveSources } from "@/lib/live-sources"
import { CONTENT_TYPES } from "@/types/broadcast"
import type { ContentType } from "@/types/broadcast"
import type { BroadcastOutput, BroadcastTheme, Scene, SceneBox, SceneClock, SceneCrop, SceneFrame, SceneLayer, SceneLayerKind, VerseRenderData } from "@/types"
import { elapsedMs, formatMs, remainingMs, type TimerState } from "@/lib/timer"

/**
 * Congregation scenes (ADR 0001, ARCH-002): layers of live content, colour, pictures and cameras
 * placed on one frame. A scene is arranged here and its looks come from Design; taking it to an
 * output makes it that output's program.
 */

const KINDS: readonly SceneLayerKind[] = ["feed", "color", "picture", "camera", "clock"]
const clamp = (n: unknown, lo: number, hi: number, d: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d)

export const FULL: SceneBox = { x: 0, y: 0, w: 100, h: 100 }

let seq = 0
const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `layer-${Date.now()}-${++seq}`)

export function newLayer(kind: SceneLayerKind, patch: Partial<SceneLayer> = {}): SceneLayer {
  const name = kind === "feed" ? "Live content" : kind === "color" ? "Colour" : kind === "picture" ? "Picture" : kind === "clock" ? "Clock" : "Camera"
  return { id: newId(), name, kind, box: { ...FULL }, opacity: 1, visible: true, ...(kind === "color" ? { color: "#101820" } : {}), ...patch }
}

export interface ScenePreset {
  id: string
  name: string
  description: string
  layers: () => SceneLayer[]
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
  { id: "camera-bible", name: "Camera with the Bible", description: "A camera full screen, the verse along the bottom (cameras: planned)", layers: () => [
    newLayer("camera", { name: "Pulpit camera" }),
    newLayer("feed", { name: "Bible", shows: ["bible"], box: { x: 0, y: 70, w: 100, h: 30 } }),
  ] },
]

export function newScene(name: string, preset: ScenePreset = SCENE_PRESETS[0]): Scene {
  const now = Date.now()
  return { id: newId(), name: name.trim().slice(0, 80) || preset.name, background: "#000000", layers: preset.layers(), createdAt: now, updatedAt: now }
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
    const clockShows = l.clockShows === "time" || l.clockShows === "until" ? l.clockShows : undefined
    const until = typeof l.until === "string" && /^\d{1,2}:\d{2}$/.test(l.until) ? l.until : undefined
    return [{ ...l, clockShows, until, name: typeof l.name === "string" ? l.name.slice(0, 80) : "Layer", shows: shows?.length ? shows : undefined, box: box(l.box), crop: crop(l.crop), opacity: clamp(l.opacity, 0, 1, 1), visible: l.visible !== false }]
  })
  return { id: s.id, name: typeof s.name === "string" && s.name.trim() ? s.name.slice(0, 80) : "Scene", background: typeof s.background === "string" ? s.background : "#000000", layers, ...(clamp(s.fadeMs, 0, 3000, 0) > 0 ? { fadeMs: clamp(s.fadeMs, 0, 3000, 0) } : {}), createdAt: clamp(s.createdAt, 0, Number.MAX_SAFE_INTEGER, 0), updatedAt: clamp(s.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0) }
}

interface LiveState {
  isLive: boolean
  liveVerse: VerseRenderData | null
  sources: LiveSources
  themes: BroadcastTheme[]
  /** The service timer for clock layers; absent or null: not set. */
  clock?: SceneClock | null
  /** Wall-clock ms for "count down to a time" (default: now). */
  now?: number
}

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
export function layerContent(s: LiveState, output: Pick<BroadcastOutput, "themeId" | "themeFor" | "language">, layer: SceneLayer): { verse: VerseRenderData | null; theme: BroadcastTheme | undefined } {
  const shown = layer.held !== undefined && layer.held !== null ? layer.held : feedFrame(s, layer.shows)
  const themeId = layer.themeId ?? themeIdFor(output, shown?.content)
  const theme = s.themes.find((t) => t.id === themeId) ?? s.themes.find((t) => t.id === output.themeId) ?? s.themes[0]
  return { verse: shown ? forOutputLanguage(shown, output.language) : null, theme }
}

/**
 * The frame an output draws for a scene. `preview` adds labels for what the composer shows but an
 * output never draws (a camera that is not connected yet).
 */
export function sceneFrame(s: LiveState, output: Pick<BroadcastOutput, "themeId" | "themeFor" | "language">, scene: Scene, preview = false): SceneFrame {
  return {
    sceneId: scene.id,
    background: scene.background,
    ...(scene.fadeMs ? { fadeMs: scene.fadeMs } : {}),
    layers: scene.layers.filter((l) => l.visible).map((l) => {
      const base = { id: l.id, kind: l.kind, box: l.box, crop: l.crop, opacity: l.opacity }
      if (l.kind === "feed") return { ...base, ...layerContent(s, output, l) }
      if (l.kind === "color") return { ...base, color: l.color ?? "#000000" }
      if (l.kind === "picture") return { ...base, imageUrl: l.imageUrl ?? null, ...(preview && !l.imageUrl ? { label: "Choose a picture" } : {}) }
      if (l.kind === "clock") {
        const theme = s.themes.find((t) => t.id === (l.themeId ?? output.themeId)) ?? s.themes[0]
        const clock = l.clockShows === "time" ? { mode: "time" as const, at: 0, text: "" } : l.clockShows === "until" ? untilClock(l.until, s.now ?? Date.now()) : (s.clock ?? null)
        return { ...base, theme, clock, ...(preview && !clock ? { label: l.clockShows === "until" ? `${l.name} · choose the time to count down to` : `${l.name} · set the service timer in Present` } : {}) }
      }
      return { ...base, ...(preview ? { label: `${l.name} · cameras are planned (#209)` } : {}) }
    }),
  }
}
