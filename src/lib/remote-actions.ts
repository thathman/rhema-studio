import { cancelPendingPresents, presentCustomSlide, presentImage, presentSlide, presentVerse } from "@/hooks/use-broadcast"
import { fetchChapter, stepVerse } from "@/hooks/use-bible"
import { resolveTranslations, isMissing } from "@/lib/translation-policy"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { isImageItem, isSlideItem, isSongItem, isVerseItem } from "@/types"

/**
 * Find the queue index of the item currently on the live output.
 * Returns null when the live content came from somewhere other than the queue.
 */
function findLiveQueueIndex(): number | null {
  const { liveVerse, liveItemId } = useBroadcastStore.getState()
  if (!liveVerse) return null
  const items = useQueueStore.getState().items
  const index = liveItemId
    ? items.findIndex((item) => item.id === liveItemId)
    : items.findIndex((item) => isVerseItem(item) && item.reference === liveVerse.reference)
  return index >= 0 ? index : null
}

/**
 * Present a rundown item and put the output on air in the same update.
 * Verses go live in their saved translations; songs at `slide` (default the
 * first, "last" for stepping backwards into a song).
 * Next/Previous/double-click/OSC/HTTP all come here.
 */
export async function presentQueueItem(index: number, slide: number | "last" = 0): Promise<void> {
  const item = useQueueStore.getState().items[index]
  if (!item) return
  useQueueStore.getState().setActive(index)
  if (isSlideItem(item)) {
    presentCustomSlide(item, { goLive: true })
    return
  }
  if (isImageItem(item)) {
    await presentImage(item, { goLive: true }).catch((e) => console.warn("[remote-actions] presentQueueItem (image) failed:", e))
    return
  }
  if (isSongItem(item)) {
    await presentSlide(item, slide, { goLive: true }).catch((e) =>
      console.warn("[remote-actions] presentQueueItem (song) failed:", e),
    )
    return
  }
  // Navigate the Bible panel to the presented verse, as detections do
  useBibleStore.getState().setPendingNavigation({
    bookNumber: item.verse.book_number,
    chapter: item.verse.chapter,
    verse: item.verse.verse,
  })
  await presentVerse(item.verse, { item, goLive: true, itemId: item.id }).catch((e) =>
    console.warn("[remote-actions] presentQueueItem failed:", e),
  )
}

/**
 * Next/Previous step through a song's slides first, then on to the next
 * item; stepping back into a song lands on its last slide.
 */
function stepQueue(offset: number): void {
  const { items, activeIndex } = useQueueStore.getState()
  if (items.length === 0) return

  const current = activeIndex ?? findLiveQueueIndex()
  const live = useBroadcastStore.getState().liveSlide
  if (current !== null) {
    const item = items[current]
    if (item && isSongItem(item) && live && live.itemId === item.id) {
      const next = live.index + offset
      if (next >= 0 && next < live.total) {
        void presentQueueItem(current, next)
        return
      }
    }
  }
  const target =
    current === null
      ? 0
      : Math.min(Math.max(current + offset, 0), items.length - 1)
  const atEdge = target === current
  const song = items[target] && isSongItem(items[target])
  // At the edge a song stays on its slide (re-presents it, e.g. after Clear);
  // a verse re-presents too. Entering a song from below starts at its last slide.
  void presentQueueItem(target, song ? (atEdge ? (live?.index ?? 0) : offset < 0 ? "last" : 0) : 0)
}

// Chapter-crossing ticket: a slow lookup must not land after a newer step.
let verseStepSeq = 0

/**
 * Continue a reading: present the verse after (or before) the one on the
 * live output, in the same translations, on air in one step. Crosses
 * chapter boundaries; stops at the ends of a book. With nothing live it
 * steps the Bible panel instead (the preview), like the panel's arrows.
 */
