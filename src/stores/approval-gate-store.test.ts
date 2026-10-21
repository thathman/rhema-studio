import { beforeEach, describe, expect, it, vi } from "vitest"
import { approvalHolds, leaveRehearsal, useApprovalGateStore } from "./approval-gate-store"
import { useBroadcastStore } from "./broadcast-store"
import { useServiceStore } from "./service-store"
import { useSettingsStore } from "./settings-store"
import type { Program } from "@/types/content"
import type { VerseRenderData } from "@/types"

const program = (over: Partial<Program> = {}) => ({ id: "p1", title: "Sunday", revision: 3, approved_revision: null, ...over }) as unknown as Program
const slide = { kind: "slide", reference: "Song", segments: [], lines: ["x"] } as unknown as VerseRenderData

describe("approval before go-live (CL-002, opt-in)", () => {
  beforeEach(() => {
    useApprovalGateStore.setState({ held: null, retry: null, acknowledged: [] })
    useBroadcastStore.setState({ rehearsal: false, isLive: false, liveVerse: null })
    useSettingsStore.setState({ requireApproval: true })
    useServiceStore.setState({ current: program() })
  })

  it("never holds in rehearsal, with no service open, or when approved; a service that started unheld is never held later", () => {
    useBroadcastStore.setState({ rehearsal: true })
    expect(approvalHolds(() => {})).toBe(false)
    useBroadcastStore.setState({ rehearsal: false })
    useServiceStore.setState({ current: null })
    expect(approvalHolds(() => {})).toBe(false)
    useServiceStore.setState({ current: program({ approved_revision: 3 }) })
    expect(approvalHolds(() => {})).toBe(false)
    useServiceStore.setState({ current: program({ revision: 4, approved_revision: 3 }) }) // edited mid-service
    expect(approvalHolds(() => {})).toBe(false)
  })

  it("with the setting off nothing is held, and turning it on mid-service does not hold that service", () => {
    useSettingsStore.setState({ requireApproval: false })
    expect(approvalHolds(() => {})).toBe(false)
    useSettingsStore.setState({ requireApproval: true })
    expect(approvalHolds(() => {})).toBe(false)
  })

  it("holds even when something is already on air (Welcome), keeps the first request, and Present anyway runs it", () => {
    useBroadcastStore.setState({ isLive: true })
    const first = vi.fn()
    const second = vi.fn()
    expect(approvalHolds(first)).toBe(true)
    expect(approvalHolds(second)).toBe(true) // a second press while asking stays held
    useApprovalGateStore.getState().presentAnyway()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
    expect(approvalHolds(() => {})).toBe(false)
    useServiceStore.setState({ current: program({ id: "p2" }) })
    expect(approvalHolds(() => {})).toBe(true)
    useApprovalGateStore.getState().dismiss()
    expect(useApprovalGateStore.getState().held).toBeNull()
  })

  it("leaving rehearsal with service content on the output asks first", () => {
    useBroadcastStore.setState({ rehearsal: true, isLive: true, liveVerse: slide })
    leaveRehearsal()
    expect(useBroadcastStore.getState().rehearsal).toBe(true)
    useApprovalGateStore.getState().presentAnyway()
    expect(useBroadcastStore.getState().rehearsal).toBe(false)
  })
})
