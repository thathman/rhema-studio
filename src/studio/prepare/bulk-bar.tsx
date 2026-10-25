import { useEffect } from "react"
import { ArrowDownIcon, ArrowUpIcon, ClipboardPasteIcon, CopyIcon, EyeIcon, EyeOffIcon, FolderInputIcon, Redo2Icon, Trash2Icon, Undo2Icon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useQueueStore } from "@/stores"
import { pickedInOrder, useRundownSelection } from "@/studio/prepare/rundown-selection"
import { useSelectedItem } from "@/studio/prepare/use-selected-item"

/** The picked items, in rundown order: the multi-select, else the one item selected (#193). */
function pickedIds(): string[] {
  const { items } = useQueueStore.getState()
  const order = items.map((i) => i.id)
  const ids = pickedInOrder(order, useRundownSelection.getState().ids)
  return ids
}

/** Where a paste goes: after the last picked or selected item; else as a new item is added. */
function pasteAfter(selectedIndex: number | null): number | null {
  const { items } = useQueueStore.getState()
  const ids = pickedIds()
  const last = ids.length ? items.findIndex((i) => i.id === ids[ids.length - 1]) : -1
  return last !== -1 ? last : selectedIndex
}

function copy(ids: string[]) {
  if (ids.length === 0) return
  useQueueStore.getState().copyItems(ids)
  toast.success(`${ids.length === 1 ? "1 item" : `${ids.length} items`} copied`, { description: "Paste here or in another service (Cmd+V)." })
}

function paste(selectedIndex: number | null) {
  const ids = useQueueStore.getState().pasteItems(pasteAfter(selectedIndex))
  if (ids.length) useRundownSelection.getState().set(ids)
}

/** Several items picked in the order of service: move, hide, copy or remove them together. */
export function BulkBar() {
  const items = useQueueStore((s) => s.items)
  const headers = useQueueStore((s) => s.headers)
  const raw = useRundownSelection((s) => s.ids)
  const ids = pickedInOrder(items.map((i) => i.id), raw)
  if (ids.length < 2) return null
  const q = () => useQueueStore.getState()
  const allHidden = items.filter((i) => ids.includes(i.id)).every((i) => i.hidden)
  const sections = [...headers].sort((a, b) => a.at - b.at)
  return (
    <div role="toolbar" aria-label={`${ids.length} items picked`} className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-border bg-card px-2 py-1.5 text-xs">
      <span className="mr-1 font-semibold">{ids.length} picked</span>
      <Button variant="ghost" size="icon-xs" aria-label="Move the picked items up" title="Move up" onClick={() => q().moveItems(ids, -1)}><ArrowUpIcon /></Button>
      <Button variant="ghost" size="icon-xs" aria-label="Move the picked items down" title="Move down" onClick={() => q().moveItems(ids, 1)}><ArrowDownIcon /></Button>
      {sections.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="xs" aria-label="Move the picked items to a phase or group"><FolderInputIcon /> Move to</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {sections.map((h) => (
              <DropdownMenuItem key={h.id} onSelect={() => q().moveToSection(ids, h.id)} className={h.type === "group" ? "pl-5" : "font-semibold"}>
                {h.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Button variant="ghost" size="xs" onClick={() => q().setHidden(ids, !allHidden)} title={allHidden ? "Show them in Present again" : "Kept in the service, skipped in Present"}>
        {allHidden ? <EyeIcon /> : <EyeOffIcon />} {allHidden ? "Show" : "Hide"}
      </Button>
      <Button variant="ghost" size="xs" onClick={() => copy(ids)}><CopyIcon /> Copy</Button>
      <Button variant="ghost" size="xs" className="text-destructive" onClick={() => { q().removeItems(ids); useRundownSelection.getState().clear() }} title="Undo brings them back">
        <Trash2Icon /> Remove
      </Button>
      <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label="Clear the picked items" onClick={() => useRundownSelection.getState().clear()}><XIcon /></Button>
    </div>
  )
}

/** Undo, Redo and Paste for the order of service (#193), with Cmd+Z, Shift+Cmd+Z, Cmd+C and Cmd+V. */
export function RundownTools() {
  const canUndo = useQueueStore((s) => s.past.length > 0)
  const canRedo = useQueueStore((s) => s.future.length > 0)
  const copied = useQueueStore((s) => s.clipboardCount)
  const sel = useSelectedItem()
  const selectedIndex = sel?.index ?? null
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const t = e.target as HTMLElement | null
      // Typing keeps its own undo, copy and paste.
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return
      // Nor while a dialog or menu is open over the page.
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return
      const key = e.key.toLowerCase()
      const q = useQueueStore.getState()
      if (key === "z" && !e.shiftKey) q.undo()
      else if ((key === "z" && e.shiftKey) || key === "y") q.redo()
      else if (key === "c" && !e.shiftKey) {
        const ids = pickedIds()
        const one = selectedIndex === null ? [] : [q.items[selectedIndex]?.id].filter((x): x is string => !!x)
        // Text picked on the page is copied as text, as usual.
        if (window.getSelection()?.toString()) return
        copy(ids.length ? ids : one)
      } else if (key === "v" && !e.shiftKey && q.clipboardCount > 0) paste(selectedIndex)
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selectedIndex])
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button variant="ghost" size="icon-xs" aria-label="Undo" title="Undo (Cmd+Z): the order of service only, never what is on air" disabled={!canUndo} onClick={() => useQueueStore.getState().undo()}><Undo2Icon /></Button>
      <Button variant="ghost" size="icon-xs" aria-label="Redo" title="Redo (Shift+Cmd+Z)" disabled={!canRedo} onClick={() => useQueueStore.getState().redo()}><Redo2Icon /></Button>
      {copied > 0 && (
        <Button variant="ghost" size="xs" title={`Paste ${copied === 1 ? "the item" : `the ${copied} items`} copied (Cmd+V), after the selected one`} onClick={() => paste(selectedIndex)}>
          <ClipboardPasteIcon /> Paste {copied}
        </Button>
      )}
    </div>
  )
}
