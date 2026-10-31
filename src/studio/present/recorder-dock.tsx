import { useEffect, useMemo, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useEventClock } from "@/stores/event-clock-store"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import { Button } from "@/components/ui/button"

type RecorderState =
  | "idle"
  | "preparing"
  | "recording"
  | "finalizing"
  | "saved"
  | "recoverable"
  | "failed"

interface RecorderProblem {
  code: string
  message: string
}

interface RecorderStatus {
  state: RecorderState
  sessionActive: boolean
  sessionId: string | null
  outputId: string | null
  startedAt: string | null
  elapsedMs: number
  video: {
    width: number
    height: number
    fps: number
    framesWritten: number
    framesDropped: number
    lastFrameAgoMs: number | null
  }
  audio: {
    deviceId: string | null
    receiving: boolean
    peakDb: number | null
    samplesWritten: number
  }
  file: {
    path: string | null
    bytes: number
    diskFreeBytes: number | null
    lastWriteOk: boolean
  }
  problem: RecorderProblem | null
}

interface RecorderPreflight {
  ok: boolean
  problems: RecorderProblem[]
  width: number
  height: number
  diskFreeBytes: number | null
  audioDevices: string[]
}

interface RecorderStartRequest {
  outputId: string
  outputName: string
  outputRole: "congregation"
  audioDeviceId: string | null
  allowSilent: boolean
  profile: "standard_720p30"
  serviceRunId: null
  programId: string | null
  rehearsal: false
}

type PendingAction = "preflight" | "start" | "stop" | "marker" | null

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

function engineStateLabel(
  status: RecorderStatus | null,
  outputName: string | undefined
): string {
  if (!status) return "Status unavailable"
  switch (status.state) {
    case "idle":
      return "Not recording"
    case "preparing":
      return "Preparing recorder"
    case "recording":
      return `Recording · ${outputName ?? "selected screen"}`
    case "finalizing":
      return "Finalizing recording"
    case "saved":
      return "Recording saved"
    case "recoverable":
      return "Recording needs recovery"
    case "failed":
      return "Recording failed"
  }
}

