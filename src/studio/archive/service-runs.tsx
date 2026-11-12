import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { ArchiveIcon, DownloadIcon } from "lucide-react"
import { invoke } from "@tauri-apps/api/core"
import { save } from "@tauri-apps/plugin-dialog"
import { writeTextFile } from "@tauri-apps/plugin-fs"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { retentionWords, transcriptSection } from "@/lib/journal-transcript"
import { useTranscriptStore } from "@/stores/transcript-store"
import { useServiceStore } from "@/stores/service-store"
import { flushServiceRunCheckpoint, finalizeServiceRun, journalText, keepJournal, startNewJournal, useJournalStore } from "@/stores/journal-store"
import { useSettingsStore } from "@/stores/settings-store"
import { ConfirmDelete } from "@/studio/ui/confirm-delete"
import { describeError } from "@/studio/library/content-actions"
import { LoadFailedRow } from "@/studio/library/load-failed-row"
import type { ServiceLog, ServiceLogSummary, ServiceRunSummary, TranscriptSegment } from "@/types"

/**
 * History → Service runs and logs (#811 R12: History's own code, moved from Library).
 *
 * Three parts, each with its own name (#805 R6): "This session's log" (what has gone live since the
 * app opened, which can be kept, saved as a file or cleared), "Saved runs" (each run's chronology,
 * opened as its own page) and "Kept logs" (logs kept in the database). Run records themselves are
 * never edited here; keeping, saving or deleting a log changes only these records, never an output
 * (#824 F13).
 */
