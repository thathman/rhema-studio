import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { useCanSend } from "@/stores/join-store"
import { useBibleStore } from "@/stores/bible-store"
import { parseTypedReference } from "@/lib/quick-search"
import {
  getHostPlan, listHostPlans, saveHostPlanDraft, submitHostPlan, toItemInput,
  type HostPlan, type HostPlanSummary, type PlanFailure, type PlanItemInput,
} from "@/lib/plans-client"

/** A draft row: what a save sends, plus a key that stays put while the row moves. */
type DraftItem = PlanItemInput & { key: string }

/** Kinds whose name is free text here; Scripture keeps its parsed reference, songs and media their payload. */
const RENAMABLE = new Set(["cue", "phase", "group"])
const KIND_WORDS: Record<string, string> = { verse: "Scripture", song: "Song", slide: "Slide", image: "Image", audio: "Audio", phase: "Phase", group: "Group", cue: "Cue" }

const field = "h-8 min-w-0 rounded-md border border-input bg-transparent px-2"
let nextKey = 0
const keyed = (item: PlanItemInput): DraftItem => ({ ...toItemInput(item), key: item.id ?? `new-${++nextKey}` })
const asSent = (items: readonly DraftItem[]) => JSON.stringify(items.map(toItemInput))

type Outcome = { tone: "ok" | "error"; text: string }

/**
 * The joined Editor's draft of a host service plan (#847, page 9 "Save draft" / "Submit for review"):
 * load the host's plan, change it here, save it at the revision it was opened at, and submit that
 * revision for the main desk's review. The host checks the role, the pause and the revision; a save
 * never approves and nothing here changes Live.
 */
