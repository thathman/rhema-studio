import { useState } from "react"
import { toast } from "sonner"
import { CalendarIcon, PlusIcon, SaveIcon, Trash2Icon, XIcon } from "lucide-react"
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

/** Pick, create, save and delete the service the rundown belongs to. */
export function ServiceBar() {
  const programs = useServiceStore((s) => s.programs)
  const current = useServiceStore((s) => s.current)
  const dirty = useServiceStore((s) => s.dirty)
  const saving = useServiceStore((s) => s.saving)
  const loading = useServiceStore((s) => s.loading)
  const error = useServiceStore((s) => s.error)
  const count = useQueueStore((s) => s.items.length)

  const [newOpen, setNewOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [date, setDate] = useState("")
  const [deleteOpen, setDeleteOpen] = useState(false)

  const open = async (id: string) => {
    const ok = await useServiceStore.getState().openProgram(id)
    if (!ok) toast.error("Could not open service", { description: useServiceStore.getState().error ?? undefined })
  }

  const create = async () => {
    const program = await useServiceStore.getState().createProgram(title, date || null)
    if (!program) {
      toast.error("Could not create service", { description: useServiceStore.getState().error ?? undefined })
      return
    }
    setNewOpen(false)
    setTitle("")
    setDate("")
    // A new service adopts whatever is in the rundown and saves it.
    useServiceStore.setState({ current: program, dirty: count > 0 })
    if (count > 0) await useServiceStore.getState().saveCurrent()
    else await useServiceStore.getState().openProgram(program.id)
    toast.success(`Service "${program.title}" created`)
  }

  const save = async () => {
    const ok = await useServiceStore.getState().saveCurrent()
    if (ok) toast.success("Service saved")
    else toast.error("Could not save service", { description: useServiceStore.getState().error ?? undefined })
  }

  const remove = async () => {
    if (!current) return
    const ok = await useServiceStore.getState().deleteProgram(current.id)
    setDeleteOpen(false)
    if (ok) toast.success("Service deleted")
    else toast.error("Could not delete service", { description: useServiceStore.getState().error ?? undefined })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={current?.id ?? ""} onValueChange={(id) => void open(id)} disabled={loading || dirty}>
        <SelectTrigger className="h-9 w-64" aria-label="Service" title={dirty ? "Save or close the current service first" : undefined}>
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
          <Button variant="outline" size="sm">
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
            <Input id="svc-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sunday service" required />
            <label className="text-xs text-muted-foreground" htmlFor="svc-date">Date (optional)</label>
            <div className="relative">
              <CalendarIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input id="svc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="pl-8" />
            </div>
            <p className="text-[0.6875rem] text-muted-foreground">
              {count > 0 ? `The ${count} item${count === 1 ? "" : "s"} in the rundown become this service.` : "Starts empty."}
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
          <Button size="sm" onClick={() => void save()} disabled={!dirty || saving} title={dirty ? "Save changes" : "No unsaved changes"}>
            <SaveIcon /> {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </Button>
          <Popover open={deleteOpen} onOpenChange={setDeleteOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Delete service" title="Delete service">
                <Trash2Icon />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64">
              <p className="mb-3 text-sm">Delete "{current.title}"? The rundown on screen stays until you clear it.</p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(false)}>Keep</Button>
                <Button variant="destructive" size="sm" onClick={() => void remove()}>Delete</Button>
              </div>
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="icon-sm" aria-label="Close service" title="Close service (keeps the rundown)" onClick={() => useServiceStore.getState().closeProgram()}>
            <XIcon />
          </Button>
        </>
      )}
      {error && !current && (
        <span className="text-xs text-destructive" role="status">{error}</span>
      )}
    </div>
  )
}
