import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { HistoryIcon, RotateCcwIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useServiceStore } from "@/stores/service-store"
import { useQueueStore } from "@/stores"
import { diffRevision, type RevisionDiff } from "@/lib/revision-diff"
import type { Revision, RevisionSummary } from "@/types"

function when(iso: string): string {
  const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

/**
 * Every save of the open service is a snapshot. Pick one to see what a
 * restore would change, then restore it; the restore is itself a save, so
 * the state before it stays in the history.
 */
export function ServiceHistory() {
  const current = useServiceStore((s) => s.current)
  const dirty = useServiceStore((s) => s.dirty)
  const items = useQueueStore((s) => s.items)
  const [open, setOpen] = useState(false)
  const [revisions, setRevisions] = useState<RevisionSummary[]>([])
  const [picked, setPicked] = useState<{ revision: Revision; diff: RevisionDiff } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    void useServiceStore.getState().listRevisions().then(setRevisions)
  }, [open])

  const pick = async (r: RevisionSummary) => {
    try {
      const revision = await invoke<Revision | null>("content_get_revision", { id: r.id })
      if (!revision) return
      setPicked({ revision, diff: diffRevision(items, revision.items) })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const restore = async () => {
    if (!picked) return
    setBusy(true)
    const r = await useServiceStore.getState().restoreRevision(picked.revision.id)
    setBusy(false)
    if (r === "ok") {
      toast.success(`Back to the version from ${when(picked.revision.created_at)}`, { description: "That was saved as a new version; the previous one is still in the history." })
      setOpen(false)
    } else if (r === "unsaved") toast.warning("Save or discard your changes first")
    else if (r === "conflict") toast.error("This service changed elsewhere", { description: "Reload it, then try again." })
    else toast.error("Could not restore", { description: useServiceStore.getState().error ?? undefined })
  }

  if (!current) return null
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setPicked(null) }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" title="Earlier saved versions of this service">
          <HistoryIcon /> History
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <p className="mb-2 text-xs text-muted-foreground">Every save is kept (the last 50). Pick one to see what going back would change.</p>
        {dirty && <p className="mb-2 text-xs text-confidence-mid">Save or discard your current changes before restoring.</p>}
        <ul className="max-h-56 overflow-y-auto rounded-md border border-border" aria-label="Saved versions">
          {revisions.length === 0 && <li className="px-2 py-2 text-xs text-muted-foreground">No saved versions yet.</li>}
          {revisions.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => void pick(r)}
                className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted/50 ${picked?.revision.id === r.id ? "bg-primary/10" : ""}`}
              >
                <span className="w-8 shrink-0 font-mono text-muted-foreground">v{r.revision}</span>
                <span className="min-w-0 flex-1 truncate">{when(r.created_at)}{r.revision === current.revision ? " · current" : ""}{r.revision === current.approved_revision ? " · approved" : ""}</span>
                <span className="shrink-0 text-muted-foreground">{r.item_count} item{r.item_count === 1 ? "" : "s"}</span>
              </button>
            </li>
          ))}
        </ul>
        {picked && (
          <div className="mt-2 rounded-md bg-muted/50 p-2 text-xs">
            {picked.diff.same ? (
              <p>Same as what is on screen now.</p>
            ) : (
              <>
                {picked.diff.added.length > 0 && <p><span className="font-medium">Brings back:</span> {picked.diff.added.join(", ")}</p>}
                {picked.diff.removed.length > 0 && <p><span className="font-medium">Removes:</span> {picked.diff.removed.join(", ")}</p>}
                {picked.diff.changed > 0 && <p>{picked.diff.changed} item{picked.diff.changed === 1 ? "" : "s"} moved or changed.</p>}
              </>
            )}
            <div className="mt-2 flex justify-end">
              <Button size="sm" disabled={busy || dirty || picked.diff.same} onClick={() => void restore()}><RotateCcwIcon /> Restore this version</Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