export async function stepLiveVerse(offset: 1 | -1): Promise<void> {
  const { liveSourceVerse: source, liveItem } = useBroadcastStore.getState()
  if (!source) {
    await stepVerse(offset === 1 ? "next" : "prev", { present: true })
    return
  }
  verseStepSeq += 1
  const ticket = verseStepSeq
  const bible = useBibleStore.getState()
  const choice = resolveTranslations(liveItem, bible)
  const translationId = isMissing(choice) ? bible.activeTranslationId : choice.primary
  try {
    let target: { chapter: number; verse: number } | null = null
    if (offset === 1) {
      const same = await fetchChapter(source.book_number, source.chapter, translationId)
      if (same.some((v) => v.verse === source.verse + 1)) target = { chapter: source.chapter, verse: source.verse + 1 }
      else {
        const next = await fetchChapter(source.book_number, source.chapter + 1, translationId)
        if (next.length > 0) target = { chapter: source.chapter + 1, verse: next[0].verse }
      }
    } else if (source.verse > 1) {
      target = { chapter: source.chapter, verse: source.verse - 1 }
    } else if (source.chapter > 1) {
      const prev = await fetchChapter(source.book_number, source.chapter - 1, translationId)
      if (prev.length > 0) target = { chapter: source.chapter - 1, verse: prev[prev.length - 1].verse }
    }
    if (ticket !== verseStepSeq) return
    if (!target) {
      useBroadcastStore.getState().setPresentWarning(
        offset === 1 ? `${source.book_name} ends at ${source.chapter}:${source.verse}.` : `${source.book_name} starts at 1:1.`
      )
      return
    }
    const verse = { ...source, ...target, id: 0, text: "" }
    useBibleStore.getState().setPendingNavigation({ bookNumber: verse.book_number, chapter: verse.chapter, verse: verse.verse })
    await presentVerse(verse, { item: liveItem, goLive: true })
  } catch (e) {
    console.warn("[remote-actions] stepLiveVerse failed:", e)
  }
}

/**
 * Operator actions reachable from every control surface — OSC, the HTTP API,
 * and (from Phase 2) the keyboard. Each surface dispatches into this registry
 * rather than carrying its own copy of the behaviour, so the surfaces cannot
 * drift apart.
 *
 * Plain functions over `getState()`, never hooks: these run from Tauri event
 * callbacks, outside React's render cycle.
 */
export const remoteActions = {
  /**
   * Present what Program preview shows, on air, in the translation the preview
   * is in. When the preview is a rundown item, that item becomes active and its
   * saved secondary translation applies.
   */
  sendToLive: () => {
    const bible = useBibleStore.getState()
    const queue = useQueueStore.getState()
    if (bible.selectedSlide) {
      const { item, index } = bible.selectedSlide
      const idx = queue.items.findIndex((i) => i.id === item.id)
      if (idx !== -1) queue.setActive(idx)
      if (isSlideItem(item)) presentCustomSlide(item, { goLive: true })
      else if (isImageItem(item)) void presentImage(item, { goLive: true }).catch((e) => console.warn("[remote-actions] sendToLive (image) failed:", e))
      else void presentSlide(item, index, { goLive: true }).catch((e) => console.warn("[remote-actions] sendToLive (song) failed:", e))
      return
    }
    const selectedVerse = bible.selectedVerse
    if (!selectedVerse) return
    const idx = queue.findDuplicate(selectedVerse.book_number, selectedVerse.chapter, selectedVerse.verse)
    const rundownItem = idx === -1 ? null : queue.items[idx]
    if (idx !== -1) queue.setActive(idx)
    const previewed = bible.translations.find((t) => t.id === selectedVerse.translation_id)?.abbreviation ?? null
    void presentVerse(selectedVerse, {
      goLive: true,
      itemId: rundownItem?.id ?? null,
      item: {
        translation: previewed,
        secondary_translation: rundownItem && isVerseItem(rundownItem) ? (rundownItem.secondary_translation ?? null) : null,
      },
    }).catch((e) => console.warn("[remote-actions] sendToLive failed:", e))
  },

  /** Queue the verse showing in Program preview. Duplicates are dropped by the store. */
  addToQueue: () => {
    const { selectedVerse } = useBibleStore.getState()
    if (!selectedVerse) return
    useQueueStore.getState().addItem({
      id: crypto.randomUUID(),
      verse: selectedVerse,
      reference: `${selectedVerse.book_name} ${selectedVerse.chapter}:${selectedVerse.verse}`,
      confidence: 1,
      source: "manual",
      added_at: Date.now(),
    })
  },

  queueNext: () => stepQueue(1),
  queuePrev: () => stepQueue(-1),

  /** Step the Bible Text panel one verse. Leaves the queue alone. */
  bibleNext: () => stepVerse("next"),
  biblePrev: () => stepVerse("prev"),

  /** Continue the reading on the live output by one verse. */
  verseNext: () => void stepLiveVerse(1),
  versePrev: () => void stepLiveVerse(-1),

  /** Off air also cancels any present still loading, so it cannot reappear later. */
  toggleOnAir: (active: boolean) => {
    if (!active) cancelPendingPresents()
    useBroadcastStore.getState().setLive(active)
  },
}
