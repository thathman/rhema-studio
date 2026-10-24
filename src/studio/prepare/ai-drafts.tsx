import { useCallback, useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { SparklesIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { draftAuthor, draftDiff, draftToRundown, itemKey, leaveOut, type AiDraft, type AiDraftItem } from "@/lib/ai-drafts"
import type { QueueItem } from "@/types"
import { formatMinutes } from "@/lib/service-timing"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"

/**
 * Prepare → AI drafts (Rhema MCP, #252): services an assistant proposed, waiting for review.
 * Opening one puts it in Prepare's rundown (the one being edited, #299) as an unsaved service
 * to edit and save; nothing is saved, approved or shown by opening it. People can untick items
 * to leave out first, and see how it differs from the service that is open. Shown when assistants
 * are allowed or a draft is waiting.
 */
export function AiDrafts() {
  const enabled = useSettingsStore((s) => s.mcpEnabled)
  const [drafts, setDrafts] = useState<AiDraft[]>([])
  const [open, setOpen] = useState(false)
  const [replace, setReplace] = useState<AiDraft | null>(null)
  // The draft whose items are being chosen, and the ones left out ("phase:item").
  const [picking, setPicking] = useState<{ id: string; out: Set<string> } | null>(null)
  const current = useServiceStore((s) => s.current)
  const rundown = useQueueStore((s) => s.items)
  const count = rundown.length
  const dirty = useServiceStore((s) => s.dirty)
  const load = useCallback(() => invoke<AiDraft[]>("ai_drafts_list").then(setDrafts).catch(() => setDrafts([])), [])
  useEffect(() => {
    void load()
  }, [load, open])
  if (!enabled && drafts.length === 0) return null

  const outOf = (d: AiDraft) => (picking?.id === d.id ? picking.out : new Set<string>())
  const openDraft = (d: AiDraft, discard = false) => {
    const queue = useQueueStore.getState()
    if (!discard && (useServiceStore.getState().dirty || queue.items.length > 0)) return setReplace(d)
    if (useServiceStore.getState().closeProgram({ discard: true }) !== "closed") return
    const { items, headers } = draftToRundown(leaveOut(d, outOf(d)))
    useQueueStore.setState({ items, headers, activeIndex: null })
    setReplace(null)
    setPicking(null)
    setOpen(false)
    toast.success(`${d.title} is now the rundown in Prepare`, { description: "Unsaved: check every item, source anything marked Missing, then use New service to save it." })
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
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); setReplace(null); setPicking(null) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Services an AI assistant proposed</DialogTitle>
            <DialogDescription>Each was checked against your library and Bible editions. Opening one puts it in the rundown you edit here in Prepare, as an unsaved service to check and save; nothing is approved or shown until you do.</DialogDescription>
          </DialogHeader>
          {drafts.length > 0 && (count > 0 || current) && (
            <p className="rounded-md bg-muted p-2 text-xs">
              Opening a draft replaces the rundown{current ? ` of "${current.title}"` : ""} ({count} {count === 1 ? "item" : "items"}){current ? " and closes that service; what it has saved stays saved" : ""}.{count > 0 || dirty ? " You are asked first." : ""}
            </p>
          )}
          {drafts.length === 0 && <p className="text-sm text-muted-foreground">None waiting. Ask your assistant to plan a service with Rhema (Settings → AI assistants).</p>}
          <ul className="flex flex-col gap-3">
            {drafts.map((d) => {
              const out = outOf(d)
              const chosen = leaveOut(d, out)
              const all = d.phases.flatMap((p) => p.items).length
              const items = chosen.phases.flatMap((p) => p.items)
              const missing = items.filter((i) => i.kind === "missing")
              const minutes = items.reduce((n, i) => n + (i.planned_minutes ?? 0), 0)
              const choosing = picking?.id === d.id
              return (
                <li key={d.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 text-xs">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-semibold">{d.title}</span>
                    {d.date && <span className="text-muted-foreground">{d.date}</span>}
                    <span className="flex-1" />
                    <span className="text-muted-foreground">{draftAuthor(d)} · {new Date(d.created_at).toLocaleString()}{d.updated_at ? ` · revised ${new Date(d.updated_at).toLocaleString()}` : ""}</span>
                  </div>
                  <p>{items.length < all ? `${items.length} of ${all}` : items.length} items{minutes ? ` · ${formatMinutes(minutes * 60_000)} planned in all` : ""}{missing.length > 0 ? <span className="font-semibold text-confidence-mid"> · {missing.length} missing from the library</span> : null}</p>
                  {choosing ? (
                    <ChooseItems draft={d} out={out} onChange={(next) => setPicking({ id: d.id, out: next })} />
                  ) : (
                    <ol className="flex flex-col gap-0.5 text-muted-foreground">
                      {d.phases.map((p, i) => <li key={i}><span className="font-semibold text-foreground">{p.name}</span>{p.starts_at ? ` · ${p.starts_at}` : ""}: {p.items.map((it, ii) => `${it.group && it.group !== p.items[ii - 1]?.group ? `[${it.group}] ` : ""}${label(it)}${it.end_by ? ` (by ${it.end_by})` : ""}${suggestion(it)}`).join(" · ")}</li>)}
                    </ol>
                  )}
                  {current && <Differences title={current.title} draft={draftToRundown(chosen, () => "").items} open={rundown} />}
                  {d.assumptions && d.assumptions.length > 0 && <p className="text-muted-foreground">Assumed: {d.assumptions.join("; ")}</p>}
                  {replace?.id === d.id ? (
                    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-2">
                      <span className="flex-1">The rundown has {count} {count === 1 ? "item" : "items"}{dirty ? " and unsaved changes" : ""}. Replace them with this draft?</span>
                      <Button size="sm" variant="ghost" onClick={() => setReplace(null)}>Keep mine</Button>
                      <Button size="sm" variant="destructive" onClick={() => openDraft(d, true)}>Replace</Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={items.length === 0} onClick={() => openDraft(d)} title="Put this draft in the rundown here, as an unsaved service">{items.length < all ? `Open ${items.length} of ${all} items in the rundown` : "Open in the rundown"}</Button>
                      <Button size="sm" variant="outline" aria-expanded={choosing} onClick={() => setPicking(choosing ? null : { id: d.id, out: new Set() })}>{choosing ? "Keep every item" : "Choose items"}</Button>
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

const label = (it: AiDraftItem) => it.song?.title ?? it.reference ?? it.title ?? it.text?.slice(0, 40) ?? ""

/**
 * Every item of a draft with a tick box, under its phase and group: untick what to leave out.
 * A group's box ticks or unticks all of it.
 */
function ChooseItems({ draft, out, onChange }: { draft: AiDraft; out: Set<string>; onChange: (out: Set<string>) => void }) {
  const set = (keys: string[], keep: boolean) => {
    const next = new Set(out)
    for (const k of keys) {
      if (keep) next.delete(k)
      else next.add(k)
    }
    onChange(next)
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2">
      <p className="text-muted-foreground">Untick what to leave out. Only the ticked items go into the rundown.</p>
      {draft.phases.map((p, pi) => {
        // Runs of items with the same group, in order.
        const runs: { group: string | null; items: { it: AiDraftItem; key: string }[] }[] = []
        p.items.forEach((it, ii) => {
          const g = it.group?.trim() || null
          const last = runs[runs.length - 1]
          if (last && last.group === g) last.items.push({ it, key: itemKey(pi, ii) })
          else runs.push({ group: g, items: [{ it, key: itemKey(pi, ii) }] })
        })
        return (
          <fieldset key={pi} className="flex flex-col gap-1">
            <legend className="font-semibold">{p.name}{p.starts_at ? ` · starts ${p.starts_at}` : ""}</legend>
            {p.items.length === 0 && <p className="text-muted-foreground">No items.</p>}
            {runs.map((run, ri) => {
              const keys = run.items.map((x) => x.key)
              const kept = keys.filter((k) => !out.has(k)).length
              return (
                <div key={ri} className="flex flex-col gap-1">
                  {run.group && (
                    <label className="flex items-center gap-2 font-medium">
                      <input type="checkbox" className="size-4" checked={kept === keys.length} ref={(el) => { if (el) el.indeterminate = kept > 0 && kept < keys.length }} onChange={(e) => set(keys, e.target.checked)} />
                      {run.group} <span className="font-normal text-muted-foreground">(group)</span>
                    </label>
                  )}
                  {run.items.map(({ it, key }) => (
                    <label key={key} className={`flex items-center gap-2 ${run.group ? "pl-6" : ""}`}>
                      <input type="checkbox" className="size-4" checked={!out.has(key)} onChange={(e) => set([key], e.target.checked)} />
                      <span className={it.kind === "missing" ? "text-confidence-mid" : ""}>{it.kind === "missing" ? `Missing ${it.wanted === "hymn" ? "hymn" : "song"}: ` : ""}{label(it)}</span>
                      <span className="text-muted-foreground">{[it.planned_minutes ? `${it.planned_minutes} min` : null, it.end_by ? `by ${it.end_by}` : null].filter(Boolean).join(" · ")}{suggestion(it)}</span>
                    </label>
                  ))}
                </div>
              )
            })}
          </fieldset>
        )
      })}
    </div>
  )
}

/** A few names, then "and n more". */
const names = (list: string[]) => (list.length > 6 ? `${list.slice(0, 6).join(", ")} and ${list.length - 6} more` : list.join(", "))

/** How the draft differs from the service open in the rundown: what is new, not there, or timed differently. */
function Differences({ title, draft, open }: { title: string; draft: QueueItem[]; open: QueueItem[] }) {
  const diff = draftDiff(draft, open)
  const same = diff.added.length + diff.missing.length + diff.changed.length === 0
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-muted p-2">
      <p className="font-medium">
        Compared with "{title}": {same ? "the same items and times" : [diff.added.length && `${diff.added.length} new`, diff.missing.length && `${diff.missing.length} not in this draft`, diff.changed.length && `${diff.changed.length} with a different time`].filter(Boolean).join(" · ")}
      </p>
      {diff.added.length > 0 && <p>New: {names(diff.added)}</p>}
      {diff.missing.length > 0 && <p>Not in this draft: {names(diff.missing)}</p>}
      {diff.changed.length > 0 && <p>Different time: {diff.changed.slice(0, 6).map((c) => `${c.label} ${c.from} → ${c.to}`).join("; ")}{diff.changed.length > 6 ? ` and ${diff.changed.length - 6} more` : ""}</p>}
    </div>
  )
}

/** The assistant's look / scene suggestion for an item, to apply by hand if wanted (MCP-004). */
function suggestion(it: AiDraftItem): string {
  const parts = [it.suggested_look ? `look: ${it.suggested_look}` : null, it.suggested_scene ? `scene: ${it.suggested_scene}` : null].filter(Boolean)
  return parts.length ? ` (${parts.join(", ")})` : ""
}
