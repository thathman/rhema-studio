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
  /**
   * Its cue list beyond `on_live` (#193, #196 R6): what runs as it starts, when its planned time is
   * up, when it is paused, and when it ends. None changes what the congregation sees. Older builds
   * keep it untouched and run only `on_live`.
   */
  cues?: ItemCue[] | null
  /** Kept in the service, but skipped by Next/Previous and timed runs and not shown in Present (#193). */
  hidden?: boolean | null
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
  /**
   * Words an AI assistant wrote (an AI draft's slide, #252), not yet accepted by a person: the
   * assistant's name. Shown as "AI suggestion" until someone checks the words and accepts it.
   */
  ai_suggestion?: string | null
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
  /** A slide with the song's title (and authors) before its words (#193). */
  title_slide?: boolean
}

export interface SongQueueItem extends QueueItemBase {
  kind: "song"
  song: SongQueueRef
  verse?: undefined
}

/** An announcement or free-text screen. Library-backed items hold a content snapshot plus source identity. */
export interface CustomSlide {
  title: string
  /** Plain text; each line is drawn on its own line. */
  body: string
  /** A safe http(s) link shown as a QR code with the text beside it (SG-003). */
  link?: string
  /** The reusable library source this occurrence was copied from. The content above stays local to this service item. */
  source_asset_id?: string
  source_revision?: number
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

/** A local audio cue. It plays through this computer's audio output and has no screen content. */
export interface AudioQueueRef {
  media_id: string
  name: string
  /** A device id on this computer; absent means the system default output. */
  output_device_id?: string
  /** 0–1; absent means the current Sound control volume. */
  volume?: number
  /** Repeat until another cue or the operator stops it. */
  loop?: boolean
  /** Fade in when the cue starts, in milliseconds. */
  fade_in_ms?: number
  /** Fade out when a later rundown item succeeds, in milliseconds. */
  fade_out_ms?: number
}

export interface AudioQueueItem extends QueueItemBase {
  kind: "audio"
  audio: AudioQueueRef
  verse?: undefined
}

/**
 * A moment in the run of show that shows nothing (#193): taking it fires its cues (an OBS
 * recording chapter, a stage message, the timer) and starts its event; the screens keep what they
 * show. Its `reference` is its name.
 */
export interface CueQueueItem extends QueueItemBase {
  kind: "cue"
  verse?: undefined
}

export type QueueItem = VerseQueueItem | SongQueueItem | SlideQueueItem | ImageQueueItem | AudioQueueItem | CueQueueItem

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

export function isAudioItem(item: QueueItem): item is AudioQueueItem {
  return item.kind === "audio"
}

export function isCueItem(item: QueueItem): item is CueQueueItem {
  return item.kind === "cue"
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
  /** Stable across service copies; older service files receive a deterministic id when read. */
  id?: string
  by: string
  at: string
  text: string
  /** A soft delete is permanent and retained with the service for audit and sync. */
  deleted_by?: string
  deleted_at?: string
}

/** Cues an item may run as it goes live: none changes what the congregation sees. */
export const GO_LIVE_CUES = ["timer.start", "timer.fresh", "timer.pause", "stage.clearMessage"] as const
export type GoLiveCue = (typeof GO_LIVE_CUES)[number]

/** When an item's cue runs (#196 R6): as its event starts, when its planned time is up, when it is paused (a hold or the timer), when it ends. */
export const CUE_TRIGGERS = ["live", "finish", "pause", "end"] as const
export type CueTrigger = (typeof CUE_TRIGGERS)[number]
/** What an item's cue may do: the go-live cues, a stage-only message, an OBS recording marker. Never the screens. */
export const ITEM_CUE_DOES = [...GO_LIVE_CUES, "stage.message", "obs.mark"] as const
export type ItemCueDo = (typeof ITEM_CUE_DOES)[number]

export interface ItemCue {
  on: CueTrigger
  do: ItemCueDo
  /** The stage message, or the marker's name (the item's name when empty). One line, at most 120 characters. */
  text?: string
}

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
