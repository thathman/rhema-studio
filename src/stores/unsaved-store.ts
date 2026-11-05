import { create } from "zustand"

/**
 * Unsaved work outside the open service (FR-03 "explicit handling of
 * unsaved work"): the close question covers it too.
 */
interface UnsavedState {
  /** Title of a song open in the editor with unsaved changes, or null. */
  songEditor: string | null
  setSongEditor: (title: string | null) => void
  /** Title of a My Designs document open in the editor with unsaved changes, or null. */
  designEditor: string | null
  setDesignEditor: (title: string | null) => void
  /** A lower third, ticker, stage or countdown look edited and not saved as a draft, or null (#411). */
  specialistDraft: string | null
  setSpecialistDraft: (what: string | null) => void
}

export const useUnsavedStore = create<UnsavedState>((set) => ({
  songEditor: null,
  setSongEditor: (songEditor) => set({ songEditor }),
  designEditor: null,
  setDesignEditor: (designEditor) => set({ designEditor }),
  specialistDraft: null,
  setSpecialistDraft: (specialistDraft) => set({ specialistDraft }),
}))
