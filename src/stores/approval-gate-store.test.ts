import { beforeEach, describe, expect, it, vi } from "vitest"
import { approvalHolds, useApprovalGateStore } from "./approval-gate-store"
import { useBroadcastStore } from "./broadcast-store"
import { useServiceStore } from "./service-store"
import { useSettingsStore } from "./settings-store"
import type { Program } from "@/types/content"

const program = (over: Partial<Program> = {}) => ({ id: "p1", title: "Sunday", revision: 3, approved_revision: null, ...over }) as unknown as Program

describe("approval before go-live (CL-002, opt-in)", () => {
  beforeEach(() => {
    useApprovalGateStore.setState({ held: null, retry: null, acknowledged: [] })
    useBroadcastStore.setState({ rehearsal: false, isLive: false })
    useSettingsStore.setState({ requireApproval: true })
    useServiceStore.setState({ current: program() })
  })

  it("never holds when the setting is off, in rehearsal, with no service open, or when approved as it stands", () => {
    useSettingsStore.setState({ requireApproval: false })
    expect(approvalHolds(() => {})).toBe(false)
    useSettingsStore.setState({ requireApproval: true })
    useBroadcastStore.setState({ rehearsal: true })
    expect(approvalHolds(() => {})).toBe(false)
    useBroadcastStore.setState({ rehearsal: false, isLive: true })
    expect(approvalHolds(() => {})).toBe(false) // already on air: Next is never held
    useBroadcastStore.setState({ isLive: false })
    useServiceStore.setState({ current: null })
    expect(approvalHolds(() => {})).toBe(false)
    useServiceStore.setState({ current: program({ approved_revision: 3 }) })
    expect(approvalHolds(() => {})).toBe(false)
  })

  it("holds an unapproved service; Present anyway runs the held go-live and lets that version through", () => {
    const retry = vi.fn()
    expect(approvalHolds(retry)).toBe(true)
    expect(useApprovalGateStore.getState().held?.title).toBe("Sunday")
    useApprovalGateStore.getState().presentAnyway()
    expect(retry).toHaveBeenCalledTimes(1)
    expect(approvalHolds(() => {})).toBe(false)
    // An edit mid-service (new revision) does not ask again.
    useServiceStore.setState({ current: program({ revision: 4 }) })
    expect(approvalHolds(() => {})).toBe(false)
    // Another unapproved service asks; Not now leaves nothing held.
    useServiceStore.setState({ current: program({ id: "p2" }) })
    expect(approvalHolds(() => {})).toBe(true)
    useApprovalGateStore.getState().dismiss()
    expect(useApprovalGateStore.getState().held).toBeNull()
  })
})
