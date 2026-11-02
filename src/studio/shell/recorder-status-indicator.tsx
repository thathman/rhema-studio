import { useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { CircleAlertIcon, CircleDotIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { recorderOutputLeftMessage, useRecorderAlertStore } from "@/stores/recorder-alert-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useShellStore, type Workspace } from "@/studio/shell-store"

type RecorderSummary = {
  state: "idle" | "preparing" | "recording" | "finalizing" | "saved" | "recoverable" | "failed"
  sessionActive: boolean
  outputId: string | null
  problem: { message: string } | null
}

function visibleOutsideLive(status: RecorderSummary | null, alert: string | null): boolean {
  return Boolean(alert || (status && (status.sessionActive || status.state === "recoverable" || status.state === "failed")))
}

/** A status-only reminder keeps recording and failure state visible while the operator uses another workspace. */
export function RecorderStatusIndicator({ workspace }: { workspace: Workspace }) {
  const [status, setStatus] = useState<RecorderSummary | null>(null)
  const [eventsConnected, setEventsConnected] = useState(false)
  const eventSequence = useRef(0)
  const actionAlert = useRecorderAlertStore((state) => state.alerts.action)
  const statusAlert = useRecorderAlertStore((state) => state.alerts.status)
  const safetyAlert = useRecorderAlertStore((state) => state.alerts.safety)
  const alertMessage = safetyAlert ?? actionAlert ?? statusAlert
  const alertScope = safetyAlert ? "safety" : actionAlert ? "action" : statusAlert ? "status" : null

  useEffect(() => {
    let cancelled = false
    let eventReceived = false
    let unlisten: (() => void) | undefined
    let unlistenOutputLeft: (() => void) | undefined
    const initialSequence = eventSequence.current
    const listening = listen<RecorderSummary>("recorder:status", (event) => {
      eventReceived = true
      eventSequence.current += 1
      if (!cancelled) {
        setStatus(event.payload)
        useRecorderAlertStore.getState().clear("status")
      }
    }).then((stop) => {
      if (cancelled) stop()
      else {
        unlisten = stop
        setEventsConnected(true)
      }
    }).catch(() => {
      if (!cancelled) setEventsConnected(false)
    })
    const outputLeftListening = listen<{ outputId?: unknown; stopped?: unknown }>("recorder:output_left", (event) => {
      const outputId = event.payload?.outputId
      if (typeof outputId !== "string" || !outputId.trim()) return
      const outputName = useBroadcastStore.getState().outputs.find((output) => output.id === outputId)?.name ?? outputId
      useRecorderAlertStore.getState().report("safety", recorderOutputLeftMessage({ outputId, stopped: event.payload.stopped === true }, outputName))
    }).then((stop) => {
      if (cancelled) stop()
      else unlistenOutputLeft = stop
    }).catch(() => {})
    void invoke<RecorderSummary>("recorder_status").then((next) => {
      if (!cancelled && !eventReceived && eventSequence.current === initialSequence) {
        setStatus(next)
        useRecorderAlertStore.getState().clear("status")
      }
    }).catch((error: unknown) => {
      if (!cancelled) useRecorderAlertStore.getState().report("status", `Recorder status is unavailable: ${error instanceof Error ? error.message : String(error)}`)
    })
    return () => {
      cancelled = true
      unlisten?.()
      unlistenOutputLeft?.()
      void listening
      void outputLeftListening
    }
  }, [])

  useEffect(() => {
    if (eventsConnected) return
    let cancelled = false
    const timer = window.setInterval(() => {
      void invoke<RecorderSummary>("recorder_status").then((next) => {
        if (!cancelled) {
          setStatus(next)
          useRecorderAlertStore.getState().clear("status")
        }
      }).catch((error: unknown) => {
        if (!cancelled) useRecorderAlertStore.getState().report("status", `Recorder status refresh failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    }, 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [eventsConnected])

  if (workspace === "present" || !visibleOutsideLive(status, alertMessage)) return null
  const failed = status?.state === "failed"
  const recoverable = status?.state === "recoverable"
  const attention = Boolean(alertMessage || failed || recoverable)
  const label = failed ? "Recording failed" : recoverable ? "Recording needs recovery" : alertMessage ? "Recorder needs attention" : status?.state === "finalizing" ? "Recording is finalizing" : "Recording is active"
  const destination = recoverable || failed ? "archive" : "present"

  return (
    <div className={`flex max-w-[22rem] items-center gap-2 rounded-md border px-2 py-1 ${attention ? "border-confidence-mid/50 bg-confidence-mid/10" : "border-on-air/40 bg-on-air/5"}`} aria-label="Recorder status">
      {attention ? <CircleAlertIcon aria-hidden className="size-4 shrink-0 text-confidence-mid" /> : <CircleDotIcon aria-hidden className="size-4 shrink-0 text-on-air" />}
      <span role={attention ? "alert" : "status"} aria-live={attention ? "assertive" : "polite"} className="min-w-0 truncate text-xs font-semibold">
        {label}{alertMessage ? ` · ${alertMessage}` : status?.problem?.message ? ` · ${status.problem.message}` : status?.outputId ? ` · ${status.outputId}` : ""}
      </span>
      {alertScope && <Button type="button" variant="ghost" size="xs" className="shrink-0" aria-label="Dismiss recorder alert" onClick={() => useRecorderAlertStore.getState().clear(alertScope)}>Dismiss</Button>}
      <Button type="button" variant="outline" size="xs" className="shrink-0" onClick={() => useShellStore.getState().goTo(destination)}>
        {destination === "archive" ? "Open History" : "Open Live"}
      </Button>
    </div>
  )
}
