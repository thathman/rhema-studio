import { beforeEach, describe, expect, it } from "vitest"
import { useJournalStore } from "@/stores/journal-store"
import { useServiceOffset } from "@/stores/service-offset-store"
import { useServiceStore } from "@/stores/service-store"

describe("the shared running-late offset (#196)", () => {
  beforeEach(() => { useServiceOffset.setState({ minutes: 0, by: null }); useJournalStore.setState({ entries: [] }) })

  it("adds up, says who, is logged, and stays within −120…+240", () => {
    useServiceOffset.getState().adjust(5, "Timekeeper")
    useServiceOffset.getState().adjust(5, "Main desk")
    expect(useServiceOffset.getState()).toMatchObject({ minutes: 10, by: "Main desk" })
    expect(useJournalStore.getState().entries.map((e) => e.label)).toEqual(["Timekeeper: running 5 min late (+5 min)", "Main desk: running 10 min late (+5 min)"])
    useServiceOffset.getState().adjust(-1000)
    expect(useServiceOffset.getState().minutes).toBe(-120)
    useServiceOffset.getState().reset("Main desk")
    expect(useServiceOffset.getState().minutes).toBe(0)
    expect(useJournalStore.getState().entries.at(-1)?.label).toBe("Main desk: back on schedule")
  })

  it("starts again for another service", () => {
    useServiceOffset.getState().adjust(10)
    useServiceStore.setState({ current: { id: "next-sunday" } as never })
    expect(useServiceOffset.getState().minutes).toBe(0)
  })
})
