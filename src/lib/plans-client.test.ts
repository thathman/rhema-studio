import { beforeEach, describe, expect, it, vi } from "vitest"

const mockInvoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }))

import { FORBIDDEN_WORDS, getHostPlan, listHostPlans, readPlanFailure, saveHostPlanDraft, submitHostPlan } from "./plans-client"
import { useSettingsStore } from "@/stores/settings-store"

const plan = (revision: number) => ({
  program: { id: "p1", title: "Sunday Worship", service_date: "2026-11-15", revision, item_count: 1, approved_revision: 2, created_at: "", updated_at: "" },
  items: [{ id: "i1", program_id: "p1", position: 0, kind: "verse", reference: "John 3:16", book_number: 43, chapter: 3, verse: 16, translation: "KJV", secondary_translation: null, notes: "read slowly", payload: null }],
})

beforeEach(() => {
  mockInvoke.mockReset()
  useSettingsStore.setState({ joinAddress: "192.168.1.20:8080", joinToken: "desk-key" })
})

describe("plans client (#847)", () => {
  it("lists and reads plans through the join commands with this desk's key", async () => {
    mockInvoke.mockResolvedValueOnce([plan(3).program]).mockResolvedValueOnce(plan(3))
    const listed = await listHostPlans()
    expect(listed).toEqual({ ok: true, value: [expect.objectContaining({ id: "p1", revision: 3, approved_revision: 2 })] })
    const got = await getHostPlan("p1")
    expect(got.ok && got.value.items[0]).toMatchObject({ id: "i1", reference: "John 3:16", notes: "read slowly" })
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "join_plans", { address: "192.168.1.20:8080", token: "desk-key" })
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "join_plan", { address: "192.168.1.20:8080", token: "desk-key", id: "p1" })
  })

  it("saves a draft at the revision it opened, keeping existing item ids", async () => {
    mockInvoke.mockResolvedValueOnce(plan(4))
    const saved = await saveHostPlanDraft("p1", 3, [{ id: "i1", kind: "verse", reference: "John 3:17" }, { kind: "song", reference: "Amazing Grace" }])
    expect(saved.ok && saved.value.program.revision).toBe(4)
    expect(mockInvoke).toHaveBeenCalledWith("join_save_plan", expect.objectContaining({
      id: "p1",
      expectedRevision: 3,
      items: [expect.objectContaining({ id: "i1", reference: "John 3:17" }), expect.not.objectContaining({ id: expect.anything() })],
    }))
  })

  it("turns a 409 into a conflict with the host's revision now", async () => {
    mockInvoke.mockRejectedValueOnce("conflict:5: The plan changed since you opened it")
    expect(await saveHostPlanDraft("p1", 3, [])).toEqual({ ok: false, failure: { kind: "conflict", actual: 5, message: "The plan changed on the host since you opened it." } })
  })

  it("submits a revision for review and returns the host's approval request", async () => {
    mockInvoke.mockResolvedValueOnce({ id: "request-1", kind: "plan_approve", baseRevision: 4, state: "submitted" })
    const submitted = await submitHostPlan("p1", 4, "  ready for Sunday  ")
    expect(submitted).toEqual({ ok: true, value: { id: "request-1", kind: "plan_approve", baseRevision: 4, state: "submitted" } })
    expect(mockInvoke).toHaveBeenCalledWith("join_submit_plan", expect.objectContaining({ id: "p1", revision: 4, note: "ready for Sunday" }))
  })

  it("says a 403 in plain words, and keeps paused, missing and other refusals apart", async () => {
    mockInvoke.mockRejectedValueOnce("forbidden: This desk's role does not work on the service plan")
    expect(await submitHostPlan("p1", 4)).toEqual({ ok: false, failure: { kind: "forbidden", message: FORBIDDEN_WORDS } })
    expect(readPlanFailure("paused: taken back").kind).toBe("paused")
    expect(readPlanFailure("missing: no such plan")).toEqual({ kind: "missing", message: "no such plan" })
    expect(readPlanFailure("refused: Already decided")).toEqual({ kind: "refused", message: "Already decided" })
    expect(readPlanFailure("Could not reach the host: timed out")).toEqual({ kind: "error", message: "Could not reach the host: timed out" })
  })

  it("refuses a malformed host answer instead of trusting it", async () => {
    mockInvoke.mockResolvedValueOnce({ program: { id: "p1" }, items: [] })
    const got = await getHostPlan("p1")
    expect(got.ok).toBe(false)
  })
})
