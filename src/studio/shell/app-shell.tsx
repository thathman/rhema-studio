import { ErrorBoundary } from "@/components/error-boundary"
import { useUnsavedStore } from "@/stores/unsaved-store"
import { toast } from "sonner"
import "@/stores/journal-store"
import "@/stores/monitor-store"
import "@/stores/obs-store"
import { useCallback, useEffect, useMemo } from "react"
import { useShellStore, type Workspace } from "@/studio/shell-store"
import { bibleActions } from "@/hooks/use-bible"
import { rememberedServiceId, useServiceStore } from "@/stores/service-store"
import { useBroadcastStore, useQueueStore } from "@/stores"
import { HomeWorkspace } from "@/studio/home/home-workspace"
import { PrepareWorkspace } from "@/studio/prepare/prepare-workspace"
import { PresentWorkspace } from "@/studio/present/present-workspace"
import { MoreWorkspace } from "@/studio/more/more-workspace"
import { DesignWorkspace } from "@/studio/design/design-workspace"
import { mayLeaveThemeDraft } from "@/lib/theme-draft"
import { BroadcastOutputsDialog } from "@/components/broadcast/broadcast-outputs-dialog"
import { SettingsPage } from "@/components/settings-dialog"
import { useSettingsDialogStore } from "@/lib/settings-dialog"
import { LibraryWorkspace } from "@/studio/library/library-workspace"
import { ArchiveWorkspace } from "@/studio/archive/archive-workspace"
import { ProductionWorkspace } from "@/studio/production/production-workspace"
import { TeamWorkspace } from "@/studio/team/team-workspace"
import { openSettings } from "@/lib/settings-dialog"
import { useSettingsStore } from "@/stores/settings-store"
import { Sidebar } from "@/studio/shell/sidebar"
import { WORKSPACE_ITEMS, churchItems, type NavItem } from "@/studio/shell/nav-items"
import { cn } from "@/lib/utils"
import { TopBar } from "@/studio/shell/top-bar"
import { startLiveStatePublisher } from "@/lib/live-state"
import { GlobalSearch } from "@/studio/shell/global-search"
// Items' go-live messages and cues run from the operator's window only.
import "@/stores/on-live-cues"
import "@/stores/stage-finish"
import "@/lib/app-tick"

/** What the top bar calls each page. */
const TITLES: Record<Workspace, string> = { home: "Overview", prepare: "Service builder", present: "Live console", production: "Production control", library: "Library", design: "Design studio", team: "Team", archive: "Archive", settings: "Settings", more: "More tools" }

const WORKSPACE: Record<Workspace, () => React.ReactNode> = {
  home: () => <HomeWorkspace />,
  prepare: () => <PrepareWorkspace />,
  present: () => <PresentWorkspace />,
  design: () => <DesignWorkspace />,
  library: () => <LibraryWorkspace />,
  archive: () => <ArchiveWorkspace />,
  production: () => <ProductionWorkspace />,
  team: () => <TeamWorkspace />,
  settings: () => <SettingsPage />,
  more: () => <MoreWorkspace />,
}

