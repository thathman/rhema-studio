import { create } from "zustand"
import { useQueueStore } from "@/stores"

/** The Add item dialog: open, and the phase or group it adds to (null: the top). */
export const useAddDialog = create<{
  open: boolean
  opener: HTMLElement | null
  openFor: (headerId: string | null, opener?: HTMLElement | null) => void
  close: () => void
  clearOpener: () => void
}>((set) => ({
  open: false,
  opener: null,
  openFor: (headerId, opener = null) => {
    useQueueStore.getState().setAddTarget(headerId)
    set({ open: true, opener })
  },
  close: () => {
    useQueueStore.getState().setAddTarget(null)
    set({ open: false })
  },
  clearOpener: () => set({ opener: null }),
}))
