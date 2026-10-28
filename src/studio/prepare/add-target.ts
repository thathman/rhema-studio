import { create } from "zustand"
import { useQueueStore } from "@/stores"

/** The Add item dialog: open, and the phase or group it adds to (null: the top). */
export const useAddDialog = create<{
  open: boolean
  opener: HTMLElement | null
  focusItemId: string | null
  openFor: (headerId: string | null, opener?: HTMLElement | null) => void
  focusAddedItem: (id: string) => void
  close: () => void
  clearOpener: () => void
}>((set) => ({
  open: false,
  opener: null,
  focusItemId: null,
  openFor: (headerId, opener = null) => {
    useQueueStore.getState().setAddTarget(headerId)
    set({ open: true, opener, focusItemId: null })
  },
  focusAddedItem: (id) => set({ focusItemId: id }),
  close: () => {
    useQueueStore.getState().setAddTarget(null)
    set({ open: false })
  },
  clearOpener: () => set({ opener: null, focusItemId: null }),
}))
