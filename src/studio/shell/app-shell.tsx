import { useUnsavedStore } from "@/stores/unsaved-store"
import { toast } from "sonner"
import "@/stores/journal-store"
import "@/stores/monitor-store"
import "@/stores/obs-store"
import { useEffect } from "react"
import {
  HouseIcon,
  PencilRulerIcon,
  PlayIcon,
  EllipsisIcon,
  SunIcon,
  MoonIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useShellStore, type Workspace } from "@/studio/shell-store"
import { useTheme } from "@/components/theme-provider"
import { bibleActions } from "@/hooks/use-bible"
import { rememberedServiceId, useServiceStore } from "@/stores/service-store"
import { useBroadcastStore, useQueueStore } from "@/stores"
import { HomeWorkspace } from "@/studio/home/home-workspace"
import { PrepareWorkspace } from "@/studio/prepare/prepare-workspace"
import { PresentWorkspace } from "@/studio/present/present-workspace"
import { MoreWorkspace } from "@/studio/more/more-workspace"
import { ThemeDesigner } from "@/components/broadcast/theme-designer"
import { BroadcastOutputsDialog } from "@/components/broadcast/broadcast-outputs-dialog"
import { SettingsDialog } from "@/components/settings-dialog"

const NAV: Array<{ id: Workspace; label: string; icon: React.ReactNode; key: string }> = [
  { id: "home", label: "Home", icon: <HouseIcon />, key: "1" },
  { id: "prepare", label: "Prepare", icon: <PencilRulerIcon />, key: "2" },
  { id: "present", label: "Present", icon: <PlayIcon />, key: "3" },
  { id: "more", label: "More", icon: <EllipsisIcon />, key: "4" },
]

const WORKSPACE: Record<Workspace, () => React.ReactNode> = {
  home: () => <HomeWorkspace />,
  prepare: () => <PrepareWorkspace />,
  present: () => <PresentWorkspace />,
  more: () => <MoreWorkspace />,
}

export function AppShell() {
  const workspace = useShellStore((s) => s.workspace)
  const setWorkspace = useShellStore((s) => s.setWorkspace)
  const outputsOpen = useShellStore((s) => s.outputsDialogOpen)
  const setOutputsOpen = useShellStore((s) => s.setOutputsDialogOpen)
  const isLive = useBroadcastStore((s) => s.isLive)
  const { theme, setTheme } = useTheme()

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

  // Cmd/Ctrl+1..4 switch workspaces from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      const item = NAV.find((n) => n.key === e.key)
      if (!item) return
      e.preventDefault()
      // Never switch away from an unsaved song or under an open dialog: that would discard it unasked.
      if (useUnsavedStore.getState().songEditor !== null) {
        toast("Save or close the song you are editing first.")
        return
      }
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return
      setWorkspace(item.id)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setWorkspace])

  return (
    <div className="fixed inset-0 grid grid-cols-[4.5rem_minmax(0,1fr)] bg-background text-foreground">
      <nav
        aria-label="Workspaces"
        className="flex flex-col items-stretch border-r border-border bg-[var(--studio-rail)] py-3"
      >
        <div className="mb-3 flex flex-col items-center gap-0.5 px-1" title="Rhema Studio">
          <span className="text-sm font-bold tracking-tight">Rhema</span>
          <span className="text-[0.5625rem] font-medium tracking-[0.2em] text-muted-foreground uppercase">
            Studio
          </span>
        </div>
        {NAV.map((item) => {
          const active = item.id === workspace
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? "page" : undefined}
              title={`${item.label} (⌘${item.key} / Ctrl+${item.key})`}
              onClick={() => setWorkspace(item.id)}
              className={cn(
                "relative mx-2 my-0.5 flex h-14 flex-col items-center justify-center gap-1 rounded-lg text-[0.6875rem] font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-5",
                active
                  ? "bg-primary/15 text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.id === "present" && isLive && (
                <span
                  aria-label="Live"
                  className="absolute top-1.5 right-2 size-2 animate-pulse rounded-full bg-live-pulse shadow-[0_0_6px] shadow-live-pulse"
                />
              )}
            </button>
          )
        })}
        <div className="mt-auto flex flex-col items-center gap-1">
          <button
            type="button"
            title="Toggle light / dark"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-4"
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </nav>

      <main className="relative min-h-0 min-w-0">{WORKSPACE[workspace]()}</main>

      {/* Global dialogs: reachable from every workspace, mounted exactly once. */}
      <ThemeDesigner />
      <BroadcastOutputsDialog open={outputsOpen} onOpenChange={setOutputsOpen} />
      <SettingsDialog />
    </div>
  )
}
