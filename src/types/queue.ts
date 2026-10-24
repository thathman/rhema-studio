import type { Verse } from "./bible"

interface QueueItemBase {
  id: string
  /** Display label: "John 3:16" or the song title. */
  reference: string
  confidence: number
  source: "manual" | "ai-direct" | "ai-semantic" | "ai-cloud"
  added_at: number
  notes?: string | null
  /** A library picture drawn behind this item's text (MD-003). */
  background?: { media_id: string; name: string } | null
  /** How long this item is planned to take, for service timing (PT-002). */
  planned_minutes?: number | null
  /** A clock time this item should finish by, 24-hour "HH:MM" (FR-07). */
  end_by?: string | null
  /** A fixed start, 24-hour "HH:MM" (#196 R3): it is expected then, however early or late what is before runs. Absent: it follows the item before. */
  starts_at?: string | null
  /** A planned pause before it, in minutes (#196 R3); lateness before it uses this up first. */
  gap_minutes?: number | null
  /** Its timing rules beyond the plan (#196 R1.2): a milestone, a soft end, its own warning. Absent: none. */
  timing?: ItemTiming | null
  /**
   * Who is preparing this item (CL-007), as one short line. Older builds read and edit only this;
   * this build keeps it as the names in `assignees` joined ("Tolu, Ade").
   */
  prepared_by?: string | null
  /** The people preparing or responsible for this item (#299 6.10), short names. Empty: see `prepared_by`. */
  assignees?: string[] | null
  /** Team comments on this item (CL-007); saved with the service and carried in service files. Never on screen. */
  comments?: ItemComment[] | null
  /** What happens as it goes live (issue #193): a stage-only message, one cue that never changes the screen. */
  on_live?: OnLive | null
  /** Moves on to the next item of its phase after its planned minutes, while timed moves are on in Present (issue #193). */
  auto_advance?: boolean | null
  /**
   * How this item is meant to look (#299 6.6, #243 RS.3): a congregation scene, a look and a camera
   * on the church network, by id (a look is a theme id, a camera its name in the camera router).
   * Hints for Present's Preview only: none of them is taken by itself.
   */
  scene_id?: string | null
  look_id?: string | null
  camera?: string | null
  /** What the operator's own Take of this item also does (#243 RS.4, OB.2); see `TakeStep`. */
  on_take?: TakeStep[] | null
  /** Payload fields this build does not edit (from a newer version or a service file), written back unchanged (FR-03). */
  payload_extra?: Record<string, unknown>
}

export interface VerseQueueItem extends QueueItemBase {
  /** Absent means "verse". */
  kind?: "verse"
  verse: Verse
  /** True when queued from a chapter-only detection (verse defaults to 1, may be refined). */
  is_chapter_only?: boolean
  /**
   * Saved-service metadata, carried so a save never overwrites what the
   * service intended. `undefined` = never saved (captured from the
   * translation the item was added with). `null` = saved as "follow the
   * active translation". A string is a pinned translation abbreviation.
   */
  translation?: string | null
  secondary_translation?: string | null
}

/** What a song item in the rundown needs to present without the editor. */
export interface SongQueueRef {
  song_id: string
  title: string
  /** null = the song's default arrangement. */
  arrangement_id: string | null
  /** Language tags to show, first is primary; empty = the song's primary language. */
  languages: string[]
}

export interface SongQueueItem extends QueueItemBase {
  kind: "song"
  song: SongQueueRef
  verse?: undefined
}

/** An announcement or any free-text screen: one slide, no library behind it. */
export interface CustomSlide {
  title: string
  /** Plain text; each line is drawn on its own line. */
  body: string
  /** A safe http(s) link shown as a QR code with the text beside it (SG-003). */
  link?: string
}

export interface SlideQueueItem extends QueueItemBase {
  kind: "slide"
  slide: CustomSlide
  verse?: undefined
}

/** A picture from the media library, shown full screen. */
export interface ImageQueueRef {
  media_id: string
  name: string
  fit: "cover" | "contain" | "stretch"
  /** Video assets only: start again at the end (default: hold the last frame). */
  loop?: boolean
  /** Video assets only: play the sound on the main output (default: yes). */
  sound?: boolean
}

export interface ImageQueueItem extends QueueItemBase {
  kind: "image"
  image: ImageQueueRef
  verse?: undefined
}

export type QueueItem = VerseQueueItem | SongQueueItem | SlideQueueItem | ImageQueueItem

export function isVerseItem(item: QueueItem): item is VerseQueueItem {
  return item.kind === undefined || item.kind === "verse"
}

export function isSongItem(item: QueueItem): item is SongQueueItem {
  return item.kind === "song"
}

export function isSlideItem(item: QueueItem): item is SlideQueueItem {
  return item.kind === "slide"
}

export function isImageItem(item: QueueItem): item is ImageQueueItem {
  return item.kind === "image"
}

/**
 * An item's timing rules (#196 R1.2). `milestone`: a moment, not a stretch of time (it takes no
 * minutes; "Livestream begins"). `soft_end_minutes`: its planned minutes are the aim, and it may run
 * to this many before it counts as over. `warn_minutes`: how long before its end its timer turns
 * amber and the stage warns (otherwise 2 minutes, and the stage look's own warning).
 */
export interface ItemTiming {
  milestone?: boolean
  soft_end_minutes?: number
  warn_minutes?: number
}

/** One team comment on a rundown item (CL-007). `at` is an ISO time. */
export interface ItemComment {
  by: string
  at: string
  text: string
}

/** Cues an item may run as it goes live: none changes what the congregation sees. */
export const GO_LIVE_CUES = ["timer.start", "timer.fresh", "timer.pause", "stage.clearMessage"] as const
export type GoLiveCue = (typeof GO_LIVE_CUES)[number]

export interface OnLive {
  /** Shown on stage outputs only. One line, at most 120 characters. */
  stage_message?: string
  cue?: GoLiveCue
}

/**
 * A step armed on an item for the operator's own Take of it (#243 RS.4, OB.2), never run by a timed
 * move or a phase that runs by itself, and never putting anything live by itself:
 * "scene.take:<scene id>" arranges every congregation screen as the scene ("…@<output id>": one
 * screen); "obs.scene:<OBS scene name>" puts the scene in OBS's preview in Studio Mode, or switches
 * OBS to it otherwise (never in rehearsal); "source.only" sends a reading to the Bible feeds only,
 * and the main screens keep what they show.
 */
export type TakeStep = `scene.take:${string}` | `obs.scene:${string}` | "source.only"
