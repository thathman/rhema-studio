import { create } from "zustand"

export type Workspace = "home" | "prepare" | "present" | "production" | "library" | "design" | "team" | "archive" | "settings" | "more"
/**
 * The Design page's sections: every design edit lives there. "outputs" was the old Output looks
 * table (#299 UX15-4 retired it); it is kept so old links still work and opens "used-on".
 */
export type DesignTab = "themes" | "lower-thirds" | "ticker" | "stage" | "brand" | "used-on" | "outputs"

/** The section a Design link really opens: the old Output looks table is now Used on… */
export function designTabOf(tab: DesignTab): DesignTab {
  return tab === "outputs" ? "used-on" : tab
}
export type PresentView = "standard" | "production"

export interface ShellPrefs {
  workspace: Workspace
  presentView: PresentView
}

export const SHELL_PREFS_KEY = "rhema-studio.shell"

const DEFAULT_PREFS: ShellPrefs = { workspace: "home", presentView: "standard" }

// "more" has no way in since the sidebar dropped it (#218), so it is not restored.
const WORKSPACES: readonly Workspace[] = ["home", "prepare", "present", "production", "library", "design", "team", "archive", "settings"]
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
  designTab: DesignTab
  setDesignTab: (tab: DesignTab) => void
  /** Ask the shell to go to Design at this section (it runs the same guards as the sidebar). */
  designRequest: DesignTab | null
  openDesign: (tab: DesignTab) => void
  /** Ask the shell to go to a workspace (it runs the same guards as the sidebar). */
  goRequest: Workspace | null
  goTo: (workspace: Workspace) => void
  /** Prepare's New service form, also opened from Home. */
  newServiceOpen: boolean
  setNewServiceOpen: (open: boolean) => void
  /** Find anything (Cmd/Ctrl+K). */
  searchOpen: boolean
  setSearchOpen: (open: boolean) => void
  /** Words handed to Present's Quick find (it takes them once). */
  pendingFind: string | null
  findInPresent: (query: string) => void
  setWorkspace: (workspace: Workspace) => void
  setPresentView: (view: PresentView) => void
  openOutputs: () => void
  /** Open the outputs with this output's editor on top (Design → Used on… → Open output). A new object each time. */
  editOutputRequest: { id: string } | null
  editOutput: (id: string) => void
  setOutputsDialogOpen: (open: boolean) => void
  /** The first-install setup (#298), also opened from the Desk menu (#299): global like the outputs dialog. */
  setupOpen: boolean
  setSetupOpen: (open: boolean) => void
}

// ponytail: localStorage like ThemeProvider; per-machine UI convenience, not content.
const storage: StorageLike | null =
  typeof localStorage === "undefined" ? null : localStorage

export const useShellStore = create<ShellState>((set) => ({
  ...readShellPrefs(storage),
  outputsDialogOpen: false,
  designTab: "themes",
  setDesignTab: (tab) => set({ designTab: designTabOf(tab) }),
  designRequest: null,
  openDesign: (tab) => set({ designRequest: designTabOf(tab) }),
  goRequest: null,
  goTo: (goRequest) => set({ goRequest }),
  newServiceOpen: false,
  setNewServiceOpen: (newServiceOpen) => set({ newServiceOpen }),
  searchOpen: false,
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  pendingFind: null,
  findInPresent: (pendingFind) => set({ pendingFind, goRequest: "present" }),
  setWorkspace: (workspace) => set({ workspace }),
  setPresentView: (presentView) => set({ presentView }),
  openOutputs: () => set({ outputsDialogOpen: true }),
  editOutputRequest: null,
  editOutput: (id) => set({ outputsDialogOpen: true, editOutputRequest: { id } }),
  setOutputsDialogOpen: (outputsDialogOpen) => set({ outputsDialogOpen }),
  setupOpen: false,
  setSetupOpen: (setupOpen) => set({ setupOpen }),
}))

useShellStore.subscribe((state, prev) => {
  if (state.workspace !== prev.workspace || state.presentView !== prev.presentView) {
    writeShellPrefs(storage, { workspace: state.workspace, presentView: state.presentView })
  }
})
