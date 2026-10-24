import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

const GROUPS: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string]>]> = [
  ["Anywhere", [["⌘K / Ctrl+K", "Find anything"], ["⌘1 to ⌘8", "Home, Prepare, Present, Library, Design, Team, Archive, Production"], ["⌘, / Ctrl+,", "Settings"], ["⌘B / Ctrl+B", "Fold the sidebar to icons, or open it out again"]]],
  ["Present", [["→ or Page Down", "Next (a song's next slide, then the next item)"], ["← or Page Up", "Previous"], ["Shift+→ / Shift+←", "The next or previous verse of the live passage"], ["Esc", "Clear (takes it off the screens; Restore brings it back)"], ["Shift+Esc", "Restore"]]],
]

/** The keyboard shortcuts (top bar ⓘ, Desk menu). Present's keys never act while typing or with a dialog open. */
export function ShortcutsDialog({ open, onOpenChange, onCloseAutoFocus }: { open: boolean; onOpenChange: (open: boolean) => void; onCloseAutoFocus?: (e: Event) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>A presenter clicker's Page Up and Page Down work as Previous and Next. Present's keys never act while you are typing.</DialogDescription>
        </DialogHeader>
        {GROUPS.map(([title, rows]) => (
          <section key={title} aria-label={title} className="flex flex-col gap-1.5">
            <h3 className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">{title}</h3>
            {rows.map(([keys, what]) => (
              <div key={keys} className="flex items-baseline gap-3 text-xs">
                <kbd className="w-36 shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem]">{keys}</kbd>
                <span>{what}</span>
              </div>
            ))}
          </section>
        ))}
      </DialogContent>
    </Dialog>
  )
}
