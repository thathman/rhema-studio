import { useEffect, useState } from "react"
import { CheckIcon, CircleAlertIcon, HistoryIcon, RefreshCwIcon, ShieldCheckIcon, XIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useJoin } from "@/stores/join-store"
import {
  decideApprovalRequest,
  hydrateApprovalRequests,
  loadApprovalHistory,
  reloadApprovalRequests,
  useApprovalRequestsStore,
  type ApprovalDecision,
  type ApprovalRequest,
} from "./approval-requests-store"

const dateWords = (at: string) => {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? at : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function requestDescription(request: ApprovalRequest, scenes: ReturnType<typeof useBroadcastStore.getState>["scenes"]): string {
  const payload = record(request.payload)
  const scene = record(payload?.scene)
  const sceneName = typeof scene?.name === "string" && scene.name.trim()
    ? scene.name.trim()
    : scenes.find((item) => item.id === request.targetId)?.name ?? request.targetId
  if (request.kind === "scene_save") return `Save scene “${sceneName}”`
  if (request.kind === "scene_delete") return `Delete scene “${sceneName}”`
  return `${request.kind.replaceAll("_", " ")} · ${request.targetId}`
}

function requestImpact(
  request: ApprovalRequest,
  outputs: ReturnType<typeof useBroadcastStore.getState>["outputs"],
): string {
  const payload = record(request.payload)
  const scene = record(payload?.scene)
  if (request.kind === "scene_save" && Array.isArray(scene?.layers)) return `Proposed composition: ${scene.layers.length} visual layers.`
  if (request.kind === "scene_delete") {
    const assignedOutputs = outputs.filter((output) => output.sceneId === request.targetId).map((output) => output.name)
    return assignedOutputs.length
      ? `Current output assignment: ${assignedOutputs.join(", ")} (review information only).`
      : "No current output assignment is recorded in this app session (review information only)."
  }
  return `Target: ${request.targetId}`
}

function stateLabel(state: ApprovalRequest["state"]): string {
  switch (state) {
    case "submitted": return "Pending review"
    case "approved": return "Approved · not applied"
    case "requested_changes": return "Changes requested"
    case "applied": return "Marked applied by host"
    default: return state[0].toUpperCase() + state.slice(1)
  }
}

function stateVariant(state: ApprovalRequest["state"]): "amber" | "green" | "rose" | "neutral" {
  if (state === "submitted") return "amber"
  if (state === "approved" || state === "applied") return "green"
  if (state === "expired" || state === "superseded") return "rose"
  return "neutral"
}

/** Host-backed approval inbox. Approval records authorization; it never saves or takes a scene. */
export function ApprovalRequestsPanel() {
  const joinStatus = useJoin((state) => state.status)
  const scenes = useBroadcastStore((state) => state.scenes)
  const outputs = useBroadcastStore((state) => state.outputs)
  const requests = useApprovalRequestsStore((state) => state.requests)
  const hydrated = useApprovalRequestsStore((state) => state.hydrated)
  const loading = useApprovalRequestsStore((state) => state.loading)
  const error = useApprovalRequestsStore((state) => state.error)
  const histories = useApprovalRequestsStore((state) => state.histories)
  const [busy, setBusy] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [requestingChanges, setRequestingChanges] = useState<string | null>(null)
  const [historyErrors, setHistoryErrors] = useState<Record<string, string>>({})
  const isHost = joinStatus === "off"
  const pending = requests.filter((request) => request.state === "submitted")

  useEffect(() => {
    if (isHost) void hydrateApprovalRequests().catch(() => {})
  }, [isHost])

  const reload = () => void reloadApprovalRequests().catch(() => {})

  const decide = async (request: ApprovalRequest, decision: ApprovalDecision) => {
    const note = decision === "request_changes" ? notes[request.id]?.trim() : undefined
    if (decision === "request_changes" && !note) return
    setBusy(request.id)
    setRowErrors((current) => ({ ...current, [request.id]: "" }))
    try {
      await decideApprovalRequest(request.id, decision, note)
      setRequestingChanges((current) => current === request.id ? null : current)
    } catch (cause) {
      setRowErrors((current) => ({ ...current, [request.id]: cause instanceof Error ? cause.message : String(cause) }))
    } finally {
      setBusy(null)
    }
  }

  const toggleHistory = async (request: ApprovalRequest, open: boolean) => {
    if (!open || histories[request.id]) return
    setHistoryErrors((current) => ({ ...current, [request.id]: "" }))
    try {
      await loadApprovalHistory(request.id)
    } catch (cause) {
      setHistoryErrors((current) => ({ ...current, [request.id]: cause instanceof Error ? cause.message : String(cause) }))
    }
  }

  return (
    <section aria-labelledby="host-approval-requests-title" className="rounded-lg border border-border bg-card shadow-panel">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface-elevated px-4 py-3">
        <ShieldCheckIcon aria-hidden className="size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h2 id="host-approval-requests-title" className="font-semibold">Approval Requests</h2>
          <p className="text-xs text-muted-foreground">Durable requests recorded by this host. Approval records authorization; it does not save a scene, approve a service revision, or change Preview or Program. Those actions require their separate host-checked workflows.</p>
        </div>
        <Badge variant={pending.length ? "amber" : "neutral"}>{pending.length} pending</Badge>
        <Button size="sm" variant="outline" aria-label="Refresh approval requests" disabled={!isHost || loading} onClick={reload}><RefreshCwIcon /> Refresh</Button>
      </header>
      <div className="p-4">
        {!isHost && <p role="status" className="mb-3 rounded-md border border-border bg-muted/40 p-3 text-sm">Only the main host can review or decide host approval requests. This view is read-only.</p>}
        {error && <p role="alert" className="mb-3 flex items-start gap-2 text-sm text-destructive"><CircleAlertIcon className="mt-0.5 size-4 shrink-0" />Host approval requests could not be loaded: {error}</p>}
        {!isHost ? <p className="text-sm text-muted-foreground">Open Permissions on the main host to review its approval requests.</p> : !hydrated && !error ? <p role="status" className="text-sm text-muted-foreground">Loading host requests…</p> : requests.length === 0 && error ? <p className="text-sm text-muted-foreground">Retry to see whether the host has recorded requests.</p> : requests.length === 0 ? <p className="text-sm text-muted-foreground">No host-recorded approval requests.</p> : (
          <ul className="divide-y divide-border">
            {requests.map((request) => {
              const open = request.state === "submitted"
              return (
                <li key={request.id} className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{requestDescription(request, scenes)}</h3>
                      <Badge variant={stateVariant(request.state)}>{stateLabel(request.state)}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">From {request.requester.name} · {dateWords(request.createdAt)} · {request.baseRevision === null ? "No base revision" : `Based on host revision ${request.baseRevision}`} · Expires {dateWords(request.expiresAt)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{requestImpact(request, outputs)}</p>
                    {request.reason && <p className="mt-1 text-xs text-muted-foreground">Reason: {request.reason}</p>}
                    {request.decisionNote && <p className="mt-1 text-xs text-muted-foreground">Decision note: {request.decisionNote}</p>}
                    {rowErrors[request.id] && <p role="alert" className="mt-2 text-xs text-destructive">{rowErrors[request.id]}</p>}
                    {historyErrors[request.id] && <p role="alert" className="mt-2 text-xs text-destructive">Request history could not be loaded: {historyErrors[request.id]}</p>}
                    {requestingChanges === request.id && <div className="mt-3 max-w-2xl space-y-2">
                      <label htmlFor={`approval-note-${request.id}`} className="block text-xs font-medium">What needs to change?</label>
                      <textarea id={`approval-note-${request.id}`} value={notes[request.id] ?? ""} maxLength={500} rows={2} onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" disabled={busy === request.id || !notes[request.id]?.trim()} onClick={() => void decide(request, "request_changes")}>Send request</Button>
                        <Button size="sm" variant="ghost" disabled={busy === request.id} onClick={() => setRequestingChanges(null)}>Cancel</Button>
                      </div>
                    </div>}
                    <details className="mt-2 text-xs" onToggle={(event) => void toggleHistory(request, event.currentTarget.open)}>
                      <summary className="flex cursor-pointer items-center gap-1 text-muted-foreground"><HistoryIcon className="size-3.5" />Decision activity</summary>
                      {histories[request.id] ? histories[request.id].length === 0 ? <p className="mt-2 text-muted-foreground">No decision activity is recorded.</p> : <ol className="mt-2 space-y-1">
                        {histories[request.id].map((entry) => <li key={entry.seq}>{dateWords(entry.at)} · {entry.actor.name}: {entry.action}{entry.detail ? ` · ${entry.detail}` : ""}</li>)}
                      </ol> : <p className="mt-2 text-muted-foreground">{historyErrors[request.id] || "Loading activity…"}</p>}
                    </details>
                  </div>
                  {isHost && open && requestingChanges !== request.id && <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={busy === request.id} onClick={() => void decide(request, "approve")}><CheckIcon /> Approve</Button>
                    <Button size="sm" variant="outline" disabled={busy === request.id} onClick={() => void decide(request, "decline")}><XIcon /> Decline</Button>
                    <Button size="sm" variant="ghost" disabled={busy === request.id} onClick={() => setRequestingChanges(request.id)}>Request changes</Button>
                  </div>}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
