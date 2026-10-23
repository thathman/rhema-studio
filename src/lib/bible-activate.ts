import { presentVerse, type PresentOutcome } from "@/hooks/use-broadcast"
import { sourceOf } from "@/lib/live-sources"
import { parseTypedReference } from "@/lib/quick-search"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"

/**
 * One rule for every Bible activation that is not the operator's own Show Live (ADR 0001, C11):
 * while a song, hymn, slide or quick screen is on the main screens, the verse goes to the feeds
 * that follow Bible and waits in the preview; otherwise it is shown on the main screens too.
 * Auto (heard verses), the remote and a joined Bible operator all use it.
 */
export function bibleScope(): { sourceOnly?: boolean } {
  const { isLive, liveVerse } = useBroadcastStore.getState()
  return isLive && liveVerse && sourceOf(liveVerse) !== "bible" ? { sourceOnly: true } : {}
}

/** A typed reference ("Romans 8:28", "jn 3 16") activated on the Bible source; null when it is not a reference. */
export async function activateBibleReference(reference: string): Promise<PresentOutcome | null> {
  const ref = parseTypedReference(reference, useBibleStore.getState().books)
  if (!ref) return null
  const verse = { id: 0, translation_id: useBibleStore.getState().activeTranslationId ?? 1, book_number: ref.book.book_number, book_name: ref.book.name, book_abbreviation: ref.book.abbreviation ?? "", chapter: ref.chapter, verse: ref.verse, text: "" }
  const scope = bibleScope()
  return presentVerse(verse, scope.sourceOnly ? scope : { goLive: true })
}
