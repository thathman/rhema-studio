import { create } from "zustand"
import { useRundownSelection } from "@/studio/prepare/rundown-selection"

export type Workspace = "home" | "prepare" | "present" | "production" | "library" | "design" | "permissions" | "connections" | "team" | "archive" | "settings"
/** `production` is a saved-route/deep-link alias; Live is the single canonical workspace. */
export function canonicalWorkspace(workspace: Workspace): Workspace {
  return workspace === "production" ? "present" : workspace
}
/**
 * The Design page's sections: every design edit lives there. "outputs" was the old Output looks
 * table (#299 UX15-4 retired it); it is kept so old links still work and opens "used-on".
 */
export type DesignTab = "themes" | "library" | "my-designs" | "lower-thirds" | "ticker" | "stage" | "countdown" | "brand" | "used-on" | "outputs"

/** The section a Design link really opens: the old Output looks table is now Used on… */
export function designTabOf(tab: DesignTab): DesignTab {
  return tab === "outputs" ? "used-on" : tab
}
export type LibrarySection = "bible" | "songs" | "hymns" | "slides" | "designs" | "media" | "audio" | "collections" | "files"

/** In-memory return path for customizing a copied Design from a Prepare event. Never persisted as a service preference. */
export interface PrepareDesignReturnContext {
  serviceId: string | null
  eventId: string
  momentId: string
  eventTitle: string
  momentTitle: string
  sceneId: string
}

/** In-memory caller path when a service moment opens the shared Library. */
export interface PrepareLibraryReturnContext {
  serviceId: string | null
  targetHeaderId: string
  targetHeaderTitle: string
  eventId: string | null
  momentId: string | null
  eventTitle: string | null
  momentTitle: string | null
}

/** A verified service design pin to focus after a guarded Prepare navigation finishes. */
export interface PrepareMomentFocusRequest {
  programId: string
  itemId: string
  designId: string
  version: number
}

export interface PrepareProgramRequest {
  programId: string
  moment?: Omit<PrepareMomentFocusRequest, "programId">
}

export interface PrepareMomentSelection extends PrepareMomentFocusRequest {
  eventId: string
}

export interface ShellPrefs {
  workspace: Workspace
  /** The operator folded the sidebar to icons (#299). Below the narrow width it is icons anyway. */
  sidebarCollapsed: boolean
}

export const SHELL_PREFS_KEY = "rhema-studio.shell"

// Prefs saved before the sidebar could fold have no sidebarCollapsed: they open expanded.
// Older prefs may also carry "presentView" (#809 R10: nothing read it) or the retired "more"
// workspace; both are ignored, and the next write drops the stale field.
const DEFAULT_PREFS: ShellPrefs = { workspace: "home", sidebarCollapsed: false }

const WORKSPACES: readonly Workspace[] = ["home", "prepare", "present", "production", "library", "design", "permissions", "connections", "team", "archive", "settings"]

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
        ? canonicalWorkspace(parsed.workspace as Workspace)
        : DEFAULT_PREFS.workspace,
      sidebarCollapsed: typeof parsed.sidebarCollapsed === "boolean" ? parsed.sidebarCollapsed : DEFAULT_PREFS.sidebarCollapsed,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export function writeShellPrefs(storage: StorageLike | null, prefs: ShellPrefs): void {
  if (!storage) return
  try {
    storage.setItem(SHELL_PREFS_KEY, JSON.stringify({ workspace: canonicalWorkspace(prefs.workspace), sidebarCollapsed: prefs.sidebarCollapsed }))
  } catch {
    // Private mode or quota: the preference is a convenience, not data.
  }
}

