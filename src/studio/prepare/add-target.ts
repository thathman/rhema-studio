import { create } from "zustand"
import { useQueueStore } from "@/stores"

/** The Add item dialog: open, target section, and the control to return focus to. */
export const useAddDialog = create<{
  open: boolean
  opener: HTMLElement | null
  focusItemId: string | null
  openFor: (headerId: string | null, opener?: HTMLElement | null) => void
  focusAddedItem: (id: string) => void
  clearOpener: () => void
  close: () => void
}>((set) => ({
  open: false,
  opener: null,
  focusItemId: null,
  openFor: (headerId, opener = null) => {
    useQueueStore.getState().setAddTarget(headerId)
    set({ open: true, opener, focusItemId: null })
  },
  focusAddedItem: (id) => set({ focusItemId: id }),
  clearOpener: () => set({ opener: null, focusItemId: null }),
  close: () => {
    useQueueStore.getState().setAddTarget(null)
    set({ open: false })
  },
}))
