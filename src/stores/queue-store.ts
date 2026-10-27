import { create } from "zustand"
import { isVerseItem, type QueueItem } from "@/types"
import { headersAfterAppend, headersAfterInsert, headersAfterMove, headersAfterRemove, interleave, sectionEnd, type OutlineHeader } from "@/lib/run-of-show"

interface QueueState {
  items: QueueItem[]
  /** The run of show's phases and groups, each before an item (see run-of-show.ts). Kept in step with `items`. */
  headers: OutlineHeader[]
  activeIndex: number | null
  /** ID of the queue item currently being flash-highlighted (null = none). */
  highlightedId: string | null
  /** The live item was removed from the rundown: the items either side of it, for Next/Previous. */
  removedActive: { prevId: string | null; nextId: string | null } | null

  /** Add at the start by default, or at the end; a valid addTarget inserts at that section's end. Returns the inserted id, or null for a duplicate verse. */
  addItem: (item: QueueItem, placement?: "start" | "end") => string | null
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

  // ── editing the run of show (#193) ──
  /** Earlier run-of-show states, oldest first, and those undone (latest last). Never what is on air. */
  past: RundownSnapshot[]
  future: RundownSnapshot[]
  undo: () => void
  redo: () => void
  /** Forget the history (another service opened: its states are not this one's). */
  resetHistory: () => void
  /** Items copied, for pasting here or into another service. */
  clipboardCount: number
  copyItems: (ids: string[]) => void
  /** Paste copies (new ids) after the item at `afterIndex` in its section; null: as a new item is added. Returns their ids. */
  pasteItems: (afterIndex: number | null) => string[]
  /** Remove several items in one step. */
  removeItems: (ids: string[]) => void
  /** Hide (kept, skipped in Present) or show items again. */
  setHidden: (ids: string[], hidden: boolean) => void
  /** Move items one place up (-1) or down (1), together. */
  moveItems: (ids: string[], dir: -1 | 1) => void
  /** Move items, in their order, to the end of a phase or group. */
  moveToSection: (ids: string[], headerId: string) => void
  /** Move items, in rundown order, before/after a stable item or to the end of a stable section. */
  moveItemsToTarget: (ids: string[], target: QueueMoveTarget) => void
  /** Move one event with all of its moments and nested groups to another event or phase. */
  moveEventToTarget: (id: string, target: QueueEventMoveTarget) => void
  /** Move an event one place up (-1) or down (1) through the event order. */
  moveEvent: (id: string, dir: -1 | 1) => void
}

export type QueueMoveTarget =
  | { kind: "before" | "after"; itemId: string }
  | { kind: "section"; headerId: string }

export type QueueEventMoveTarget =
  | { kind: "phase"; phaseId: string }
  | { kind: "event"; eventId: string; placement: "before" | "after" }

export interface RundownSnapshot {
  items: QueueItem[]
  headers: OutlineHeader[]
}

/** Steps of history kept. */
export const MAX_HISTORY = 100
/** Edits of one thing this close together (typing a note) are one step to undo. */
const COALESCE_MS = 1000

let clipboard: QueueItem[] = []
let lastEdit: { key: string; at: number } | null = null

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
function inserted(state: { items: QueueItem[]; headers: OutlineHeader[]; activeIndex: number | null; addTarget: string | null }, item: QueueItem, placement: "start" | "end") {
  const target = state.addTarget && state.headers.some((h) => h.id === state.addTarget) ? state.addTarget : null
  if (!target) {
    const at = placement === "end" ? state.items.length : 0
    return { ...withActiveKept(state, [...state.items.slice(0, at), item, ...state.items.slice(at)]), headers: headersAfterInsert(state.headers, at) }
  }
  const at = sectionEnd(state.items.length, state.headers, target)
  const items = [...state.items.slice(0, at), item, ...state.items.slice(at)]
  return { ...withActiveKept(state, items), headers: headersAfterAppend(state.headers, at, target) }
}

type Rundown = Pick<QueueState, "items" | "headers" | "activeIndex" | "removedActive">

type RundownRow = { kind: "item"; item: QueueItem } | { kind: "header"; header: OutlineHeader }

