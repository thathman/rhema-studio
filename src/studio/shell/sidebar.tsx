import { cn } from "@/lib/utils"
import type { Workspace } from "@/studio/shell-store"
import { DeskMenu } from "@/studio/shell/desk-menu"
import { WORKSPACE_ITEMS, type NavItem } from "@/studio/shell/nav-items"

function NavButton({ item, active, live, onSelect }: { item: NavItem; active: boolean; live?: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      title={item.key ? `${item.label} (⌘${item.key} / Ctrl+${item.key})` : item.label}
      onClick={onSelect}
      className={cn(
        "relative flex min-h-[2.3125rem] w-full items-center gap-3 rounded-md px-[11px] text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-sidebar-ring/60 max-[1180px]:justify-center max-[1180px]:px-0 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:opacity-90",
        active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-hover",
      )}
    >
      {active && <span aria-hidden className="absolute top-[7px] bottom-[7px] left-0 w-0.5 rounded-r bg-sidebar-primary" />}
      {item.icon}
      <span className="truncate max-[1180px]:sr-only">{item.label}</span>
      {live && <span aria-label="Live" className="ml-auto size-2 shrink-0 animate-pulse rounded-full bg-on-air max-[1180px]:absolute max-[1180px]:top-2 max-[1180px]:right-2" />}
    </button>
  )
}

function Group({ label, children, first }: { label: string; children: React.ReactNode; first?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-0.5 px-2.5", !first && "mt-5")}>
      <span className="px-3 pt-2.5 pb-1.5 text-[0.625rem] font-semibold tracking-[0.12em] text-sidebar-label uppercase max-[1180px]:sr-only">{label}</span>
      {children}
    </div>
  )
}

/**
 * The studio's navigation (approved design, issue #215): what you do on a Sunday (Home,
 * Prepare, Present), your church's things (Library, Design, Team, Archive), then who is at
 * this desk, with Settings, Light or dark and help in its menu (#299).
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
  return (
    <nav aria-label="Workspaces" className="sticky top-0 flex h-full min-h-0 w-[194px] flex-col overflow-y-auto bg-sidebar text-sidebar-foreground max-[1180px]:w-[72px]">
      <div className="flex items-center gap-2 px-4 pt-[23px] pb-6 max-[1180px]:justify-center max-[1180px]:px-0" title="Rhema Studio">
        <span aria-hidden className="flex size-[34px] shrink-0 items-center justify-center rounded-[7px] bg-[#2d766f] font-[Georgia,serif] text-[1.4375rem] font-bold text-[#f7fbf8]">R</span>
        <span className="flex flex-col leading-none max-[1180px]:sr-only">
          <span className="text-[1.1875rem] font-bold tracking-[-0.045em] text-[#f2f6f3]">rhema<span className="text-[#a7c9ba]">.</span></span>
          <span className="mt-0.5 font-mono text-[0.5625rem] font-semibold tracking-[0.19em] text-[#93a5a9] uppercase">Studio</span>
        </span>
      </div>
      <Group label="Workspace" first>
        {WORKSPACE_ITEMS.map((item) => (
          <NavButton key={item.id} item={item} active={item.workspace === workspace} live={item.id === "present" && isLive} onSelect={() => item.workspace && onWorkspace(item.workspace)} />
        ))}
      </Group>
      <Group label="Your church">
        {church.map((item) => <NavButton key={item.id} item={item} active={item.workspace === workspace} onSelect={() => (item.workspace ? onWorkspace(item.workspace) : item.onSelect?.())} />)}
      </Group>
      <div className="mt-auto flex flex-col px-[11px] pt-4 pb-[15px]">
        <DeskMenu active={workspace === "settings"} onSettings={onSettings} />
      </div>
    </nav>
  )
}
