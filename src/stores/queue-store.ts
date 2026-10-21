import { create } from "zustand"
import { isVerseItem, type QueueItem } from "@/types"

interface QueueState {
  items: QueueItem[]
  activeIndex: number | null
  /** ID of the queue item currently being flash-highlighted (null = none). */
  highlightedId: string | null

  addItem: (item: QueueItem) => void
  removeItem: (id: string) => void
  /** Change an item's own settings (song languages, arrangement, notes). */
  updateItem: (id: string, patch: (item: QueueItem) => QueueItem) => void
  reorderItems: (fromIndex: number, toIndex: number) => void
  setActive: (index: number | null) => void
  clearQueue: () => void
  /** Flash-highlight a queue item briefly (1.5 s). */
  flashItem: (id: string) => void
  /** Find an existing item by book+chapter+verse. Returns its index or -1. */
  findDuplicate: (bookNumber: number, chapter: number, verse: number) => number
  /** Fill in verse text on an item that was queued without it. Never overwrites non-empty text. */
  backfillText: (id: string, text: string) => void
  /** Update a chapter-only queue item in place when the verse is refined. */
  updateEarlyRef: (bookNumber: number, chapter: number, verse: number, reference: string, verseText: string) => boolean
}

let flashTimer: ReturnType<typeof setTimeout> | null = null

/**
 * New items with the active position kept on the same item (RG-03 "Next/
 * Previous predictable"): adding at the top, removing or reordering must not
 * leave Next pointing somewhere else. If the active item is gone, there is
 * no active position and stepping falls back to what is live.
 */
function withActiveKept(state: { items: QueueItem[]; activeIndex: number | null }, items: QueueItem[]) {
  if (state.activeIndex === null) return { items }
  const id = state.items[state.activeIndex]?.id
  const activeIndex = id === undefined ? -1 : items.findIndex((i) => i.id === id)
  return { items, activeIndex: activeIndex === -1 ? null : activeIndex }
}

export const useQueueStore = create<QueueState>((set, get) => ({
  items: [],
  activeIndex: null,
  highlightedId: null,

  addItem: (item) =>
    set((state) => {
      // Songs may repeat in a service (opening and closing hymn); verses dedupe.
      if (!isVerseItem(item)) return withActiveKept(state, [item, ...state.items])
      const idx = state.items.findIndex(
        (i) =>
          isVerseItem(i) &&
          i.verse.book_number === item.verse.book_number &&
          i.verse.chapter === item.verse.chapter &&
          i.verse.verse === item.verse.verse,
      )
      if (idx !== -1) {
        // Duplicate: don't re-add, but backfill text if the existing item
        // was queued without it (detections can arrive with empty text).
        const existing = state.items[idx]
        if (isVerseItem(existing) && !existing.verse.text && item.verse.text) {
          const items = [...state.items]
          items[idx] = {
            ...existing,
            verse: { ...existing.verse, text: item.verse.text },
          }
          return { items }
        }
        return state
      }
      return withActiveKept(state, [item, ...state.items])
    }),
  removeItem: (id) =>
    set((state) => withActiveKept(state, state.items.filter((i) => i.id !== id))),
  updateItem: (id, patch) =>
    set((state) => ({ items: state.items.map((i) => (i.id === id ? patch(i) : i)) })),
  reorderItems: (fromIndex, toIndex) =>
    set((state) => {
      const items = [...state.items]
      const [moved] = items.splice(fromIndex, 1)
      items.splice(toIndex, 0, moved)
      return withActiveKept(state, items)
    }),
  setActive: (activeIndex) => set({ activeIndex }),
  clearQueue: () => set({ items: [], activeIndex: null }),
  flashItem: (id) => {
    if (flashTimer) clearTimeout(flashTimer)
    set({ highlightedId: id })
    flashTimer = setTimeout(() => set({ highlightedId: null }), 1500)
  },
  findDuplicate: (bookNumber, chapter, verse) =>
    get().items.findIndex(
      (i) =>
        isVerseItem(i) &&
        i.verse.book_number === bookNumber &&
        i.verse.chapter === chapter &&
        i.verse.verse === verse,
    ),
  backfillText: (id, text) =>
    set((state) => {
      const idx = state.items.findIndex((i) => i.id === id)
      const target = state.items[idx]
      if (!target || !isVerseItem(target) || target.verse.text || !text) return state
      const items = [...state.items]
      items[idx] = { ...target, verse: { ...target.verse, text } }
      return { items }
    }),
  updateEarlyRef: (bookNumber, chapter, verse, reference, verseText) => {
    let found = false
    set((state) => {
      // First try exact match: same book + same chapter
      let idx = state.items.findIndex(
        (i) =>
          isVerseItem(i) &&
          i.is_chapter_only &&
          i.verse.book_number === bookNumber &&
          i.verse.chapter === chapter,
      )
      // Fallback: same book, any chapter (book-only detection guessed chapter 1)
      if (idx === -1) {
        idx = state.items.findIndex(
          (i) =>
            isVerseItem(i) &&
            i.is_chapter_only &&
            i.verse.book_number === bookNumber,
        )
      }
      const current = state.items[idx]
      if (!current || !isVerseItem(current)) return state
      found = true
      const items = [...state.items]
      const item = { ...current }
      item.verse = { ...item.verse, verse, text: verseText }
      item.reference = reference
      item.is_chapter_only = false
      items[idx] = item
      return { items }
    })
    return found
  },
}))
