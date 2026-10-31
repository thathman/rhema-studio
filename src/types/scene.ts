import type { BroadcastTheme, ContentType, VerseRenderData } from "./broadcast"
import type { BroadcastOutputLanguage, LowerThird, Ticker } from "./broadcast-output"

/**
 * What a "time until" clock counts down to (#196 R2): the next item's expected start, the main
 * service's expected end, an item's "end by" (`endby:<item id>`), a chosen item's expected start
 * (`start:<item id>`) or a group's expected end (`groupend:<group id>`).
 */
export type CountdownTo = "next" | "end" | `endby:${string}` | `start:${string}` | `groupend:${string}`

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
 * background; video: a library video playing on a loop, without sound (a moving background); camera: a camera on the church network (a WHEP stream, e.g. from MediaMTX; #209); clock: the
 * service timer in a look (a countdown before the service); ticker: the running ticker, in its box;
 * lowerThird: the lower third on air, in its box; logo: the church's Brand Kit logo, fitted in its box.
 * A scene with a ticker (or lower third) layer owns that source on its output: the output does not
 * also draw it over the whole frame.
 */
export type SceneLayerKind = "feed" | "color" | "ellipse" | "picture" | "video" | "camera" | "clock" | "ticker" | "lowerThird" | "logo" | "text"

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

/**
 * What a camera's box shows while the camera is not sending: SMPTE colour bars, TV static, its
 * words (`cameraFallback`), or nothing (the layers below show through).
 */
export type NoSignal = "bars" | "static" | "words" | "none"
export const NO_SIGNALS: readonly NoSignal[] = ["bars", "static", "words", "none"]

export interface SceneLayer {
  id: string
  name: string
  kind: SceneLayerKind
  /** feed: the live sources it follows; absent = whatever is put on air (the program). */
  shows?: ContentType[]
  /** camera: its stream on the church network (WHEP, e.g. http://192.168.1.10:8889/pulpit/whep). */
  cameraUrl?: string
  /** camera: words shown in its box while the camera is not playing (#213 fallback), when `noSignal` is "words". */
  cameraFallback?: string
  /** camera: what its box shows while the camera is not sending; absent = colour bars. */
  noSignal?: NoSignal
  /** camera: the colour bars carry a small ident with the camera's name (absent = no). */
  noSignalName?: boolean
  /** clock: what it shows: the service timer (absent), the time of day, a countdown to `until`, or to the run of show's `countdownTo`. */
  clockShows?: "timer" | "time" | "until" | "countdown"
  /** clock "until": the time of day counted down to, "HH:MM" (e.g. the service start). */
  until?: string
  /** clock "countdown": the next item (absent too) or a milestone of the run of show (#196 R2). */
  countdownTo?: CountdownTo
  /** feed, clock: the look (an approved theme); absent = the output's own looks. */
  themeId?: string
  /** color, ellipse: the solid fill. */
  color?: string
  /** text: literal content (not a live source binding). */
  text?: string
  /** text: font family and size on the 1920×1080 design artboard. */
  fontFamily?: string
  fontSize?: number
  fontWeight?: "400" | "500" | "600" | "700" | "800" | "900"
  fontStyle?: "normal" | "italic"
  textAlign?: "left" | "center" | "right"
  lineHeight?: number
  textColor?: string
  underline?: boolean
  /** picture, video: a library picture or video. A picture also keeps its picture as a data URL (so outputs need nothing else). */
  mediaId?: string
  imageUrl?: string
  /** video: where this computer's output windows play it from (the media folder, streamed). */
  videoUrl?: string
  /** video: its file in the media folder, which a browser feed asks the host for. */
  mediaFile?: string
  /** feed: which language of a bilingual verse or song this layer shows; absent = the output's own setting. */
  language?: BroadcastOutputLanguage
  /** How this layer changes when what it shows changes (a new verse, picture or video): a cut, or a cross-fade of this many ms. Absent: a cut. */
  fadeMs?: number
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
  /** The operator who last saved this reusable design, when known. */
  updatedBy?: string | null
  /** The Design → Library look this was copied from (Reset puts it back as that look has it). */
  libraryLookId?: string
  /** The design version this scene was made from (docs/contracts/design-documents-v1.md, Pinning).
   * Versions never change, so a newer one never alters this scene until it is re-made from it. */
  design?: DesignPin
}

/** One immutable version of a design in the host's design store. */
export interface DesignPin {
  id: string
  version: number
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
  /** text: static words and their version-pinned style, rendered by every subscribed output. */
  text?: string
  fontSize?: number
  fontWeight?: "400" | "500" | "600" | "700" | "800" | "900"
  fontStyle?: "normal" | "italic"
  textAlign?: "left" | "center" | "right"
  lineHeight?: number
  textColor?: string
  underline?: boolean
  imageUrl?: string | null
  /** video: where an output window plays it from. */
  videoUrl?: string
  /** video: its file in the media folder (a browser feed plays it from the host). */
  mediaFile?: string
  /** Cross-fade to new content in this many ms (0 or absent: cut); `key` says when the content is new. */
  fadeMs?: number
  key?: string
  clock?: SceneClock | null
  /** camera: its WHEP stream address. */
  cameraUrl?: string
  /** camera: words for its box while the camera is not playing, in `theme`'s text style (`noSignal` "words"). */
  fallback?: string
  /** camera: what its box shows while the camera is not playing (absent: colour bars). */
  noSignal?: NoSignal
  /** camera: the name the colour bars' ident shows (absent: no ident). */
  ident?: string
  /** camera: the operator's Retry count for it (#213): a new count makes every screen start its reader again. */
  retry?: number
  /** camera: Freeze: screens hold the last frame. */
  hold?: boolean
  /** camera: the router says it is connected but sending nothing: screens show the fallback, not a stale frame. */
  stale?: boolean
  /** ticker: the running ticker (null when none runs). */
  ticker?: Ticker | null
  /** lowerThird: the lower third on air (null when none is up). */
  overlay?: LowerThird | null
  /** ticker, lowerThird: the output's verse font, for a style without its own. */
  fontFamily?: string
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