export function EditorPlanDraft() {
  const canSend = useCanSend()
  const books = useBibleStore((state) => state.books)
  const [plans, setPlans] = useState<HostPlanSummary[] | null>(null)
  const [selected, setSelected] = useState<string>("")
  const [host, setHost] = useState<HostPlan | null>(null)
  const [draft, setDraft] = useState<DraftItem[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<"save" | "submit" | "resolve" | null>(null)
  const [conflict, setConflict] = useState<{ actual: number } | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [addReference, setAddReference] = useState("")
  const [addCue, setAddCue] = useState("")
  const [note, setNote] = useState("")
  const loadRequest = useRef(0)

  const say = (failure: PlanFailure) => setOutcome({ tone: "error", text: failure.message })

  const open = useCallback(async (id: string) => {
    const request = ++loadRequest.current
    setLoading(true)
    setConflict(null)
    setOutcome(null)
    const got = await getHostPlan(id)
    if (request !== loadRequest.current) return
    setLoading(false)
    if (!got.ok) {
      setHost(null)
      setDraft([])
      say(got.failure)
      return
    }
    setHost(got.value)
    setDraft(got.value.items.map(keyed))
  }, [])

  useEffect(() => {
    let mounted = true
    void listHostPlans().then((listed) => {
      if (!mounted) return
      if (!listed.ok) {
        setPlans([])
        say(listed.failure)
        return
      }
      setPlans(listed.value)
      const first = listed.value[0]
      if (first) {
        setSelected(first.id)
        void open(first.id)
      }
    })
    return () => { mounted = false }
  }, [open])

  // A plan still loading when the desk closes is not shown.
  useEffect(() => () => { loadRequest.current++ }, [])

  const dirty = !!host && asSent(draft) !== asSent(host.items.map(keyed))
  const revision = host?.program.revision ?? null
  const approved = host?.program.approved_revision ?? null

  const change = (key: string, patch: Partial<PlanItemInput>) => setDraft((items) => items.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  const move = (index: number, by: -1 | 1) => setDraft((items) => {
    const to = index + by
    if (to < 0 || to >= items.length) return items
    const next = [...items]
    ;[next[index], next[to]] = [next[to]!, next[index]!]
    return next
  })
  const remove = (key: string) => setDraft((items) => items.filter((item) => item.key !== key))

  const addScripture = () => {
    const parsed = parseTypedReference(addReference, books)
    if (!parsed) {
      setOutcome({ tone: "error", text: "Type a Scripture reference like Psalm 100:1 to add it." })
      return
    }
    const reference = `${parsed.book.name} ${parsed.chapter}:${parsed.verse}`
    setDraft((items) => [...items, keyed({ kind: "verse", reference, book_number: parsed.book.book_number, chapter: parsed.chapter, verse: parsed.verse })])
    setAddReference("")
    setOutcome(null)
  }
  const addCueMoment = () => {
    const name = addCue.trim()
    if (!name) return
    setDraft((items) => [...items, keyed({ kind: "cue", reference: name })])
    setAddCue("")
  }

  const save = async () => {
    if (!host || revision === null) return
    setBusy("save")
    setOutcome(null)
    const saved = await saveHostPlanDraft(host.program.id, revision, draft)
    setBusy(null)
    if (saved.ok) {
      setHost(saved.value)
      setDraft(saved.value.items.map(keyed))
      setConflict(null)
      setOutcome({ tone: "ok", text: `Draft saved as revision ${saved.value.program.revision}. Live still uses the approved revision until the main desk approves this one.` })
      return
    }
    if (saved.failure.kind === "conflict") setConflict({ actual: saved.failure.actual })
    say(saved.failure)
  }

  /** The plan changed on the host: take the host's plan, or keep this draft and save it over the new revision. */
  const resolve = async (keepMine: boolean) => {
    if (!host) return
    setBusy("resolve")
    const got = await getHostPlan(host.program.id)
    setBusy(null)
    if (!got.ok) {
      say(got.failure)
      return
    }
    setHost(got.value)
    setConflict(null)
    if (keepMine) {
      setOutcome({ tone: "ok", text: `Your draft is kept. The host's plan is now at revision ${got.value.program.revision}; Save draft replaces that change with yours.` })
    } else {
      setDraft(got.value.items.map(keyed))
      setOutcome({ tone: "ok", text: `Reloaded the host's plan at revision ${got.value.program.revision}. Your unsaved changes were dropped.` })
    }
  }

  const submit = async () => {
    if (!host || revision === null || dirty) return
    setBusy("submit")
    setOutcome(null)
    const sent = await submitHostPlan(host.program.id, revision, note)
    setBusy(null)
    if (sent.ok) {
      setNote("")
      setOutcome({ tone: "ok", text: `Revision ${revision} is with the main desk for review (in its Approval Requests). It is not approved or on a screen yet.` })
      return
    }
    if (sent.failure.kind === "conflict") setConflict({ actual: sent.failure.actual })
    say(sent.failure)
  }

  const working = busy !== null || loading

  return (
    <section aria-label="Service plan draft" className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div>
        <h2 className="font-semibold">Service plan draft</h2>
        <p className="mt-1 text-sm text-muted-foreground">Change the host's service plan here, save your draft, then submit it for review. Saving never approves it; Live keeps the approved revision.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Service plan" value={selected} disabled={!plans?.length || working} onChange={(event) => { setSelected(event.currentTarget.value); void open(event.currentTarget.value) }} className="h-8 max-w-72 rounded-md border border-input bg-card px-1.5">
          {plans === null && <option value="">Loading the host's plans…</option>}
          {plans?.length === 0 && <option value="">No service plans on the host</option>}
          {plans?.map((plan) => <option key={plan.id} value={plan.id}>{plan.title}{plan.service_date ? ` · ${plan.service_date}` : ""}</option>)}
        </select>
        {host && (
          <p role="status" aria-label="Draft state" className="text-xs text-muted-foreground">
            Revision {revision}{approved !== null ? ` · approved ${approved}` : " · not approved yet"}{dirty ? " · unsaved changes" : " · saved"}
          </p>
        )}
      </div>

      {conflict && (
        <div role="alert" aria-label="Plan conflict" className="flex flex-col gap-2 rounded-md border border-confidence-mid/40 bg-confidence-mid/10 p-2.5">
          <p><span className="font-semibold">The plan changed on the host since you opened it</span> (it is at revision {conflict.actual} now). Nothing of yours was saved.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={working} onClick={() => void resolve(false)}>Reload the host's plan</Button>
            <Button size="sm" variant="outline" disabled={working} onClick={() => void resolve(true)}>Keep my draft</Button>
          </div>
        </div>
      )}

      {host && (
        <ol aria-label="Draft items" className="flex flex-col divide-y divide-border rounded-md border border-border">
          {draft.length === 0 && <li className="px-2 py-2 text-sm text-muted-foreground">This plan has no items yet.</li>}
          {draft.map((item, index) => (
            <li key={item.key} className="flex flex-col gap-1.5 px-2 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[0.625rem] font-bold tracking-wide text-muted-foreground uppercase">{KIND_WORDS[item.kind] ?? item.kind}</span>
                {RENAMABLE.has(item.kind)
                  ? <input aria-label={`Name of item ${index + 1}`} value={item.reference} maxLength={200} onChange={(event) => change(item.key, { reference: event.currentTarget.value })} className={`${field} flex-1`} />
                  : <span className="flex-1 font-medium">{item.reference}</span>}
                <Button size="xs" variant="ghost" aria-label={`Move item ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>↑</Button>
                <Button size="xs" variant="ghost" aria-label={`Move item ${index + 1} down`} disabled={index === draft.length - 1} onClick={() => move(index, 1)}>↓</Button>
                <Button size="xs" variant="ghost" aria-label={`Remove item ${index + 1}`} onClick={() => remove(item.key)}>Remove</Button>
              </div>
              <textarea aria-label={`Notes for item ${index + 1}`} value={item.notes ?? ""} maxLength={4000} rows={1} placeholder="Notes for the team" onChange={(event) => change(item.key, { notes: event.currentTarget.value || null })} className="min-h-8 rounded-md border border-input bg-transparent px-2 py-1 text-sm" />
            </li>
          ))}
        </ol>
      )}

      {host && (
        <div className="flex flex-wrap gap-2">
          <form className="flex flex-1 gap-2" onSubmit={(event) => { event.preventDefault(); addScripture() }}>
            <input aria-label="Scripture to add" value={addReference} onChange={(event) => setAddReference(event.currentTarget.value)} placeholder="Psalm 100:1" maxLength={120} className={`${field} min-w-32 flex-1`} />
            <Button size="sm" type="submit" variant="outline" disabled={!addReference.trim()}>Add Scripture</Button>
          </form>
          <form className="flex flex-1 gap-2" onSubmit={(event) => { event.preventDefault(); addCueMoment() }}>
            <input aria-label="Moment to add" value={addCue} onChange={(event) => setAddCue(event.currentTarget.value)} placeholder="Offering" maxLength={200} className={`${field} min-w-32 flex-1`} />
            <Button size="sm" type="submit" variant="outline" disabled={!addCue.trim()}>Add moment</Button>
          </form>
        </div>
      )}

      {host && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!canSend || !dirty || working || !!conflict} onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save draft"}</Button>
          <input aria-label="Note for the reviewer" value={note} onChange={(event) => setNote(event.currentTarget.value)} placeholder="Note for the reviewer (optional)" maxLength={500} className={`${field} min-w-40 flex-1`} />
          <Button size="sm" variant="outline" disabled={!canSend || dirty || working || !!conflict || revision === approved} onClick={() => void submit()}>{busy === "submit" ? "Submitting…" : "Submit for review"}</Button>
          {dirty && <p className="basis-full text-xs text-muted-foreground">Save your draft before submitting it for review.</p>}
          {!dirty && revision !== null && revision === approved && <p className="basis-full text-xs text-muted-foreground">This revision is already the approved one; change and save it to submit a new one.</p>}
          {!canSend && <p role="status" className="basis-full text-xs text-muted-foreground">The host is not accepting changes from this desk right now; your draft stays here.</p>}
        </div>
      )}

      {outcome && <p aria-label="Plan draft result" role={outcome.tone === "error" ? "alert" : "status"} aria-live="polite" className={outcome.tone === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{outcome.text}</p>}
    </section>
  )
}