function rundownRows(items: QueueItem[], headers: OutlineHeader[]): RundownRow[] {
  return interleave(items, headers).map((row) => "header" in row
    ? { kind: "header", header: row.header }
    : { kind: "item", item: row.item })
}

function sameRundownRows(a: RundownRow[], b: RundownRow[]): boolean {
  return a.length === b.length && a.every((row, index) => {
    const other = b[index]
    return row.kind === "item"
      ? other.kind === "item" && row.item.id === other.item.id
      : other.kind === "header" && row.header.id === other.header.id
  })
}

function rundownFromRows(rows: RundownRow[]): { items: QueueItem[]; headers: OutlineHeader[] } {
  const items: QueueItem[] = []
  const headers: OutlineHeader[] = []
  for (const row of rows) {
    if (row.kind === "item") items.push(row.item)
    else headers.push({ ...row.header, at: items.length })
  }
  return { items, headers }
}

/** The live item removed: the position stays on the one before it, and Next/Previous use both neighbours. */
function withoutItem(state: Rundown, id: string): Partial<Rundown> {
  const removed = state.items.findIndex((i) => i.id === id)
  const items = state.items.filter((i) => i.id !== id)
  const headers = removed === -1 ? state.headers : headersAfterRemove(state.headers, removed)
  if (removed !== -1 && removed === state.activeIndex) {
    return {
      items,
      headers,
      activeIndex: removed > 0 ? removed - 1 : null,
      removedActive: { prevId: state.items[removed - 1]?.id ?? null, nextId: state.items[removed + 1]?.id ?? null },
    }
  }
  return { ...withActiveKept(state, items), headers }
}

function moved(state: Rundown, fromIndex: number, toIndex: number): Partial<Rundown> {
  const items = [...state.items]
  const [item] = items.splice(fromIndex, 1)
  items.splice(toIndex, 0, item)
  return { ...withActiveKept(state, items), headers: headersAfterMove(state.headers, fromIndex, toIndex) }
}

/** A fresh copy of an item (pasted, or a copy of a copy): its own id, the rest as it was. */
const copyOf = (item: QueueItem): QueueItem => ({ ...(JSON.parse(JSON.stringify(item)) as QueueItem), id: crypto.randomUUID(), added_at: Date.now() })

