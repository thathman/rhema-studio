import { useCallback, useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { ArrowLeftIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { parseServiceRunCheckpoint } from "@/lib/service-run-checkpoint"
import { describeError } from "@/studio/library/content-actions"
import { LoadFailedRow } from "@/studio/library/load-failed-row"
import { RunJournal } from "@/studio/archive/run-journal"
import { ServiceRunReview } from "@/studio/archive/service-run-review"
import type { ServiceRun } from "@/types"

/** A saved run with its after-action notes (migration 0020; the content crate's `ServiceRun`). */
export type ServiceRunWithNotes = ServiceRun & { after_action_notes?: string | null; notes_updated_at?: string | null }

const MAX_AFTER_ACTION_NOTES = 20_000

/**
 * History → one service run's page (#854 G10): its chronology. What was planned against what
 * actually happened, every journal entry in order, the recordings filed under it, the captured plan
 * and the team's after-action notes. Review only: nothing here restores a service or sends anything
 * to a screen. Only the notes can be written.
 */
export function RunChronologyPage({ runId, onBack }: { runId: string; onBack: () => void }) {
  const [run, setRun] = useState<ServiceRunWithNotes | null | "missing">(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    let cancelled = false
    invoke<ServiceRunWithNotes | null>("content_get_service_run", { runId })
      .then((result) => { if (!cancelled) { setError(null); setRun(result ?? "missing") } })
      .catch((e: unknown) => { if (!cancelled) setError(describeError(e)) })
    return () => { cancelled = true }
  }, [runId])
  useEffect(() => load(), [load])

  const when = (iso: string | null | undefined, timeZone: string | null) => iso ? new Date(iso).toLocaleString(undefined, timeZone ? { timeZone } : {}) : null
  return (
    <div className="flex flex-col gap-4" aria-label="Service run chronology">
      <div>
        <Button size="sm" variant="outline" onClick={onBack}><ArrowLeftIcon /> Back to History</Button>
      </div>
      {error && <LoadFailedRow what="this run" error={error} onRetry={() => void load()} />}
      {!error && run === null && <p className="text-xs text-muted-foreground" role="status">Loading the run…</p>}
      {run === "missing" && <p className="text-sm text-muted-foreground">This run is no longer on this computer.</p>}
      {run && run !== "missing" && (
        <>
          <header>
            <p className="eyebrow">Service chronology</p>
            <h1 className="mt-1 text-[1.625rem] leading-tight font-bold tracking-[-0.035em]">{run.title}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {[run.service_date, run.status === "finished" ? "Finished run" : run.status === "interrupted" ? "Interrupted run" : "Active run", `started ${when(run.started_at, run.time_zone)}`, run.finished_at ? `finished ${when(run.finished_at, run.time_zone)}` : null, run.time_zone ? `times in ${run.time_zone}` : null].filter(Boolean).join(" · ")}
            </p>
          </header>
          <RunDetail run={run} />
          <AfterActionNotes run={run} onSaved={(next) => setRun(next)} />
        </>
      )}
    </div>
  )
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg border border-border bg-card p-4 text-xs shadow-panel">
      <h2 className="text-sm font-bold">{title}</h2>
      {sub && <p className="mb-2 text-muted-foreground">{sub}</p>}
      <div className={sub ? "" : "mt-2"}>{children}</div>
    </section>
  )
}

