import { invoke } from "@tauri-apps/api/core"
import { mergeDeskScene, scenesOnScreen } from "@/lib/desk-scenes"
import {
  loadSceneApprovalRecovery,
  persistSceneLibraryNow,
  saveSceneApprovalRecovery,
  useBroadcastStore,
  type SceneApprovalRecovery,
} from "@/stores/broadcast-store"
import { useJournalStore } from "@/stores/journal-store"
import { create } from "zustand"

export type ApprovalRequestState = "submitted" | "approved" | "declined" | "requested_changes" | "applied" | "expired" | "withdrawn" | "superseded"
export type ApprovalDecision = "approve" | "decline" | "request_changes"

export interface ApprovalActor {
  id: string
  name: string
}

export interface ApprovalRequest {
  id: string
  kind: string
  targetId: string
  baseRevision: number | null
  requester: ApprovalActor
  payload: unknown
  reason: string | null
  state: ApprovalRequestState
  createdAt: string
  expiresAt: string
  decidedBy: ApprovalActor | null
  decidedAt: string | null
  decisionNote: string | null
}

export interface ApprovalEvent {
  seq: number
  at: string
  actor: ApprovalActor
  action: string
  detail: string | null
}

interface ApprovalRequestsState {
  requests: ApprovalRequest[]
  histories: Record<string, ApprovalEvent[]>
  localApplicationErrors: Record<string, string>
  localSceneRecoveries: Record<string, SceneApprovalRecovery>
  localRecoveryDismissed: Record<string, boolean>
  localRecoveryUnavailable: Record<string, boolean>
  hydrated: boolean
  loading: boolean
  error: string | null
}

export const useApprovalRequestsStore = create<ApprovalRequestsState>(() => ({
  requests: [],
  histories: {},
  localApplicationErrors: {},
  localSceneRecoveries: {},
  localRecoveryDismissed: {},
  localRecoveryUnavailable: {},
  hydrated: false,
  loading: false,
  error: null,
}))

let hydration: Promise<void> | null = null
let loadSequence = 0

export function approvalErrorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message
  return "The host approval service could not be reached."
}

/** Load the host's authoritative SQLite request list. This never reads the legacy local ledger. */
export async function reloadApprovalRequests(): Promise<void> {
  const sequence = ++loadSequence
  useApprovalRequestsStore.setState({ loading: true, error: null })
  try {
    const requests = await invoke<ApprovalRequest[]>("approvals_list")
    if (!Array.isArray(requests)) throw new Error("The host returned an invalid approval list.")
    const recoveries: Record<string, SceneApprovalRecovery> = {}
    await Promise.all(requests.filter((item) => item.state === "applied" && item.kind.startsWith("scene_")).map(async (item) => {
      try {
        const recovery = await loadSceneApprovalRecovery(item.id)
        if (recovery && recovery.kind === item.kind && recovery.targetId === item.targetId) recoveries[item.id] = recovery
      } catch {
        // Host truth remains available even when this computer cannot read its local recovery record.
      }
    }))
    if (sequence === loadSequence) useApprovalRequestsStore.setState({
      requests,
      localSceneRecoveries: recoveries,
      localRecoveryDismissed: Object.fromEntries(Object.entries(recoveries).filter(([, recovery]) => recovery.status === "kept_local").map(([id]) => [id, true])),
      hydrated: true,
      error: null,
    })
  } catch (error) {
    if (sequence === loadSequence) useApprovalRequestsStore.setState({ hydrated: true, error: approvalErrorText(error) })
    throw error
  } finally {
    if (sequence === loadSequence) useApprovalRequestsStore.setState({ loading: false })
  }
}

export function hydrateApprovalRequests(): Promise<void> {
  if (useApprovalRequestsStore.getState().hydrated && !useApprovalRequestsStore.getState().error) return Promise.resolve()
  if (hydration) return hydration
  const pending = reloadApprovalRequests()
  const current = pending.finally(() => { if (hydration === current) hydration = null })
  hydration = current
  return current
}

export function resetApprovalRequests(): void {
  loadSequence += 1
  hydration = null
  useApprovalRequestsStore.setState({ requests: [], histories: {}, localApplicationErrors: {}, localSceneRecoveries: {}, localRecoveryDismissed: {}, localRecoveryUnavailable: {}, hydrated: false, loading: false, error: null })
}

