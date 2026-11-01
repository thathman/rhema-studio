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
  hydrated: boolean
  loading: boolean
  error: string | null
}

export const useApprovalRequestsStore = create<ApprovalRequestsState>(() => ({
  requests: [],
  histories: {},
  localApplicationErrors: {},
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
    if (sequence === loadSequence) useApprovalRequestsStore.setState({ requests, hydrated: true, error: null })
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
  useApprovalRequestsStore.setState({ requests: [], histories: {}, localApplicationErrors: {}, hydrated: false, loading: false, error: null })
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
): boolean {
  if (request.state !== "applied" || !request.kind.startsWith("scene_")) return false
  return Boolean(localError) || !sceneMatchesApproval(request, scenes)
}

async function applyApprovedSceneLocally(request: ApprovalRequest, recovery: SceneApprovalRecovery): Promise<void> {
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
    const changed = !sceneMatchesApproval(request, broadcast.scenes)
    if (changed) broadcast.saveScene(scene)
    await persistSceneLibraryNow(useBroadcastStore.getState().scenes)
    if (changed) useJournalStore.getState().add({
      kind: "scene",
      label: `Scene ${scene.name} ${existing ? "changed" : "made"} by ${request.requester.name} (approved on the main desk)`,
    })
    await saveSceneApprovalRecovery(null)
    return
  }

  if (existing && !sameSceneContent(existing, recovery.beforeScene)) {
    throw new Error("The local scene changed after host approval, so recovery stopped to protect the newer design. Submit a fresh scene request.")
  }
  if (scenesOnScreen(useBroadcastStore.getState()).has(request.targetId)) {
    throw new Error("That scene is now on a real screen. Move each screen to another scene before retrying its local deletion.")
  }
  if (existing) broadcast.deleteScene(request.targetId)
  await persistSceneLibraryNow(useBroadcastStore.getState().scenes)
  if (existing) useJournalStore.getState().add({
    kind: "scene",
    label: `Scene ${existing?.name ?? request.targetId} deleted by ${request.requester.name} (approved on the main desk)`,
  })
  await saveSceneApprovalRecovery(null)
}

/** Apply an approved remote scene request only after the host rechecks its saved revision and outputs. */
export async function applySceneApprovalRequest(id: string): Promise<ApprovalRequest> {
  let current = useApprovalRequestsStore.getState().requests.find((item) => item.id === id)
  if (!current || (current.kind !== "scene_save" && current.kind !== "scene_delete")) {
    throw new Error("Only a host-approved scene request can be applied here.")
  }
  if (current.state !== "approved" && current.state !== "applied") throw new Error("The scene request must be approved before it can be applied.")

  let hostApplied = current.state === "applied"
  let recovery: SceneApprovalRecovery | null = null
  let recoverySaved = false
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

    recovery = await loadSceneApprovalRecovery()
    if (recovery && (recovery.requestId !== id || recovery.kind !== current.kind || recovery.targetId !== current.targetId)) {
      throw new Error("Another approved scene change still needs local recovery. Finish that recovery before applying this request.")
    }
    if (!recovery && current.state === "applied" && !sceneMatchesApproval(current, useBroadcastStore.getState().scenes)) {
      throw new Error("This request was applied before local recovery tracking was available. The host state is final, but the local scene changed; submit a fresh request for a safe update.")
    }
    if (!recovery) {
      const beforeScene = useBroadcastStore.getState().scenes.find((scene) => scene.id === current!.targetId) ?? null
      recovery = { requestId: id, kind: current.kind, targetId: current.targetId, beforeScene: beforeScene ? structuredClone(beforeScene) : null }
      await saveSceneApprovalRecovery(recovery)
      recoverySaved = true
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
      error: null,
    }))
    return current
  } catch (error) {
    // The host marks stale requests superseded before refusing; refresh so Permissions shows that state.
    await reloadApprovalRequests().catch(() => {})
    if (hostApplied) {
      const detail = approvalErrorText(error)
      useApprovalRequestsStore.setState((state) => ({
        localApplicationErrors: { ...state.localApplicationErrors, [id]: detail },
      }))
      throw new Error(`The host marked this request applied, but the scene library could not be saved locally: ${detail} Use the local recovery action here to retry without applying it at the host again.`)
    }
    if (recoverySaved) await saveSceneApprovalRecovery(null).catch(() => {})
    throw error
  }
}

export async function loadApprovalHistory(id: string): Promise<ApprovalEvent[]> {
  const events = await invoke<ApprovalEvent[]>("approvals_history", { id })
  if (!Array.isArray(events)) throw new Error("The host returned invalid approval history.")
  useApprovalRequestsStore.setState((state) => ({ histories: { ...state.histories, [id]: events } }))
  return events
}
