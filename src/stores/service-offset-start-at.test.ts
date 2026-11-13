import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn(async () => {}), emitTo: vi.fn(async () => {}) }))

import { useServiceOffset } from "@/stores/service-offset-store"
import { useJournalStore } from "@/stores/journal-store"

describe("running late until a time (#196)", () => {
  it("sets the lateness to the minutes between the planned start and the new one, in one step", () => {
    useServiceOffset.setState({ minutes: 5, by: null, mode: "absorb" })
    expect(useServiceOffset.getState().startAt("10:40", "10:00", "Ade")).toBe(true)
    expect(useServiceOffset.getState()).toMatchObject({ minutes: 40, by: "Ade" })
    expect(useJournalStore.getState().entries.at(-1)?.label).toContain("running 40 min late")
    // Early, and back on time.
    useServiceOffset.getState().startAt("09:55", "10:00", "Ade")
    expect(useServiceOffset.getState().minutes).toBe(-5)
    useServiceOffset.getState().startAt("10:00", "10:00", "Ade")
    expect(useServiceOffset.getState().minutes).toBe(0)
  })

  it("refuses a time that is not one, or beyond what the offset holds, changing nothing", () => {
    useServiceOffset.setState({ minutes: 0, by: null })
    expect(useServiceOffset.getState().startAt("ten forty", "10:00")).toBe(false)
    expect(useServiceOffset.getState().startAt("11:30", "06:00")).toBe(false)
    expect(useServiceOffset.getState().minutes).toBe(0)
  })

  it("reads across midnight as the nearest day (a watch-night service)", () => {
    useServiceOffset.setState({ minutes: 0, by: null })
    useServiceOffset.getState().startAt("00:10", "23:30")
    expect(useServiceOffset.getState().minutes).toBe(40)
    useServiceOffset.getState().startAt("23:55", "00:15")
    expect(useServiceOffset.getState().minutes).toBe(-20)
  })
})
