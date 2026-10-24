import { useEffect, useState, useSyncExternalStore } from "react"
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useShellStore, type Workspace } from "@/studio/shell-store"
import { DeskMenu } from "@/studio/shell/desk-menu"
import { WORKSPACE_ITEMS, type NavItem } from "@/studio/shell/nav-items"

/** Below this width the sidebar is icons only whatever the operator chose (the `compact` variant in index.css). */
const COMPACT_SIDEBAR_QUERY = "(width < 1180px)"

function subscribeNarrow(onChange: () => void) {
  const mq = typeof window.matchMedia === "function" ? window.matchMedia(COMPACT_SIDEBAR_QUERY) : null
  mq?.addEventListener?.("change", onChange)
  return () => mq?.removeEventListener?.("change", onChange)
}
/** Is the window narrow enough that the sidebar is icons only anyway? */
function isNarrowWindow(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(COMPACT_SIDEBAR_QUERY).matches
}

/** Cmd/Ctrl+B folds the sidebar or opens it out: not over a dialog, and a narrow window is icons only anyway. */
function onSidebarKey(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "b") return
  if (isNarrowWindow() || document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return
  e.preventDefault()
  useShellStore.getState().toggleSidebar()
}

/** In the icons-only sidebar each button says what it is beside it; open out, the label is there and the title gives the keys. */
function SideTip({ compact, text, children }: { compact: boolean; text: string; children: React.ReactElement }) {
  const [open, setOpen] = useState(false)
  return (
    <Tooltip open={compact && open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>{text}</TooltipContent>
    </Tooltip>
  )
}

function NavButton({ item, active, live, compact, onSelect }: { item: NavItem; active: boolean; live?: boolean; compact: boolean; onSelect: () => void }) {
  const keys = item.key ? `${item.label} (⌘${item.key} / Ctrl+${item.key})` : item.label
  return (
    <SideTip compact={compact} text={live ? `${keys} · live` : keys}>
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        title={compact ? undefined : keys}
        onClick={onSelect}
        className={cn(
          "relative flex min-h-[2.3125rem] w-full items-center gap-3 rounded-md px-[11px] text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-sidebar-ring/60 compact:justify-center compact:px-0 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:opacity-90",
          active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-hover",
        )}
      >
        {active && <span aria-hidden className="absolute top-[7px] bottom-[7px] left-0 w-0.5 rounded-r bg-sidebar-primary" />}
        {item.icon}
        <span className="truncate compact:sr-only">{item.label}</span>
        {live && <span aria-label="Live" className="ml-auto size-2 shrink-0 animate-pulse rounded-full bg-on-air compact:absolute compact:top-2 compact:right-2" />}
      </button>
    </SideTip>
  )
}

function Group({ label, children, first }: { label: string; children: React.ReactNode; first?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-0.5 px-2.5", !first && "mt-5")}>
      <span className="px-3 pt-2.5 pb-1.5 text-[0.625rem] font-semibold tracking-[0.12em] whitespace-nowrap text-sidebar-label uppercase compact:sr-only">{label}</span>
      {children}
    </div>
  )
}

/**
 * The studio's navigation (approved design, issue #215): what you do on a Sunday (Home,
 * Prepare, Present), your church's things (Library, Design, Team, Archive), then who is at
 * this desk, with Settings, Light or dark and help in its menu (#299). It folds to icons
 * (the button above the desk, Cmd/Ctrl+B), remembered on this computer; a narrow window
 * shows icons only whatever the choice.
 */
export function Sidebar({
  workspace,
  isLive,
  church,
  onWorkspace,
  onSettings,
}: {
  workspace: Workspace
  isLive: boolean
  church: NavItem[]
  onWorkspace: (w: Workspace) => void
  onSettings: () => void
}) {
  const collapsed = useShellStore((s) => s.sidebarCollapsed)
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrowWindow, () => false)
  const compact = collapsed || narrow
  useEffect(() => {
    window.addEventListener("keydown", onSidebarKey)
    return () => window.removeEventListener("keydown", onSidebarKey)
  }, [])
  const toggleText = collapsed ? "Expand sidebar (⌘B / Ctrl+B)" : "Collapse sidebar (⌘B / Ctrl+B)"
  return (
    <nav
      id="studio-sidebar"
      aria-label="Workspaces"
      data-collapsed={collapsed ? "true" : undefined}
      className="sticky top-0 flex h-full min-h-0 w-[194px] flex-col overflow-x-hidden overflow-y-auto bg-sidebar text-sidebar-foreground transition-[width] duration-150 ease-out compact:w-[72px]"
    >
      <div className="flex items-center gap-2 px-4 pt-[23px] pb-6 compact:justify-center compact:px-0" title="Rhema Studio">
        <span aria-hidden className="flex size-[34px] shrink-0 items-center justify-center rounded-[7px] bg-[#2d766f] font-[Georgia,serif] text-[1.4375rem] font-bold text-[#f7fbf8]">R</span>
        <span className="flex flex-col leading-none compact:sr-only">
          <span className="text-[1.1875rem] font-bold tracking-[-0.045em] text-[#f2f6f3]">rhema<span className="text-[#a7c9ba]">.</span></span>
          <span className="mt-0.5 font-mono text-[0.625rem] font-semibold tracking-[0.16em] text-sidebar-label uppercase">Studio</span>
        </span>
      </div>
      <Group label="Workspace" first>
        {WORKSPACE_ITEMS.map((item) => (
          <NavButton key={item.id} item={item} compact={compact} active={item.workspace === workspace} live={item.id === "present" && isLive} onSelect={() => item.workspace && onWorkspace(item.workspace)} />
        ))}
      </Group>
      <Group label="Your church">
        {church.map((item) => <NavButton key={item.id} item={item} compact={compact} active={item.workspace === workspace} onSelect={() => (item.workspace ? onWorkspace(item.workspace) : item.onSelect?.())} />)}
      </Group>
      <div className="mt-auto flex flex-col px-[11px] pt-4 pb-[15px]">
        {/* A narrow window is icons only anyway, so the button is not offered there. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
              aria-controls="studio-sidebar"
              aria-keyshortcuts="Meta+B Control+B"
              onClick={() => useShellStore.getState().toggleSidebar()}
              className="flex h-8 w-full items-center gap-3 rounded-md px-2 text-xs font-medium whitespace-nowrap text-sidebar-label outline-none hover:bg-sidebar-hover hover:text-sidebar-foreground focus-visible:ring-3 focus-visible:ring-sidebar-ring/60 compact:justify-center compact:px-0 max-[1180px]:hidden [&_svg]:size-4 [&_svg]:shrink-0"
            >
              {collapsed ? <PanelLeftOpenIcon aria-hidden /> : <PanelLeftCloseIcon aria-hidden />}
              <span className="compact:sr-only">Collapse</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>{toggleText}</TooltipContent>
        </Tooltip>
        <DeskMenu active={workspace === "settings"} onSettings={onSettings} />
      </div>
    </nav>
  )
}
