import type { ContentType, FeedSourceKind } from "@/types/broadcast"

/** How each kind of content is named in settings. */
export const CONTENT_NAMES: Record<ContentType, string> = { bible: "Bible", song: "Songs", hymn: "Hymns", slide: "Slides", picture: "Pictures" }

/** What an output can follow, by name ("What this output follows"). */
export const FEED_NAMES: Record<FeedSourceKind, string> = { ...CONTENT_NAMES, ticker: "Ticker" }

/** A live source's name by its id in the Live State ("bible", "ticker", "camera:pulpit"…). */
export function sourceName(id: string): string {
  if (id in CONTENT_NAMES) return CONTENT_NAMES[id as ContentType]
  if (id.startsWith("camera:")) return "Camera"
  return ({ quick: "Quick screen", ticker: "Ticker", timer: "Timer" } as Record<string, string>)[id] ?? id
}
