import type { NdiAlphaMode, NdiFrameRate, NdiResolution } from "./ndi"

export type BroadcastOutputType = "display" | "ndi"

/**
 * What an output is for. Absent means `congregation` (every output saved
 * before roles existed). A `stage` output shows the worship team what is
 * live, what is next, the operator's note and the timer instead of the
 * themed frame.
 */
export type BroadcastOutputRole = "congregation" | "stage" | "signage"

/** A name/title band kept on screen until the operator hides it; Next, Clear and new presents leave it alone. */
export interface LowerThird {
  line1: string
  line2: string
}

/** A `signage` output: pictures on a loop, independent of what is live in the sanctuary. */
export interface SignageSettings {
  /** Media ids of pictures, in order. */
  mediaIds: string[]
  /** Seconds each picture stays. */
  seconds: number
  /** When the loop runs; absent means always. Outside the window the screen shows the theme background. */
  schedule?: SignageSchedule
  /**
   * Several loops with their own times (SG-002). When present, the first
   * playlist whose schedule matches runs; one without a schedule is the
   * fallback. `mediaIds`/`seconds`/`schedule` above mirror the first playlist
   * for older readers.
   */
  playlists?: SignagePlaylist[]
}

export interface SignagePlaylist {
  name: string
  mediaIds: string[]
  seconds: number
  schedule?: SignageSchedule
}

export interface SignageSchedule {
  /** Days of the week, 0 = Sunday … 6 = Saturday. Empty means every day. */
  days: number[]
  /** "HH:MM" local time, inclusive start. */
  from: string
  /** "HH:MM" local time, exclusive end; earlier than `from` means the window crosses midnight. */
  to: string
}

/**
 * Which language(s) of a bilingual frame a congregation output shows. Absent
 * means `both`. "second" falls back to the frame as prepared when there is
 * no second language.
 */
export type BroadcastOutputLanguage = "both" | "first" | "second"

/** What a stage output is sent on every change. Plain text only. */
export interface StagePayload {
  current: { title: string; lines: string[] } | null
  next: string | null
  note: string | null
  timer: { label: string; tone: "ok" | "warn" | "over" } | null
  /** A private message from the operator ("wrap up", "mic 2 is off"). */
  message: string | null
  /** "Key G · 72 bpm" for the live song, when known. */
  band: string | null
}

export interface BroadcastOutputNdiSettings {
  sourceName: string
  resolution: NdiResolution
  frameRate: NdiFrameRate
  alphaMode: NdiAlphaMode
}

/**
 * Persisted configuration for one broadcast output. Whether the output is
 * currently on air (window open / NDI sender running) is runtime state,
 * reconciled from the OS — never persisted.
 */
export interface BroadcastOutput {
  /** "main" for the default output; crypto.randomUUID() otherwise. */
  id: string
  name: string
  type: BroadcastOutputType
  role?: BroadcastOutputRole
  language?: BroadcastOutputLanguage
  /** Show the operator's lower third (name / title band) on this output, over whatever else it shows. */
  lowerThirds?: boolean
  signage?: SignageSettings
  themeId: string
  /** Kept even while type === "ndi" so switching types is lossless. */
  monitorIndex: number
  ndi: BroadcastOutputNdiSettings
}

/** Runtime on-air state for an output, reconciled from the OS. */
export interface BroadcastOutputStatus {
  previewOpen: boolean
  ndiActive: boolean
  /** Set while the NDI sender keeps failing to push frames; cleared on the next success. */
  ndiError?: string | null
  /** Receivers (OBS, another PC) connected to the NDI sender right now; null when unknown. */
  ndiReceivers?: number | null
}

/** The default output: always present, editable, never deletable. */
export const MAIN_OUTPUT_ID = "main"

export const outputWindowLabel = (id: string) => `broadcast-${id}`

export const defaultNdiSettings = (sourceName = "Rhema"): BroadcastOutputNdiSettings => ({
  sourceName,
  resolution: "r1080p",
  frameRate: "fps24",
  alphaMode: "straightAlpha",
})