export function AppShell() {
  const workspace = useShellStore((s) => s.workspace)
  const setWorkspace = useShellStore((s) => s.setWorkspace)
  const outputsOpen = useShellStore((s) => s.outputsDialogOpen)
  const setOutputsOpen = useShellStore((s) => s.setOutputsDialogOpen)
  const isLive = useBroadcastStore((s) => s.isLive)
  const operatorName = useSettingsStore((s) => s.operatorName)
  const church = useMemo(() => churchItems(), [])

  // Going anywhere from Design first settles an unsaved theme (keep editing, or discard it), as closing the designer did.
  const go = useCallback(async (next: Workspace) => {
    const from = useShellStore.getState().workspace
    if (from === next) return
    if (from === "design") {
      if (!(await mayLeaveThemeDraft())) return
      useBroadcastStore.getState().setDesignerOpen(false)
    }
    setWorkspace(next)
  }, [setWorkspace])
  // A request to open Design at a section (Present's Design… buttons, More tools).
  const designRequest = useShellStore((s) => s.designRequest)
  useEffect(() => {
    if (!designRequest) return
    useShellStore.setState({ designRequest: null, designTab: designRequest })
    void go("design")
  }, [designRequest, go])
  // Host/Join: keep this computer's Live State current for the computers that join it.
  useEffect(() => startLiveStatePublisher(), [])
  // openSettings(section) from anywhere: the Settings page, at that section.
  const settingsAsked = useSettingsDialogStore((s) => s.isOpen)
  useEffect(() => {
    if (!settingsAsked) return
    useSettingsDialogStore.setState({ isOpen: false })
    void go("settings")
  }, [settingsAsked, go])
  const goRequest = useShellStore((s) => s.goRequest)
  useEffect(() => {
    if (!goRequest) return
    useShellStore.setState({ goRequest: null })
    void go(goRequest)
  }, [goRequest, go])

  // The Bible catalogue used to load only when the search panel mounted.
  useEffect(() => {
    bibleActions.loadTranslations().catch(console.error)
    bibleActions.loadBooks().catch(console.error)
    // Saved services, and the one that was open last time (empty rundown only:
    // a rundown already on screen, e.g. from detections, is never replaced).
    void useServiceStore.getState().loadPrograms().then(() => {
      const id = rememberedServiceId()
      if (id && useQueueStore.getState().items.length === 0) {
        void useServiceStore.getState().openProgram(id)
      }
    })
  }, [])

  // Cmd/Ctrl+1..7 go to a place from anywhere; Cmd/Ctrl+, opens Settings.
  useEffect(() => {
    const items: NavItem[] = [...WORKSPACE_ITEMS, ...church]
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      // Find anything: from anywhere, but not over another dialog.
      if (e.key.toLowerCase() === "k") {
        if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return
        e.preventDefault()
        useShellStore.getState().setSearchOpen(true)
        return
      }
      const item = items.find((n) => n.key === e.key)
      if (!item && e.key !== ",") return
      e.preventDefault()
      // Never switch away from an unsaved song or under an open dialog: that would discard it unasked.
      if (useUnsavedStore.getState().songEditor !== null) {
        toast("Save or close the song you are editing first.")
        return
      }
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return
      if (!item) openSettings()
      else if (item.workspace) void go(item.workspace)
      else item.onSelect?.()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [go, church])

  return (
    <div className="fixed inset-0 grid grid-cols-[auto_minmax(0,1fr)] bg-background text-foreground">
      <a href="#main" className="fixed top-3 left-3 z-50 -translate-y-24 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground focus:translate-y-0">Skip to the page</a>
      <Sidebar
        workspace={workspace}
        isLive={isLive}
        church={church}
        operatorName={operatorName}
        onWorkspace={(w) => void go(w)}
        onSettings={() => openSettings()}
      />

      {/* The live console is always dark (its own deeper palette), top bar included. */}
      <div className={cn("flex min-h-0 min-w-0 flex-col bg-background text-foreground", workspace === "present" && "dark present-surface")}>
        <TopBar title={TITLES[workspace]} />
        <main id="main" tabIndex={-1} className="relative min-h-0 min-w-0 flex-1 outline-none">
          {/* One view failing leaves the navigation, the remote, the outputs and the other views working. */}
          <ErrorBoundary key={workspace} name={`the ${TITLES[workspace]} view`}>{WORKSPACE[workspace]()}</ErrorBoundary>
        </main>
      </div>

      {/* Global dialogs: reachable from every workspace, mounted exactly once. */}
      <BroadcastOutputsDialog open={outputsOpen} onOpenChange={setOutputsOpen} />
      <GlobalSearch />
    </div>
  )
}
