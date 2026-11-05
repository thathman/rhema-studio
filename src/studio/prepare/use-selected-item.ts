import { useBibleStore, useQueueStore } from "@/stores"
import { useRundownSelection } from "@/studio/prepare/rundown-selection"
import { isCueItem, isImageItem, isSlideItem, isSongItem, type QueueItem } from "@/types"

/**
 * The rundown item Prepare is editing (#447, owner decision 5 Nov 2026): Prepare's own focus,
 * planning state only. Before anything is focused it shows what Live's Preview has, so Prepare
 * opens on something; focusing never changes Live's Preview or Program.
 */
export function useSelectedItem(): { item: QueueItem; index: number } | null {
  const items = useQueueStore((s) => s.items)
  const focusId = useRundownSelection((s) => s.focusId)
  const preview = usePreviewItem()
  if (focusId) {
    const index = items.findIndex((item) => item.id === focusId)
    if (index !== -1) return { item: items[index], index }
  }
  return preview
}

/** The rundown item Live's Preview holds (what Take sends): Live's cue state, never Prepare's focus. */
export function usePreviewItem(): { item: QueueItem; index: number } | null {
  const items = useQueueStore((s) => s.items)
  const selected = useBibleStore((s) => s.selectedVerse)
  const selectedSlide = useBibleStore((s) => s.selectedSlide)
  const selectedQueueItemId = useBibleStore((s) => s.selectedQueueItemId)
  const selectedIndex = selectedQueueItemId ? items.findIndex((item) => item.id === selectedQueueItemId) : -1
  const index = selectedQueueItemId ? selectedIndex : items.findIndex((item) =>
    isSongItem(item) || isSlideItem(item) || isImageItem(item) || item.kind === "audio" || isCueItem(item)
      ? selectedSlide?.item.id === item.id
      : !!selected && !selectedSlide && selected.book_number === item.verse.book_number && selected.chapter === item.verse.chapter && selected.verse === item.verse.verse,
  )
  return index === -1 ? null : { item: items[index], index }
}
