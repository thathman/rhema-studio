import { create } from "zustand"

export type RecorderAlertScope = "action" | "status" | "safety"

export interface RecorderOutputLeftPayload {
  outputId: string
  stopped: boolean
}

export function recorderOutputLeftMessage(payload: RecorderOutputLeftPayload, outputName = payload.outputId): string {
  if (payload.stopped) {
    return `Recording stopped automatically because ${outputName} is no longer a congregation screen. Review the saved recording in History.`
  }
  return `Rhema could not confirm the recording stopped after ${outputName} stopped being a congregation screen. Open Live and stop recording before private content can appear.`
}

interface RecorderAlertStore {
  alerts: Record<RecorderAlertScope, string | null>
  report: (scope: RecorderAlertScope, message: string) => void
  clear: (scope: RecorderAlertScope) => void
  reset: () => void
}

const EMPTY_ALERTS: Record<RecorderAlertScope, string | null> = {
  action: null,
  status: null,
  safety: null,
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
