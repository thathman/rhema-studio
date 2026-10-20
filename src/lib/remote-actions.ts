import { cancelPendingPresents, presentVerse } from "@/hooks/use-broadcast"
import { stepVerse } from "@/hooks/use-bible"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"

/**
 * Find the queue index of the verse currently on the live output.
 * Returns null when the live verse came from somewhere other than the queue.
 */
function findLiveQueueIndex(): number | null {
  const { liveVerse } = useBroadcastStore.getState()
  if (!liveVerse) return null

  const index = useQueueStore
    .getState()
    .items.findIndex((item) => item.reference === liveVerse.reference)
  return index >= 0 ? index : null
}

/**
 * Present a rundown item in its saved translations and put the output on air
 * in the same update. Next/Previous/double-click/OSC/HTTP all come here.
 */
export async function presentQueueItem(index: number): Promise<void> {
  const item = useQueueStore.getState().items[index]
  if (!item) return
  useQueueStore.getState().setActive(index)
  // Navigate the Bible panel to the presented verse, as detections do
  useBibleStore.getState().setPendingNavigation({
    bookNumber: item.verse.book_number,
    chapter: item.verse.chapter,
    verse: item.verse.verse,
  })
  await presentVerse(item.verse, { item, goLive: true }).catch((e) =>
    console.warn("[remote-actions] presentQueueItem failed:", e),
  )
}

function stepQueue(offset: number): void {
  const { items, activeIndex } = useQueueStore.getState()
  if (items.length === 0) return

  const current = activeIndex ?? findLiveQueueIndex()
  const target =
    current === null
      ? 0
      : Math.min(Math.max(current + offset, 0), items.length - 1)

  void presentQueueItem(target)
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
    const selectedVerse = bible.selectedVerse
    if (!selectedVerse) return
    const queue = useQueueStore.getState()
    const idx = queue.findDuplicate(selectedVerse.book_number, selectedVerse.chapter, selectedVerse.verse)
    const rundownItem = idx === -1 ? null : queue.items[idx]
    if (idx !== -1) queue.setActive(idx)
    const previewed = bible.translations.find((t) => t.id === selectedVerse.translation_id)?.abbreviation ?? null
    void presentVerse(selectedVerse, {
      goLive: true,
      item: { translation: previewed, secondary_translation: rundownItem?.secondary_translation ?? null },
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

  /** Off air also cancels any present still loading, so it cannot reappear later. */
  toggleOnAir: (active: boolean) => {
    if (!active) cancelPendingPresents()
    useBroadcastStore.getState().setLive(active)
  },
}
