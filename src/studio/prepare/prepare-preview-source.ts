import { useEffect, useState } from "react"
import { bibleActions } from "@/hooks/use-bible"
import { resolveTranslations, isMissing } from "@/lib/translation-policy"
import { useBibleStore } from "@/stores"
import { isVerseItem, type QueueItem, type Verse } from "@/types"
import type { PreviewSource } from "@/components/panels/preview-panel"

/**
 * What Prepare's own preview shows for the item it is editing (#447): built here, never written to
 * Live's Preview. A verse is shown in the translation it will go live in (pinned, or the active one),
 * as Send to Live Preview would show it.
 */
export function usePrepareSource(item: QueueItem | null, slideIndex = 0): PreviewSource {
  // A number, not the resolution object: a fresh object per read would re-render forever.
  const primary = useBibleStore((s) => {
    if (!item || !isVerseItem(item)) return null
    const choice = resolveTranslations(item, s)
    return isMissing(choice) ? null : choice.primary
  })
  const [fetched, setFetched] = useState<{ key: string; verse: Verse } | null>(null)
  const key = item && isVerseItem(item) && primary !== null ? `${item.id}:${item.verse.book_number}:${item.verse.chapter}:${item.verse.verse}:${primary}` : null
  useEffect(() => {
    if (!key || !item || !isVerseItem(item) || primary === null || item.verse.translation_id === primary) return
    let cancelled = false
    const { book_number, chapter, verse } = item.verse
    void bibleActions.fetchVerse(book_number, chapter, verse, primary).then((v) => {
      if (!cancelled && v?.text && v.translation_id === primary) setFetched({ key, verse: v })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [key, item, primary])
  if (!item) return { item: null, slide: null, verse: null, queueItemId: null }
  if (!isVerseItem(item)) return { item, slide: { item, index: slideIndex }, verse: null, queueItemId: item.id }
  const verse = fetched && fetched.key === key ? fetched.verse : item.verse
  return { item, slide: null, verse, queueItemId: item.id }
}
