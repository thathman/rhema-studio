import { create } from "zustand"

/**
 * Prepare's multi-select in the order of service (#193): Shift-click picks a range from the last
 * item clicked, Cmd/Ctrl-click adds or takes one away, a plain click picks one. The picked items
 * can be moved, hidden, copied or removed together. Selecting never puts anything live.
 */
interface RundownSelectionState {
  ids: string[]
  /** Where a Shift-click range starts: the last item clicked. */
  anchor: string | null
  /** A click on the item with id `id` (in the list `order`, the rundown's ids). */
  click: (id: string, order: string[], how: { range?: boolean; toggle?: boolean }) => void
  set: (ids: string[]) => void
  clear: () => void
}

export const useRundownSelection = create<RundownSelectionState>((set, get) => ({
  ids: [],
  anchor: null,
  click: (id, order, how) => {
    const { ids, anchor } = get()
    if (how.range && anchor && order.includes(anchor)) {
      const [a, b] = [order.indexOf(anchor), order.indexOf(id)].sort((x, y) => x - y)
      set({ ids: order.slice(a, b + 1) })
      return
    }
    if (how.toggle) {
      set({ ids: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id], anchor: id })
      return
    }
    set({ ids: [id], anchor: id })
  },
  set: (ids) => set({ ids }),
  clear: () => set({ ids: [], anchor: null }),
}))

/** The picked items in rundown order (ids no longer in the rundown left out). */
export function pickedInOrder(order: string[], ids: string[]): string[] {
  return order.filter((id) => ids.includes(id))
}
