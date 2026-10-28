import { create } from "zustand"
import type { CloudSpeechProvider } from "@/stores/settings-store"

/** The pending "may audio go to the cloud?" question and what to do once it is answered yes. */
interface CloudConsentState {
  /** The provider of the listening session in progress, as started (null when not listening). */
  runningProvider: CloudSpeechProvider | "whisper" | null
  pendingProvider: CloudSpeechProvider | null
  open: boolean
  onAgree: (() => void) | null
  ask: (provider: CloudSpeechProvider, onAgree: () => void) => void
  close: () => void
}

export const useCloudConsentStore = create<CloudConsentState>((set) => ({
  runningProvider: null,
  pendingProvider: null,
  open: false,
  onAgree: null,
  ask: (pendingProvider, onAgree) => set({ open: true, pendingProvider, onAgree }),
  close: () => set({ open: false, pendingProvider: null, onAgree: null }),
}))
