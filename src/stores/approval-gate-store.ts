import { create } from "zustand"
import { approvalState } from "@/lib/approval"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"

/**
 * CL-002 "approval required before go-live", as an opt-in setting (off by
 * default; whether it should be on by default is an owner decision). When
 * on and the open service is not approved as it stands, the first go-live
 * is held and Present asks; "Present anyway" runs it. Only the first: a
 * service that has gone live once this session is never held again (an
 * edit mid-service must not put a question in front of Next). Quick
 * screens, sound items, rehearsal and presenting with no service open are
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

/**
 * True when a go-live must wait for the operator (and records what was held).
 * Call it before any other effect (active item, cancelling presents) so a
 * held go-live changes nothing. A service counts as started at its first
 * go-live that is not held (approved, gate off, or let through), and is
 * never held again this session.
 */
/** Whether a go-live now would be held, without asking or recording anything. */
export function approvalWouldHold(opts: { leavingRehearsal?: boolean } = {}): boolean {
  const current = useServiceStore.getState().current
  if (!current) return false
  const gate = useApprovalGateStore.getState()
  if (gate.held) return true
  if (gate.acknowledged.includes(current.id)) return false
  if (useBroadcastStore.getState().rehearsal && !opts.leavingRehearsal) return false
  return useSettingsStore.getState().requireApproval && approvalState(current) !== "approved"
}

export function approvalHolds(retry: () => void, opts: { leavingRehearsal?: boolean } = {}): boolean {
  const current = useServiceStore.getState().current
  if (!current) return false
  const gate = useApprovalGateStore.getState()
  if (gate.held) return true // one question at a time; the first request is the one kept
  if (gate.acknowledged.includes(current.id)) return false
  if (useBroadcastStore.getState().rehearsal && !opts.leavingRehearsal) return false
  if (!approvalWouldHold(opts)) {
    useApprovalGateStore.setState({ acknowledged: [...gate.acknowledged, current.id] })
    return false
  }
  useApprovalGateStore.setState({ held: { id: current.id, revision: current.revision, title: current.title }, retry })
  return true
}

/** Leave rehearsal: the real program comes back as it was (ADR 0001), so nothing new goes on air. */
export function leaveRehearsal(): void {
  useBroadcastStore.getState().setRehearsal(false)
}

/** Leave rehearsal showing what was rehearsed: a deliberate go-live, so the approval question applies. */
export function showRehearsalLive(): void {
  const b = useBroadcastStore.getState()
  if (!b.rehearsal) return
  if (b.isLive && b.liveVerse && !b.liveVerse.screen && !b.liveVerse.quick && approvalHolds(showRehearsalLive, { leavingRehearsal: true })) return
  b.setRehearsal(false, { keepRehearsed: true })
}
