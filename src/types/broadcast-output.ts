import type { ContentType } from "./broadcast"
import type { NdiAlphaMode, NdiFrameRate, NdiResolution } from "./ndi"

/** display: a window on a monitor; ndi: an NDI sender; browser: a web page on the church network (OBS Browser Source, a TV's browser). */
export type BroadcastOutputType = "display" | "ndi" | "browser"

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
  /** How it looks (resolved when shown, so an output draws it without looking anything up). */
  style?: LowerThirdStyle
  /** The style's picture or video behind the band, as a URL the output can load. */
  backing?: { kind: "picture" | "video"; url: string } | null
  /** A strip that follows what is live: the verse on screen (and its reference), or the lyric lines (and the song). */
  follow?: "scripture" | "lyrics"
  /** When it was shown (ms), for its entrance. */
  shownAt?: number
}

/** How the news ticker looks and moves. One for the church, saved with the themes. */
export interface TickerStyle {
  /** Along the top or the bottom of the frame. */
  position: "top" | "bottom"
  /** Band height as a % of the frame height. */
  height: number
  /** How fast the words move, in pixels a second on a 1080-line frame. */
  speed: number
  /** null = the theme's verse font. */
  fontFamily: string | null
  /** Words size as a % of the band height. */
  size: number
  color: string
  weight: number
  background: { kind: "color" | "picture" | "video"; color: string; opacity: number; mediaId: string | null }
  /** A fixed tag at the start of the band ("NEWS"); empty for none. */
  label: string
  labelColor: string
  labelBackground: string
  /** Between items. */
  separator: string
  /** Which way the words move: toward the left (the usual crawl) or toward the right. */
  direction: "left" | "right"
  /** Crawl, or one announcement at a time without movement (for people who find motion hard). */
  motion: "crawl" | "pages"
  /** Pages: seconds each announcement stays. */
  pageSeconds: number
}

/** A saved set of announcements to load into the ticker. */
export interface TickerPreset {
  id: string
  name: string
  items: string[]
}

/** The ticker on air: what crawls, since when, in which look. */
export interface Ticker {
  items: string[]
  style: TickerStyle
  /** When it started (ms); the crawl's position comes from the time since. */
  startedAt: number
  /** Paused at this time (ms): the words hold still until resumed. */
  pausedAt?: number
  backing?: { kind: "picture" | "video"; url: string } | null
}

/** A designed look for the lower third (name and title band), chosen when it is shown. */
export interface LowerThirdStyle {
  id: string
  name: string
  /** Where the band sits across the frame. */
  align: "left" | "center" | "right"
  /** Gap from the side (left/right) as a % of the frame width. */
  margin: number
  /** Gap from the bottom edge as a % of the frame height. */
  bottom: number
  /** Band width as a % of the frame width; 0 = as wide as the words. */
  width: number
  /** Band height as a % of the frame height. */
  height: number
  /** null = the theme's verse font. */
  fontFamily: string | null
  line1: { size: number; color: string; weight: number; uppercase: boolean }
  line2: { size: number; color: string; weight: number }
  background: { kind: "color" | "picture" | "video" | "none"; color: string; opacity: number; mediaId: string | null }
  /** Corner radius as a % of the band height. */
  radius: number
  accent: { enabled: boolean; color: string; width: number }
  /** How it comes on screen. */
  animation: "none" | "fade" | "slide"
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
  /** When the service is now expected to end, from the run of show's timing (issue #196). */
  finish?: StageFinish | null
  /** Auxiliary timers the operator shows on the stage ("Communion prep 3:12"). */
  aux?: StageAux[]
  /** How the church designed the stage display (Design → Stage); built-in look when absent. */
  style?: StageStyle
}

export interface StageAux {
  label: string
  /** "3:12", "−0:45" once over. */
  text: string
  tone: "ok" | "warn" | "over"
}

export interface StageFinish {
  /** "10:42" */
  time: string
  /** Expected minus planned end, whole minutes: positive when late. */
  lateMin: number
}

/** The stage display's design (DS-004): colours, the live words' size, which parts show. */
export interface StageStyle {
  background: string
  /** The live words' colour. */
  words: string
  /** Multiplies the live words' fitted size: 0.7 to 1.6. */
  wordsScale: number
  showTimer: boolean
  showNext: boolean
  showNote: boolean
  showBand: boolean
  /** When the service is expected to end. */
  showFinish: boolean
  /** A message on the stage as the timer reaches this many minutes left (0: none), #196 R6. */
  warnAtMinutes: number
  /** A message on the stage as the timer's time is up. */
  warnWhenOver: boolean
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
  /**
   * The live sources this output follows (ADR 0001), e.g. ["bible"] for a Bible lower-third feed.
   * Absent: whatever was put on air last, as before.
   */
  shows?: ContentType[]
  /** The congregation scene this output shows (its program, ADR 0001); absent: its own feed, full frame. */
  sceneId?: string
  /** Browser feeds: the secret in the feed's link (renewing it closes the old link). */
  feedToken?: string
  signage?: SignageSettings
  themeId: string
  /**
   * A different theme for some kinds of content on this output (hymns in gold,
   * the Bible in blue…); a kind not listed uses `themeId`.
   */
  themeFor?: Partial<Record<ContentType, string>>
  /** Shows the news ticker when one is running. */
  ticker?: boolean
  /** A display output opens as a window the operator can move and resize, not full screen (signage on the operator's own screen). */
  windowed?: boolean
  /** Kept even while type === "ndi" so switching types is lossless. */
  monitorIndex: number
  /**
   * The monitor's name when it was chosen. The OS list renumbers when a monitor
   * is unplugged, so the name finds the same screen again (resolveMonitorIndex).
   */
  monitorName?: string | null
  ndi: BroadcastOutputNdiSettings
  /** Browser feeds: the Google TVs Rhema sent this feed to (Show on a Google TV), to check on them in Show health (#213). */
  tvs?: ReceiverTv[]
}

/** A Google TV running Rhema Receiver that was sent a feed: its name and the address on its screen. */
export interface ReceiverTv {
  name: string
  address: string
  /** When it was sent (wall-clock ms). */
  sentAt: number
}

/** Runtime on-air state for an output, reconciled from the OS. */
export interface BroadcastOutputStatus {
  previewOpen: boolean
  ndiActive: boolean
  /** Set while the NDI sender keeps failing to push frames; cleared on the next success. */
  ndiError?: string | null
  /** Receivers (OBS, another PC) connected to the NDI sender right now; null when unknown. */
  ndiReceivers?: number | null
  /** Browser feeds: publishing to the feed page. */
  feedActive?: boolean
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
