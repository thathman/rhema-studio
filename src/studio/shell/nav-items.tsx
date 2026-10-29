import { ArchiveIcon, CableIcon, HouseIcon, LibraryBigIcon, PaletteIcon, PencilRulerIcon, PlayIcon, ShieldCheckIcon, UsersIcon } from "lucide-react"
import type { Workspace } from "@/studio/shell-store"

export interface NavItem {
  id: string
  label: string
  icon: React.ReactNode
  /** ⌘/Ctrl + this key. */
  key?: string
  /** A workspace (a page); otherwise `onSelect` runs. */
  workspace?: Workspace
  onSelect?: () => void
  badge?: number
}

export const WORKSPACE_ITEMS: NavItem[] = [
  { id: "home", label: "Home", icon: <HouseIcon />, key: "1", workspace: "home" },
  { id: "prepare", label: "Prepare", icon: <PencilRulerIcon />, key: "2", workspace: "prepare" },
  { id: "present", label: "Live", icon: <PlayIcon />, key: "3", workspace: "present" },
  { id: "library", label: "Library", icon: <LibraryBigIcon />, key: "4", workspace: "library" },
  { id: "design", label: "Design", icon: <PaletteIcon />, key: "5", workspace: "design" },
  { id: "history", label: "History", icon: <ArchiveIcon />, key: "6", workspace: "archive" },
]

/** Church operations that are not one of the six primary workspaces. */
export function churchItems(pendingApprovals = 0): NavItem[] {
  return [
    { id: "permissions", label: "Permissions", icon: <ShieldCheckIcon />, workspace: "permissions", ...(pendingApprovals > 0 ? { badge: pendingApprovals } : {}) },
    { id: "connections", label: "Connections", icon: <CableIcon />, workspace: "connections" },
    { id: "team", label: "Team", icon: <UsersIcon />, workspace: "team" },
  ]
}
