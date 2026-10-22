import { describe, expect, it } from "vitest"
import { crawlElapsed, crawlPositions, mirrorPositions, normalizeTickerStyle, tickerText } from "./ticker"

describe("news ticker", () => {
  it("joins items with the separator, dropping blanks", () => {
    expect(tickerText(["Youth meeting Friday", " ", "Choir Saturday"], "•")).toBe("Youth meeting Friday   •   Choir Saturday")
    expect(tickerText(["a", "b"], "")).toBe("a     b")
  })
  it("enters at the right edge, then crawls left with copies following", () => {
    expect(crawlPositions(0, 1000, 300, 100, 100, 0)).toEqual([])
    expect(crawlPositions(0, 1000, 300, 100, 100, 1000)).toEqual([900])
    // 12 s at 100 px/s: the first copy is at -200, the next at 200, then 600.
    expect(crawlPositions(0, 1000, 300, 100, 100, 12000)).toEqual([-200, 200, 600])
    // Long after: still a full lane, nothing far off screen kept.
    const later = crawlPositions(0, 1000, 300, 100, 100, 1_000_000)
    expect(later.length).toBeGreaterThan(1)
    expect(later.every((x) => x + 300 > 0 && x < 1000)).toBe(true)
  })
  it("a lane after a label starts after it", () => {
    expect(crawlPositions(200, 800, 300, 100, 100, 1000)).toEqual([900])
  })
  it("a saved style is completed and kept in bounds", () => {
    const s = normalizeTickerStyle({ speed: 5000, position: "top", background: { kind: "video", mediaId: "m" } as never })
    expect(s.speed).toBe(600)
    expect(s.position).toBe("top")
    expect(s.background.mediaId).toBe("m")
    expect(normalizeTickerStyle(null).label).toBe("NEWS")
  })
})

describe("pause and direction", () => {
  it("a paused ticker holds where it stopped", () => {
    expect(crawlElapsed({ startedAt: 1000 }, 5000)).toBe(4000)
    expect(crawlElapsed({ startedAt: 1000, pausedAt: 3000 }, 9000)).toBe(2000)
  })
  it("moving right mirrors the crawl: it enters at the left edge", () => {
    expect(mirrorPositions([900], 0, 1000, 300)).toEqual([-200])
    // 1 s in at 100 px/s: the right end is 100 px into the lane (x 300), so 300 px of words start at 0.
    expect(mirrorPositions(crawlPositions(200, 800, 300, 100, 100, 1000), 200, 800, 300)).toEqual([0])
    expect(normalizeTickerStyle({ direction: "right" }).direction).toBe("right")
    expect(normalizeTickerStyle({}).direction).toBe("left")
  })
})
