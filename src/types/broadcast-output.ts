import type { ContentType, FeedSourceKind } from "./broadcast"
import type { CountdownTo } from "./scene"
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
  /** The Design → Library look this was copied from (Reset puts it back as that look has it). */
  libraryLookId?: string
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
  /** The Design → Library look this was copied from (Reset puts it back as that look has it). */
  libraryLookId?: string
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
  /** A countdown display (Design → Countdown) shows only this, the message and a few small lines. */
  countdown?: CountdownFrame
}

/**
 * One colour step of the countdown display: from when it comes on (a share of the whole time left,
 * or a time left; 0 is "time's up" and stays through overtime) its colours and message hold until a
 * later step takes over.
 */
export interface CountdownStep {
  /** "percent": `at` is a percentage (0–100) of the whole time; "time": `at` is seconds left. */
  when: "percent" | "time"
  at: number
  background: string
  text: string
  /** Shown under the time while this step is on ("Please wrap up"); empty for none. */
  message: string
  /** A slow, gentle pulse (once a second, never faster) while it is on and the time runs. */
  pulse: boolean
}

/**
 * What the countdown display counts: the service timer, the item on now (its planned minutes from
 * when it started), a named extra timer, a time of day, or the service's start (run of show).
 */
export type CountdownCounts = "timer" | "item" | "aux" | "until" | "start"

/** The countdown display's design (Design → Countdown): one big time, readable from the back. */
export interface CountdownLook {
  counts: CountdownCounts
  /** counts "aux": the extra timer's name (Production → Timekeeper). */
  auxLabel: string
  /** counts "until": the time of day, "HH:MM". */
  until: string
  /** Counting to a time: the percentages are of this many minutes before it. */
  leadMinutes: number
  /** Before any step: the colours it starts in. */
  background: string
  text: string
  steps: CountdownStep[]
  /** The stage message from Present or Timekeeper, under the time. */
  showMessage: boolean
  /** The item on now's name, small. */
  showItem: boolean
  /** The next item's name, small. */
  showNext: boolean
  /** The time of day in a corner. */
  showClock: boolean
}

/**
 * What a countdown display is sent. It counts by itself (one redraw a second), so the host sends
 * it again only when something changes: started, paused, adjusted, another item.
 */
export interface CountdownFrame {
  look: CountdownLook
  /** What it counts, small over the time ("Service timer", "Sermon", "Service starts 10:00"). */
  label: string
  /** The whole time the percentages are of (ms); 0: no length, it counts up. */
  totalMs: number
  /** Running: the instant (the host's clock, ms) it reaches 0:00; counting up, when it began. Held: null. */
  endsAt: number | null
  /** Held (paused or not started): the time left as it stands; counting up, minus the time so far. */
  leftMs: number
  /** Nothing to count, and why ("Start the service timer in Present"). */
  idle?: string
  /** The counted item's own warning (Prepare → Timing), ms before its end: the first step comes on then. */
  warnMs?: number
  item: string | null
  next: string | null
  /** The time zone for the time of day (the church's; "" = the screen's own). */
  zone: string
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
  /** A countdown on the stage to the next item or a milestone (#196 R2); absent: none. */
  countdown?: CountdownTo
  /** The Design → Library look this was copied from (Reset puts it back as that look has it). */
  libraryLookId?: string
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
   * The live sources this output follows (ADR 0001), e.g. ["bible"] for a Bible lower-third feed;
   * "ticker" draws the ticker too (["ticker"] alone: the ticker and no content). Absent: whatever was
   * put on air last, as before.
   */
  shows?: FeedSourceKind[]
  /** A stage output's layout: "countdown" shows the countdown display (Design → Countdown); absent: the full stage view. */
  stageLayout?: "countdown"
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
  /** What a scene's camera box shows on this output while its camera is not sending (#213); absent: the scene's own choice. */
  cameraFallback?: OutputCameraFallback
}

/**
 * One output's own choice for a camera that is not sending (or is hidden, or frozen at the router):
 * colour bars, TV static, words or nothing as a scene's camera layer offers, or another camera.
 */
export interface OutputCameraFallback {
  mode: "bars" | "static" | "words" | "none" | "camera"
  /** "words": what it says. */
  words?: string
  /** "camera": the router's name of the camera shown instead (when that one sends). */
  camera?: string
  /** "bars": the camera's name on the bars. */
  name?: boolean
}

/** A Google TV running Rhema Studio Receiver that was sent a feed: its name and the address on its screen. */
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
