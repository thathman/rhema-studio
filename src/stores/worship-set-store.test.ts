import { beforeEach, describe, expect, it } from "vitest"
import { useWorshipSetStore, type WorshipSetChange } from "./worship-set-store"
import type { WorshipSetItem } from "@/lib/desk-consoles"

const base: WorshipSetItem[] = [
  { id: "a", title: "Alpha" },
  { id: "b", title: "Beta", live: true },
  { id: "c", title: "Gamma", key: "D" },
]

const change = (value: WorshipSetChange, inserted?: WorshipSetItem) =>
  useWorshipSetStore.getState().apply("service-1", base, value, inserted)

describe("temporary Worship order", () => {
  beforeEach(() => useWorshipSetStore.getState().reset())

  it("moves, skips, repeats and inserts only in the in-memory service order", () => {
    expect(change({ op: "move", item: "c", before: "a" })).toBe(true)
    expect(useWorshipSetStore.getState().forService("service-1", base).map((item) => item.id)).toEqual(["c", "a", "b"])
    expect(change({ op: "repeat", item: "b" })).toBe(true)
    const repeated = useWorshipSetStore.getState().forService("service-1", base)
    expect(repeated.map((item) => item.title)).toEqual(["Gamma", "Alpha", "Beta", "Beta"])
    expect(repeated[2]).toMatchObject({ id: "b", live: true })
    expect(repeated[3]?.id).toMatch(/^repeat-/)
    expect(change({ op: "insert", item: "a", song: "Delta" }, { id: "delta-library-id", title: "Delta", key: "G" })).toBe(true)
    expect(useWorshipSetStore.getState().forService("service-1", base).map((item) => item.title)).toEqual(["Gamma", "Alpha", "Beta", "Beta", "Delta"])
    expect(change({ op: "skip", item: "a" })).toBe(true)
    expect(useWorshipSetStore.getState().forService("service-1", base).map((item) => item.title)).toEqual(["Gamma", "Beta", "Beta", "Delta"])
    expect(base.map((item) => item.id)).toEqual(["a", "b", "c"])
  })

  it("refuses stale targets and drops the temporary order when another service opens", () => {
    expect(change({ op: "move", item: "missing", before: "a" })).toBe(false)
    expect(change({ op: "move", item: "a", before: "missing" })).toBe(false)
    expect(change({ op: "insert", item: "a", song: "" }, { id: "x", title: "" })).toBe(false)
    expect(change({ op: "skip", item: "b" })).toBe(false)
    expect(useWorshipSetStore.getState().forService("service-2", base)).toEqual(base)
    expect(useWorshipSetStore.getState()).toMatchObject({ serviceId: null, order: null })
  })

  it("keeps an explicitly skipped plan song out of the temporary order while Live songs stay protected", () => {
    expect(change({ op: "skip", item: "b" })).toBe(false)
    expect(change({ op: "skip", item: "a" })).toBe(true)
    expect(useWorshipSetStore.getState().forService("service-1", base).map((item) => item.id)).toEqual(["b", "c"])
    expect(useWorshipSetStore.getState().skipped).toEqual(["a"])
  })

  it("drops removed Prepare songs and their repeats but keeps independent library additions", () => {
    const store = useWorshipSetStore.getState()
    expect(store.apply("service-1", base, { op: "repeat", item: "a" })).toBe(true)
    expect(store.apply("service-1", base, { op: "insert", item: "a", song: "Delta" }, { id: "delta-library-id", title: "Delta" })).toBe(true)
    const beforeRemoval = store.forService("service-1", base)
    expect(beforeRemoval.map((item) => item.title)).toEqual(["Alpha", "Alpha", "Beta", "Gamma", "Delta"])

    const afterRemoval = store.forService("service-1", base.filter((item) => item.id !== "a"))
    expect(afterRemoval.map((item) => item.title)).toEqual(["Beta", "Gamma", "Delta"])
    expect(afterRemoval.some((item) => item.id === "a" || item.id.startsWith("repeat-"))).toBe(false)
  })
})
