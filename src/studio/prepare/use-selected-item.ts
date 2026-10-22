import { useBibleStore, useQueueStore } from "@/stores"
import { isImageItem, isSlideItem, isSongItem, type QueueItem } from "@/types"

/** The rundown item Prepare's selection points at (a click previews it; nothing goes live). */
export function useSelectedItem(): { item: QueueItem; index: number } | null {
  const items = useQueueStore((s) => s.items)
  const selected = useBibleStore((s) => s.selectedVerse)
  const selectedSlide = useBibleStore((s) => s.selectedSlide)
  const index = items.findIndex((item) =>
    isSongItem(item) || isSlideItem(item) || isImageItem(item)
      ? selectedSlide?.item.id === item.id
      : !!selected && !selectedSlide && selected.book_number === item.verse.book_number && selected.chapter === item.verse.chapter && selected.verse === item.verse.verse,
  )
  return index === -1 ? null : { item: items[index], index }
}
