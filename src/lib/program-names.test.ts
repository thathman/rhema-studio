import { describe, expect, it } from "vitest"
import { congregationProgramName, formatName, obsVideo, onlineProgramName, outputFormat } from "./program-names"
import { defaultNdiSettings, type BroadcastOutput } from "@/types"

const out = (patch: Partial<BroadcastOutput>): BroadcastOutput => ({ id: "o", name: "Screen", type: "display", themeId: "t", monitorIndex: 0, ndi: defaultNdiSettings(), ...patch })

describe("the two programs' names (#215 G5.1)", () => {
  it("say the format as broadcasters do", () => {
    expect(formatName(720, 30)).toBe("720p30")
    expect(formatName(1080, 30000 / 1001)).toBe("1080p29.97")
    expect(formatName(1080)).toBe("1080p")
  })

  it("online: OBS's own format once it has said, 720p30 before", () => {
    expect(onlineProgramName(null)).toBe("Online program (OBS, 720p30)")
    expect(onlineProgramName(obsVideo({ outputWidth: 1920, outputHeight: 1080, fpsNumerator: 60, fpsDenominator: 1 }))).toBe("Online program (OBS, 1080p60)")
    expect(obsVideo({ outputWidth: 1920 })).toBeNull()
    expect(obsVideo(null)).toBeNull()
  })

  it("congregation: the formats its NDI senders are set to, 1080p when none says", () => {
    expect(congregationProgramName([])).toBe("Congregation program (screens, 1080p)")
    expect(congregationProgramName([out({ type: "display" })])).toBe("Congregation program (screens, 1080p)")
    const ndi = (resolution: "r720p" | "r1080p", frameRate: "fps30" | "fps60", role?: "stage") => out({ type: "ndi", role, ndi: { ...defaultNdiSettings(), resolution, frameRate } })
    expect(congregationProgramName([ndi("r1080p", "fps60"), ndi("r1080p", "fps60")])).toBe("Congregation program (screens, 1080p60)")
    expect(congregationProgramName([ndi("r1080p", "fps30"), ndi("r720p", "fps30")])).toBe("Congregation program (screens, 1080p30 / 720p30)")
    // A stage sender is not the congregation's.
    expect(congregationProgramName([ndi("r720p", "fps30", "stage")])).toBe("Congregation program (screens, 1080p)")
    expect(outputFormat(out({ type: "browser" }))).toBeNull()
  })
})
