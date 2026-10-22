import { create } from "zustand"
import { useQueueStore } from "@/stores"

/** The Add item dialog: open, and the phase or group it adds to (null: the top). */
export const useAddDialog = create<{ open: boolean; openFor: (headerId: string | null) => void; close: () => void }>((set) => ({
  open: false,
  openFor: (headerId) => {
    useQueueStore.getState().setAddTarget(headerId)
    set({ open: true })
  },
  close: () => {
    useQueueStore.getState().setAddTarget(null)
    set({ open: false })
  },
}))