export function JournalBlock({ onOpenRun }: { onOpenRun?: (runId: string) => void } = {}) {
  const entries = useJournalStore((s) => s.entries)
  const runContext = useJournalStore((s) => s.runContext)
  const runStatus = useJournalStore((s) => s.runStatus)
  const checkpointStatus = useJournalStore((s) => s.checkpointStatus)
  const checkpointError = useJournalStore((s) => s.checkpointError)
  const programs = useServiceStore((s) => s.programs)
  const [busy, setBusy] = useState(false)
  const [archived, setArchived] = useState(0)
  const [filterProgramId, setFilterProgramId] = useState("all")
  const segments = useTranscriptStore((s) => s.segments)
  const finalCount = segments.filter((s) => s.is_final && s.text.trim()).length
  // AR-004: the transcript goes into a log only when ticked for that log; never by default.
  const [withTranscript, setWithTranscript] = useState(false)
  // A new log clears what was said (#411): passages not kept with a log are asked about first.
  const [keptSegments, setKeptSegments] = useState<TranscriptSegment[] | null>(null)
  const [confirmNewLog, setConfirmNewLog] = useState(false)
  const unkeptTranscript = finalCount > 0 && keptSegments !== segments
  const provider = useSettingsStore((s) => {
    if (s.sttProvider === "deepgram") return "Deepgram (cloud)"
    if (s.sttProvider === "openai") return "OpenAI (cloud)"
    return "Whisper (on this computer)"
  })
  const retention = useSettingsStore((s) => s.transcriptRetentionDays)
  const keepLog = async () => {
    setBusy(true)
    try {
      const said = useTranscriptStore.getState().segments
      await keepJournal(withTranscript ? transcriptSection(said, provider) : "")
      if (withTranscript) setKeptSegments(said)
      setArchived((n) => n + 1)
      toast.success("Log kept", { description: "Find it under Kept logs, even after a restart." })
    } catch (e) {
      toast.error(describeError(e))
    } finally {
      setBusy(false)
    }
  }
  const retryRunSave = async () => {
    setBusy(true)
    try {
      if (runStatus === "finished") await finalizeServiceRun()
      else await flushServiceRunCheckpoint()
      toast.success(runStatus === "finished" ? "Run saved to History" : "Run checkpoint saved")
    } catch (e) {
      toast.error("Run could not be saved", { description: describeError(e) })
    } finally {
      setBusy(false)
    }
  }
  const newLog = async () => {
    if (unkeptTranscript && !confirmNewLog) {
      setConfirmNewLog(true)
      return
    }
    setConfirmNewLog(false)
    try {
      await startNewJournal()
    } catch (e) {
      toast.error("The previous run could not be saved", { description: describeError(e) })
    }
  }
  const text = () => journalText() + (withTranscript ? transcriptSection(useTranscriptStore.getState().segments, provider) : "")
  const saveLog = async () => {
    setBusy(true)
    try {
      const path = await save({ defaultPath: `rhema-service-log-${new Date().toISOString().slice(0, 10)}.txt`, filters: [{ name: "Text", extensions: ["txt"] }] })
      if (path) {
        await writeTextFile(path, text())
        toast.success(`Log saved to ${path}`)
      }
    } catch (e) {
      toast.error(describeError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-lg border border-border p-3" aria-label="This session's log">
        <p className="mb-1 font-medium">This session's log</p>
        <p className="mb-2 text-xs text-muted-foreground">{entries.length ? `${entries.length} journal entr${entries.length === 1 ? "y" : "ies"}${runContext ? ` for ${runContext.title}` : " in this session"}: what happened against the captured service plan.` : "Nothing has gone live yet in this run of the app."}</p>
        {runContext && <p className="mb-2 text-xs text-muted-foreground" role="status">
          {runStatus === "finished" ? "Finished run" : runStatus === "interrupted" ? "Interrupted run" : "Active run"} · {checkpointStatus === "saving" ? "saving checkpoint…" : checkpointStatus === "saved" ? "saved on this computer" : checkpointStatus === "error" ? "save needs attention" : "checkpoint pending"}
        </p>}
        {runContext && checkpointStatus === "error" && <div className="mb-2 flex flex-wrap items-center gap-2" role="alert">
          <p className="text-xs text-destructive">{checkpointError}</p>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void retryRunSave()}>Retry save</Button>
        </div>}
        {finalCount > 0 && (
          <label className="mb-2 flex items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5" checked={withTranscript} onChange={(e) => setWithTranscript(e.target.checked)} />
            <span>
              Include what was said ({finalCount} recognised passage{finalCount === 1 ? "" : "s"})
              <span className="block text-[0.6875rem] text-muted-foreground">
                Machine-recognised speech, not checked. It then stays in the kept log (searchable under Kept logs) {retentionWords(retention)} (Settings → Speech). Keep it only if the people speaking know it is recorded.
              </span>
            </span>
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy || entries.length === 0} onClick={() => void keepLog()}><ArchiveIcon /> Keep this log</Button>
          <Button size="sm" variant="outline" disabled={busy || entries.length === 0} onClick={() => void saveLog()}><DownloadIcon /> Save the log…</Button>
          <Button size="sm" variant="ghost" disabled={entries.length === 0 || busy} onClick={() => void newLog()}>Start a new log</Button>
        </div>
        {confirmNewLog && (
          <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-confidence-mid/40 p-2 text-xs">
            <p className="min-w-0 flex-1">What was said ({finalCount} passage{finalCount === 1 ? "" : "s"}) is not kept with a log. A new log starts with an empty transcript, so it would be gone.</p>
            <Button size="sm" variant="outline" onClick={() => setConfirmNewLog(false)}>Keep the log first</Button>
            <Button size="sm" variant="destructive" onClick={() => void newLog()}>Clear and start</Button>
          </div>
        )}
      </section>
      {programs.length > 0 && <label className="flex items-center gap-2 text-xs">
        <span>Show runs and logs for</span>
        <Select value={filterProgramId} onValueChange={setFilterProgramId}>
          <SelectTrigger className="h-7 w-56 text-xs" aria-label="Filter History by service"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All services</SelectItem>
            {programs.filter((p) => !p.is_template).map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>}
      <SavedRuns key={`${filterProgramId}:${archived}`} programId={filterProgramId === "all" ? null : filterProgramId} onOpenRun={onOpenRun} />
      <KeptLogs key={`${filterProgramId}:${archived}`} refresh={archived} programId={filterProgramId === "all" ? null : filterProgramId} onChanged={() => setArchived((count) => count + 1)} />
    </div>
  )
}

/** Logs kept in the database: newest first, searchable, each one saveable as a file. */
function KeptLogs({ refresh, programId, onChanged }: { refresh: number; programId: string | null; onChanged: () => void }) {
  const [query, setQuery] = useState("")
  const [logs, setLogs] = useState<ServiceLogSummary[]>([])
  // A failed load says so (#832 S8); it never hides the section as if there were no logs.
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    invoke<ServiceLogSummary[]>("content_list_service_logs", { query: query.trim() || null, limit: 50, programId })
      .then((l) => { if (!cancelled) { setLogs(l); setError(null) } })
      .catch((e: unknown) => { if (!cancelled) { setLogs([]); setError(describeError(e)) } })
    return () => { cancelled = true }
  }, [query, refresh, programId, attempt])
  const [gone, setGone] = useState<string[]>([])
  const saveAs = async (l: ServiceLogSummary) => {
    try {
      const full = await invoke<ServiceLog | null>("content_get_service_log", { id: l.id })
      if (!full) return
      const path = await save({ defaultPath: `${l.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "service-log"}.txt`, filters: [{ name: "Text", extensions: ["txt"] }] })
      if (path) {
        await writeTextFile(path, full.body)
        toast.success(`Log saved to ${path}`)
      }
    } catch (e) {
      toast.error(describeError(e))
    }
  }
  const remove = async (id: string) => {
    try {
      await invoke("content_delete_service_log", { id })
      setGone((g) => [...g, id])
      onChanged()
    } catch (e) {
      toast.error(describeError(e))
    }
  }
  const shown = logs.filter((l) => !gone.includes(l.id))
  if (!error && shown.length === 0 && !query) return null
  return (
    <section className="border-t border-border pt-2" aria-label="Kept logs">
      <div className="mb-1 flex items-center gap-2">
        <p className="text-xs font-medium">Kept logs</p>
        <Input aria-label="Search kept logs" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a title or a reference" className="h-7 flex-1 text-xs" />
      </div>
      {error && <LoadFailedRow what="kept logs" error={error} onRetry={() => setAttempt((n) => n + 1)} />}
      <ul className="max-h-40 overflow-y-auto">
        {!error && shown.length === 0 && <li className="px-1 py-1 text-xs text-muted-foreground">Nothing matches.</li>}
        {shown.map((l) => (
          <li key={l.id} className="flex items-center gap-2 px-1 py-1 text-xs">
            <span className="min-w-0 flex-1 truncate">{l.title}</span>
            <span className="shrink-0 text-muted-foreground">{new Date(l.finished_at ?? l.saved_at).toLocaleDateString(undefined, l.time_zone ? { timeZone: l.time_zone } : {})}</span>
            <Button size="icon-xs" variant="ghost" aria-label={`Save ${l.title} as a file`} onClick={() => void saveAs(l)}><DownloadIcon /></Button>
            <ConfirmDelete label={`Delete ${l.title}`} onConfirm={() => void remove(l.id)} />
          </li>
        ))}
      </ul>
    </section>
  )
}

const RUNS_PAGE = 20

/** Saved runs (current, interrupted and finished): each opens as its own chronology page (#854 G10). */
function SavedRuns({ programId, onOpenRun }: { programId: string | null; onOpenRun?: (runId: string) => void }) {
  const [runs, setRuns] = useState<ServiceRunSummary[]>([])
  // Paged (twenty at a time): Show more asks for the next twenty, keeping the order.
  const [limit, setLimit] = useState(RUNS_PAGE)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    let cancelled = false
    invoke<ServiceRunSummary[]>("content_list_service_runs", { programId, limit: limit + 1 })
      .then((result) => { if (!cancelled) { setRuns(result); setError(null) } })
      .catch((e) => { if (!cancelled) { setRuns([]); setError(describeError(e)) } })
    return () => { cancelled = true }
  }, [programId, limit])
  useEffect(() => load(), [load])
  if (!error && runs.length === 0) return null
  return (
    <section className="border-t border-border pt-2" aria-label="Saved runs">
      <p className="mb-1 text-xs font-medium">Saved runs</p>
      {error && <LoadFailedRow what="saved runs" error={error} onRetry={() => void load()} />}
      <ul className="max-h-60 overflow-y-auto">
        {runs.slice(0, limit).map((run) => (
          <li key={run.run_id} className="flex items-center gap-2 border-b border-border/60 py-1.5 text-xs last:border-0">
            <span className="min-w-0 flex-1 truncate">{run.title}</span>
            <span className="shrink-0 text-muted-foreground">{run.status === "active" ? "Active" : run.status === "interrupted" ? "Interrupted" : "Finished"}</span>
            {run.service_date && <span className="shrink-0 text-muted-foreground">{run.service_date}</span>}
            <span className="shrink-0 text-muted-foreground">{new Date(run.finished_at ?? run.updated_at).toLocaleString(undefined, run.time_zone ? { timeZone: run.time_zone } : {})}</span>
            {onOpenRun && <Button size="xs" variant="ghost" aria-label={`Open the chronology of ${run.title}`} onClick={() => onOpenRun(run.run_id)}>Open</Button>}
          </li>
        ))}
      </ul>
      {runs.length > limit && <Button size="xs" variant="ghost" className="mt-1" onClick={() => setLimit((n) => n + RUNS_PAGE)}>Show more</Button>}
    </section>
  )
}
