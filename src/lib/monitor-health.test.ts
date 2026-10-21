import { describe, expect, it } from "vitest"
import { monitorProblems, resolveMonitorIndex } from "./monitor-health"

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

  it("finds an output's monitor by name when the OS renumbers (a monitor unplugged)", () => {
    const projector = { name: "Projector", type: "display" as const, monitorIndex: 1, monitorName: "EPSON" }
    const stage = { name: "Stage", type: "display" as const, monitorIndex: 2, monitorName: "DELL" }
    // The projector is unplugged: the stage screen moves up to position 1.
    const names = ["Built-in", "DELL"]
    expect(resolveMonitorIndex(projector, names)).toBeNull()
    expect(resolveMonitorIndex(stage, names)).toBe(1)
    expect(monitorProblems([projector, stage], names)).toEqual({ missing: ["Projector"], shared: [] })
    // Two monitors with one name: the saved position wins when it still has that name.
    expect(resolveMonitorIndex({ monitorIndex: 2, monitorName: "DELL" }, ["Built-in", "DELL", "DELL"])).toBe(2)
    // No name kept (older settings): by position, as before.
    expect(resolveMonitorIndex({ monitorIndex: 1 }, ["a", "b"])).toBe(1)
    expect(resolveMonitorIndex({ monitorIndex: 2 }, ["a", "b"])).toBeNull()
  })
})

