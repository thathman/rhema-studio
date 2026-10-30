import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"

type RecordingState =
  | "idle"
  | "preparing"
  | "recording"
  | "finalizing"
  | "saved"
  | "recoverable"
  | "failed"

interface RecordingManifest {
  sessionId: string
  state: RecordingState
  outputName: string
  profile: string
  rehearsal: boolean
  startedAt: string
  durationMs?: number | null
  files: { mp4?: string | null; mov?: string | null }
  markers: Array<{ atMs: number; label: string }>
  framesWritten: number
  framesDropped: number
  problem?: { code: string; message: string } | null
}

function durationLabel(milliseconds: number | null | undefined): string {
  if (milliseconds === null || milliseconds === undefined)
    return "Duration not available"
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  const hours = Math.floor(minutes / 60)
  return hours > 0
    ? `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
}

function startedAtLabel(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function profileLabel(profile: string): string {
  if (profile === "standard_720p30") return "720p30"
  if (profile === "hd_1080p30") return "1080p30"
  return profile
}

function stateLabel(state: RecordingState): string {
  switch (state) {
    case "saved":
      return "Saved"
    case "recoverable":
      return "Recoverable"
    case "failed":
      return "Failed"
    case "preparing":
      return "Preparing"
    case "recording":
      return "Recording"
    case "finalizing":
      return "Finalizing"
    case "idle":
      return "Not started"
  }
}

/** Read-only index for recordings created by this host. */
export function RecorderArchive() {
  const [rehearsal, setRehearsal] = useState(false)
  const [archive, setArchive] = useState<{
    rehearsal: boolean
    records: RecordingManifest[]
  } | null>(null)
  const [archiveError, setArchiveError] = useState<{
    rehearsal: boolean
    message: string
  } | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [fileAction, setFileAction] = useState<{
    sessionId: string
    action: "open" | "reveal"
  } | null>(null)
  const [fileActionMessage, setFileActionMessage] = useState<{
    sessionId: string
    message: string
    error: boolean
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    void invoke<RecordingManifest[]>("recorder_list", { rehearsal })
      .then((items) => {
        if (!cancelled) {
          setArchive({ rehearsal, records: items })
          setArchiveError(null)
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setArchiveError({
            rehearsal,
            message: reason instanceof Error ? reason.message : String(reason),
          })
      })
    return () => {
      cancelled = true
    }
  }, [rehearsal, refresh])

  const records = archive?.rehearsal === rehearsal ? archive.records : null
  const error =
    archiveError?.rehearsal === rehearsal ? archiveError.message : null

  const actOnRecordingFile = async (
    record: RecordingManifest,
    action: "open" | "reveal"
  ) => {
    setFileAction({ sessionId: record.sessionId, action })
    setFileActionMessage(null)
    try {
      await invoke(
        action === "open" ? "recorder_open_file" : "recorder_reveal_file",
        { sessionId: record.sessionId, rehearsal }
      )
      setFileActionMessage({
        sessionId: record.sessionId,
        message:
          action === "open"
            ? "Opening the recording with this computer's video app."
            : "Showing the recording in its local folder.",
        error: false,
      })
    } catch (reason) {
      setFileActionMessage({
        sessionId: record.sessionId,
        message: `Could not ${action === "open" ? "open" : "show"} the recording: ${reason instanceof Error ? reason.message : String(reason)}`,
        error: true,
      })
    } finally {
      setFileAction(null)
    }
  }

  return (
    <section
      aria-labelledby="recorder-archive-title"
      className="rounded-lg border border-border bg-card p-5 shadow-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="recorder-archive-title"
            className="text-base font-bold tracking-[-0.03em]"
          >
            Rhema-native recordings
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {rehearsal
              ? "Rehearsal records are stored separately from service recordings."
              : "Recordings are private files saved on this computer. OBS-only recording is separate from Rhema-native recording."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={rehearsal ? "outline" : "soft"}
            aria-label="Show service recordings"
            aria-pressed={!rehearsal}
            onClick={() => setRehearsal(false)}
          >
            Service
          </Button>
          <Button
            type="button"
            size="sm"
            variant={rehearsal ? "soft" : "outline"}
            aria-label="Show rehearsal recordings"
            aria-pressed={rehearsal}
            onClick={() => setRehearsal(true)}
          >
            Rehearsal
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setRefresh((value) => value + 1)}
          >
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          Recording history is unavailable: {error}
        </p>
      )}
      {!error && records === null && (
        <p role="status" className="mt-4 text-xs text-muted-foreground">
          Loading local recordings…
        </p>
      )}
      {!error && records?.length === 0 && (
        <p className="mt-4 rounded-md border border-border px-3 py-4 text-center text-xs text-muted-foreground">
          No {rehearsal ? "rehearsal " : "service "}recordings yet.
        </p>
      )}
      {!error && records && records.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {records.map((record) => (
            <li
              key={record.sessionId}
              className="flex flex-wrap items-start gap-3 rounded-md border border-border px-3 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-semibold">
                    {record.outputName}
                  </h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${record.state === "saved" ? "bg-tone-green text-tone-green-foreground" : record.state === "failed" ? "bg-destructive/10 text-destructive" : "bg-tone-amber text-tone-amber-foreground"}`}
                  >
                    {stateLabel(record.state)}
                  </span>
                  {record.rehearsal && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">
                      Rehearsal
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {startedAtLabel(record.startedAt)} ·{" "}
                  {durationLabel(record.durationMs)} ·{" "}
                  {profileLabel(record.profile)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {record.framesWritten.toLocaleString()} frames ·{" "}
                  {record.framesDropped.toLocaleString()} dropped
                  {record.markers.length
                    ? ` · ${record.markers.length} marker${record.markers.length === 1 ? "" : "s"}`
                    : ""}
                </p>
                {record.problem && (
                  <p role="alert" className="mt-1 text-xs text-amber-800">
                    {record.problem.message}
                  </p>
                )}
                {record.state === "saved" && record.files.mp4 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    MPEG-4 file saved locally. Open and export controls are not
                    available here yet.
                  </p>
                )}
                {record.state === "recoverable" && (
                  <p className="mt-1 text-xs text-amber-800">
                    This file may need recovery before it can be played.
                  </p>
                )}
                {record.state === "failed" && (
                  <p className="mt-1 text-xs text-destructive">
                    A completed recording file was not confirmed.
                  </p>
                )}
                {(record.state === "saved" ||
                  record.state === "recoverable") &&
                  record.files.mp4 && (
                    <>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-label={`Open ${record.outputName} recording ${record.sessionId}`}
                          disabled={fileAction?.sessionId === record.sessionId}
                          onClick={() => void actOnRecordingFile(record, "open")}
                        >
                          {fileAction?.sessionId === record.sessionId &&
                          fileAction.action === "open"
                            ? "Opening…"
                            : "Open recording"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-label={`Show ${record.outputName} recording ${record.sessionId} in folder`}
                          disabled={fileAction?.sessionId === record.sessionId}
                          onClick={() => void actOnRecordingFile(record, "reveal")}
                        >
                          {fileAction?.sessionId === record.sessionId &&
                          fileAction.action === "reveal"
                            ? "Opening folder…"
                            : "Show in folder"}
                        </Button>
                      </div>
                      {fileActionMessage?.sessionId === record.sessionId && (
                        <p
                          role={fileActionMessage.error ? "alert" : "status"}
                          className={`mt-1 text-xs ${fileActionMessage.error ? "text-destructive" : "text-muted-foreground"}`}
                        >
                          {fileActionMessage.message}
                        </p>
                      )}
                    </>
                  )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