function RunDetail({ run }: { run: ServiceRunWithNotes }) {
  const checkpoint = parseServiceRunCheckpoint(run.checkpoint)
  if (!checkpoint) return <p role="alert" className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs">This saved checkpoint could not be read. Nothing was restored or sent to a screen.</p>
  const { entries, plan, headers, operator } = checkpoint
  const orderedPlan: Array<{ key: string; kind: "header" | "item"; label: string }> = []
  for (let at = 0; at <= plan.length; at++) {
    headers.filter((header) => header.at === at).forEach((header) => orderedPlan.push({ key: header.id, kind: "header", label: `${header.type}: ${header.name}` }))
    const item = plan[at]
    if (item) orderedPlan.push({ key: item.id, kind: "item", label: item.label })
  }
  return (
    <div className="grid grid-cols-2 gap-4 max-[1100px]:grid-cols-1">
      <Section title="Planned against actual" sub={run.status === "finished" ? "Each event and moment's planned length against how long it ran." : "Time after the last confirmed checkpoint is unknown."}>
        <ServiceRunReview checkpoint={checkpoint} status={run.status} />
      </Section>
      <Section title="What happened, in order" sub={operator ? `Operator: ${operator}` : undefined}>
        <RunJournal entries={entries} timeZone={run.time_zone} />
      </Section>
      <Section title="Recordings">
        <RunRecordings runId={run.run_id} timeZone={run.time_zone} />
      </Section>
      {orderedPlan.length > 0 && <Section title="The plan when the run started">
        <ol className="max-h-56 list-inside list-decimal overflow-y-auto">
          {orderedPlan.slice(0, 200).map((row) => <li key={`${row.kind}:${row.key}`} className={row.kind === "header" ? "font-medium" : "pl-3 text-muted-foreground"}>{row.label}</li>)}
          {orderedPlan.length > 200 && <li className="list-none text-muted-foreground">And {orderedPlan.length - 200} more plan rows.</li>}
        </ol>
      </Section>}
    </div>
  )
}

/** The recordings filed under this run (#447 History): where its picture and sound are kept. */
function RunRecordings({ runId, timeZone }: { runId: string; timeZone: string | null }) {
  const [recordings, setRecordings] = useState<Array<{ sessionId: string; outputName: string; startedAt: string; durationMs?: number | null; state: string; serviceRunId?: string | null }> | "error" | null>(null)
  useEffect(() => {
    let cancelled = false
    invoke<Array<{ sessionId: string; outputName: string; startedAt: string; durationMs?: number | null; state: string; serviceRunId?: string | null }>>("recorder_list", { rehearsal: false })
      .then((list) => { if (!cancelled) setRecordings(list.filter((r) => r.serviceRunId === runId)) })
      .catch(() => { if (!cancelled) setRecordings("error") })
    return () => { cancelled = true }
  }, [runId])
  if (!recordings) return <p className="text-muted-foreground" role="status">Looking for recordings…</p>
  return recordings === "error"
    ? <p role="status" className="text-muted-foreground">Recordings could not be read on this computer.</p>
    : recordings.length === 0
    ? <p className="text-muted-foreground">No Rhema recording was made during this run.</p>
    : <ul>{recordings.map((r) => <li key={r.sessionId}>{r.outputName} · {new Date(r.startedAt).toLocaleTimeString(undefined, timeZone ? { timeZone } : {})}{typeof r.durationMs === "number" ? ` · ${Math.round(r.durationMs / 60_000)} min` : ""} · {r.state} — open it in History → Recordings</li>)}</ul>
}

/** After-action notes (#854 G10; doc 28 History): what the team learned. Stored with the run. */
function AfterActionNotes({ run, onSaved }: { run: ServiceRunWithNotes; onSaved: (next: ServiceRunWithNotes) => void }) {
  const saved = run.after_action_notes ?? ""
  const [draft, setDraft] = useState(saved)
  const [busy, setBusy] = useState(false)
  const dirty = draft !== saved
  const save = async () => {
    setBusy(true)
    try {
      const next = await invoke<ServiceRunWithNotes>("content_set_service_run_notes", { runId: run.run_id, notes: draft })
      onSaved(next)
      setDraft(next.after_action_notes ?? "")
      toast.success("After-action notes saved")
    } catch (e) {
      toast.error("The notes were not saved", { description: describeError(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title="After-action notes" sub="What went well, what to change next time. Kept with this run on this computer; the run's record itself is never changed.">
      <Textarea aria-label="After-action notes" value={draft} maxLength={MAX_AFTER_ACTION_NOTES} onChange={(e) => setDraft(e.target.value)} rows={6} placeholder="The second offering song started late because… Next time…" className="text-xs" />
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[0.6875rem] text-muted-foreground" role="status">{dirty ? "Not saved yet" : run.notes_updated_at ? `Saved ${new Date(run.notes_updated_at).toLocaleString(undefined, run.time_zone ? { timeZone: run.time_zone } : {})}` : "No notes yet"}</p>
        <div className="flex gap-2">
          {dirty && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft(saved)}>Discard</Button>}
          <Button size="sm" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Saving…" : "Save notes"}</Button>
        </div>
      </div>
    </Section>
  )
}
