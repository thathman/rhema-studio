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
  const [conflict, setConflict] = useState<{ actual: number; from: "save" | "submit" } | null>(null)
  // After "Keep my draft": the host's newer plan this desk chose to save over. Saving asks first.
  const [theirs, setTheirs] = useState<HostPlan | null>(null)
  const [confirmingReplace, setConfirmingReplace] = useState(false)
  // A plan the operator picked while this draft had unsaved changes.
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null)
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
    setTheirs(null)
    setConfirmingReplace(false)
    setPendingSwitch(null)
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

  /** What saving over the host's newer plan removes: the item counts and the items that disappear. */
  const ids = new Set(draft.map((item) => item.id).filter(Boolean))
  const replacing = theirs && theirs.program.revision === revision
    ? { before: theirs.items.length, after: draft.length, removed: theirs.items.filter((item) => !ids.has(item.id)).map((item) => item.reference) }
    : null

  const save = async (confirmed = false) => {
    if (!host || revision === null) return
    if (replacing && !confirmed) {
      setConfirmingReplace(true)
      return
    }
    setConfirmingReplace(false)
    setBusy("save")
    setOutcome(null)
    // Editing is locked while the save is in flight (the fieldset below), so the host's answer is
    // exactly what was sent and nothing typed meanwhile can be dropped.
    const saved = await saveHostPlanDraft(host.program.id, revision, draft)
    setBusy(null)
    if (saved.ok) {
      setHost(saved.value)
      setDraft(saved.value.items.map(keyed))
      setConflict(null)
      setTheirs(null)
      setOutcome({ tone: "ok", text: `Draft saved as revision ${saved.value.program.revision}. Live still uses the approved revision until the main computer approves this one.` })
      return
    }
    if (saved.failure.kind === "conflict") setConflict({ actual: saved.failure.actual, from: "save" })
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
    setConfirmingReplace(false)
    setTheirs(keepMine ? got.value : null)
    if (keepMine) {
      setOutcome({ tone: "ok", text: `Your draft is kept. The main computer's plan is now at revision ${got.value.program.revision}; Save draft will ask before it replaces that change with yours.` })
    } else {
      setDraft(got.value.items.map(keyed))
      setOutcome({ tone: "ok", text: `Reloaded the main computer's plan at revision ${got.value.program.revision}. Your unsaved changes were dropped.` })
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
      setOutcome({ tone: "ok", text: `Revision ${revision} is with the main computer for review (in its Approval Requests). It is not approved or on a screen yet.` })
      return
    }
    if (sent.failure.kind === "conflict") setConflict({ actual: sent.failure.actual, from: "submit" })
    say(sent.failure)
  }

  const working = busy !== null || loading

  const pick = (id: string) => {
    if (dirty && id !== selected) {
      setPendingSwitch(id)
      return
    }
    setSelected(id)
    void open(id)
  }
  const pendingTitle = plans?.find((plan) => plan.id === pendingSwitch)?.title

  return (
    <section aria-label="Service plan draft" className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div>
        <h2 className="font-semibold">Service plan draft</h2>
        <p className="mt-1 text-sm text-muted-foreground">Change the main computer's service plan here, save your draft, then submit it for review. Saving never approves it; Live keeps the approved revision.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Service plan" value={selected} disabled={!plans?.length || working} onChange={(event) => pick(event.currentTarget.value)} className="h-8 max-w-72 rounded-md border border-input bg-card px-1.5">
          {plans === null && <option value="">Loading the main computer's plans…</option>}
          {plans?.length === 0 && <option value="">No service plans on the main computer</option>}
          {plans?.map((plan) => <option key={plan.id} value={plan.id}>{plan.title}{plan.service_date ? ` · ${plan.service_date}` : ""}</option>)}
        </select>
        {host && (
          <p role="status" aria-label="Draft state" className="text-xs text-muted-foreground">
            Revision {revision}{approved !== null ? ` · approved ${approved}` : " · not approved yet"}{dirty ? " · unsaved changes" : " · saved"}
          </p>
        )}
      </div>

      {pendingSwitch && (
        <div role="alert" aria-label="Unsaved draft" className="flex flex-col gap-2 rounded-md border border-confidence-mid/40 bg-confidence-mid/10 p-2.5">
          <p><span className="font-semibold">You have unsaved changes to {host?.program.title ?? "this plan"}.</span> Opening {pendingTitle ?? "another plan"} drops them.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setPendingSwitch(null)}>Stay and keep my changes</Button>
            <Button size="sm" variant="outline" onClick={() => { const id = pendingSwitch; setSelected(id); void open(id) }}>Open it and drop my changes</Button>
          </div>
        </div>
      )}

      {conflict && (
        <div role="alert" aria-label="Plan conflict" className="flex flex-col gap-2 rounded-md border border-confidence-mid/40 bg-confidence-mid/10 p-2.5">
          {conflict.from === "save"
            ? <p><span className="font-semibold">The plan changed on the main computer since you opened it</span> (it is at revision {conflict.actual} now). Your latest changes were not saved.</p>
            : <p><span className="font-semibold">Someone saved the plan after you</span> (it is at revision {conflict.actual} now). Your revision {revision} is still saved on the main computer, but it was not submitted for review.</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={working} onClick={() => void resolve(false)}>Reload the main computer's plan</Button>
            <Button size="sm" variant="outline" disabled={working} onClick={() => void resolve(true)}>Keep my draft</Button>
          </div>
        </div>
      )}

      {confirmingReplace && replacing && (
        <div role="alert" aria-label="Replace the main computer's changes" className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5">
          <p><span className="font-semibold">Saving replaces the main computer's revision {revision} with your draft.</span> The main computer's plan has {replacing.before} item{replacing.before === 1 ? "" : "s"}; yours has {replacing.after}.</p>
          {replacing.removed.length > 0
            ? <p>These items will disappear: {replacing.removed.join(", ")}.</p>
            : <p>No item disappears, but their changes to the items you share are replaced by yours.</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="destructive" disabled={working} onClick={() => void save(true)}>Replace with my draft</Button>
            <Button size="sm" variant="outline" disabled={working} onClick={() => setConfirmingReplace(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <fieldset disabled={working} aria-label="Draft editing" className="flex min-w-0 flex-col gap-3 disabled:opacity-70">
      {busy === "save" && <p role="status" className="text-xs text-muted-foreground">Saving… editing is paused until the main computer answers.</p>}
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

      </fieldset>

      {host && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!canSend || !dirty || working || !!conflict || confirmingReplace} onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save draft"}</Button>
          <input aria-label="Note for the reviewer" value={note} onChange={(event) => setNote(event.currentTarget.value)} placeholder="Note for the reviewer (optional)" maxLength={500} className={`${field} min-w-40 flex-1`} />
          <Button size="sm" variant="outline" disabled={!canSend || dirty || working || !!conflict || revision === approved} onClick={() => void submit()}>{busy === "submit" ? "Submitting…" : "Submit for review"}</Button>
          {dirty && <p className="basis-full text-xs text-muted-foreground">Save your draft before submitting it for review.</p>}
          {!dirty && revision !== null && revision === approved && <p className="basis-full text-xs text-muted-foreground">This revision is already the approved one; change and save it to submit a new one.</p>}
          {!canSend && <p role="status" className="basis-full text-xs text-muted-foreground">The main computer is not accepting changes from this desk right now; your draft stays here.</p>}
        </div>
      )}

      {outcome && <p aria-label="Plan draft result" role={outcome.tone === "error" ? "alert" : "status"} aria-live="polite" className={outcome.tone === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{outcome.text}</p>}
    </section>
  )
}
