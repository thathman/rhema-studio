import type { Verse } from "./bible"

interface QueueItemBase {
  id: string
  /** Display label: "John 3:16" or the song title. */
  reference: string
  confidence: number
  source: "manual" | "ai-direct" | "ai-semantic" | "ai-cloud"
  added_at: number
  notes?: string | null
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

export type QueueItem = VerseQueueItem | SongQueueItem | SlideQueueItem

export function isVerseItem(item: QueueItem): item is VerseQueueItem {
  return item.kind === undefined || item.kind === "verse"
}

export function isSongItem(item: QueueItem): item is SongQueueItem {
  return item.kind === "song"
}

export function isSlideItem(item: QueueItem): item is SlideQueueItem {
  return item.kind === "slide"
}
