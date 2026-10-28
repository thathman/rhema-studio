import { useCallback, useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { SparklesIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { draftAuthor, draftDiff, draftToRundown, isOpened, itemKey, leaveOut, matchSuggestions, type AiDraft, type AiDraftItem, type DraftNames } from "@/lib/ai-drafts"
import type { QueueItem } from "@/types"
import { formatMinutes } from "@/lib/service-timing"
import { CUE_ACTIONS } from "@/lib/cues"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useBroadcastStore } from "@/stores/broadcast-store"

/**
 * Prepare → AI drafts (Rhema MCP, #252): services an assistant proposed, waiting for review.
 * Opening one puts it in Prepare's rundown (the one being edited, #299) as an unsaved service
 * to edit and save; nothing is saved, approved or shown by opening it. People can untick items
 * to leave out first, and see how it differs from the service that is open. Shown when assistants
 * are allowed or a draft is waiting. Opening one marks it opened (#252 UI4): it stops waiting and
 * the assistant can no longer revise it. The check's warnings are shown with each draft.
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
  // The church's looks and scenes: a suggestion naming one becomes the item's look or scene.
  const looks = useBroadcastStore((s) => s.themes)
  const scenes = useBroadcastStore((s) => s.scenes)
  const cameras = useSettingsStore((s) => s.cameras)
  const names: DraftNames = { looks, scenes, cameras }
  const waiting = drafts.filter((d) => !isOpened(d)).length
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
    const { items, headers } = draftToRundown(leaveOut(d, outOf(d)), undefined, names)
    useQueueStore.setState({ items, headers, activeIndex: null })
    useQueueStore.getState().resetHistory() // the closed service's states are not the draft's
    setReplace(null)
    setPicking(null)
    setOpen(false)
    // It stops waiting: the assistant can no longer revise what people are now working on.
    void invoke("ai_draft_mark_opened", { id: d.id, by: useSettingsStore.getState().operatorName || null }).catch(() => {}).then(load)
    const suggestions = items.filter((i) => i.ai_suggestion).length
    toast.success(`${d.title} is now the rundown in Prepare`, { description: `Unsaved: check every item, source anything marked Missing${suggestions ? `, accept the ${suggestions} ${suggestions === 1 ? "slide" : "slides"} marked AI suggestion` : ""}, then use New service to save it.` })
  }
  const remove = async (d: AiDraft) => {
    await invoke("ai_draft_delete", { id: d.id }).catch(() => {})
    void load()
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <SparklesIcon /> AI drafts{waiting > 0 ? ` (${waiting})` : ""}
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); setReplace(null); setPicking(null) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Services an AI assistant proposed</DialogTitle>
            <DialogDescription>Each was checked against your library and Bible editions. Opening one puts it in the rundown you edit here in Prepare, as an unsaved service to check and save; nothing is approved or shown until you do. A suggested look, scene or camera your church has is set on its item for Preview, and steps for your own Take wait for you to Take it; nothing is taken live. Slides the assistant wrote are marked AI suggestion until you accept each one.</DialogDescription>
          </DialogHeader>
          {drafts.length > 0 && (count > 0 || current) && (
            <p className="rounded-md bg-muted p-2 text-xs">
              Opening a draft replaces the rundown{current ? ` of "${current.title}"` : ""} ({count} {count === 1 ? "item" : "items"}){current ? " and closes that service; what it has saved stays saved" : ""}.{count > 0 || dirty ? " You are asked first." : ""}
            </p>
          )}
          {drafts.length === 0 && <p className="text-sm text-muted-foreground">None waiting. Ask your assistant to plan a service with Rhema Studio (Settings → AI assistants).</p>}
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
                  {isOpened(d) && <p className="font-medium">Opened{d.opened_at ? ` ${new Date(d.opened_at).toLocaleString()}` : ""}{d.opened_by ? ` by ${d.opened_by}` : ""}: no longer waiting, and the assistant cannot revise it. Remove it when you are done.</p>}
                  <p>{items.length < all ? `${items.length} of ${all}` : items.length} items{minutes ? ` · ${formatMinutes(minutes * 60_000)} planned in all` : ""}{missing.length > 0 ? <span className="font-semibold text-confidence-mid"> · {missing.length} missing from the library</span> : null}</p>
                  {choosing ? (
                    <ChooseItems draft={d} out={out} names={names} onChange={(next) => setPicking({ id: d.id, out: next })} />
                  ) : (
                    <ol className="flex flex-col gap-0.5 text-muted-foreground">
                      {d.phases.map((p, i) => <li key={i}><span className="font-semibold text-foreground">{p.name}</span>{p.starts_at ? ` · ${p.starts_at}` : ""}: {p.items.map((it, ii) => `${it.group && it.group !== p.items[ii - 1]?.group ? `[${it.group}] ` : ""}${label(it)}${it.end_by ? ` (by ${it.end_by})` : ""}${suggestion(it, names)}`).join(" · ")}</li>)}
                    </ol>
                  )}
                  {current && <Differences title={current.title} draft={draftToRundown(chosen, () => "", names).items} open={rundown} />}
                  {d.assumptions && d.assumptions.length > 0 && <p className="text-muted-foreground">Assumed: {d.assumptions.join("; ")}</p>}
                  {d.warnings && d.warnings.length > 0 && (
                    <div className="rounded-md border border-border p-2">
                      <p className="font-medium">The check found {d.warnings.length === 1 ? "one thing" : `${d.warnings.length} things`} to look at:</p>
                      <ul className="list-disc pl-4 text-muted-foreground">
                        {d.warnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}
                        {d.warnings.length > 8 && <li>and {d.warnings.length - 8} more</li>}
                      </ul>
                    </div>
                  )}
                  {replace?.id === d.id ? (
                    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-2">
                      <span className="flex-1">The rundown has {count} {count === 1 ? "item" : "items"}{dirty ? " and unsaved changes" : ""}. Replace them with this draft?</span>
                      <Button size="sm" variant="ghost" onClick={() => setReplace(null)}>Keep mine</Button>
                      <Button size="sm" variant="destructive" onClick={() => openDraft(d, true)}>Replace</Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={items.length === 0} onClick={() => openDraft(d)} title="Put this draft in the rundown here, as an unsaved service">{items.length < all ? `Open ${items.length} of ${all} items in the rundown` : isOpened(d) ? "Open again in the rundown" : "Open in the rundown"}</Button>
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
function ChooseItems({ draft, out, names, onChange }: { draft: AiDraft; out: Set<string>; names: DraftNames; onChange: (out: Set<string>) => void }) {
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
                      <span className="text-muted-foreground">{[it.planned_minutes ? `${it.planned_minutes} min` : null, it.end_by ? `by ${it.end_by}` : null].filter(Boolean).join(" · ")}{suggestion(it, names)}</span>
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

/**
 * The assistant's look / scene suggestion for an item (MCP-004): set on the item when the church has
 * one by that name, otherwise only shown, to choose by hand in the item's Look and scene.
 */
function suggestion(it: AiDraftItem, names: DraftNames): string {
  const { look, scene } = matchSuggestions(it, names)
  const part = (what: string, m: { name: string; id: string | null } | null) => (m ? `${what}: ${m.name}${m.id ? "" : " (none here by that name)"}` : null)
  const camera = it.camera ? names.cameras?.find((c) => c.name === it.camera)?.label || it.camera : null
  const take = [it.on_take?.bible_feeds_only && "Bible feeds only", it.on_take?.scene && `scene ${it.on_take.scene}`, it.on_take?.obs_scene && `OBS ${it.on_take.obs_scene}`].filter(Boolean)
  const parts = [
    part("look", look),
    part("scene", scene),
    camera && `camera: ${camera}`,
    it.second_translation && `with ${it.second_translation}`,
    it.languages?.length && `in ${it.languages.join(" + ")}`,
    it.arrangement?.name && `arrangement: ${it.arrangement.name}`,
    it.on_live?.stage_message && `stage: "${it.on_live.stage_message}"`,
    it.on_live?.cue && CUE_ACTIONS[it.on_live.cue] && `as it goes live: ${CUE_ACTIONS[it.on_live.cue].label.toLowerCase()}`,
    take.length > 0 && `on your Take: ${take.join(", ")}`,
  ].filter(Boolean)
  return parts.length ? ` (${parts.join(", ")})` : ""
}
