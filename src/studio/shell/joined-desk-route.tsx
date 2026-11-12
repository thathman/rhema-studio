import { MenuIcon, MonitorPlayIcon, SearchIcon, SettingsIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { openSettings } from "@/lib/settings-dialog"
import { useShellStore, type Workspace } from "@/studio/shell-store"
import { WORKSPACE_ITEMS, type NavItem } from "@/studio/shell/nav-items"
import { JoinedDesk } from "@/studio/production/operators-panel"

/**
 * A joined computer's Live page (#813 F2, #846 G2): its role's desk, full height, with the rest of
 * Rhema Studio behind one menu. The host stays the authority; this page only changes where this
 * computer's desk is shown, never what it may do.
 */
export function JoinedDeskRoute({ church, onGo }: { church: NavItem[]; onGo: (workspace: Workspace) => void }) {
  const places = [...WORKSPACE_ITEMS.filter((item) => item.workspace !== "present"), ...church]
  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="outline" aria-label="Rhema Studio menu" title="This computer's own Live console and the rest of Rhema Studio">
          <MenuIcon /> Menu
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>This computer</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => useShellStore.getState().setJoinedDeskView("console")}>
          <MonitorPlayIcon /> This computer's Live console
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => useShellStore.getState().setSearchOpen(true)}>
          <SearchIcon /> Find anything
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Go to</DropdownMenuLabel>
        {places.map((item) => item.workspace ? (
          <DropdownMenuItem key={item.id} onSelect={() => onGo(item.workspace!)}>
            {item.icon} {item.label}
          </DropdownMenuItem>
        ) : null)}
        <DropdownMenuItem onSelect={() => openSettings()}>
          <SettingsIcon /> Settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
  return <JoinedDesk layout="page" menu={menu} />
}