/** Main-desk controls for the host's independent Rhema-native recorder. */
export function RecorderDock() {
  const outputs = useBroadcastStore((state) => state.outputs)
  const rehearsal = useBroadcastStore((state) => state.rehearsal)
  const currentProgramId = useServiceStore((state) => state.current?.id ?? null)
  const currentMomentId = useEventClock((state) => state.currentMomentId)
  const queueItems = useQueueStore((state) => state.items)
  const currentMoment = currentMomentId
    ? queueItems.find((item) => item.id === currentMomentId) ?? null
    : null
  const congregationOutputs = useMemo(
    () =>
      outputs.filter(
        (output) =>
          output.type !== "browser" &&
          (output.role ?? "congregation") === "congregation"
      ),
    [outputs]
  )
  const [outputId, setOutputId] = useState("")
  const [audioDeviceId, setAudioDeviceId] = useState("")
  const [allowSilent, setAllowSilent] = useState(false)
  const [audioDevices, setAudioDevices] = useState<string[]>([])
  const [preflight, setPreflight] = useState<RecorderPreflight | null>(null)
  const [preflightKey, setPreflightKey] = useState<string | null>(null)
  const [status, setStatus] = useState<RecorderStatus | null>(null)
  const [statusEventsConnected, setStatusEventsConnected] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [confirmStop, setConfirmStop] = useState(false)
  const [markerLabel, setMarkerLabel] = useState("")
  const [lastMarker, setLastMarker] = useState<string | null>(null)
  const eventSequence = useRef(0)
  const selectedOutputId = congregationOutputs.some(
    (candidate) => candidate.id === outputId
  )
    ? outputId
    : ""
  const output = congregationOutputs.find(
    (candidate) => candidate.id === selectedOutputId
  )
  const pinnedOutputName = outputs.find(
    (candidate) => candidate.id === status?.outputId
  )?.name
  const active = Boolean(status?.sessionActive)
  const canStop = Boolean(
    status?.sessionActive &&
    (status.state === "recording" || status.state === "failed")
  )
  const request: RecorderStartRequest = {
    outputId: output?.id ?? "",
    outputName: output?.name ?? "",
    outputRole: "congregation",
    audioDeviceId: allowSilent ? null : audioDeviceId || null,
    allowSilent,
    profile: "standard_720p30",
    serviceRunId: null,
    programId: currentProgramId,
    rehearsal: false,
  }
  const requestKey = JSON.stringify(request)
  const preflightIsCurrent = preflightKey === requestKey
  const canStart = Boolean(
    preflight?.ok &&
    preflightIsCurrent &&
    output &&
    !active &&
    !rehearsal &&
    !pendingAction &&
    (allowSilent || audioDeviceId)
  )
  const stateLabel =
    pendingAction === "start"
      ? "Starting · waiting for recorder confirmation"
      : pendingAction === "stop"
        ? "Stop requested · finalizing the local file"
        : engineStateLabel(status, pinnedOutputName)

  useEffect(() => {
    let cancelled = false
    let eventReceived = false
    let unlisten: (() => void) | undefined
    const listening = listen<RecorderStatus>("recorder:status", (event) => {
      eventReceived = true
      eventSequence.current += 1
      if (!cancelled) {
        setStatus(event.payload)
        setStatusError(null)
      }
    })
      .then((stop) => {
        if (cancelled) stop()
        else {
          unlisten = stop
          setStatusEventsConnected(true)
          setStatusError(null)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled && !eventReceived) {
          setStatusEventsConnected(false)
          setStatusError(
            `Recorder status events are unavailable: ${errorMessage(error)}`
          )
        }
      })
    const initialSequence = eventSequence.current
    void invoke<RecorderStatus>("recorder_status")
      .then((next) => {
        if (
          !cancelled &&
          !eventReceived &&
          eventSequence.current === initialSequence
        ) {
          setStatus(next)
          setStatusError(null)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setStatusError(
            `Recorder status is unavailable: ${errorMessage(error)}`
          )
      })
    return () => {
      cancelled = true
      unlisten?.()
      void listening
    }
  }, [])

  useEffect(() => {
    if (!status?.sessionActive || pendingAction || statusEventsConnected)
      return
    let cancelled = false
    const timer = window.setInterval(() => {
      void invoke<RecorderStatus>("recorder_status")
        .then((next) => {
          if (!cancelled) {
            setStatus(next)
            setStatusError(null)
          }
        })
        .catch((error: unknown) => {
          if (!cancelled)
            setStatusError(
              `Recorder status refresh failed: ${errorMessage(error)}`
            )
        })
    }, 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [pendingAction, status?.sessionActive, statusEventsConnected])

  const invalidatePreflight = () => {
    setPreflight(null)
    setPreflightKey(null)
    setActionError(null)
  }

  const checkSetup = async () => {
    if (!output || pendingAction || active || rehearsal) return
    setPendingAction("preflight")
    setActionError(null)
    setPreflight(null)
    setPreflightKey(null)
    try {
      const checked = await invoke<RecorderPreflight>("recorder_preflight", {
        request,
      })
      setAudioDevices(checked.audioDevices)
      setPreflight(checked)
      setPreflightKey(requestKey)
      if (audioDeviceId && !checked.audioDevices.includes(audioDeviceId)) {
        setAudioDeviceId("")
        setPreflightKey(null)
      }
    } catch (error) {
      setActionError(`Setup check failed: ${errorMessage(error)}`)
    } finally {
      setPendingAction(null)
    }
  }

  const startRecording = async () => {
    if (!canStart) return
    setPendingAction("start")
    setActionError(null)
    setLastMarker(null)
    try {
      const started = await invoke<RecorderStatus>("recorder_start", {
        request,
      })
      setStatus(started)
      setStatusError(null)
      setPreflight(null)
      setPreflightKey(null)
    } catch (error) {
      setActionError(`Recording did not start: ${errorMessage(error)}`)
    } finally {
      setPendingAction(null)
    }
  }

  const stopRecording = async () => {
    if (!canStop || pendingAction) return
    setPendingAction("stop")
    setActionError(null)
    setConfirmStop(false)
    try {
      const stopped = await invoke<RecorderStatus>("recorder_stop")
      setStatus(stopped)
      setStatusError(null)
    } catch (error) {
      setActionError(`Recording could not be finalized: ${errorMessage(error)}`)
    } finally {
      setPendingAction(null)
    }
  }

  const addMarker = async () => {
    const label = markerLabel.trim().slice(0, 120)
    if (!label || status?.state !== "recording" || pendingAction) return
    const momentAtMarker = currentMoment
    setPendingAction("marker")
    setActionError(null)
    try {
      const marker = await invoke<{ atMs: number; label: string }>(
        "recorder_marker",
        {
          label,
          serviceRunId: null,
          itemId: momentAtMarker?.id ?? null,
        }
      )
      setLastMarker(
        `${marker.label} · ${formatDuration(marker.atMs)}${momentAtMarker ? ` · service clock: ${momentAtMarker.reference}` : ""}`
      )
      setMarkerLabel("")
    } catch (error) {
      setActionError(`Marker was not added: ${errorMessage(error)}`)
    } finally {
      setPendingAction(null)
    }
  }

  const audioLine =
    status?.state === "recording"
      ? status.audio.deviceId
        ? status.audio.receiving
          ? `Audio receiving · ${status.audio.deviceId}${status.audio.peakDb === null ? "" : ` · peak ${status.audio.peakDb.toFixed(0)} dB`}`
          : `No sound arriving from ${status.audio.deviceId}`
        : "No sound · silent recording was confirmed"
      : null

  return (
    <section
      className="shrink-0 rounded-lg border border-border bg-card px-3 py-2"
      aria-label="Rhema recording dock"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-xs font-semibold">Rhema recording</h2>
          <span
            role="status"
            aria-live="polite"
            className={`text-xs ${status?.state === "recording" ? "font-semibold text-destructive" : "text-muted-foreground"}`}
          >
            {stateLabel}
          </span>
          {status?.state === "recording" && (
            <span className="text-xs text-muted-foreground">
              {formatDuration(status.elapsedMs)} · {status.video.width}×
              {status.video.height} · {status.video.framesWritten} frames ·{" "}
              {status.video.framesDropped} dropped
              {status.file.diskFreeBytes === null
                ? " · free space unknown"
                : ` · ${formatBytes(status.file.diskFreeBytes)} free`}
            </span>
          )}
          {audioLine && (
            <span
              className={`text-xs ${status?.audio.receiving || !status?.audio.deviceId ? "text-muted-foreground" : "text-amber-700"}`}
            >
              {audioLine}
            </span>
          )}
          {status?.sessionActive && status.file.bytes > 0 && (
            <span className="text-xs text-muted-foreground">
              File {formatBytes(status.file.bytes)}
            </span>
          )}
        </div>
        <details className="group min-w-0">
          <summary className="cursor-pointer list-none rounded px-2 py-1 text-xs font-medium text-primary-text underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">
              {active ? "Recording controls" : "Set up recording"}
            </span>
            <span className="hidden group-open:inline">
              Hide recording controls
            </span>
          </summary>
          <div className="mt-2 grid gap-3 border-t border-border pt-3 lg:grid-cols-[minmax(12rem,1fr)_minmax(14rem,1fr)_auto] lg:items-end">
            <label className="grid gap-1 text-xs font-medium">
              Congregation screen
              <select
                aria-label="Congregation output"
                value={selectedOutputId}
                disabled={Boolean(active || pendingAction)}
                onChange={(event) => {
                  setOutputId(event.target.value)
                  setAudioDeviceId("")
                  setAllowSilent(false)
                  invalidatePreflight()
                }}
                className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-xs disabled:opacity-60"
              >
                <option value="">Choose a congregation screen</option>
                {congregationOutputs.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-1 text-xs font-medium">
              <label htmlFor="recorder-audio-input">Approved mixer input</label>
              <select
                id="recorder-audio-input"
                aria-label="Approved mixer input"
                value={allowSilent ? "" : audioDeviceId}
                disabled={
                  !output ||
                  !audioDevices.length ||
                  Boolean(active || pendingAction) ||
                  allowSilent
                }
                onChange={(event) => {
                  setAudioDeviceId(event.target.value)
                  invalidatePreflight()
                }}
                className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-xs disabled:opacity-60"
              >
                <option value="">Choose an approved mixer input</option>
                {audioDevices.map((device) => (
                  <option key={device} value={device}>
                    {device}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 font-normal text-muted-foreground">
                <input
                  type="checkbox"
                  checked={allowSilent}
                  disabled={!output || Boolean(active || pendingAction)}
                  onChange={(event) => {
                    setAllowSilent(event.target.checked)
                    invalidatePreflight()
                  }}
                />
                I explicitly want this recording without sound
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              {canStop ? (
                <>
                  {status?.state === "recording" && (
                    <>
                      <label className="sr-only" htmlFor="recorder-marker-label">
                        Recording marker
                      </label>
                      <input
                        id="recorder-marker-label"
                        value={markerLabel}
                        maxLength={120}
                        disabled={Boolean(pendingAction)}
                        onChange={(event) => setMarkerLabel(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void addMarker()
                        }}
                        placeholder="Marker, e.g. Sermon begins"
                        className="h-8 w-48 rounded-md border border-input bg-background px-2 text-xs"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!markerLabel.trim() || Boolean(pendingAction)}
                        onClick={() => void addMarker()}
                      >
                        {pendingAction === "marker" ? "Adding…" : "Add marker"}
                      </Button>
                    </>
                  )}
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={Boolean(pendingAction)}
                    onClick={() => setConfirmStop((confirm) => !confirm)}
                    aria-controls="recorder-stop-confirmation"
                    aria-expanded={confirmStop}
                  >
                    {status?.state === "failed"
                      ? "Close failed recording…"
                      : "Stop recording…"}
                  </Button>
                  <div
                    id="recorder-stop-confirmation"
                    role="group"
                    aria-label={
                      status?.state === "failed"
                        ? "Close failed recording confirmation"
                        : "Stop confirmation"
                    }
                    hidden={!confirmStop}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span className="text-xs text-muted-foreground">
                      {status?.state === "failed"
                        ? "Close the failed recorder session and keep any recoverable file; Live continues."
                        : "This closes the local recording; Live continues."}
                    </span>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={Boolean(pendingAction)}
                      onClick={() => void stopRecording()}
                    >
                      {status?.state === "failed"
                        ? "Close and recover"
                        : "Stop and finalize"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmStop(false)}
                    >
                      {status?.state === "failed"
                        ? "Leave for now"
                        : "Keep recording"}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label="Check recording setup"
                    disabled={
                      !output || Boolean(active || pendingAction) || rehearsal
                    }
                    onClick={() => void checkSetup()}
                  >
                    {pendingAction === "preflight"
                      ? "Checking…"
                      : "Check setup"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    aria-label="Start Rhema recording"
                    disabled={!canStart}
                    onClick={() => void startRecording()}
                  >
                    {pendingAction === "start"
                      ? "Starting…"
                      : "Start recording"}
                  </Button>
                </>
              )}
            </div>

            {status?.state === "recording" && (
              <p className="lg:col-span-3 text-xs text-muted-foreground">
                {currentMoment
                  ? `Service clock context: ${currentMoment.reference}. This does not confirm what is visible in the selected recording output.`
                  : "No current service moment; this marker will not be linked to a moment."}
              </p>
            )}

            <div className="lg:col-span-3" aria-live="polite">
              {rehearsal && (
                <p className="text-xs text-amber-800">
                  Recording is disabled during private rehearsal. The native
                  recorder captures the selected congregation screen, not
                  rehearsal Preview.
                </p>
              )}
              {pendingAction === "start" && (
                <p className="text-xs text-muted-foreground">
                  Waiting for the native encoder to start. Recording status
                  appears only after the recorder confirms it.
                </p>
              )}
              {pendingAction === "stop" && (
                <p className="text-xs text-muted-foreground">
                  Finalizing the local file. The recorder will report Saved,
                  Recoverable or Failed when it finishes.
                </p>
              )}
              {preflight && preflightIsCurrent && (
                <div className="mt-1 text-xs">
                  {preflight.problems.length > 0 ? (
                    <ul className="list-inside list-disc text-destructive">
                      {preflight.problems.map((problem, index) => (
                        <li key={`${problem.code}-${index}`}>
                          {problem.message}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">
                      Setup check passed for {preflight.width}×
                      {preflight.height} at 30 fps ·{" "}
                      {preflight.diskFreeBytes === null
                        ? "free space unknown"
                        : `${formatBytes(preflight.diskFreeBytes)} free`}
                      . Encoder startup and audio capture are confirmed only
                      after Start; watch the recorder status.
                    </p>
                  )}
                </div>
              )}
              {lastMarker && (
                <p className="text-xs text-muted-foreground">
                  Marker added: {lastMarker}
                </p>
              )}
              {status?.state === "saved" && (
                <p className="text-xs text-muted-foreground">
                  Recording saved on this computer. Find its record in History.
                </p>
              )}
              {status?.state === "recoverable" && (
                <p className="text-xs text-amber-800">
                  The recording may need recovery. Find its record in History.
                </p>
              )}
              {status?.state === "failed" && (
                <p className="text-xs text-destructive">
                  No completed recording was confirmed.
                </p>
              )}
            </div>
          </div>
        </details>
      </div>
      {statusError && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {statusError}
        </p>
      )}
      {actionError && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {actionError}
        </p>
      )}
      {status?.problem && (
        <p role="alert" className="mt-1 text-xs text-amber-800">
          {status.problem.message}
        </p>
      )}
      {rehearsal && active && (
        <p role="status" className="mt-1 text-xs text-amber-800">
          Private rehearsal is on. This recording remains pinned to the actual
          congregation screen; rehearsal Preview is not captured.
        </p>
      )}
      {status?.state === "recording" &&
        status.video.lastFrameAgoMs !== null &&
        status.video.lastFrameAgoMs > 5000 &&
        !status.problem && (
          <p role="alert" className="mt-1 text-xs text-amber-800">
            The selected screen has not sent a recent picture. Live remains
            independent; check the output window.
          </p>
        )}
    </section>
  )
}
