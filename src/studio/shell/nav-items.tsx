import { ArchiveIcon, HouseIcon, LibraryBigIcon, PaletteIcon, PencilRulerIcon, PlayIcon, UsersIcon } from "lucide-react"
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
}

export const WORKSPACE_ITEMS: NavItem[] = [
  { id: "home", label: "Home", icon: <HouseIcon />, key: "1", workspace: "home" },
  { id: "prepare", label: "Prepare", icon: <PencilRulerIcon />, key: "2", workspace: "prepare" },
  { id: "present", label: "Present", icon: <PlayIcon />, key: "3", workspace: "present" },
]

/** Your church: until each becomes a page (UX-08 to UX-11) they open what exists today. */
export function churchItems(): NavItem[] {
  return [
    { id: "library", label: "Library", icon: <LibraryBigIcon />, key: "4", workspace: "library" },
    { id: "design", label: "Design", icon: <PaletteIcon />, key: "5", workspace: "design" },
    { id: "team", label: "Team", icon: <UsersIcon />, key: "6", workspace: "team" },
    { id: "archive", label: "Archive", icon: <ArchiveIcon />, key: "7", workspace: "archive" },
  ]
}