interface ShellState extends ShellPrefs {
  /** Monotonic in-memory identity for each visit to Library; rejects stale async Uses. */
  libraryVisitId: number
  /** The outputs dialog is global so Home, Live and Design can all open it. */
  outputsDialogOpen: boolean
  designTab: DesignTab
  setDesignTab: (tab: DesignTab) => void
  /** Ask the shell to go to Design at this section (it runs the same guards as the sidebar). */
  designRequest: DesignTab | null
  openDesign: (tab: DesignTab) => void
  /** Open a specific canonical document in Design (for example, the design pinned to a scene). */
  designDocumentRequest: string | null
  openDesignDocument: (designId: string) => void
  clearDesignDocumentRequest: (expectedId: string) => void
  /** Ask the shell to go to a workspace (it runs the same guards as the sidebar). */
  goRequest: Workspace | null
  goTo: (workspace: Workspace) => void
  /** Ask the shell to open a saved service in Prepare after its navigation guards pass. */
  prepareProgramRequest: PrepareProgramRequest | null
  openPrepareProgram: (programId: string) => void
  openPrepareMoment: (request: PrepareMomentFocusRequest) => void
  prepareMomentFocus: PrepareMomentFocusRequest | null
  setPrepareMomentFocus: (request: PrepareMomentFocusRequest | null) => void
  clearPrepareMomentFocus: (expected: PrepareMomentFocusRequest) => void
  prepareMomentSelection: PrepareMomentSelection | null
  setPrepareMomentSelection: (selection: PrepareMomentSelection | null) => void
  /** Open one service item in Prepare's editor (#447: planning only, Live is untouched); `n` makes each ask new. */
  prepareItemRequest: { id: string; n: number } | null
  openInPrepare: (itemId: string) => void
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
  librarySection: LibrarySection
  setLibrarySection: (section: LibrarySection) => void
  openLibrarySection: (section: LibrarySection, prepareReturn?: PrepareLibraryReturnContext | null) => void
  /** Fold the sidebar to icons or open it out again (the sidebar's button, Cmd/Ctrl+B). */
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
  openOutputs: () => void
  /** Open the outputs with this output's editor on top (Design → Used on… → Open output). A new object each time. */
  editOutputRequest: { id: string } | null
  editOutput: (id: string) => void
  setOutputsDialogOpen: (open: boolean) => void
  /** The first-install setup (#298), also opened from the Desk menu (#299): global like the outputs dialog. */
  setupOpen: boolean
  setSetupOpen: (open: boolean) => void
  /** Prepare's History of the open service, also opened from Home's Team changes. */
  historyOpen: boolean
  setHistoryOpen: (open: boolean) => void
  openHistory: () => void
  /** Context preserved while a service-linked scene copy is edited in Live → Scenes. */
  prepareDesignReturn: PrepareDesignReturnContext | null
  setPrepareDesignReturn: (context: PrepareDesignReturnContext) => void
  clearPrepareDesignReturn: () => void
  prepareLibraryReturn: PrepareLibraryReturnContext | null
  setPrepareLibraryReturn: (context: PrepareLibraryReturnContext) => void
  clearPrepareLibraryReturn: () => void
  /** Setup status (#298): the church's setup, the equipment and this service, on one page. */
  setupStatusOpen: boolean
  setSetupStatusOpen: (open: boolean) => void
  /** Ask the Desk menu to open (Settings search → Appearance). A new count each time. */
  deskMenuRequest: number
  openDeskMenu: () => void
}

// ponytail: localStorage like ThemeProvider; per-machine UI convenience, not content.
const storage: StorageLike | null =
  typeof localStorage === "undefined" ? null : localStorage

