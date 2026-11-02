import { useCallback, useEffect, useState } from "react"
import { CircleAlertIcon, RefreshCwIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { loadMyApprovalRequests, useCanSend, useJoin, withdrawMyApprovalRequest, type DeskApprovalRequest, type DeskApprovalState } from "@/stores/join-store"

const STATE_WORDS: Record<DeskApprovalState, string> = {
  submitted: "Waiting for the host",
  approved: "Approved",
  declined: "Declined",
  requested_changes: "Changes requested",
  applied: "Applied",
  expired: "Expired",
  withdrawn: "Withdrawn",
  superseded: "Superseded",
}

const KIND_WORDS: Record<string, string> = {
  plan_approve: "Service plan",
  scene_save: "Scene change",
  scene_delete: "Scene deletion",
}

const dateWords = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
}

/** A joined desk can follow and withdraw its own requests; only the host decides them. */
export function MyApprovalRequests() {
  const status = useJoin((state) => state.status)
  const paused = useJoin((state) => state.paused)
  const canWithdraw = useCanSend()
  const [requests, setRequests] = useState<DeskApprovalRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})

  const reload = useCallback(async () => {
    if (status !== "connected") return
    setLoading(true)
    setError(null)
    try {
      setRequests(await loadMyApprovalRequests())
      setRowErrors({})
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    if (status !== "connected") return
    const timer = window.setTimeout(() => void reload(), 0)
    return () => window.clearTimeout(timer)
  }, [reload, status])

  const withdraw = async (request: DeskApprovalRequest) => {
    setBusyId(request.id)
    setRowErrors((current) => ({ ...current, [request.id]: "" }))
    try {
      const updated = await withdrawMyApprovalRequest(request.id)
      setRequests((current) => current.map((item) => item.id === request.id ? updated : item))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setRowErrors((current) => ({ ...current, [request.id]: message }))
      if (message.startsWith("stale:")) void reload()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section aria-labelledby="my-approval-requests-title" className="rounded-lg border border-border bg-card shadow-panel">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface-elevated px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 id="my-approval-requests-title" className="font-semibold">My approval requests</h2>
          <p className="text-xs text-muted-foreground">Status comes from the host. Only the host can approve or reject a request; you can withdraw your own while it is waiting.</p>
        </div>
        <Button size="sm" variant="outline" aria-label="Refresh my approval requests" disabled={loading || status !== "connected"} onClick={() => void reload()}><RefreshCwIcon /> Refresh</Button>
      </header>
      <div className="p-4">
        {paused && <p role="status" className="mb-3 rounded-md border border-border bg-muted/40 p-2.5 text-sm">The host paused this desk's controls. Request status is read-only until control is restored.</p>}
        {status !== "connected" && <p role="status" className="text-sm text-muted-foreground">Reconnect to the host to see the latest request status.</p>}
        {error && <p role="alert" className="mb-3 flex items-start gap-2 text-sm text-destructive"><CircleAlertIcon className="mt-0.5 size-4 shrink-0" />Requests could not be loaded: {error}</p>}
        {status === "connected" && loading && !error && <p role="status" className="text-sm text-muted-foreground">Loading your host requests…</p>}
        {status === "connected" && !loading && !error && requests.length === 0 && <p className="text-sm text-muted-foreground">No host-recorded requests from this desk.</p>}
        {status === "connected" && !loading && !error && requests.length > 0 && <ul className="divide-y divide-border">
          {requests.map((request) => (
            <li key={request.id} className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{KIND_WORDS[request.kind] ?? request.kind.replaceAll("_", " ")} · {request.targetId}</h3>
                  <Badge variant={request.state === "submitted" ? "amber" : request.state === "approved" || request.state === "applied" ? "green" : request.state === "declined" || request.state === "superseded" ? "rose" : "neutral"}>{STATE_WORDS[request.state]}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Sent {dateWords(request.createdAt)}{request.baseRevision !== null ? ` · revision ${request.baseRevision}` : ""}{request.decidedBy ? ` · decided by ${request.decidedBy}` : ""}{request.decidedAt ? ` · ${dateWords(request.decidedAt)}` : ""}</p>
                {request.reason && <p className="mt-1 text-sm">{request.reason}</p>}
                {request.decisionNote && <p className="mt-1 text-sm text-muted-foreground">Host note: {request.decisionNote}</p>}
                {rowErrors[request.id] && <p role="alert" className="mt-2 text-xs text-destructive">{rowErrors[request.id]}</p>}
              </div>
              {request.state === "submitted" && <Button size="sm" variant="outline" disabled={!canWithdraw || busyId === request.id} onClick={() => void withdraw(request)}>{busyId === request.id ? "Withdrawing…" : "Withdraw request"}</Button>}
            </li>
          ))}
        </ul>}
      </div>
    </section>
  )
}