export const useQueueStore = create<QueueState>((rawSet, get) => {
  /**
   * Every edit of the run of show goes through here: when the items or headers change, the state
   * before is kept for Undo (and Redo is cleared). Edits of one thing (`key`) close together are
   * one step. Only the order of service: what is on air never changes with Undo.
   */
  const set = (change: Partial<QueueState> | ((state: QueueState) => Partial<QueueState> | QueueState), key: string | null = null) =>
    rawSet((state) => {
      const next = typeof change === "function" ? change(state) : change
      if (next === state) return state
      const changed = (next.items !== undefined && next.items !== state.items) || (next.headers !== undefined && next.headers !== state.headers)
      if (!changed) return next
      const now = Date.now()
      const same = key !== null && lastEdit?.key === key && now - lastEdit.at < COALESCE_MS
      lastEdit = key === null ? null : { key, at: now }
      if (same) return { ...next, future: [] }
      return { ...next, past: [...state.past, { items: state.items, headers: state.headers }].slice(-MAX_HISTORY), future: [] }
    })
  const travel = (from: "past" | "future") =>
    rawSet((state) => {
      const stack = state[from]
      const to = stack[stack.length - 1]
      if (!to) return state
      lastEdit = null
      const here = { items: state.items, headers: state.headers }
      return {
        ...withActiveKept(state, to.items),
        headers: to.headers,
        removedActive: null,
        [from]: stack.slice(0, -1),
        ...(from === "past" ? { future: [...state.future, here] } : { past: [...state.past, here] }),
      }
    })
  return {
  items: [],
  headers: [],
  activeIndex: null,
  highlightedId: null,
  removedActive: null,

  addItem: (item, placement = "start") => {
    let insertedId: string | null = null
    set((state) => {
      // Songs may repeat in a service (opening and closing hymn); verses dedupe.
      if (!isVerseItem(item)) {
        insertedId = item.id
        return inserted(state, item, placement)
      }
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
      insertedId = item.id
      return inserted(state, item, placement)
    })
    return insertedId
  },
  // The active item itself removed: the position stays on the one before it (so "next"
  // on the stage and in the rundown is the item that followed), and stepping uses both
  // neighbours: Next goes to the one that followed, Previous to the one before (no skip).
  removeItem: (id) => set((state) => withoutItem(state, id)),
  updateItem: (id, patch) =>
    set((state) => ({ items: state.items.map((i) => (i.id === id ? patch(i) : i)) }), `item:${id}`),
  reorderItems: (fromIndex, toIndex) => {
    const state = get()
    const source = state.items[fromIndex]
    const target = state.items[toIndex]
    if (!source || !target || fromIndex === toIndex) return
    state.moveItemsToTarget([source.id], { kind: fromIndex < toIndex ? "after" : "before", itemId: target.id })
  },
  setActive: (activeIndex) => set({ activeIndex, removedActive: null }),
  clearQueue: () => set({ items: [], headers: [], activeIndex: null, removedActive: null }),
  setHeaders: (headers) => set({ headers }),
  addTarget: null,
  setAddTarget: (addTarget) => set({ addTarget }),
  updateHeader: (id, patch) => set((state) => ({ headers: state.headers.map((h) => (h.id === id ? { ...h, ...patch, id } : h)) }), `header:${id}`),
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
  // Filling in words the item already stands for is not an edit to undo.
  backfillText: (id, text) =>
    rawSet((state) => {
      const idx = state.items.findIndex((i) => i.id === id)
      const target = state.items[idx]
      if (!target || !isVerseItem(target) || target.verse.text || !text) return state
      const items = [...state.items]
      items[idx] = { ...target, verse: { ...target.verse, text } }
      return { items }
    }),
  updateEarlyRef: (bookNumber, chapter, verse, reference, verseText) => {
    let found = false
    // A detection refining its own item, not an edit to undo.
    rawSet((state) => {
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

  past: [],
  future: [],
  undo: () => travel("past"),
  redo: () => travel("future"),
  resetHistory: () => {
    lastEdit = null
    rawSet({ past: [], future: [] })
  },
  clipboardCount: 0,
  copyItems: (ids) => {
    const items = get().items.filter((i) => ids.includes(i.id))
    if (items.length === 0) return
    clipboard = items.map((i) => JSON.parse(JSON.stringify(i)) as QueueItem)
    rawSet({ clipboardCount: clipboard.length })
  },
  pasteItems: (afterIndex) => {
    if (clipboard.length === 0) return []
    const copies = clipboard.map(copyOf)
    set((state) => {
      if (afterIndex === null || afterIndex < 0 || afterIndex >= state.items.length) {
        // As new items are added: each at the end of the section being added to, or all at the top, in the order copied.
        const toSection = !!state.addTarget && state.headers.some((h) => h.id === state.addTarget)
        let next: Pick<QueueState, "items" | "headers" | "activeIndex" | "addTarget"> = state
        for (const c of toSection ? copies : [...copies].reverse()) next = { ...next, ...inserted(next, c, toSection ? "end" : "start") }
        return { items: next.items, headers: next.headers, activeIndex: next.activeIndex }
      }
      // Right after that item, in its section: a header just below it stays below the copies.
      const at = afterIndex + 1
      const items = [...state.items.slice(0, at), ...copies, ...state.items.slice(at)]
      const headers = state.headers.map((h) => (h.at >= at ? { ...h, at: h.at + copies.length } : h))
      return { ...withActiveKept(state, items), headers }
    })
    return copies.map((c) => c.id)
  },
  removeItems: (ids) =>
    set((state) => {
      let next: Rundown = state
      for (const id of ids) next = { ...next, ...withoutItem(next, id) }
      return next === state ? state : { items: next.items, headers: next.headers, activeIndex: next.activeIndex, removedActive: next.removedActive }
    }),
  setHidden: (ids, hidden) =>
    set((state) => ({ items: state.items.map((i) => (ids.includes(i.id) && !!i.hidden !== hidden ? { ...i, hidden: hidden || null } : i)) })),
  moveItems: (ids, dir) =>
    set((state) => {
      const picked = new Set(ids)
      const order = state.items.map((_, i) => i).filter((i) => picked.has(state.items[i].id))
      if (dir === 1) order.reverse()
      let next: Rundown = state
      for (const i of order) {
        const j = i + dir
        // At an end, or against another picked item that could not move: stays, so the block keeps its shape.
        if (j < 0 || j >= next.items.length || picked.has(next.items[j].id)) continue
        next = { ...next, ...moved(next, i, j) }
      }
      return next === state ? state : { items: next.items, headers: next.headers, activeIndex: next.activeIndex }
    }),
  moveToSection: (ids, headerId) => get().moveItemsToTarget(ids, { kind: "section", headerId }),
  moveItemsToTarget: (ids, target) =>
    set((state) => {
      const picked = new Set(ids)
      const rows = rundownRows(state.items, state.headers)
      const moving = rows.filter((row) => row.kind === "item" && picked.has(row.item.id))
      if (moving.length === 0) return state
      if (target.kind !== "section" && picked.has(target.itemId)) return state
      const remaining = rows.filter((row) => row.kind !== "item" || !picked.has(row.item.id))
      let insertion: number
      if (target.kind === "section") {
        const start = remaining.findIndex((row) => row.kind === "header" && row.header.id === target.headerId)
        if (start === -1) return state
        const header = (remaining[start] as Extract<RundownRow, { kind: "header" }>).header
        // Keep same-index headers on their original side of the boundary, including
        // the next phase's nested groups. Numeric offsets alone lose that order.
        const end = remaining.findIndex((row, index) => index > start && row.kind === "header" && (
          header.type === "phase" ? row.header.type === "phase"
            : header.event ? row.header.type === "phase" || !!row.header.event : true
        ))
        insertion = end === -1 ? remaining.length : end
      } else {
        const index = remaining.findIndex((row) => row.kind === "item" && row.item.id === target.itemId)
        if (index === -1) return state
        insertion = index + (target.kind === "after" ? 1 : 0)
      }
      const nextRows = [...remaining.slice(0, insertion), ...moving, ...remaining.slice(insertion)]
      if (sameRundownRows(rows, nextRows)) return state
      const next = rundownFromRows(nextRows)
      return { ...withActiveKept(state, next.items), headers: next.headers }
    }),
  moveEventToTarget: (id, target) =>
    set((state) => {
      const rows = rundownRows(state.items, state.headers)
      const start = rows.findIndex((row) => row.kind === "header" && row.header.id === id && !!row.header.event)
      if (start === -1) return state

      const end = rows.findIndex((row, index) => index > start && row.kind === "header" && (row.header.type === "phase" || !!row.header.event))
      const stop = end === -1 ? rows.length : end
      const moving = rows.slice(start, stop)
      const remaining = [...rows.slice(0, start), ...rows.slice(stop)]

      let insertion: number
      if (target.kind === "phase") {
        const phaseIndex = remaining.findIndex((row) => row.kind === "header" && row.header.id === target.phaseId && row.header.type === "phase")
        if (phaseIndex === -1) return state
        const nextPhase = remaining.findIndex((row, index) => index > phaseIndex && row.kind === "header" && row.header.type === "phase")
        insertion = nextPhase === -1 ? remaining.length : nextPhase
      } else {
        const eventIndex = remaining.findIndex((row) => row.kind === "header" && row.header.id === target.eventId && !!row.header.event)
        if (eventIndex === -1) return state
        if (target.placement === "before") {
          insertion = eventIndex
        } else {
          const nextEvent = remaining.findIndex((row, index) => index > eventIndex && row.kind === "header" && (row.header.type === "phase" || !!row.header.event))
          insertion = nextEvent === -1 ? remaining.length : nextEvent
        }
      }

      const nextRows = [...remaining.slice(0, insertion), ...moving, ...remaining.slice(insertion)]
      if (sameRundownRows(rows, nextRows)) return state
      const next = rundownFromRows(nextRows)
      return { ...withActiveKept(state, next.items), headers: next.headers }
    }),
  moveEvent: (id, dir) => {
    const rows = rundownRows(get().items, get().headers)
    const events = rows.flatMap((row) => row.kind === "header" && row.header.event ? [row.header] : [])
    const index = events.findIndex((event) => event.id === id)
    const target = events[index + dir]
    if (!target) return
    get().moveEventToTarget(id, { kind: "event", eventId: target.id, placement: dir < 0 ? "before" : "after" })
  },
  }
})
