import { beforeEach, describe, expect, it, vi } from "vitest"
import { approvalHolds, leaveRehearsal, showRehearsalLive, useApprovalGateStore } from "./approval-gate-store"
import { useBroadcastStore } from "./broadcast-store"
import { useServiceStore } from "./service-store"
import { useSettingsStore } from "./settings-store"
import { useJournalStore } from "./journal-store"
import type { Program } from "@/types/content"
import type { VerseRenderData } from "@/types"

const program = (over: Partial<Program> = {}) => ({ id: "p1", title: "Sunday", revision: 3, approved_revision: null, ...over }) as unknown as Program
const slide = { kind: "slide", reference: "Song", segments: [], lines: ["x"] } as unknown as VerseRenderData

describe("approval before go-live (CL-002, opt-in)", () => {
  beforeEach(() => {
    useApprovalGateStore.setState({ held: null, retry: null, acknowledged: [] })
    useBroadcastStore.setState({ rehearsal: false, isLive: false, liveVerse: null })
    useSettingsStore.setState({ requireApproval: true })
    useServiceStore.setState({ current: program(), dirty: false })
  })

  it("holds unsaved edits to an approved service, as a saved change would be held (#409)", () => {
    useServiceStore.setState({ current: program({ approved_revision: 3 }), dirty: true })
    const retry = vi.fn()
    expect(approvalHolds(retry)).toBe(true)
    expect(useApprovalGateStore.getState().held?.id).toBe("p1")
    expect(retry).not.toHaveBeenCalled()
  })

  it("drops a held question when another service opens; Present anyway then acts on nothing (#409)", () => {
    const retry = vi.fn()
    expect(approvalHolds(retry)).toBe(true)
    useServiceStore.setState({ current: program({ id: "p2", approved_revision: 3 }) })
    expect(useApprovalGateStore.getState().held).toBeNull()
    useJournalStore.setState({ entries: [], runContext: null })
    useApprovalGateStore.getState().presentAnyway()
    expect(retry).not.toHaveBeenCalled()
    expect(useApprovalGateStore.getState().acknowledged).not.toContain("p1")
    expect(useJournalStore.getState().entries).toEqual([])
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

  it("Present anyway is in the service log: who let which unapproved version through, kept when its go-live starts the run (#409)", async () => {
    useSettingsStore.setState({ operatorName: "Femi" })
    useJournalStore.setState({ entries: [], runContext: null })
    // As in use: the go-live it lets through comes later (a verse is fetched first), and starts the run's log.
    expect(approvalHolds(() => { void Promise.resolve().then(() => useJournalStore.getState().add({ kind: "live", label: "Welcome", itemId: "w" })) })).toBe(true)
    useApprovalGateStore.getState().presentAnyway()
    await Promise.resolve()
    const entries = useJournalStore.getState().entries
    expect(entries.map((e) => e.kind)).toEqual(["approval", "live"])
    expect(entries[0]).toMatchObject({ by: "Femi", label: 'Present anyway: "Sunday" v3 was not approved · by Femi' })
    // Not asked again this session, so not logged again.
    useJournalStore.getState().add({ kind: "live", label: "Psalm 23", itemId: "p" })
    expect(useJournalStore.getState().entries.filter((e) => e.kind === "approval")).toHaveLength(1)
  })

  it("a let-through belongs to its own service's run only (#409)", async () => {
    useJournalStore.setState({ entries: [], runContext: null })
    // Service A (approved) is running; B is let through unapproved, then goes live: a new run for B.
    useServiceStore.setState({ current: program({ id: "a", approved_revision: 3 }) })
    useJournalStore.getState().add({ kind: "live", label: "A welcome", itemId: "a1" })
    useServiceStore.setState({ current: program({ id: "b", title: "Evening" }) })
    expect(approvalHolds(() => useJournalStore.getState().add({ kind: "live", label: "B welcome", itemId: "b1" }))).toBe(true)
    useApprovalGateStore.getState().presentAnyway()
    expect(useJournalStore.getState().runContext?.programId).toBe("b")
    expect(useJournalStore.getState().entries.map((e) => [e.kind, e.programId ?? null])).toEqual([["approval", "b"], ["live", null]])

    // A later run for another service within the minute does not take B's let-through.
    useServiceStore.setState({ current: program({ id: "c", approved_revision: 3 }) })
    useJournalStore.getState().add({ kind: "live", label: "C welcome", itemId: "c1" })
    expect(useJournalStore.getState().entries.some((e) => e.kind === "approval")).toBe(false)
  })

  it("a recording running before the first go-live belongs to the run it starts, and is logged in rehearsal (#411)", () => {
    useServiceStore.setState({ current: program({ approved_revision: 3 }) })
    useJournalStore.setState({ entries: [], runContext: null })
    useJournalStore.getState().add({ kind: "recording", label: "Recording started: Overflow", recording: "started" })
    useJournalStore.getState().add({ kind: "live", label: "Welcome", itemId: "w" })
    expect(useJournalStore.getState().entries.map((e) => e.kind)).toEqual(["recording", "live"])
    useBroadcastStore.setState({ rehearsal: true })
    useJournalStore.getState().add({ kind: "recording", label: "Recording stopped after 5 s", recording: "stopped" })
    useBroadcastStore.setState({ rehearsal: false })
    expect(useJournalStore.getState().entries.filter((e) => e.kind === "recording").map((e) => e.recording)).toEqual(["started", "stopped"])
  })

  it("logs nothing for Not now", () => {
    useJournalStore.setState({ entries: [], runContext: null })
    expect(approvalHolds(() => {})).toBe(true)
    useApprovalGateStore.getState().dismiss()
    useJournalStore.getState().add({ kind: "live", label: "Welcome", itemId: "w" })
    expect(useJournalStore.getState().entries.some((e) => e.kind === "approval")).toBe(false)
  })

  it("letting rehearsed content through unapproved is logged, though rehearsal was on when it was asked", () => {
    useJournalStore.setState({ entries: [] })
    useBroadcastStore.setState({ rehearsal: true, isLive: true, liveVerse: slide, rehearsalReturn: null })
    showRehearsalLive()
    useApprovalGateStore.getState().presentAnyway()
    expect(useJournalStore.getState().entries.some((e) => e.kind === "approval")).toBe(true)
  })

  it("showing rehearsed service content live asks first; plain leaving shows nothing new, so it does not", () => {
    useBroadcastStore.setState({ rehearsal: true, isLive: true, liveVerse: slide, rehearsalReturn: null })
    showRehearsalLive()
    expect(useBroadcastStore.getState().rehearsal).toBe(true)
    useApprovalGateStore.getState().presentAnyway()
    expect(useBroadcastStore.getState().rehearsal).toBe(false)
    useApprovalGateStore.setState({ held: null })
    useBroadcastStore.setState({ rehearsal: true, isLive: true, liveVerse: slide })
    leaveRehearsal()
    expect(useBroadcastStore.getState().rehearsal).toBe(false)
    expect(useApprovalGateStore.getState().held).toBeNull()
  })
})
