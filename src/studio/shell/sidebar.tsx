import { SettingsIcon, ShieldCheckIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/stores/settings-store"
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
        "relative flex min-h-[2.3125rem] w-full items-center gap-3 rounded-md px-[11px] text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-sidebar-ring/60 max-[980px]:justify-center max-[980px]:px-0 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:opacity-90",
        active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-hover",
      )}
    >
      {active && <span aria-hidden className="absolute top-[7px] bottom-[7px] left-0 w-0.5 rounded-r bg-sidebar-primary" />}
      {item.icon}
      <span className="truncate max-[980px]:sr-only">{item.label}</span>
      {live && <span aria-label="Live" className="ml-auto size-2 shrink-0 animate-pulse rounded-full bg-on-air max-[980px]:absolute max-[980px]:top-2 max-[980px]:right-2" />}
    </button>
  )
}

function Group({ label, children, first }: { label: string; children: React.ReactNode; first?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-0.5 px-2.5", !first && "mt-5")}>
      <span className="px-3 pt-2.5 pb-1.5 text-[0.625rem] font-semibold tracking-[0.12em] text-sidebar-label uppercase max-[980px]:sr-only">{label}</span>
      {children}
    </div>
  )
}

/**
 * The studio's navigation (approved design, issue #215): what you do on a Sunday (Home,
 * Prepare, Present), your church's things (Library, Design, Team, Archive), then the
 * workspace this is, Settings and who is at the desk.
 */
export function Sidebar({
  workspace,
  isLive,
  church,
  operatorName,
  onWorkspace,
  onSettings,
}: {
  workspace: Workspace
  isLive: boolean
  church: NavItem[]
  operatorName: string
  onWorkspace: (w: Workspace) => void
  onSettings: () => void
}) {
  const churchName = useSettingsStore((s) => s.brandKit.churchName.trim())
  const initials = operatorName.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()
  return (
    <nav aria-label="Workspaces" className="sticky top-0 flex h-full min-h-0 w-[194px] flex-col overflow-y-auto bg-sidebar text-sidebar-foreground max-[980px]:w-[72px]">
      <div className="flex items-center gap-2 px-4 pt-[23px] pb-6 max-[980px]:justify-center max-[980px]:px-0" title="Rhema Studio">
        <span aria-hidden className="flex size-[34px] shrink-0 items-center justify-center rounded-[7px] bg-[#2d766f] font-[Georgia,serif] text-[1.4375rem] font-bold text-[#f7fbf8]">R</span>
        <span className="flex flex-col leading-none max-[980px]:sr-only">
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
      <div className="mt-auto flex flex-col gap-0.5 px-[11px] pt-4 pb-[15px]">
        <div className="mb-2 rounded-[7px] border border-sidebar-tag-border bg-sidebar-tag px-[9px] py-[11px] text-[0.625rem] text-[#9eb1b7] max-[980px]:hidden">
          <span className="flex items-center gap-1.5 font-semibold whitespace-nowrap uppercase"><ShieldCheckIcon aria-hidden className="size-[13px] shrink-0" /> Local-first workspace</span>
          <span className="mt-1 block truncate text-[0.6875rem] font-semibold text-[#e9f1ed]">{churchName || "This computer"}</span>
          <span className="block">Works offline, on this computer</span>
        </div>
        <NavButton item={{ id: "settings", label: "Settings", icon: <SettingsIcon />, key: "," }} active={workspace === "settings"} onSelect={onSettings} />
        <button type="button" onClick={onSettings} title="Your name goes on the service log and approvals (Settings)" className="mt-1.5 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-sidebar-hover focus-visible:ring-3 focus-visible:ring-sidebar-ring/60 max-[980px]:justify-center">
          <span aria-hidden className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-[#e6f0eb] text-xs font-bold text-[#28685f]">{initials || "?"}</span>
          <span className="flex min-w-0 flex-col max-[980px]:sr-only">
            <span className="truncate text-xs font-semibold text-[#f2f6f3]">{operatorName.trim() || "Add your name"}</span>
            <span className="truncate text-[0.6875rem] text-[#8d9ab2]">At the desk</span>
          </span>
        </button>
      </div>
    </nav>
  )
}
