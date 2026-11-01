import { useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { CircleAlertIcon, CircleDotIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useShellStore, type Workspace } from "@/studio/shell-store"

type RecorderSummary = {
  state: "idle" | "preparing" | "recording" | "finalizing" | "saved" | "recoverable" | "failed"
  sessionActive: boolean
  outputId: string | null
  problem: { message: string } | null
}

function visibleOutsideLive(status: RecorderSummary | null): boolean {
  return Boolean(status && (status.sessionActive || status.state === "recoverable" || status.state === "failed"))
}

/** A status-only reminder keeps recording and failure state visible while the operator uses another workspace. */
export function RecorderStatusIndicator({ workspace }: { workspace: Workspace }) {
  const [status, setStatus] = useState<RecorderSummary | null>(null)
  const [eventsConnected, setEventsConnected] = useState(false)
  const eventSequence = useRef(0)

  useEffect(() => {
    let cancelled = false
    let eventReceived = false
    let unlisten: (() => void) | undefined
    const initialSequence = eventSequence.current
    const listening = listen<RecorderSummary>("recorder:status", (event) => {
      eventReceived = true
      eventSequence.current += 1
      if (!cancelled) setStatus(event.payload)
    }).then((stop) => {
      if (cancelled) stop()
      else {
        unlisten = stop
        setEventsConnected(true)
      }
    }).catch(() => {
      if (!cancelled) setEventsConnected(false)
    })
    void invoke<RecorderSummary>("recorder_status").then((next) => {
      if (!cancelled && !eventReceived && eventSequence.current === initialSequence) setStatus(next)
    }).catch(() => {})
    return () => {
      cancelled = true
      unlisten?.()
      void listening
    }
  }, [])

  const keepVisible = visibleOutsideLive(status)
  useEffect(() => {
    if (!keepVisible || eventsConnected) return
    let cancelled = false
    const timer = window.setInterval(() => {
      void invoke<RecorderSummary>("recorder_status").then((next) => {
        if (!cancelled) setStatus(next)
      }).catch(() => {})
    }, 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [eventsConnected, keepVisible])

  if (workspace === "present" || !visibleOutsideLive(status)) return null
  const failed = status?.state === "failed"
  const recoverable = status?.state === "recoverable"
  const attention = failed || recoverable
  const label = failed ? "Recording failed" : recoverable ? "Recording needs recovery" : status?.state === "finalizing" ? "Recording is finalizing" : "Recording is active"
  const destination = recoverable || failed ? "archive" : "present"

  return (
    <div className={`flex max-w-[22rem] items-center gap-2 rounded-md border px-2 py-1 ${attention ? "border-confidence-mid/50 bg-confidence-mid/10" : "border-on-air/40 bg-on-air/5"}`} aria-label="Recorder status">
      {attention ? <CircleAlertIcon aria-hidden className="size-4 shrink-0 text-confidence-mid" /> : <CircleDotIcon aria-hidden className="size-4 shrink-0 text-on-air" />}
      <span role={attention ? "alert" : "status"} aria-live={attention ? "assertive" : "polite"} className="min-w-0 truncate text-xs font-semibold">
        {label}{status?.problem?.message ? ` · ${status.problem.message}` : status?.outputId ? ` · ${status.outputId}` : ""}
      </span>
      <Button type="button" variant="outline" size="xs" className="shrink-0" onClick={() => useShellStore.getState().goTo(destination)}>
        {destination === "archive" ? "Open History" : "Open Live"}
      </Button>
    </div>
  )
}
