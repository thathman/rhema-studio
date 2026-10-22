import { EllipsisIcon, SettingsIcon, ShieldCheckIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Workspace } from "@/studio/shell-store"
import { WORKSPACE_ITEMS, type NavItem } from "@/studio/shell/nav-items"

function NavButton({ item, active, live, onSelect }: { item: NavItem; active: boolean; live?: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      title={item.key ? `${item.label} (⌘${item.key} / Ctrl+${item.key})` : item.label}
      onClick={onSelect}
      className={cn(
        "relative flex h-10 w-full items-center gap-3 rounded-[11px] px-3 text-[0.8125rem] font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-sidebar-ring/60 max-[1080px]:justify-center max-[1080px]:px-0 [&_svg]:size-[1.125rem] [&_svg]:shrink-0",
        active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-white/[0.07] hover:text-white",
      )}
    >
      {active && <span aria-hidden className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-sidebar-primary" />}
      {item.icon}
      <span className="truncate max-[1080px]:sr-only">{item.label}</span>
      {live && <span aria-label="Live" className="ml-auto size-2 shrink-0 animate-pulse rounded-full bg-on-air shadow-[0_0_6px] shadow-on-air max-[1080px]:absolute max-[1080px]:top-2 max-[1080px]:right-2" />}
    </button>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="px-3 pt-4 pb-1 text-[0.625rem] font-extrabold tracking-[0.15em] text-sidebar-label uppercase max-[1080px]:sr-only">{label}</span>
      {children}
    </div>
  )
}

/**
 * The studio's navigation: what you do on a Sunday (Home, Prepare, Present),
 * your church's things (Library, Design, Team, Archive), and Settings with
 * who is at the desk.
 */
export function Sidebar({
  workspace,
  isLive,
  church,
  operatorName,
  onWorkspace,
  onSettings,
  onMore,
}: {
  workspace: Workspace
  isLive: boolean
  church: NavItem[]
  operatorName: string
  onWorkspace: (w: Workspace) => void
  onSettings: () => void
  onMore: () => void
}) {
  const initials = operatorName.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()
  return (
    <nav aria-label="Workspaces" className="flex min-h-0 w-[232px] flex-col gap-1 overflow-y-auto bg-sidebar px-3.5 py-5 text-sidebar-foreground max-[1280px]:w-[190px] max-[1080px]:w-[78px] max-[1080px]:px-2.5">
      <div className="mb-3 flex items-center gap-2.5 px-2 max-[1080px]:justify-center max-[1080px]:px-0" title="Rhema Studio">
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sidebar-primary font-serif text-lg font-bold text-sidebar-primary-foreground italic">R</span>
        <span className="flex flex-col leading-none max-[1080px]:sr-only">
          <span className="font-serif text-[1.375rem] font-semibold text-white">rhema<span className="text-sidebar-primary">.</span></span>
          <span className="mt-1 text-[0.5625rem] font-extrabold tracking-[0.32em] text-sidebar-label uppercase">Studio</span>
        </span>
      </div>
      <Group label="Workspace">
        {WORKSPACE_ITEMS.map((item) => (
          <NavButton key={item.id} item={item} active={item.workspace === workspace} live={item.id === "present" && isLive} onSelect={() => item.workspace && onWorkspace(item.workspace)} />
        ))}
      </Group>
      <Group label="Your church">
        {church.map((item) => <NavButton key={item.id} item={item} active={false} onSelect={() => item.onSelect?.()} />)}
      </Group>
      <div className="mt-auto flex flex-col gap-1 pt-4">
        <div className="mb-2 rounded-xl border border-sidebar-border px-3 py-2.5 text-[0.6875rem] max-[1080px]:hidden">
          <span className="flex items-center gap-1.5 font-semibold text-sidebar-label uppercase"><ShieldCheckIcon className="size-3.5" /> Local-first</span>
          <span className="mt-1 block text-sidebar-foreground">Your services and songs stay on this computer.</span>
        </div>
        <NavButton item={{ id: "more", label: "More tools", icon: <EllipsisIcon /> }} active={workspace === "more"} onSelect={onMore} />
        <NavButton item={{ id: "settings", label: "Settings", icon: <SettingsIcon />, key: "," }} active={false} onSelect={onSettings} />
        <button type="button" onClick={onSettings} title="Your name goes on the service log and approvals (Settings)" className="mt-1 flex items-center gap-2.5 rounded-[11px] px-2 py-1.5 text-left outline-none hover:bg-white/[0.07] focus-visible:ring-3 focus-visible:ring-sidebar-ring/60 max-[1080px]:justify-center">
          <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-[0.6875rem] font-bold text-white">{initials || "?"}</span>
          <span className="flex min-w-0 flex-col max-[1080px]:sr-only">
            <span className="truncate text-[0.8125rem] font-semibold text-white">{operatorName.trim() || "Add your name"}</span>
            <span className="truncate text-[0.6875rem] text-sidebar-label">At the desk</span>
          </span>
        </button>
      </div>
    </nav>
  )
}
