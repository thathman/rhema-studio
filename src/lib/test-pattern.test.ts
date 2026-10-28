import { describe, expect, it } from "vitest"
import { drawTestPattern, feedAckLabel, TEST_LABEL, testPatternFrame, testRisks } from "./test-pattern"

describe("drawTestPattern", () => {
  it("draws at the output's own size, with its name, its resolution and the not-on-air label", () => {
    const texts: string[] = []
    const rects: number[][] = []
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k) => {
        if (k === "fillText") return (s: string) => texts.push(s)
        if (k === "fillRect") return (...a: number[]) => rects.push(a)
        if (k in t) return t[k as string]
        return () => {}
      },
      set: (t, k, v) => ((t[k as string] = v), true),
    }) as unknown as CanvasRenderingContext2D
    drawTestPattern(ctx, { width: 1280, height: 720, name: "Stage screen" })
    expect(texts).toEqual([TEST_LABEL, "Stage screen · 1280×720"])
    expect(TEST_LABEL).toBe("TEST – not on air")
    // The first fill covers the whole frame.
    expect(rects[0]).toEqual([0, 0, 1280, 720])
  })
})

describe("testPatternFrame", () => {
  it("is the pattern as the whole background and nothing else: no words, lower third, ticker or sound", () => {
    const f = testPatternFrame("data:image/png;base64,AAAA", { width: 3840, height: 2160, name: "Projector" }) as { theme: { id: string; resolution: object; background: { type: string; image: { url: string; fit: string } }; logo: unknown } } & Record<string, unknown>
    expect(f.verse).toBeNull()
    expect(f.overlay).toBeNull()
    expect(f.ticker).toBeNull()
    expect(f.sound).toBe(false)
    expect(f.theme.id).toBe("screen-test")
    expect(f.theme.resolution).toEqual({ width: 3840, height: 2160 })
    expect(f.theme.background).toMatchObject({ type: "image", image: { url: "data:image/png;base64,AAAA", fit: "stretch" } })
    expect(f.theme.logo).toBeNull()
  })
})

describe("testRisks", () => {
  it("a screen nobody is watching needs only the first confirmation", () => {
    expect(testRisks({ type: "display", name: "Projector", live: false })).toEqual([])
    expect(testRisks({ type: "ndi", name: "Stream", live: false, ndiReceivers: 0 })).toEqual([])
    expect(testRisks({ type: "browser", name: "Lobby TV", live: false, feedWatching: 0 })).toEqual([])
  })

  it("something on air, an NDI receiver or a page showing the feed each ask again", () => {
    expect(testRisks({ type: "display", name: "Projector", live: true })[0]).toContain("Something is on air now")
    expect(testRisks({ type: "ndi", name: "Stream", live: false, ndiReceivers: 2 })[0]).toContain("2 NDI receivers are taking this output")
    expect(testRisks({ type: "browser", name: "Lobby TV", live: false, feedWatching: 1 })[0]).toContain("1 page is showing this feed")
    expect(testRisks({ type: "ndi", name: "Stream", live: true, ndiReceivers: 1 })).toHaveLength(2)
  })
})

describe("feedAckLabel", () => {
  it("says whether a page really drew the frame, not only that the feed is on", () => {
    expect(feedAckLabel(null)).toBe("Checking the feed…")
    expect(feedAckLabel({ watching: 0, current: true, behind: false })).toBe("Feed on, no page open")
    expect(feedAckLabel({ watching: 1, current: true, behind: false })).toBe("Shown on 1 page")
    expect(feedAckLabel({ watching: 3, current: true, behind: false })).toBe("Shown on 3 pages")
    expect(feedAckLabel({ watching: 1, current: false, behind: true })).toBe("Connected, not shown (1 page open)")
  })
})
