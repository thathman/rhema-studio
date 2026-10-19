import { useState } from "react"
import { toast } from "sonner"
import { CalendarIcon, PlusIcon, RefreshCwIcon, SaveIcon, Trash2Icon, TriangleAlertIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useServiceStore } from "@/stores/service-store"
import { useQueueStore } from "@/stores"

/**
 * Pick, create, save, close and delete the service the rundown belongs to.
 * The store refuses anything that would lose unsaved work; this bar only
 * decides how to ask before passing `discard`.
 */
export function ServiceBar() {
  const programs = useServiceStore((s) => s.programs)
  const current = useServiceStore((s) => s.current)
  const dirty = useServiceStore((s) => s.dirty)
  const saving = useServiceStore((s) => s.saving)
  const loading = useServiceStore((s) => s.loading)
  const error = useServiceStore((s) => s.error)
  const conflict = useServiceStore((s) => s.conflict)
  const unsupported = useServiceStore((s) => s.unsupportedItems)
  const count = useQueueStore((s) => s.items.length)

  const [newOpen, setNewOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [date, setDate] = useState("")
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)

  const fail = (what: string) =>
    toast.error(what, { description: useServiceStore.getState().error ?? undefined })

  const open = async (id: string) => {
    const r = await useServiceStore.getState().openProgram(id)
    if (r === "unsaved") toast.warning("Save or discard your changes first")
    else if (r !== "ok") fail("Could not open service")
  }

  const create = async () => {
    const r = await useServiceStore.getState().createFromRundown(title, date || null)
    setNewOpen(false)
    if (r === "created") {
      toast.success(count > 0 ? `Service "${title}" created and saved` : `Service "${title}" created`)
      setTitle("")
      setDate("")
    } else if (r === "created_unsaved") {
      toast.error(`Service "${title}" was created but the rundown could not be saved`, {
        description: `${useServiceStore.getState().error ?? ""} Your items are still on screen; use Save to retry.`,
      })
      setTitle("")
      setDate("")
    } else if (r === "unsaved") {
      toast.warning("Save or discard your changes first")
    } else {
      fail("Could not create service")
    }
  }

  const save = async () => {
    const r = await useServiceStore.getState().saveCurrent()
    if (r === "saved") toast.success("Service saved")
    else if (r === "conflict") toast.error("Not saved: this service changed elsewhere", { description: "Reload to see the latest version, or keep editing and reload later." })
    else if (r === "unsupported") toast.error("Not saved", { description: useServiceStore.getState().error ?? undefined })
    else if (r === "failed") fail("Could not save service")
  }

  const reload = async () => {
    if (!current) return
    const r = await useServiceStore.getState().openProgram(current.id, { discard: true })
    if (r === "ok") toast.success("Reloaded the saved version")
    else fail("Could not reload service")
  }

  const remove = async () => {
    if (!current) return
    const r = await useServiceStore.getState().deleteProgram(current.id, { discard: true })
    setDeleteOpen(false)
    if (r === "deleted") toast.success("Service deleted")
    else if (r === "conflict") toast.error("Not deleted: this service changed elsewhere", { description: "Reload it first." })
    else fail("Could not delete service")
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={current?.id ?? ""} onValueChange={(id) => void open(id)} disabled={loading || dirty}>
        <SelectTrigger className="h-9 w-64" aria-label="Service" title={dirty ? "Save or discard changes before switching" : undefined}>
          <SelectValue placeholder={programs.length ? "Open a service…" : "No saved services yet"} />
        </SelectTrigger>
        <SelectContent>
          {programs.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.title}
              {p.service_date ? ` · ${p.service_date}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Popover open={newOpen} onOpenChange={setNewOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" disabled={!!current && dirty} title={current && dirty ? "Save or discard changes first" : undefined}>
            <PlusIcon /> New service
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72">
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void create()
            }}
          >
            <label className="text-xs text-muted-foreground" htmlFor="svc-title">Title</label>
            <Input id="svc-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sunday service" required maxLength={200} />
            <label className="text-xs text-muted-foreground" htmlFor="svc-date">Date (optional)</label>
            <div className="relative">
              <CalendarIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input id="svc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="pl-8" />
            </div>
            <p className="text-[0.6875rem] text-muted-foreground">
              {count > 0 ? `The ${count} item${count === 1 ? "" : "s"} on screen become this service and are saved.` : "Starts empty."}
            </p>
            <div className="mt-1 flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setNewOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={!title.trim()}>Create</Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>

      {current && (
        <>
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={!dirty || saving || unsupported.length > 0}
            title={unsupported.length > 0 ? "Contains items this version cannot edit" : dirty ? "Save changes" : "No unsaved changes"}
          >
            <SaveIcon /> {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </Button>

          {conflict && (
            <Button size="sm" variant="outline" className="border-confidence-mid text-confidence-mid" onClick={() => void reload()} title={`Saved elsewhere as revision ${conflict.actual}; you opened revision ${conflict.expected}`}>
              <RefreshCwIcon /> Changed elsewhere · Reload
            </Button>
          )}

          {dirty ? (
            <Popover open={discardOpen} onOpenChange={setDiscardOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Close service" title="Close service">
                  <XIcon />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72">
                <p className="mb-3 text-sm">Discard unsaved changes to "{current.title}"? The rundown stays on screen but is no longer linked to the saved service.</p>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setDiscardOpen(false)}>Keep editing</Button>
                  <Button variant="destructive" size="sm" onClick={() => { useServiceStore.getState().closeProgram({ discard: true }); setDiscardOpen(false) }}>
                    Discard changes
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          ) : (
            <Button variant="ghost" size="icon-sm" aria-label="Close service" title="Close service (keeps the rundown)" onClick={() => useServiceStore.getState().closeProgram()}>
              <XIcon />
            </Button>
          )}

          <Popover open={deleteOpen} onOpenChange={setDeleteOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Delete service" title="Delete service">
                <Trash2Icon />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64">
              <p className="mb-3 text-sm">
                Delete "{current.title}"?{dirty ? " Unsaved changes are lost too." : ""} The rundown on screen stays until you clear it.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(false)}>Keep</Button>
                <Button variant="destructive" size="sm" onClick={() => void remove()}>Delete</Button>
              </div>
            </PopoverContent>
          </Popover>
        </>
      )}

      {unsupported.length > 0 && (
        <span className="flex items-center gap-1 text-xs text-confidence-mid" role="status" title={unsupported.map((u) => `${u.kind}: ${u.reference}`).join("\n")}>
          <TriangleAlertIcon className="size-3.5" /> {unsupported.length} item{unsupported.length === 1 ? "" : "s"} this version cannot edit
        </span>
      )}
      {error && !current && (
        <span className="text-xs text-destructive" role="status">{error}</span>
      )}
    </div>
  )
}