export async function decideApprovalRequest(id: string, decision: ApprovalDecision, note?: string): Promise<ApprovalRequest> {
  const request = await invoke<ApprovalRequest>("approvals_decide", { id, decision, ...(note ? { note } : {}) })
  if (!request || request.id !== id) throw new Error("The host returned a different approval request than the one selected.")
  useApprovalRequestsStore.setState((state) => ({
    requests: state.requests.some((item) => item.id === id)
      ? state.requests.map((item) => item.id === id ? request : item)
      : [request, ...state.requests],
    histories: Object.fromEntries(Object.entries(state.histories).filter(([requestId]) => requestId !== id)),
    error: null,
  }))
  return request
}

/** Confirm a plan approval only after Prepare approved the requested revision. The host checks
 * the saved program revision itself; scene requests must never use this generic apply command. */
export async function confirmPlanApprovalRequest(id: string): Promise<ApprovalRequest> {
  const current = useApprovalRequestsStore.getState().requests.find((item) => item.id === id)
  if (!current || current.kind !== "plan_approve") throw new Error("Only plan approval requests can be confirmed here.")
  if (current.state !== "approved") throw new Error("The request must be approved before it can be confirmed.")
  if (current.baseRevision === null) throw new Error("This plan request has no revision to verify and cannot be confirmed safely.")

  try {
    const request = await invoke<ApprovalRequest>("approvals_apply", { id })
    if (!request || request.id !== id || request.state !== "applied") {
      throw new Error("The host did not confirm this plan revision as applied.")
    }
    useApprovalRequestsStore.setState((state) => ({
      requests: state.requests.map((item) => item.id === id ? request : item),
      histories: Object.fromEntries(Object.entries(state.histories).filter(([requestId]) => requestId !== id)),
      error: null,
    }))
    return request
  } catch (error) {
    // A stale apply changes the durable host state to superseded before it returns a refusal.
    // Refresh the list so the UI reflects that host truth instead of leaving an approved badge.
    await reloadApprovalRequests().catch(() => {})
    throw error
  }
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function sceneMatchesApproval(request: ApprovalRequest, scenes: ReturnType<typeof useBroadcastStore.getState>["scenes"]): boolean {
  const existing = scenes.find((scene) => scene.id === request.targetId)
  if (request.kind === "scene_delete") return !existing
  const payload = recordOf(request.payload)
  const scene = mergeDeskScene(recordOf(payload?.scene), existing)
  if (!scene || !existing) return false
  return sameSceneContent(scene, existing)
}

function sameSceneContent(a: ReturnType<typeof mergeDeskScene>, b: ReturnType<typeof useBroadcastStore.getState>["scenes"][number] | null | undefined): boolean {
  if (!a || !b) return a === b
  const withoutLocalRevision = (value: typeof a) => Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "createdAt" && key !== "updatedAt" && key !== "updatedBy"),
  )
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable)
    if (!value || typeof value !== "object") return value
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, stable(nested)]))
  }
  return JSON.stringify(stable(withoutLocalRevision(a))) === JSON.stringify(stable(withoutLocalRevision(b)))
}

/** An applied host request can outlive a failed local disk write; expose a local-only recovery. */
export function sceneApprovalNeedsLocalRecovery(
  request: ApprovalRequest,
  scenes: ReturnType<typeof useBroadcastStore.getState>["scenes"],
  localError?: string,
  recoveryDismissed = false,
): boolean {
  if (request.state !== "applied" || !request.kind.startsWith("scene_")) return false
  if (recoveryDismissed) return false
  return Boolean(localError) || !sceneMatchesApproval(request, scenes)
}

export function sceneApprovalHasNewerLocalConflict(
  request: ApprovalRequest,
  scenes: ReturnType<typeof useBroadcastStore.getState>["scenes"],
  recovery: SceneApprovalRecovery | undefined,
): boolean {
  if (request.state !== "applied" || !recovery || recovery.status !== "pending") return false
  const existing = scenes.find((scene) => scene.id === request.targetId)
  if (sceneMatchesApproval(request, scenes)) return false
  return !sameSceneContent(existing ?? null, recovery.beforeScene)
}

const journaledSceneApprovals = new Set<string>()

