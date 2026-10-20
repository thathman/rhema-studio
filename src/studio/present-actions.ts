import { presentQueueItem, remoteActions } from "@/lib/remote-actions"
import { bibleActions } from "@/hooks/use-bible"
import { isMissing, resolveTranslations } from "@/lib/translation-policy"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useBibleStore } from "@/stores/bible-store"
import { isSlideItem, isSongItem, type QueueItem, type SongQueueItem } from "@/types"
import { useSongStore } from "@/stores/song-store"

/**
 * The Standard view's verb set. Thin wrappers over `remoteActions` so the big
 * buttons, the keyboard, the rundown and OSC/HTTP all do the same thing.
 *
 * Next/Previous/Show live are deliberate operator verbs: the output goes on
 * air together with the verse, never before it. Clear takes it off air but
 * keeps the last item for Restore.
 */
export const presentActions = {
  next: () => remoteActions.queueNext(),
  prev: () => remoteActions.queuePrev(),
  /** Present whatever is in Preview, in the translation the preview shows. */
  showLive: () => remoteActions.sendToLive(),
  /** Present one rundown item (double-click in the rundown). */
  presentItem: (index: number) => void presentQueueItem(index),
  /**
   * Put a rundown item in Preview in the translation it will go live in. An
   * item that follows the active translation also moves the Bible panel; a
   * pinned one only selects, because navigating would reselect the verse in
   * the active translation and the preview would stop matching live.
   */
  previewItem: (item: QueueItem) => {
    if (isSlideItem(item)) {
      useBibleStore.getState().selectSlide({ item, index: 0 })
      return
    }
    if (isSongItem(item)) {
      presentActions.previewSlide(item, 0)
      return
    }
    const choice = resolveTranslations(item, useBibleStore.getState())
    const { book_number, chapter, verse } = item.verse
    if (isMissing(choice) || choice.source !== "item") {
      bibleActions.selectVerse(item.verse)
      bibleActions.navigateToVerse(book_number, chapter, verse)
      return
    }
    bibleActions.selectVerse({ ...item.verse, translation_id: choice.primary })
    void bibleActions
      .fetchVerse(book_number, chapter, verse, choice.primary)
      .then((fresh) => {
        const still = useBibleStore.getState().selectedVerse
        if (fresh?.text && still && still.book_number === book_number && still.chapter === chapter && still.verse === verse) {
          bibleActions.selectVerse(fresh)
        }
      })
      .catch(() => {})
  },
  /** Put one slide of a song item in Preview; the song loads if it is not cached yet. */
  previewSlide: (item: SongQueueItem, index: number) => {
    useBibleStore.getState().selectSlide({ item, index })
    void useSongStore.getState().load(item.song.song_id).catch(() => {})
  },
  clear: () => remoteActions.toggleOnAir(false),
  restore: () => {
    if (presentActions.canRestore()) remoteActions.toggleOnAir(true)
  },
  canRestore: () => {
    const s = useBroadcastStore.getState()
    return !s.isLive && s.liveVerse !== null
  },
}
