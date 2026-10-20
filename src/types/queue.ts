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
