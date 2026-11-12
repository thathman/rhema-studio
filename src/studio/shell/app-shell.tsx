import { ErrorBoundary } from "@/components/error-boundary"
import { useUnsavedStore } from "@/stores/unsaved-store"
import { toast } from "sonner"
import "@/stores/journal-store"
import "@/stores/monitor-store"
import "@/stores/obs-store"
import { useCallback, useEffect, useMemo, useRef } from "react"
import { canonicalWorkspace, showsJoinedDesk, useShellStore, type Workspace } from "@/studio/shell-store"
import { bibleActions } from "@/hooks/use-bible"
import { rememberedServiceId, useServiceStore } from "@/stores/service-store"
import { useBroadcastStore, useQueueStore } from "@/stores"
import { HomeWorkspace } from "@/studio/home/home-workspace"
import { PrepareWorkspace } from "@/studio/prepare/prepare-workspace"
import { PresentWorkspace } from "@/studio/present/present-workspace"
import { DesignWorkspace } from "@/studio/design/design-workspace"
import { mayLeaveThemeDraft } from "@/lib/theme-draft"
import { mayLeaveDesignDocumentDraft } from "@/lib/design-document-draft"
import { BroadcastOutputsDialog } from "@/components/broadcast/broadcast-outputs-dialog"
import { SettingsPage } from "@/components/settings-dialog"
import { useSettingsDialogStore } from "@/lib/settings-dialog"
import { LibraryWorkspace } from "@/studio/library/library-workspace"
import { ArchiveWorkspace } from "@/studio/archive/archive-workspace"
import { TeamWorkspace } from "@/studio/team/team-workspace"
import { ConnectionsWorkspace } from "@/studio/connections/connections-workspace"
import { openSettings } from "@/lib/settings-dialog"
import { Sidebar } from "@/studio/shell/sidebar"
import { JoinedDeskRoute } from "@/studio/shell/joined-desk-route"
import { WORKSPACE_ITEMS, churchItems, type NavItem } from "@/studio/shell/nav-items"
import { cn } from "@/lib/utils"
import { TopBar } from "@/studio/shell/top-bar"
import { startLiveStatePublisher } from "@/lib/live-state"
import { startCountdownChime } from "@/stores/countdown-chime"
import { startBrowserFeeds } from "@/lib/browser-feeds"
import { startNdiStallWatch } from "@/lib/ndi-stall-watch"
import { startCameras } from "@/lib/cameras"
import { watchCamerasOnTvs } from "@/lib/camera-tv-quality"
import { startLiveRecovery } from "@/lib/live-recovery"
import { RecoveryBanner } from "@/studio/shell/recovery-banner"
import { SignalWatch } from "@/studio/shell/signal-watch"
import { ShareReadiness } from "@/studio/share-readiness"
import { useSettingsStore } from "@/stores/settings-store"
import { startVoiceHub } from "@/lib/voice"
import { GlobalSearch } from "@/studio/shell/global-search"
import { SetupWizard } from "@/studio/setup/setup-wizard"
import { SetupStatusDialog } from "@/studio/setup/setup-status"
import { decideSetupLaunch } from "@/studio/setup/setup-launch"
// Items' go-live messages and cues run from the operator's window only.
import "@/stores/on-live-cues"
import "@/stores/keep-awake"
import "@/stores/stage-time-warnings"
import "@/stores/stage-finish"
import "@/lib/app-tick"
import { removeOldTranscripts } from "@/lib/journal-transcript"
import { hydrateSceneApprovals, useSceneApprovalsStore } from "@/stores/scene-approvals-store"
import { PermissionsWorkspace } from "@/studio/permissions/permissions-workspace"
import { hydrateApprovalRequests, reloadApprovalRequests, resetApprovalRequests, useApprovalRequestsStore } from "@/studio/permissions/approval-requests-store"
import { useJoin } from "@/stores/join-store"
import { useNotices } from "@/stores/notices-store"
import { automaticReminderNotices } from "@/lib/timekeeper-reminders"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { REMOTE_EVENTS, REMOTE_REQUEST_WITHDRAWN_EVENT, REMOTE_STAGE_SEND_REQUEST_EVENT } from "@/lib/remote-events"

