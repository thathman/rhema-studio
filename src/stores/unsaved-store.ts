import { create } from "zustand"

/**
 * Unsaved work outside the open service (FR-03 "explicit handling of
 * unsaved work"): the close question covers it too.
 */
interface UnsavedState {
  /** Title of a song open in the editor with unsaved changes, or null. */
  songEditor: string | null
  setSongEditor: (title: string | null) => void
}

export const useUnsavedStore = create<UnsavedState>((set) => ({
  songEditor: null,
  setSongEditor: (songEditor) => set({ songEditor }),
}))
