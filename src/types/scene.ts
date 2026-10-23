import type { BroadcastTheme, ContentType, VerseRenderData } from "./broadcast"

/** A place in the frame, in % of its width and height (x/y = top-left). */
export interface SceneBox {
  x: number
  y: number
  w: number
  h: number
}

/** What is cut from each edge of a layer's own frame, in %. */
export interface SceneCrop {
  l: number
  t: number
  r: number
  b: number
}

/**
 * feed: live content (the sources it follows) in an approved look; color and picture: a
 * background; camera: a camera input (placeholder until cameras arrive, issue #209); clock: the
 * service timer in a look (a countdown before the service).
 */
export type SceneLayerKind = "feed" | "color" | "picture" | "camera" | "clock"

/**
 * A clock as an output draws it: counting down to `at`, up from `at` (wall-clock ms), or still at
 * `text` (paused or not started). The output works out the time itself, so frames are sent only
 * when the timer starts, stops or changes.
 */
export interface SceneClock {
  /** time: the time of day (no `at`). */
  mode: "down" | "up" | "still" | "time"
  at: number
  text: string
}

export interface SceneLayer {
  id: string
  name: string
  kind: SceneLayerKind
  /** feed: the live sources it follows; absent = whatever is put on air (the program). */
  shows?: ContentType[]
  /** clock: what it shows: the service timer (absent), the time of day, or a countdown to `until`. */
  clockShows?: "timer" | "time" | "until"
  /** clock "until": the time of day counted down to, "HH:MM" (e.g. the service start). */
  until?: string
  /** feed, clock: the look (an approved theme); absent = the output's own looks. */
  themeId?: string
  /** color: the fill. */
  color?: string
  /** picture: a library picture, and its picture as a data URL (so outputs need nothing else). */
  mediaId?: string
  imageUrl?: string
  box: SceneBox
  crop?: SceneCrop
  /** 0–1 */
  opacity: number
  visible: boolean
  /** Hold: this layer keeps a copy of what was live instead of following (ADR 0001). */
  held?: VerseRenderData | null
}

/** A congregation scene (ADR 0001, ARCH-002): layers placed on one frame, bottom first. */
export interface Scene {
  id: string
  name: string
  /** "transparent" or a colour. */
  background: string
  layers: SceneLayer[]
  /** How it comes on air when taken (and goes when released): a cut, or a cross-fade of this many ms. Absent: a cut. */
  fadeMs?: number
  createdAt: number
  updatedAt: number
}

/** One layer as an output draws it. */
export interface SceneLayerFrame {
  id: string
  kind: SceneLayerKind
  box: SceneBox
  crop?: SceneCrop
  opacity: number
  theme?: BroadcastTheme
  verse?: VerseRenderData | null
  color?: string
  imageUrl?: string | null
  clock?: SceneClock | null
  /** Shown in the composer's preview only (e.g. "Camera — planned"). */
  label?: string
}

/** A scene as an output draws it. */
export interface SceneFrame {
  sceneId: string
  background: string
  layers: SceneLayerFrame[]
  /** Cross-fade to and from this scene, in ms (0 or absent: cut). */
  fadeMs?: number
}
