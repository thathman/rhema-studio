import { approvalHolds } from "@/stores/approval-gate-store"
import { presentQueueItem, remoteActions } from "@/lib/remote-actions"
import { bibleActions } from "@/hooks/use-bible"
import { isMissing, resolveTranslations } from "@/lib/translation-policy"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useBibleStore } from "@/stores/bible-store"
import { isCueItem, isImageItem, isSlideItem, isSongItem, type QueueItem, type SongQueueItem, type SongWithSections } from "@/types"
import { presentQuickScreen, type QuickScreen } from "@/hooks/use-broadcast"
import { useSongStore } from "@/stores/song-store"
import { lowerThirdBacking } from "@/lib/lower-third-backing"

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
    // A cue-only moment previews as what it will do (#193): nothing on the screens.
    if (isSlideItem(item) || isImageItem(item) || isCueItem(item)) {
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
  previewSlide: (item: SongQueueItem, index: number, song?: SongWithSections) => {
    useBibleStore.getState().selectSlide({ item, index, ...(song ? { song } : {}) })
    if (!song) void useSongStore.getState().load(item.song.song_id).catch(() => {})
  },
  /** Continue a reading: the verse after/before the live one, same translations. */
  verseNext: () => remoteActions.verseNext(),
  versePrev: () => remoteActions.versePrev(),
  /** Welcome / Please stand / Let us pray / Offering, on air at once. */
  quickScreen: (screen: QuickScreen) => presentQuickScreen(screen),
  /** Return to what was live before the quick screen. */
  back: () => {
    const b = useBroadcastStore.getState()
    const held = b.heldLive
    // Back puts the held content on air: a go-live like any other (CL-002 gate).
    if (held && held.wasLive && b.isLive && !held.liveVerse.screen && !held.liveVerse.quick && approvalHolds(() => presentActions.back())) return
    b.releaseHeld()
  },
  canGoBack: () => useBroadcastStore.getState().heldLive !== null,
  clear: () => remoteActions.toggleOnAir(false),
  restore: () => {
    if (presentActions.canRestore()) remoteActions.toggleOnAir(true)
  },
  /** Take the news ticker with its words, or Stop it when it runs (Shift+T, #187). Nothing without words. */
  ticker: () => {
    const b = useBroadcastStore.getState()
    if (b.ticker) return b.setTicker(null)
    if (!b.tickerItems.some((i) => i.trim())) return
    void lowerThirdBacking(b.tickerStyle).then((backing) => { if (!useBroadcastStore.getState().ticker) useBroadcastStore.getState().setTicker({ backing }) }).catch(() => {})
  },
  canRestore: () => {
    const s = useBroadcastStore.getState()
    return !s.isLive && s.liveVerse !== null
  },
}
