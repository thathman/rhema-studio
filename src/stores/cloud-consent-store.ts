import { create } from "zustand"

/** The pending "may audio go to the cloud?" question and what to do once it is answered yes. */
interface CloudConsentState {
  open: boolean
  onAgree: (() => void) | null
  ask: (onAgree: () => void) => void
  close: () => void
}

export const useCloudConsentStore = create<CloudConsentState>((set) => ({
  open: false,
  onAgree: null,
  ask: (onAgree) => set({ open: true, onAgree }),
  close: () => set({ open: false, onAgree: null }),
}))
