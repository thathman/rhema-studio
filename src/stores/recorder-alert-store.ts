import { create } from "zustand"

export type RecorderAlertScope = "action" | "status"

interface RecorderAlertStore {
  alerts: Record<RecorderAlertScope, string | null>
  report: (scope: RecorderAlertScope, message: string) => void
  clear: (scope: RecorderAlertScope) => void
  reset: () => void
}

const EMPTY_ALERTS: Record<RecorderAlertScope, string | null> = {
  action: null,
  status: null,
}

/** Ephemeral notices that must survive navigation away from the Live recorder dock. */
export const useRecorderAlertStore = create<RecorderAlertStore>((set) => ({
  alerts: { ...EMPTY_ALERTS },
  report: (scope, message) => {
    const normalized = message.trim()
    if (!normalized) return
    set((state) => ({ alerts: { ...state.alerts, [scope]: normalized } }))
  },
  clear: (scope) => set((state) => {
    if (state.alerts[scope] === null) return state
    return { alerts: { ...state.alerts, [scope]: null } }
  }),
  reset: () => set({ alerts: { ...EMPTY_ALERTS } }),
}))
