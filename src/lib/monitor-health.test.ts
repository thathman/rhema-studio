import { describe, expect, it } from "vitest"
import { monitorProblems, outputTransportChanged, resolveMonitorIndex } from "./monitor-health"
import { defaultNdiSettings, type BroadcastOutput } from "@/types"

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
    // Two TVs with one name, B's unplugged: B is missing, not on A's TV.
    const a = { name: "A", type: "display" as const, monitorIndex: 1, monitorName: "SONY TV" }
    const b = { name: "B", type: "display" as const, monitorIndex: 2, monitorName: "SONY TV" }
    expect(monitorProblems([a, b], ["Built-in", "SONY TV"])).toEqual({ missing: ["B"], shared: [] })
    // Windows device names are positional: the index decides, as before.
    expect(resolveMonitorIndex({ monitorIndex: 1, monitorName: "\\\\.\\DISPLAY2" }, ["\\\\.\\DISPLAY1", "\\\\.\\DISPLAY3"])).toBe(1)
  })
})

describe("an output edit that only changes its look never reopens its screen (#411)", () => {
  const screen = (id: string, monitorIndex: number, monitorName: string, extra: Partial<BroadcastOutput> = {}) =>
    ({ id, name: id, type: "display", themeId: "t", monitorIndex, monitorName, ndi: defaultNdiSettings(id), ...extra }) as BroadcastOutput

  it("the OS renumbering screens is no move", () => {
    // Saved on screen 2; the stage TV was off at start, so the projector is screen 1 now. The editor shows 1.
    const existing = screen("main", 2, "EPSON PJ")
    const names = ["Built-in", "EPSON PJ"]
    const edited = { ...existing, monitorIndex: 1, themeId: "other" }
    expect(outputTransportChanged(existing, edited, names, [existing])).toBe(false)
    // Choosing another screen is a move.
    expect(outputTransportChanged(existing, { ...edited, monitorIndex: 0, monitorName: "Built-in" }, names, [existing])).toBe(true)
  })

  it("an editor opened before the screens were listed keeps the saved index: still no move", () => {
    const existing = screen("main", 2, "EPSON PJ")
    expect(outputTransportChanged(existing, { ...existing, themeId: "other" }, ["Built-in", "EPSON PJ"], [existing])).toBe(false)
  })

  it("two screens of one model stay told apart", () => {
    const a = screen("a", 1, "LG TV")
    const b = screen("b", 2, "LG TV")
    const names = ["Built-in", "LG TV", "LG TV"]
    expect(outputTransportChanged(b, { ...b, themeId: "other" }, names, [a, b])).toBe(false)
  })
})