async function applyApprovedSceneLocally(request: ApprovalRequest, recovery: SceneApprovalRecovery): Promise<void> {
  if (recovery.status !== "pending") throw new Error("This approved scene request was resolved by keeping the newer local scene. Send a fresh request to change it.")
  const broadcast = useBroadcastStore.getState()
  const existing = broadcast.scenes.find((scene) => scene.id === request.targetId)
  if (request.kind === "scene_save") {
    const payload = recordOf(request.payload)
    const scene = mergeDeskScene(recordOf(payload?.scene), existing)
    if (!scene || scene.id !== request.targetId) {
      throw new Error("The approved scene payload could not be restored safely on this computer.")
    }
    if (!sceneMatchesApproval(request, broadcast.scenes) && !sameSceneContent(existing ?? null, recovery.beforeScene)) {
      throw new Error("The local scene changed after host approval, so recovery stopped to protect the newer design. Submit a fresh scene request.")
    }
    const changed = !sameSceneContent(scene, recovery.beforeScene)
    const needsApply = !sceneMatchesApproval(request, broadcast.scenes)
    if (needsApply) broadcast.saveScene(scene)
    await persistSceneLibraryNow(useBroadcastStore.getState().scenes)
    if (changed && !journaledSceneApprovals.has(request.id)) {
      journaledSceneApprovals.add(request.id)
      useJournalStore.getState().add({
      kind: "scene",
      label: `Scene ${scene.name} ${existing ? "changed" : "made"} by ${request.requester.name} (approved on the main desk)`,
      })
    }
    await saveSceneApprovalRecovery(request.id, null)
    return
  }

  if (existing && !sameSceneContent(existing, recovery.beforeScene)) {
    throw new Error("The local scene changed after host approval, so recovery stopped to protect the newer design. Submit a fresh scene request.")
  }
  if (scenesOnScreen(useBroadcastStore.getState()).has(request.targetId)) {
    throw new Error("That scene is now on a real screen. Move each screen to another scene before retrying its local deletion.")
  }
  const changed = recovery.beforeScene !== null
  if (existing) broadcast.deleteScene(request.targetId)
  await persistSceneLibraryNow(useBroadcastStore.getState().scenes)
  if (changed && !journaledSceneApprovals.has(request.id)) {
    journaledSceneApprovals.add(request.id)
    useJournalStore.getState().add({
      kind: "scene",
      label: `Scene ${existing?.name ?? recovery.beforeScene?.name ?? request.targetId} deleted by ${request.requester.name} (approved on the main desk)`,
    })
  }
  await saveSceneApprovalRecovery(request.id, null)
}

let sceneApprovalApplyQueue: Promise<void> = Promise.resolve()

/** Store-level serialization protects each request's durable recovery record as well as the host transition. */
export function applySceneApprovalRequest(id: string): Promise<ApprovalRequest> {
  const next = sceneApprovalApplyQueue.then(() => applySceneApprovalRequestSerialized(id), () => applySceneApprovalRequestSerialized(id))
  sceneApprovalApplyQueue = next.then(() => {}, () => {})
  return next
}