export const useShellStore = create<ShellState>((set) => ({
  ...readShellPrefs(storage),
  libraryVisitId: 0,
  outputsDialogOpen: false,
  designTab: "my-designs",
  setDesignTab: (tab) => set({ designTab: designTabOf(tab) }),
  designRequest: null,
  openDesign: (tab) => set({ designRequest: designTabOf(tab) }),
  designDocumentRequest: null,
  openDesignDocument: (designId) => set({ designRequest: "my-designs", designDocumentRequest: designId }),
  clearDesignDocumentRequest: (expectedId) => set((state) => state.designDocumentRequest === expectedId ? { designDocumentRequest: null } : {}),
  deskMenuRequest: 0,
  openDeskMenu: () => set((s) => ({ deskMenuRequest: s.deskMenuRequest + 1 })),
  goRequest: null,
  goTo: (workspace) => set({ goRequest: canonicalWorkspace(workspace) }),
  prepareProgramRequest: null,
  openPrepareProgram: (programId) => set({
    prepareProgramRequest: { programId },
    prepareMomentFocus: null,
    prepareMomentSelection: null,
  }),
  openPrepareMoment: ({ programId, itemId, designId, version }) => set({
    prepareProgramRequest: { programId, moment: { itemId, designId, version } },
    prepareMomentFocus: null,
    prepareMomentSelection: null,
  }),
  prepareMomentFocus: null,
  setPrepareMomentFocus: (prepareMomentFocus) => set({ prepareMomentFocus }),
  clearPrepareMomentFocus: (expected) => set((state) => state.prepareMomentFocus === expected ? { prepareMomentFocus: null } : state),
  prepareMomentSelection: null,
  setPrepareMomentSelection: (prepareMomentSelection) => set({ prepareMomentSelection }),
  prepareItemRequest: null,
  openInPrepare: (id) => {
    useRundownSelection.getState().focus(id)
    set((s) => ({ prepareMomentSelection: null, prepareItemRequest: { id, n: (s.prepareItemRequest?.n ?? 0) + 1 }, goRequest: "prepare" }))
  },
  newServiceOpen: false,
  setNewServiceOpen: (newServiceOpen) => set({ newServiceOpen }),
  searchOpen: false,
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  pendingFind: null,
  findInPresent: (pendingFind) => set({ pendingFind, goRequest: "present" }),
  setWorkspace: (workspace) => set((state) => {
    const target = canonicalWorkspace(workspace)
    const enteringLibraryDirectly = target === "library" && state.workspace !== "library"
    const leavingLibraryWithoutReturningToPrepare =
      state.workspace === "library" && target !== "library" && target !== "prepare"
    return {
      workspace: target,
      ...(enteringLibraryDirectly
        ? { libraryVisitId: state.libraryVisitId + 1 }
        : {}),
      ...(enteringLibraryDirectly || leavingLibraryWithoutReturningToPrepare
        ? { prepareLibraryReturn: null }
        : {}),
    }
  }),
  librarySection: "songs",
  setLibrarySection: (librarySection) => set({ librarySection }),
  openLibrarySection: (librarySection, prepareLibraryReturn = null) => set((state) => ({
    workspace: "library",
    librarySection,
    prepareLibraryReturn,
    ...(state.workspace !== "library"
      ? { libraryVisitId: state.libraryVisitId + 1 }
      : {}),
  })),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  openOutputs: () => set({ outputsDialogOpen: true }),
  editOutputRequest: null,
  editOutput: (id) => set({ outputsDialogOpen: true, editOutputRequest: { id } }),
  setOutputsDialogOpen: (outputsDialogOpen) => set({ outputsDialogOpen }),
  setupOpen: false,
  setSetupOpen: (setupOpen) => set({ setupOpen }),
  historyOpen: false,
  setHistoryOpen: (historyOpen) => set({ historyOpen }),
  openHistory: () => set({ historyOpen: true, goRequest: "prepare" }),
  prepareDesignReturn: null,
  setPrepareDesignReturn: (prepareDesignReturn) => set({ prepareDesignReturn }),
  clearPrepareDesignReturn: () => set({ prepareDesignReturn: null }),
  prepareLibraryReturn: null,
  setPrepareLibraryReturn: (prepareLibraryReturn) => set({ prepareLibraryReturn }),
  clearPrepareLibraryReturn: () => set({ prepareLibraryReturn: null }),
  setupStatusOpen: false,
  setSetupStatusOpen: (setupStatusOpen) => set({ setupStatusOpen }),
}))

useShellStore.subscribe((state, prev) => {
  if (state.workspace !== prev.workspace || state.sidebarCollapsed !== prev.sidebarCollapsed) {
    writeShellPrefs(storage, { workspace: state.workspace, sidebarCollapsed: state.sidebarCollapsed })
  }
})
