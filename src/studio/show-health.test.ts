import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

const { attention, showing } = await import("@/lib/show-health")
const { defaultNdiSettings } = await import("@/types")

const out = (id: string, type: "display" | "ndi" | "browser", extra = {}) => ({ id, name: id, type, themeId: "t", monitorIndex: 0, ndi: defaultNdiSettings(id), ...extra })

/** Show health (#213): real signals only, the serious ones first. */
describe("show health", () => {
  it("lists what needs attention, most serious first, and only for outputs on air", () => {
    const outputs = [out("obs", "ndi"), out("foyer", "browser"), out("tv", "browser"), out("spare", "ndi"), out("main", "display")]
    const a = attention(outputs, {
      obs: { previewOpen: false, ndiActive: true, ndiReceivers: 0 },
      foyer: { previewOpen: false, ndiActive: false, feedActive: true },
      tv: { previewOpen: false, ndiActive: false, feedActive: true },
      spare: { previewOpen: false, ndiActive: false, ndiError: "send failed" },
      main: { previewOpen: true, ndiActive: false },
    }, { foyer: { watching: 0, current: false, behind: false }, tv: { watching: 1, current: false, behind: true } })
    expect(a.map((x) => [x.level, x.outputId])).toEqual([["high", "tv"], ["medium", "obs"], ["medium", "foyer"]])
  })

  it("says what each output shows", () => {
    const theme = {} as never
    expect(showing(out("main", "display"), undefined, [], false)).toBe("Off")
    expect(showing(out("s", "display", { role: "stage" }), undefined, [], true)).toBe("Stage display")
    expect(showing(out("main", "display"), { theme, verse: { reference: "Romans 8:28", segments: [] }, overlay: null }, [], true)).toBe("Romans 8:28")
    expect(showing(out("main", "display"), { theme, verse: { reference: "", segments: [], screen: "black" }, overlay: null }, [], true)).toBe("Black")
    expect(showing(out("main", "display"), { theme, verse: null, overlay: null, scene: { sceneId: "s1", background: "#000", layers: [] } }, [{ id: "s1", name: "Sermon split" } as never], true)).toBe("Scene: Sermon split")
  })
})
