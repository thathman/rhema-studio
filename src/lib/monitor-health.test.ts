import { describe, expect, it } from "vitest"
import { monitorProblems } from "./monitor-health"

describe("monitor health", () => {
  it("finds outputs whose monitor is gone and outputs sharing a monitor; NDI never counts", () => {
    const outputs = [
      { name: "Main", type: "display" as const, monitorIndex: 1 },
      { name: "Stage", type: "display" as const, monitorIndex: 2 },
      { name: "Lobby", type: "display" as const, monitorIndex: 1 },
      { name: "Stream", type: "ndi" as const, monitorIndex: 7 },
    ]
    expect(monitorProblems(outputs, 2)).toEqual({ missing: ["Stage"], shared: [["Main", "Lobby"]] })
    expect(monitorProblems(outputs, 3)).toEqual({ missing: [], shared: [["Main", "Lobby"]] })
    expect(monitorProblems([outputs[0]], 1)).toEqual({ missing: ["Main"], shared: [] })
  })
})
