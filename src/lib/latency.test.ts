import { describe, expect, it } from "vitest"
import { BATCH, createLatencyLog } from "./latency"

describe("slide-change latency log", () => {
  it("summarises every batch and calls out a slow change on its own", () => {
    const log = createLatencyLog("Main Display")
    const lines: Array<{ warn?: string; info?: string }> = []
    for (let i = 0; i < BATCH; i++) lines.push(log.record(i === 3 ? 250 : 10 + i))
    expect(lines.filter((l) => l.warn)).toEqual([{ warn: "[latency] Main Display: a screen change took 250 ms" }])
    expect(lines.at(-1)?.info).toBe("[latency] Main Display: 20 screen changes, median 21 ms, slowest 250 ms")
    expect(log.record(5)).toEqual({})
  })
})
