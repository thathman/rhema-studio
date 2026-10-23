import { useCallback, useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { SparklesIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { draftAuthor, draftToRundown, type AiDraft } from "@/lib/ai-drafts"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"

/**
 * Prepare → AI drafts (Rhema MCP, #252): services an assistant proposed, waiting for review.
 * Opening one puts it in the rundown as an unsaved service to edit and save; nothing is saved,
 * approved or shown by opening it. Shown when assistants are allowed or a draft is waiting.
 */
export function AiDrafts() {
  const enabled = useSettingsStore((s) => s.mcpEnabled)
  const [drafts, setDrafts] = useState<AiDraft[]>([])
  const [open, setOpen] = useState(false)
  const [replace, setReplace] = useState<AiDraft | null>(null)
  const load = useCallback(() => invoke<AiDraft[]>("ai_drafts_list").then(setDrafts).catch(() => setDrafts([])), [])
  useEffect(() => {
    void load()
  }, [load, open])
  if (!enabled && drafts.length === 0) return null

  const openDraft = (d: AiDraft, discard = false) => {
    const queue = useQueueStore.getState()
    if (!discard && (useServiceStore.getState().dirty || queue.items.length > 0)) return setReplace(d)
    if (useServiceStore.getState().closeProgram({ discard: true }) !== "closed") return
    const { items, headers } = draftToRundown(d)
    useQueueStore.setState({ items, headers, activeIndex: null })
    setReplace(null)
    setOpen(false)
    toast.success(`${d.title}: opened as an unsaved service`, { description: "Check every item, source anything marked Missing, then save it as a new service." })
  }
  const remove = async (d: AiDraft) => {
    await invoke("ai_draft_delete", { id: d.id }).catch(() => {})
    void load()
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <SparklesIcon /> AI drafts{drafts.length > 0 ? ` (${drafts.length})` : ""}
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); setReplace(null) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Services an AI assistant proposed</DialogTitle>
            <DialogDescription>Each was checked against your library and Bible editions. Opening one makes an unsaved service for you to edit and save; nothing is approved or shown until you do.</DialogDescription>
          </DialogHeader>
          {drafts.length === 0 && <p className="text-sm text-muted-foreground">None waiting. Ask your assistant to plan a service with Rhema (Settings → AI assistants).</p>}
          <ul className="flex flex-col gap-3">
            {drafts.map((d) => {
              const items = d.phases.flatMap((p) => p.items)
              const missing = items.filter((i) => i.kind === "missing")
              const minutes = items.reduce((n, i) => n + (i.planned_minutes ?? 0), 0)
              return (
                <li key={d.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 text-xs">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-semibold">{d.title}</span>
                    {d.date && <span className="text-muted-foreground">{d.date}</span>}
                    <span className="flex-1" />
                    <span className="text-muted-foreground">{draftAuthor(d)} · {new Date(d.created_at).toLocaleString()}{d.updated_at ? ` · revised ${new Date(d.updated_at).toLocaleString()}` : ""}</span>
                  </div>
                  <p>{items.length} items · {minutes} min planned{missing.length > 0 ? <span className="font-semibold text-confidence-mid"> · {missing.length} missing from the library</span> : null}</p>
                  <ol className="flex flex-col gap-0.5 text-muted-foreground">
                    {d.phases.map((p, i) => <li key={i}><span className="font-semibold text-foreground">{p.name}</span>{p.starts_at ? ` · ${p.starts_at}` : ""}: {p.items.map((it) => it.song?.title ?? it.reference ?? it.title ?? "").join(" · ")}</li>)}
                  </ol>
                  {d.assumptions && d.assumptions.length > 0 && <p className="text-muted-foreground">Assumed: {d.assumptions.join("; ")}</p>}
                  {replace?.id === d.id ? (
                    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-2">
                      <span className="flex-1">The rundown has items{useServiceStore.getState().dirty ? " and unsaved changes" : ""}. Replace them with this draft?</span>
                      <Button size="sm" variant="ghost" onClick={() => setReplace(null)}>Keep mine</Button>
                      <Button size="sm" variant="destructive" onClick={() => openDraft(d, true)}>Replace</Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => openDraft(d)}>Open as a new service</Button>
                      <Button size="sm" variant="ghost" onClick={() => void remove(d)}>Remove</Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  )
}