/** Apply an approved remote scene request only after the host rechecks its saved revision and outputs. */
async function applySceneApprovalRequestSerialized(id: string): Promise<ApprovalRequest> {
  let current = useApprovalRequestsStore.getState().requests.find((item) => item.id === id)
  if (!current || (current.kind !== "scene_save" && current.kind !== "scene_delete")) {
    throw new Error("Only a host-approved scene request can be applied here.")
  }
  if (current.state !== "approved" && current.state !== "applied") throw new Error("The scene request must be approved before it can be applied.")

  let hostApplied = current.state === "applied"
  let recovery: SceneApprovalRecovery | null = null
  let recoverySaved = false
  let recoveryUnavailable = false
  try {
    // Reject malformed saves and known active-screen deletions before consuming the one-shot host approval.
    if (current.kind === "scene_save") {
      const payload = recordOf(current.payload)
      const existing = useBroadcastStore.getState().scenes.find((scene) => scene.id === current!.targetId)
      const candidate = mergeDeskScene(recordOf(payload?.scene), existing)
      if (!candidate || candidate.id !== current.targetId) throw new Error("The approved scene payload could not be restored safely on this computer.")
    } else if (current.state === "approved" && scenesOnScreen(useBroadcastStore.getState()).has(current.targetId)) {
      throw new Error("That scene is on a real screen. Move each screen to another scene before applying its deletion.")
    }

    recovery = await loadSceneApprovalRecovery(id)
    if (recovery && (recovery.kind !== current.kind || recovery.targetId !== current.targetId)) throw new Error("The local recovery record does not match this request; keep the current scene and submit a fresh request.")
    if (recovery?.status === "kept_local") return current
    if (!recovery && current.state === "applied" && !sceneMatchesApproval(current, useBroadcastStore.getState().scenes)) {
      recoveryUnavailable = true
      throw new Error("This request was applied before local recovery tracking was available. The host state is final, but the local scene changed; submit a fresh request for a safe update.")
    }
    if (!recovery) {
      const beforeScene = useBroadcastStore.getState().scenes.find((scene) => scene.id === current!.targetId) ?? null
      recovery = { requestId: id, kind: current.kind, targetId: current.targetId, beforeScene: beforeScene ? structuredClone(beforeScene) : null, status: "pending" }
      await saveSceneApprovalRecovery(id, recovery)
      recoverySaved = true
      useApprovalRequestsStore.setState((state) => ({ localSceneRecoveries: { ...state.localSceneRecoveries, [id]: recovery! } }))
    }

    if (current.state !== "applied") {
      const request = await invoke<ApprovalRequest>("approvals_apply", { id })
      hostApplied = request?.id === id && request.state === "applied"
      if (!hostApplied || request.kind !== current.kind || request.targetId !== current.targetId) {
        throw new Error("The host did not confirm this exact scene request as applied.")
      }
      current = request
      useApprovalRequestsStore.setState((state) => ({
        requests: state.requests.map((item) => item.id === id ? request : item),
        error: null,
      }))
    }

    await applyApprovedSceneLocally(current, recovery)
    useApprovalRequestsStore.setState((state) => ({
      requests: state.requests.map((item) => item.id === id ? current! : item),
      histories: Object.fromEntries(Object.entries(state.histories).filter(([requestId]) => requestId !== id)),
      localApplicationErrors: Object.fromEntries(Object.entries(state.localApplicationErrors).filter(([requestId]) => requestId !== id)),
      localSceneRecoveries: Object.fromEntries(Object.entries(state.localSceneRecoveries).filter(([requestId]) => requestId !== id)),
      localRecoveryDismissed: Object.fromEntries(Object.entries(state.localRecoveryDismissed).filter(([requestId]) => requestId !== id)),
      localRecoveryUnavailable: Object.fromEntries(Object.entries(state.localRecoveryUnavailable).filter(([requestId]) => requestId !== id)),
      error: null,
    }))
    return current
  } catch (error) {
    // The host marks stale requests superseded before refusing; refresh so Permissions shows that state.
    await reloadApprovalRequests().catch(() => {})
    const refreshed = useApprovalRequestsStore.getState().requests.find((item) => item.id === id)
    if (refreshed?.state === "applied" && refreshed.kind === current.kind && refreshed.targetId === current.targetId) {
      current = refreshed
      hostApplied = true
    }
    if (hostApplied) {
      const detail = approvalErrorText(error)
      useApprovalRequestsStore.setState((state) => ({
        localApplicationErrors: { ...state.localApplicationErrors, [id]: detail },
        ...(recoveryUnavailable ? { localRecoveryUnavailable: { ...state.localRecoveryUnavailable, [id]: true } } : {}),
        ...(recovery?.status === "pending" ? { localSceneRecoveries: { ...state.localSceneRecoveries, [id]: recovery } } : {}),
      }))
      throw new Error(`The host recorded this request as applied, but local completion needs attention: ${detail}`)
    }
    if (recoverySaved) {
      await saveSceneApprovalRecovery(id, null).catch(() => {})
      useApprovalRequestsStore.setState((state) => ({
        localSceneRecoveries: Object.fromEntries(Object.entries(state.localSceneRecoveries).filter(([requestId]) => requestId !== id)),
      }))
    }
    throw error
  }
}

/** Keep a newer local design and close this recovery without replacing that design. */
export async function keepNewerLocalSceneAfterApproval(id: string): Promise<void> {
  const request = useApprovalRequestsStore.getState().requests.find((item) => item.id === id)
  if (!request || request.state !== "applied" || (request.kind !== "scene_save" && request.kind !== "scene_delete")) {
    throw new Error("Only an applied host scene request can be resolved this way.")
  }
  const recovery = await loadSceneApprovalRecovery(id)
  if (!sceneApprovalHasNewerLocalConflict(request, useBroadcastStore.getState().scenes, recovery ?? undefined)) {
    throw new Error("There is no newer local scene to keep. Retry the approved scene recovery instead.")
  }
  const kept = { ...recovery!, status: "kept_local" as const }
  await saveSceneApprovalRecovery(id, kept)
  useApprovalRequestsStore.setState((state) => ({
    localSceneRecoveries: { ...state.localSceneRecoveries, [id]: kept },
    localRecoveryDismissed: { ...state.localRecoveryDismissed, [id]: true },
    localRecoveryUnavailable: Object.fromEntries(Object.entries(state.localRecoveryUnavailable).filter(([requestId]) => requestId !== id)),
    localApplicationErrors: Object.fromEntries(Object.entries(state.localApplicationErrors).filter(([requestId]) => requestId !== id)),
  }))
}

export async function loadApprovalHistory(id: string): Promise<ApprovalEvent[]> {
  const events = await invoke<ApprovalEvent[]>("approvals_history", { id })
  if (!Array.isArray(events)) throw new Error("The host returned invalid approval history.")
  useApprovalRequestsStore.setState((state) => ({ histories: { ...state.histories, [id]: events } }))
  return events
}
