import { create } from "zustand"
import { isVerseItem, type QueueItem } from "@/types"
import { headersAfterAppend, headersAfterInsert, headersAfterMove, headersAfterRemove, sectionEnd, type OutlineHeader } from "@/lib/run-of-show"

interface QueueState {
  items: QueueItem[]
  /** The run of show's phases and groups, each before an item (see run-of-show.ts). Kept in step with `items`. */
  headers: OutlineHeader[]
  activeIndex: number | null
  /** ID of the queue item currently being flash-highlighted (null = none). */
  highlightedId: string | null
  /** The live item was removed from the rundown: the items either side of it, for Next/Previous. */
  removedActive: { prevId: string | null; nextId: string | null } | null

  addItem: (item: QueueItem) => void
  removeItem: (id: string) => void
  /** Change an item's own settings (song languages, arrangement, notes). */
  updateItem: (id: string, patch: (item: QueueItem) => QueueItem) => void
  reorderItems: (fromIndex: number, toIndex: number) => void
  setActive: (index: number | null) => void
  clearQueue: () => void
  /** Phases and groups (the run of show). */
  setHeaders: (headers: OutlineHeader[]) => void
  /** While set, added items go to the end of this phase or group (in the order added) instead of the top. */
  addTarget: string | null
  setAddTarget: (headerId: string | null) => void
  updateHeader: (id: string, patch: Partial<OutlineHeader>) => void
  /** Remove a phase or group; its items stay where they are. */
  removeHeader: (id: string) => void
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
 * leave Next pointing somewhere else.
 */
function withActiveKept(state: { items: QueueItem[]; activeIndex: number | null }, items: QueueItem[]) {
  if (state.activeIndex === null) return { items }
  const id = state.items[state.activeIndex]?.id
  const activeIndex = id === undefined ? -1 : items.findIndex((i) => i.id === id)
  return { items, activeIndex: activeIndex === -1 ? null : activeIndex }
}

/** A new item into the rundown: at the top, or at the end of the section being added to. */
function inserted(state: { items: QueueItem[]; headers: OutlineHeader[]; activeIndex: number | null; addTarget: string | null }, item: QueueItem) {
  const target = state.addTarget && state.headers.some((h) => h.id === state.addTarget) ? state.addTarget : null
  if (!target) return { ...withActiveKept(state, [item, ...state.items]), headers: headersAfterInsert(state.headers, 0) }
  const at = sectionEnd(state.items.length, state.headers, target)
  const items = [...state.items.slice(0, at), item, ...state.items.slice(at)]
  return { ...withActiveKept(state, items), headers: headersAfterAppend(state.headers, at, target) }
}

export const useQueueStore = create<QueueState>((set, get) => ({
  items: [],
  headers: [],
  activeIndex: null,
  highlightedId: null,
  removedActive: null,

  addItem: (item) =>
    set((state) => {
      // Songs may repeat in a service (opening and closing hymn); verses dedupe.
      if (!isVerseItem(item)) return inserted(state, item)
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
      return inserted(state, item)
    }),
  removeItem: (id) =>
    set((state) => {
      const removed = state.items.findIndex((i) => i.id === id)
      const items = state.items.filter((i) => i.id !== id)
      const headers = removed === -1 ? state.headers : headersAfterRemove(state.headers, removed)
      // The active item itself removed: the position stays on the one before it (so "next"
      // on the stage and in the rundown is the item that followed), and stepping uses both
      // neighbours: Next goes to the one that followed, Previous to the one before (no skip).
      if (removed !== -1 && removed === state.activeIndex) {
        return {
          items,
          headers,
          activeIndex: removed > 0 ? removed - 1 : null,
          removedActive: { prevId: state.items[removed - 1]?.id ?? null, nextId: state.items[removed + 1]?.id ?? null },
        }
      }
      return { ...withActiveKept(state, items), headers }
    }),
  updateItem: (id, patch) =>
    set((state) => ({ items: state.items.map((i) => (i.id === id ? patch(i) : i)) })),
  reorderItems: (fromIndex, toIndex) =>
    set((state) => {
      const items = [...state.items]
      const [moved] = items.splice(fromIndex, 1)
      items.splice(toIndex, 0, moved)
      return { ...withActiveKept(state, items), headers: headersAfterMove(state.headers, fromIndex, toIndex) }
    }),
  setActive: (activeIndex) => set({ activeIndex, removedActive: null }),
  clearQueue: () => set({ items: [], headers: [], activeIndex: null, removedActive: null }),
  setHeaders: (headers) => set({ headers }),
  addTarget: null,
  setAddTarget: (addTarget) => set({ addTarget }),
  updateHeader: (id, patch) => set((state) => ({ headers: state.headers.map((h) => (h.id === id ? { ...h, ...patch, id } : h)) })),
  removeHeader: (id) => set((state) => ({ headers: state.headers.filter((h) => h.id !== id) })),
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
