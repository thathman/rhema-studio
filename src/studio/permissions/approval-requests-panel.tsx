import { useEffect, useState } from "react"
import { CheckIcon, CircleAlertIcon, HistoryIcon, RefreshCwIcon, ShieldCheckIcon, XIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { outputsForScreens, useBroadcastStore } from "@/stores/broadcast-store"
import { scenesOnScreen } from "@/lib/desk-scenes"
import { cameraLabelOf } from "@/lib/cameras"
import { useQueueStore } from "@/stores/queue-store"
import { useJoin } from "@/stores/join-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useShellStore } from "@/studio/shell-store"
import { sceneLayerReviewSummary, scenePlanReferenceLabels, sceneRequestReviewModel, type SceneRequestReviewModel } from "./scene-request-review"
import {
  applySceneApprovalRequest,
  applyStageSendApprovalRequest,
  decideApprovalRequest,
  approvalErrorText,
  confirmPlanApprovalRequest,
  hydrateApprovalRequests,
  keepNewerLocalSceneAfterApproval,
  loadApprovalHistory,
  reloadApprovalRequests,
  sceneApprovalNeedsLocalRecovery,
  sceneApprovalHasNewerLocalConflict,
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
  if (request.kind === "stage_send") return `Private Stage message to ${request.targetId}`
  if (request.kind === "plan_approve") {
    const title = typeof payload?.title === "string" && payload.title.trim() ? payload.title.trim() : request.targetId
    return `Approve service “${title}”${request.baseRevision === null ? " · revision missing" : ` · revision ${request.baseRevision}`}`
  }
  const sceneName = typeof scene?.name === "string" && scene.name.trim()
    ? scene.name.trim()
    : scenes.find((item) => item.id === request.targetId)?.name ?? request.targetId
  if (request.kind === "scene_save") return `Save scene “${sceneName}”`
  if (request.kind === "scene_delete") return `Delete scene “${sceneName}”`
  return `${request.kind.replaceAll("_", " ")} · ${request.targetId}`
}

function requestImpact(
  request: ApprovalRequest,
): string {
  if (request.kind === "stage_send") {
    const payload = record(request.payload)
    const text = typeof payload?.text === "string" ? payload.text : "Message unavailable"
    return `Private Stage display · ${request.targetId} · Message: “${text}”. It is not sent until the host applies this approval; receiver playback is not confirmed.`
  }
  if (request.kind === "plan_approve") {
    if (request.baseRevision === null) return "This request has no host-checked base revision and cannot be confirmed safely."
    return `Submitted revision ${request.baseRevision}. Approve this exact revision in Prepare first; the host verifies it before confirmation.`
  }
  return `Target: ${request.targetId}`
}

function sceneDeleteInstruction(request: ApprovalRequest): string {
  switch (request.state) {
    case "submitted": return "If approved, the scene will be removed only after explicit host Apply."
    case "approved": return "The scene will be removed only after explicit host Apply."
    case "applied": return "The host applied this deletion. The scene was removed from its library; Program remains unchanged."
    case "declined": return "The host declined this deletion. The scene remains in the library."
    case "requested_changes": return "The host requested changes. The scene remains in the library until a fresh request is reviewed."
    case "expired": return "This deletion request expired. The scene remains in the library."
    case "withdrawn": return "This deletion request was withdrawn. The scene remains in the library."
    case "superseded": return "This deletion request is stale. The scene remains in the library; submit a fresh request after reviewing its current revision."
  }
  return "This request did not remove the scene from the library."
}

function SceneCompositionSummary({ scene, missingText, cameraLabelForUrl }: {
  scene: import("@/types").Scene | null
  missingText: string
  cameraLabelForUrl: (url: string) => string | undefined
}) {
  if (!scene) return <p className="mt-1 text-xs text-muted-foreground">{missingText}</p>
  return (
    <div className="mt-1 space-y-1 text-xs text-muted-foreground">
      <p>{scene.name} · {scene.background} · {scene.layers.length} visual layer{scene.layers.length === 1 ? "" : "s"}</p>
      {scene.layers.length > 0 ? <ol className="list-inside list-decimal space-y-0.5">
        {scene.layers.map((layer) => <li key={layer.id}>{sceneLayerReviewSummary(layer, cameraLabelForUrl)}</li>)}
      </ol> : <p>Blank composition · no visual layers</p>}
    </div>
  )
}

function SceneRequestReview({
  request,
  model,
  assignedOutputs,
  rehearsal,
  planReferences,
  cameraLabelForUrl,
}: {
  request: ApprovalRequest
  model: SceneRequestReviewModel
  assignedOutputs: string[]
  rehearsal: boolean
  planReferences: string[]
  cameraLabelForUrl: (url: string) => string | undefined
}) {
  return (
    <section aria-label="Scene change review" className="mt-3 rounded-md border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-medium">Scene change review</h4>
        <Badge variant="neutral">{model.baseRevisionLabel}</Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Current scene data is local review context. The host checks the submitted revision again before Apply. This review does not change Preview or Program.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-md border border-border bg-background p-3">
          <h5 className="text-xs font-semibold">{model.beforeLabel}</h5>
          <SceneCompositionSummary
            scene={model.beforeScene}
            missingText={model.beforeStatus === "unavailable" ? "No trustworthy pre-Apply snapshot is available." : "No scene with this ID is present in the local library."}
            cameraLabelForUrl={cameraLabelForUrl}
          />
        </div>
        <div className="min-w-0 rounded-md border border-border bg-background p-3">
          <h5 className="text-xs font-semibold">{model.requestedLabel}</h5>
          {request.kind === "scene_delete"
            ? <p className="mt-1 text-xs text-muted-foreground">{sceneDeleteInstruction(request)}</p>
            : <SceneCompositionSummary scene={model.requestedScene} missingText="The requested scene version cannot be reproduced safely." cameraLabelForUrl={cameraLabelForUrl} />}
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div>
          <h5 className="text-xs font-semibold">Change summary</h5>
          <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
            {model.changes.map((change, index) => <li key={`${index}-${change}`}>{change}</li>)}
          </ul>
        </div>
        <div>
          <h5 className="text-xs font-semibold">Current {rehearsal ? "rehearsal " : ""}screen assignments</h5>
          <p className="mt-1 text-xs text-muted-foreground">{assignedOutputs.length ? assignedOutputs.join(", ") : "No matching assignment in the local screen state."}</p>
          <p className="mt-1 text-xs text-muted-foreground">Local review only; this is not a receiver acknowledgement.</p>
        </div>
        <div>
          <h5 className="text-xs font-semibold">Current local service plan references</h5>
          {planReferences.length ? <ul className="mt-1 space-y-1 text-xs text-muted-foreground">{planReferences.map((reference) => <li key={reference}>{reference}</li>)}</ul> : <p className="mt-1 text-xs text-muted-foreground">No matching scene reference in the current local run of show.</p>}
          <p className="mt-1 text-xs text-muted-foreground">These references are not pinned in the approval request.</p>
        </div>
      </div>
      {model.blockReason && <p id={`scene-review-warning-${request.id}`} role="alert" className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">{model.blockReason}</p>}
      {model.reviewNotice && <p role="status" className="mt-3 rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">{model.reviewNotice}</p>}
    </section>
  )
}

function stateLabel(request: ApprovalRequest): string {
  const state = request.state
  switch (state) {
    case "submitted": return "Pending review"
    case "approved": return request.kind === "plan_approve" ? "Approved · awaiting Prepare" : request.kind === "stage_send" ? "Approved · ready to send" : request.kind.startsWith("scene_") ? "Approved · ready to apply" : "Approved · not applied"
    case "requested_changes": return "Changes requested"
    case "applied": return request.kind === "plan_approve" ? "Revision confirmed by host" : request.kind === "stage_send" ? "Applied · receiver not confirmed" : request.kind.startsWith("scene_") ? "Applied by host · no Live change" : "Marked applied by host"
    default: return state[0].toUpperCase() + state.slice(1)
  }
}

function stateVariant(state: ApprovalRequest["state"]): "amber" | "green" | "rose" | "neutral" {
  if (state === "submitted") return "amber"
  if (state === "approved" || state === "applied") return "green"
  if (state === "expired" || state === "superseded") return "rose"
  return "neutral"
}

/** Host-backed approval inbox. Scene changes need a separate explicit host-checked Apply action. */
export function ApprovalRequestsPanel() {
  const joinStatus = useJoin((state) => state.status)
  const scenes = useBroadcastStore((state) => state.scenes)
  const outputs = useBroadcastStore((state) => state.outputs)
  const rehearsal = useBroadcastStore((state) => state.rehearsal)
  const rehearsalReturn = useBroadcastStore((state) => state.rehearsalReturn)
  const cameras = useSettingsStore((state) => state.cameras)
  const queueItems = useQueueStore((state) => state.items)
  const queueHeaders = useQueueStore((state) => state.headers)
  const screenState = { outputs, rehearsal, rehearsalReturn }
  const outputsOnScreens = outputsForScreens(screenState)
  const sceneIdsOnScreens = scenesOnScreen(screenState)
  const cameraLabelForUrl = (url: string) => cameraLabelOf(url, cameras)
  const requests = useApprovalRequestsStore((state) => state.requests)
  const localApplicationErrors = useApprovalRequestsStore((state) => state.localApplicationErrors)
  const localSceneRecoveries = useApprovalRequestsStore((state) => state.localSceneRecoveries)
  const localRecoveryDismissed = useApprovalRequestsStore((state) => state.localRecoveryDismissed)
  const localRecoveryUnavailable = useApprovalRequestsStore((state) => state.localRecoveryUnavailable)
  const localHostStatusUnknown = useApprovalRequestsStore((state) => state.localHostStatusUnknown)
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

  const confirmPlan = async (request: ApprovalRequest) => {
    setBusy(request.id)
    setRowErrors((current) => ({ ...current, [request.id]: "" }))
    try {
      await confirmPlanApprovalRequest(request.id)
    } catch (cause) {
      setRowErrors((current) => ({ ...current, [request.id]: approvalErrorText(cause) }))
    } finally {
      setBusy(null)
    }
  }

  const applyScene = async (request: ApprovalRequest) => {
    setBusy(request.id)
    setRowErrors((current) => ({ ...current, [request.id]: "" }))
    try {
      await applySceneApprovalRequest(request.id)
    } catch (cause) {
      setRowErrors((current) => ({ ...current, [request.id]: approvalErrorText(cause) }))
    } finally {
      setBusy(null)
    }
  }

  const applyStageSend = async (request: ApprovalRequest) => {
    setBusy(request.id)
    setRowErrors((current) => ({ ...current, [request.id]: "" }))
    try {
      await applyStageSendApprovalRequest(request.id)
    } catch (cause) {
      setRowErrors((current) => ({ ...current, [request.id]: approvalErrorText(cause) }))
    } finally {
      setBusy(null)
    }
  }

  const keepLocalScene = async (request: ApprovalRequest) => {
    setBusy(request.id)
    setRowErrors((current) => ({ ...current, [request.id]: "" }))
    try {
      await keepNewerLocalSceneAfterApproval(request.id)
    } catch (cause) {
      setRowErrors((current) => ({ ...current, [request.id]: cause instanceof Error ? cause.message : String(cause) }))
    } finally {
      setBusy(null)
    }
  }

  const refreshHostStatus = async (request: ApprovalRequest) => {
    setBusy(request.id)
    setRowErrors((current) => ({ ...current, [request.id]: "" }))
    try {
      await reloadApprovalRequests()
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
          <p className="text-xs text-muted-foreground">Durable requests recorded by this host. Approved scenes need an explicit Apply and never Take to Program. An approved Stage cue needs explicit host Apply before it reaches its private display. Service revisions use Prepare.</p>
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
              const recovery = localSceneRecoveries[request.id]
              const needsLocalRecovery = sceneApprovalNeedsLocalRecovery(request, scenes, localApplicationErrors[request.id], localRecoveryDismissed[request.id])
              const hasNewerLocalConflict = sceneApprovalHasNewerLocalConflict(request, scenes, recovery)
              const sceneReview = request.kind.startsWith("scene_") ? sceneRequestReviewModel(request, scenes, recovery, cameraLabelForUrl) : null
              const assignedOutputs = outputsOnScreens.filter((output) => output.sceneId === request.targetId).map((output) => output.name)
              const planReferences = sceneReview ? scenePlanReferenceLabels(queueItems, queueHeaders, request.targetId) : []
              return (
                <li key={request.id} className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{requestDescription(request, scenes)}</h3>
                      <Badge variant={stateVariant(request.state)}>{stateLabel(request)}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">From {request.requester.name} · {dateWords(request.createdAt)} · {request.baseRevision === null ? "No base revision" : `Based on host revision ${request.baseRevision}`} · Expires {dateWords(request.expiresAt)}</p>
                    {!sceneReview && <p className="mt-1 text-xs text-muted-foreground">{requestImpact(request)}</p>}
                    {sceneReview && <SceneRequestReview request={request} model={sceneReview} assignedOutputs={assignedOutputs} rehearsal={rehearsal} planReferences={planReferences} cameraLabelForUrl={cameraLabelForUrl} />}
                    {request.state === "approved" && request.kind.startsWith("scene_") && <p className="mt-1 text-xs text-muted-foreground">Apply checks the scene revision and current output assignment on this host. Saving changes the scene library only; it does not Take the scene live.</p>}
                    {request.state === "approved" && request.kind.startsWith("scene_") && localHostStatusUnknown[request.id] && <p role="alert" className="mt-1 text-xs text-amber-800">The host response was interrupted and its status is unknown. The local recovery record was kept. Refresh host status before trying again.</p>}
                    {request.state === "approved" && request.kind === "scene_delete" && sceneIdsOnScreens.has(request.targetId) && <p role="status" className="mt-1 text-xs text-amber-800">Move every real screen away from this scene before applying its deletion.</p>}
                    {request.state === "applied" && request.kind.startsWith("scene_") && needsLocalRecovery && !localRecoveryUnavailable[request.id] && <p role="status" className="mt-1 text-xs text-amber-800">The host recorded this approval, but local scene recovery is still needed. Program has not changed. Retry applies only this approved version and stops if the local scene changed since approval.</p>}
                    {request.state === "applied" && request.kind.startsWith("scene_") && needsLocalRecovery && localRecoveryUnavailable[request.id] && <p role="alert" className="mt-1 text-xs text-amber-800">This applied request has no safe local recovery record. The current scene was preserved. Send a fresh request to synchronize it.</p>}
                    {request.state === "applied" && request.kind.startsWith("scene_") && localRecoveryDismissed[request.id] && <p role="status" className="mt-1 text-xs text-amber-800">You kept the newer local scene. The host request remains applied; send a fresh request to synchronize this version. Program was not changed.</p>}
                    {request.state === "applied" && request.kind.startsWith("scene_") && !needsLocalRecovery && !localRecoveryDismissed[request.id] && <p role="status" className="mt-1 text-xs text-muted-foreground">Saved in the local scene library after host approval. No scene was Taken live; Program stays unchanged.</p>}
                    {request.state === "approved" && request.kind === "stage_send" && <p role="status" className="mt-1 text-xs text-muted-foreground">The message remains private and unsent until the host applies it. Stage display playback is not acknowledged.</p>}
                    {request.state === "applied" && request.kind === "stage_send" && <p role="status" className="mt-1 text-xs text-muted-foreground">The host applied this private cue to the Stage display. Receiver playback and whether anyone read it are not confirmed.</p>}
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
                    <Button size="sm" disabled={busy === request.id || Boolean(sceneReview?.blockReason)} aria-describedby={sceneReview?.blockReason ? `scene-review-warning-${request.id}` : undefined} onClick={() => void decide(request, "approve")}><CheckIcon /> Approve</Button>
                    <Button size="sm" variant="outline" disabled={busy === request.id} onClick={() => void decide(request, "decline")}><XIcon /> Decline</Button>
                    <Button size="sm" variant="ghost" disabled={busy === request.id} onClick={() => setRequestingChanges(request.id)}>Request changes</Button>
                  </div>}
                  {isHost && request.kind === "plan_approve" && request.state === "approved" && request.baseRevision !== null && <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" disabled={busy === request.id} onClick={() => void confirmPlan(request)}>Confirm approved revision</Button>
                  </div>}
                  {isHost && request.kind === "stage_send" && request.state === "approved" && <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" aria-label="Apply approved private Stage message" disabled={busy !== null} onClick={() => void applyStageSend(request)}>Send approved Stage message</Button>
                  </div>}
                  {isHost && request.kind.startsWith("scene_") && request.state === "approved" && !localHostStatusUnknown[request.id] && <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={request.kind === "scene_delete" ? "Apply approved scene deletion" : "Apply approved scene change"}
                      disabled={busy !== null || Boolean(sceneReview?.applyBlockReason) || (request.kind === "scene_delete" && sceneIdsOnScreens.has(request.targetId))}
                      onClick={() => void applyScene(request)}
                    >
                      {request.kind === "scene_delete" ? "Apply approved deletion" : "Apply approved scene change"}
                    </Button>
                  </div>}
                  {isHost && request.kind.startsWith("scene_") && request.state === "approved" && localHostStatusUnknown[request.id] && <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void refreshHostStatus(request)}>Refresh host status</Button>
                  </div>}
                  {isHost && request.kind.startsWith("scene_") && request.state === "applied" && needsLocalRecovery && !localRecoveryUnavailable[request.id] && <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={request.kind === "scene_delete" ? "Retry local approved scene deletion" : "Retry local approved scene save"}
                      disabled={busy !== null || Boolean(sceneReview?.applyBlockReason) || (request.kind === "scene_delete" && sceneIdsOnScreens.has(request.targetId))}
                      onClick={() => void applyScene(request)}
                    >
                      {request.kind === "scene_delete" ? "Retry local deletion" : "Retry local scene save"}
                    </Button>
                    {hasNewerLocalConflict && <Button size="sm" variant="outline" aria-label="Keep newer local scene" disabled={busy !== null} onClick={() => void keepLocalScene(request)}>Keep newer local scene</Button>}
                  </div>}
                  {isHost && request.kind === "plan_approve" && request.state !== "expired" && request.state !== "withdrawn" && request.state !== "superseded" && <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => useShellStore.getState().openPrepareProgram(request.targetId)}>Open in Prepare</Button>
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
