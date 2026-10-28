import { useBibleStore } from "@/stores"
import { isSongItem } from "@/types"

/** What is in Preview, in words: what Take live will put up. Null when Preview is empty. */
export function usePreviewLabel(): string | null {
  return useBibleStore((s) => {
    if (s.selectedSlide) {
      const { item, index } = s.selectedSlide
      return isSongItem(item) ? `${item.reference} · slide ${index + 1}` : item.reference
    }
    const v = s.selectedVerse
    return v ? `${v.book_name} ${v.chapter}:${v.verse}`.trim() : null
  })
}