/** What the top bar calls each page. */
const TITLES: Record<Workspace, string> = { home: "Home", prepare: "Prepare", present: "Live", production: "Live", library: "Library", design: "Design", permissions: "Permissions", connections: "Connections", team: "Team", archive: "History", settings: "Settings" }

const WORKSPACE: Record<Workspace, () => React.ReactNode> = {
  home: () => <HomeWorkspace />,
  prepare: () => <PrepareWorkspace />,
  present: () => <PresentWorkspace />,
  design: () => <DesignWorkspace />,
  library: () => <LibraryWorkspace />,
  archive: () => <ArchiveWorkspace />,
  // Legacy saved routes and deep links resolve to the same Live console.
  production: () => <PresentWorkspace />,
  connections: () => <ConnectionsWorkspace />,
  permissions: () => <PermissionsWorkspace />,
  team: () => <TeamWorkspace />,
  settings: () => <SettingsPage />,
}

export function AppShell() {
  const workspace = useShellStore((s) => s.workspace)
  const activeWorkspace = canonicalWorkspace(workspace)
  const setWorkspace = useShellStore((s) => s.setWorkspace)
  const outputsOpen = useShellStore((s) => s.outputsDialogOpen)
  const setOutputsOpen = useShellStore((s) => s.setOutputsDialogOpen)
  const isLive = useBroadcastStore((s) => s.isLive)
  const joinStatus = useJoin((s) => s.status)
  const hostPendingApprovals = useApprovalRequestsStore((s) => joinStatus === "off" ? s.requests.filter((request) => request.state === "submitted").length : 0)
  const localPendingApprovals = useSceneApprovalsStore((s) => s.requests.filter((request) => request.status === "pending" || request.status === "needs-review").length)
  const pendingApprovals = hostPendingApprovals + localPendingApprovals
  const church = useMemo(() => churchItems(pendingApprovals), [pendingApprovals])
  // A joined director sees this computer's readiness checks (desk consoles): worked out only while someone is paired.
  const paired = useSettingsStore((s) => s.remoteDevices.length > 0)
  // Joined to a host (#813 F2): Live is this computer's role desk, full window, the rest behind its menu.
  const joinedDeskView = useShellStore((s) => s.joinedDeskView)
  const deskPage = showsJoinedDesk(joinStatus, activeWorkspace, joinedDeskView)
  useEffect(() => {
    if (joinStatus === "off") useShellStore.getState().setJoinedDeskView("desk")
  }, [joinStatus])
  // Switching between the desk and the shell (or leaving mid-service) replaces the page: put focus
  // on it so a keyboard or screen reader user is not left on a button that no longer exists.
  const wasDeskPage = useRef(deskPage)
  useEffect(() => {
    if (wasDeskPage.current === deskPage) return
    wasDeskPage.current = deskPage
    queueMicrotask(() => document.getElementById("main")?.focus())
  }, [deskPage])

  // Going anywhere from Design first settles an unsaved theme (keep editing, or discard it), as closing the designer did.
  const go = useCallback(async (next: Workspace) => {
    const from = useShellStore.getState().workspace
    const target = canonicalWorkspace(next)
    if (from === target) return
    if (from === "design") {
      if (!(await mayLeaveThemeDraft())) return
      if (!(await mayLeaveDesignDocumentDraft())) return
      useBroadcastStore.getState().setDesignerOpen(false)
    }
    setWorkspace(target)
  }, [setWorkspace])
  // Old saved shell preferences and deep links land on the single Live workspace.
  useEffect(() => {
    if (workspace !== activeWorkspace) setWorkspace(activeWorkspace)
  }, [activeWorkspace, setWorkspace, workspace])
  // A request to open Design at a section (Live's Design… buttons, Find anything).
  const designRequest = useShellStore((s) => s.designRequest)
  useEffect(() => {
    if (!designRequest) return
    useShellStore.setState({ designRequest: null })
    void (async () => {
      // Already in Design on another tab: ask about unsaved work there first (#411, Find anything).
      const s = useShellStore.getState()
      if (s.workspace === "design" && s.designTab !== designRequest && !(await mayLeaveDesignDocumentDraft())) return
      useShellStore.setState({ designTab: designRequest })
      void go("design")
    })()
  }, [designRequest, go])
  // Host/Join: keep this computer's Live State current for the computers that join it.
  useEffect(() => startLiveStatePublisher(), [])
  // Host-clock reminders enter the same private Comms stream as manually sent notices.
  useEffect(() => {
    let cancelled = false
    let unlisten: UnlistenFn | undefined
    void listen<unknown>("timing:reminder", ({ payload }) => {
      for (const reminder of automaticReminderNotices(payload)) {
        useNotices.getState().send({ from: "Automatic Timekeeper", fromId: "host", ...reminder })
      }
    }).then((off) => {
      if (cancelled) off()
      else unlisten = off
    }).catch(() => {})
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])
  // Load durable host approvals before rendering their pending badge or accepting decisions.
  useEffect(() => { void hydrateSceneApprovals().catch((error) => toast.error("Saved approvals could not be loaded", { description: error instanceof Error ? error.message : String(error) })) }, [])
  // Host-backed requests power the Permissions badge. Joined desks never read or decide the host ledger.
  useEffect(() => {
    if (joinStatus === "off") void hydrateApprovalRequests().catch(() => {})
    else resetApprovalRequests()
  }, [joinStatus])
  useEffect(() => {
    if (joinStatus !== "off") return
    let cancelled = false
    const unlisteners: UnlistenFn[] = []
    const refreshOnRequest = (received: { payload: string }) => {
      if (cancelled) return
      try {
        const payload = JSON.parse(received.payload) as { requestId?: unknown; id?: unknown }
        if ([payload.requestId, payload.id].some((id) => typeof id === "string" && id.trim())) void reloadApprovalRequests().catch(() => {})
      } catch {
        // Malformed scene events are handled by the scene listener; they cannot refresh or alter approvals.
      }
    }
    void Promise.allSettled([REMOTE_EVENTS.save_scene, REMOTE_EVENTS.delete_scene, REMOTE_REQUEST_WITHDRAWN_EVENT, REMOTE_STAGE_SEND_REQUEST_EVENT].map((event) => listen<string>(event, refreshOnRequest))).then((results) => {
      const listeners = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : [])
      if (cancelled) listeners.forEach((unlisten) => unlisten())
      else unlisteners.push(...listeners)
    }).catch(() => {})
    return () => {
      cancelled = true
      unlisteners.forEach((unlisten) => unlisten())
    }
  }, [joinStatus])
  // Timekeeper's chime (#196 R2): this computer only, off unless turned on there.
  useEffect(() => startCountdownChime(), [])
  // Browser feeds: the LAN listener knows each feed and its secret.
  useEffect(() => startBrowserFeeds(), [])
  useEffect(() => startNdiStallWatch(), [])
  // Kept transcripts older than the church allows lose their transcript (#246 C17), at start and on a change.
  const transcriptDays = useSettingsStore((s) => s.transcriptRetentionDays)
  useEffect(() => { void removeOldTranscripts(transcriptDays) }, [transcriptDays])
  // Cameras (#209): the camera page's list, and the camera router when cameras are added.
  useEffect(() => startCameras(), [])
  // A camera shown on a Google TV is suggested TV-friendly 720p unless the operator chose a quality.
  useEffect(() => watchCamerasOnTvs(), [])
  // What was on the screens, for recovery after an unexpected close.
  useEffect(() => {
    let off: (() => void) | undefined
    let gone = false
    void startLiveRecovery().then((f) => { if (gone) f(); else off = f })
    return () => { gone = true; off?.() }
  }, [])
  // The talk channel's hub (Rhema Comms voice): answers desks that join it.
  useEffect(() => startVoiceHub(), [])
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

  const prepareProgramRequest = useShellStore((s) => s.prepareProgramRequest)
  useEffect(() => {
    if (!prepareProgramRequest) return
    if (useShellStore.getState().prepareProgramRequest !== prepareProgramRequest) return
    useShellStore.setState({ prepareProgramRequest: null })
    void go("prepare").then(async () => {
      // `go` owns route guards (including an open Design draft). Do not change the selected
      // service if the user chose to stay in the current workspace.
      if (useShellStore.getState().workspace !== "prepare") return
      // A newer request supersedes this one if it arrived while navigation was guarded.
      if (useShellStore.getState().prepareProgramRequest !== null) return
      const result = await useServiceStore.getState().openProgram(prepareProgramRequest.programId)
      if (result !== "ok") {
        const detail = result === "unsaved"
          ? "Save or discard the current service changes in Prepare before opening this request."
          : useServiceStore.getState().error ?? "The requested service could not be opened."
        toast.error("Could not open service in Prepare", { description: detail })
      } else if (prepareProgramRequest.moment && useShellStore.getState().prepareProgramRequest === null) {
        useShellStore.getState().setPrepareMomentFocus({
          programId: prepareProgramRequest.programId,
          ...prepareProgramRequest.moment,
        })
      }
    })
  }, [prepareProgramRequest, go])

  // The Bible catalogue used to load only when the search panel mounted.
  useEffect(() => {
    bibleActions.loadTranslations().catch(console.error)
    bibleActions.loadBooks().catch(console.error)
    // Saved services, and the one that was open last time (empty rundown only:
    // a rundown already on screen, e.g. from detections, is never replaced).
    void useServiceStore.getState().loadPrograms().then((ok) => {
      // A genuinely new install opens the setup once (#298); the services must be known first.
      decideSetupLaunch(ok)
      const id = rememberedServiceId()
      if (id && useQueueStore.getState().items.length === 0) {
        void useServiceStore.getState().openProgram(id)
      }
    })
  }, [])

  // Cmd/Ctrl+1..6 go to the six main places (nav-items.tsx) from anywhere; Cmd/Ctrl+, opens Settings. (Cmd/Ctrl+B is the sidebar's own.)
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
      const unsaved = useUnsavedStore.getState()
      if (unsaved.songEditor !== null) {
        toast("Save or close the song you are editing first.")
        return
      }
      if (unsaved.designEditor !== null || unsaved.specialistDraft !== null) {
        toast("Save or discard the design you are editing first.")
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

  if (deskPage) {
    return (
      <div className="dark present-surface fixed inset-0 flex flex-col bg-background text-foreground">
        <a href="#main" className="fixed top-3 left-3 z-50 -translate-y-24 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground focus:translate-y-0">Skip to the page</a>
        {/* The same bar and watches as every page: Find, recorder status, Talk, and the camera/signal watch never stop. */}
        <TopBar title="Your desk" workspace="present" />
        <RecoveryBanner />
        <SignalWatch />
        {paired && <ShareReadiness />}
        <main id="main" tabIndex={-1} className="relative min-h-0 min-w-0 flex-1 outline-none">
          <ErrorBoundary key="joined-desk" name="your desk">
            <JoinedDeskRoute church={church} onGo={(w) => void go(w)} />
          </ErrorBoundary>
        </main>
        <BroadcastOutputsDialog open={outputsOpen} onOpenChange={setOutputsOpen} />
        <GlobalSearch />
        <SetupWizard />
        <SetupStatusDialog />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 grid grid-cols-[auto_minmax(0,1fr)] bg-background text-foreground">
      <a href="#main" className="fixed top-3 left-3 z-50 -translate-y-24 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground focus:translate-y-0">Skip to the page</a>
      <Sidebar
        workspace={activeWorkspace}
        isLive={isLive}
        church={church}
        onWorkspace={(w) => void go(w)}
        onSettings={() => openSettings()}
      />

      {/* The live console is always dark (its own deeper palette), top bar included. */}
      <div className={cn("flex min-h-0 min-w-0 flex-col bg-background text-foreground", activeWorkspace === "present" && "dark present-surface")}>
        <TopBar title={TITLES[activeWorkspace]} workspace={activeWorkspace} />
        <RecoveryBanner />
        <SignalWatch />
        {paired && <ShareReadiness />}
        <main id="main" tabIndex={-1} className="relative min-h-0 min-w-0 flex-1 outline-none">
          {/* One view failing leaves the navigation, the remote, the outputs and the other views working. */}
          <ErrorBoundary key={activeWorkspace} name={`the ${TITLES[activeWorkspace]} view`}>{WORKSPACE[activeWorkspace]()}</ErrorBoundary>
        </main>
      </div>

      {/* Global dialogs: reachable from every workspace, mounted exactly once. */}
      <BroadcastOutputsDialog open={outputsOpen} onOpenChange={setOutputsOpen} />
      <GlobalSearch />
      <SetupWizard />
      <SetupStatusDialog />
    </div>
  )
}
