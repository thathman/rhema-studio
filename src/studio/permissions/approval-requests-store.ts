import { invoke } from "@tauri-apps/api/core"
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
  hydrated: boolean
  loading: boolean
  error: string | null
}

export const useApprovalRequestsStore = create<ApprovalRequestsState>(() => ({
  requests: [],
  histories: {},
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
  useApprovalRequestsStore.setState({ requests: [], histories: {}, hydrated: false, loading: false, error: null })
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

export async function loadApprovalHistory(id: string): Promise<ApprovalEvent[]> {
  const events = await invoke<ApprovalEvent[]>("approvals_history", { id })
  if (!Array.isArray(events)) throw new Error("The host returned invalid approval history.")
  useApprovalRequestsStore.setState((state) => ({ histories: { ...state.histories, [id]: events } }))
  return events
}
