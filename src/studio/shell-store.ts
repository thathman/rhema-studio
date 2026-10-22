import { create } from "zustand"

export type Workspace = "home" | "prepare" | "present" | "more"
export type PresentView = "standard" | "production"

export interface ShellPrefs {
  workspace: Workspace
  presentView: PresentView
}

export const SHELL_PREFS_KEY = "rhema-studio.shell"

const DEFAULT_PREFS: ShellPrefs = { workspace: "home", presentView: "standard" }

const WORKSPACES: readonly Workspace[] = ["home", "prepare", "present", "more"]
const VIEWS: readonly PresentView[] = ["standard", "production"]

/** Minimal Storage surface so tests can pass a Map-backed fake. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Parse persisted prefs, falling back field-by-field so a bad value never breaks boot. */
export function readShellPrefs(storage: StorageLike | null): ShellPrefs {
  if (!storage) return DEFAULT_PREFS
  try {
    const raw = storage.getItem(SHELL_PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<ShellPrefs>
    return {
      workspace: WORKSPACES.includes(parsed.workspace as Workspace)
        ? (parsed.workspace as Workspace)
        : DEFAULT_PREFS.workspace,
      presentView: VIEWS.includes(parsed.presentView as PresentView)
        ? (parsed.presentView as PresentView)
        : DEFAULT_PREFS.presentView,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export function writeShellPrefs(storage: StorageLike | null, prefs: ShellPrefs): void {
  if (!storage) return
  try {
    storage.setItem(SHELL_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Private mode or quota: the preference is a convenience, not data.
  }
}

interface ShellState extends ShellPrefs {
  /** The outputs dialog is global so Home, Present and More can all open it. */
  outputsDialogOpen: boolean
  /** The library (songs, hymn books, saved logs): opened from the sidebar and from More. */
  libraryOpen: boolean
  setLibraryOpen: (open: boolean) => void
  setWorkspace: (workspace: Workspace) => void
  setPresentView: (view: PresentView) => void
  openOutputs: () => void
  setOutputsDialogOpen: (open: boolean) => void
}

// ponytail: localStorage like ThemeProvider; per-machine UI convenience, not content.
const storage: StorageLike | null =
  typeof localStorage === "undefined" ? null : localStorage

export const useShellStore = create<ShellState>((set) => ({
  ...readShellPrefs(storage),
  outputsDialogOpen: false,
  libraryOpen: false,
  setLibraryOpen: (libraryOpen) => set({ libraryOpen }),
  setWorkspace: (workspace) => set({ workspace }),
  setPresentView: (presentView) => set({ presentView }),
  openOutputs: () => set({ outputsDialogOpen: true }),
  setOutputsDialogOpen: (outputsDialogOpen) => set({ outputsDialogOpen }),
}))

useShellStore.subscribe((state, prev) => {
  if (state.workspace !== prev.workspace || state.presentView !== prev.presentView) {
    writeShellPrefs(storage, { workspace: state.workspace, presentView: state.presentView })
  }
})
