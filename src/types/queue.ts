import type { Verse } from "./bible"

export interface QueueItem {
  id: string
  /** Rundown item kind. Absent means "verse" (the only kind today). */
  kind?: "verse"
  verse: Verse
  reference: string
  confidence: number
  source: "manual" | "ai-direct" | "ai-semantic" | "ai-cloud"
  added_at: number
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
  notes?: string | null
}
