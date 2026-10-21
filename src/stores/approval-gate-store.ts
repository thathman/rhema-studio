import { create } from "zustand"
import { approvalState } from "@/lib/approval"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"

/**
 * CL-002 "approval required before go-live", as an opt-in setting (off by
 * default; whether it should be on by default is an owner decision). When
 * on and the open service is not approved as it stands, the first go-live
 * is held and Present asks; "Present anyway" runs it. Only the first: never
 * while already on air, and never again for a service that has been live in
 * this session (an edit mid-service must not put a question in front of
 * Next). Quick screens, rehearsal and presenting with no service open are
 * never held.
 */
interface ApprovalGateState {
  /** The service version that was held, shown in Present until answered. */
  held: { id: string; revision: number; title: string } | null
  /** The go-live that was held, run again by "Present anyway". */
  retry: (() => void) | null
  /** Services (by id) that have gone live this session. */
  acknowledged: string[]
  presentAnyway: () => void
  dismiss: () => void
}

export const useApprovalGateStore = create<ApprovalGateState>((set, get) => ({
  held: null,
  retry: null,
  acknowledged: [],
  presentAnyway: () => {
    const { held, retry, acknowledged } = get()
    if (!held) return
    set({ acknowledged: [...acknowledged, held.id], held: null, retry: null })
    retry?.()
  },
  dismiss: () => set({ held: null, retry: null }),
}))

/** True when a go-live must wait for the operator (and records what was held). */
export function approvalHolds(retry: () => void): boolean {
  if (!useSettingsStore.getState().requireApproval) return false
  const broadcast = useBroadcastStore.getState()
  if (broadcast.rehearsal || broadcast.isLive) return false
  const current = useServiceStore.getState().current
  if (!current) return false
  const gate = useApprovalGateStore.getState()
  if (gate.acknowledged.includes(current.id)) return false
  if (approvalState(current) === "approved") {
    useApprovalGateStore.setState({ acknowledged: [...gate.acknowledged, current.id] })
    return false
  }
  useApprovalGateStore.setState({ held: { id: current.id, revision: current.revision, title: current.title }, retry })
  return true
}
