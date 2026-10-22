import { useState } from "react"
import { BellIcon, ChevronRightIcon, InfoIcon, SearchIcon } from "lucide-react"
import { useShellStore } from "@/studio/shell-store"
import { ShortcutsDialog } from "@/studio/shell/shortcuts-dialog"

const ICON = "flex size-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4"

/** The bar over every page (approved design): where you are, Find anything, shortcuts, the team's activity, and that the studio works offline. */
export function TopBar({ title }: { title: string }) {
  const [shortcuts, setShortcuts] = useState(false)
  return (
    <header className="sticky top-0 z-10 flex min-h-[57px] shrink-0 items-center justify-between gap-3 border-b border-border bg-topbar px-[25px] py-2.5 max-[600px]:px-3">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[0.6875rem]">
        <span className="text-muted-foreground">Rhema Studio</span>
        <ChevronRightIcon aria-hidden className="size-[13px] text-muted-foreground" />
        <span aria-current="page" className="truncate font-semibold text-foreground">{title}</span>
      </nav>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => useShellStore.getState().setSearchOpen(true)}
          className="flex h-[30px] min-w-[188px] items-center gap-2 rounded-md border border-border bg-card px-2.5 text-[0.6875rem] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 max-[600px]:min-w-0 max-[600px]:px-2"
        >
          <SearchIcon aria-hidden className="size-4" />
          <span className="max-[600px]:sr-only">Find anything…</span>
          <kbd className="ml-auto rounded-[5px] border border-border bg-muted px-[5px] py-px font-sans text-[0.625rem] max-[600px]:hidden">⌘ K</kbd>
        </button>
        <button type="button" className={ICON} aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={() => setShortcuts(true)}><InfoIcon /></button>
        <button type="button" className={`${ICON} max-[450px]:hidden`} aria-label="Team activity: approvals and comments" title="Team activity: approvals and comments" onClick={() => useShellStore.getState().goTo("team")}><BellIcon /></button>
        <span className="inline-flex items-center gap-1.5 rounded-[5px] bg-tone-green px-2.5 py-[7px] text-[0.6875rem] font-bold text-tone-green-foreground max-[600px]:hidden" title="Services, songs and Bibles are on this computer: no internet needed on Sunday">
          <span aria-hidden className="size-1.5 rounded-full bg-[#2da78a]" /> Offline-ready
        </span>
      </div>
      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
    </header>
  )
}
