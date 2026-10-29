import { create } from "zustand"

/** Operator-only drafts; memory-only across screen unmounts, never persisted or broadcast. */
export interface AuxTimerFormDraft {
  label: string
  minutes: string
  owner: string
}

export const NO_SERVICE_TIMER_DRAFT_KEY = "__no_open_service__"
export const EMPTY_AUX_TIMER_DRAFT: AuxTimerFormDraft = {
  label: "",
  minutes: "5",
  owner: "",
}

function timerDraftKey(serviceId: string | null): string {
  return serviceId ?? NO_SERVICE_TIMER_DRAFT_KEY
}

interface PresentDraftsState {
  stageMessage: string
  setStageMessage: (value: string) => void
  auxTimerDrafts: Record<string, AuxTimerFormDraft>
  updateAuxTimer: (
    serviceId: string | null,
    patch: Partial<AuxTimerFormDraft>
  ) => void
}

export const usePresentDraftsStore = create<PresentDraftsState>((set) => ({
  stageMessage: "",
  setStageMessage: (stageMessage) => set({ stageMessage }),
  auxTimerDrafts: {},
  updateAuxTimer: (serviceId, patch) =>
    set((state) => {
      const key = timerDraftKey(serviceId)
      const current = state.auxTimerDrafts[key] ?? EMPTY_AUX_TIMER_DRAFT
      return {
        auxTimerDrafts: {
          ...state.auxTimerDrafts,
          [key]: { ...current, ...patch },
        },
      }
    }),
}))
