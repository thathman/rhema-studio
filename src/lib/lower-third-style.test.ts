import { describe, expect, it } from "vitest"
import { DEFAULT_LOWER_THIRD_STYLE, entranceProgress, layoutLowerThird, normalizeLowerThirdStyle, overlayFor } from "./lower-third-style"

const measure = (text: string, size: number) => text.length * size * 0.5

describe("lower third layout", () => {
  it("the classic band sits bottom left, sized to the words", () => {
    const l = layoutLowerThird(1920, 1080, { line1: "Pastor Tolu", line2: "Senior Pastor" }, DEFAULT_LOWER_THIRD_STYLE, measure)
    expect(l.band.x).toBe(Math.round(1920 * 0.06))
    expect(l.band.y + l.band.h).toBe(1080 - Math.round(1080 * 0.08))
    expect(l.band.w).toBeLessThan(800)
    expect(l.line2).not.toBeNull()
  })
  it("centred and full width, with an accent on top; right-aligned leaves the margin on the right", () => {
    const c = layoutLowerThird(1920, 1080, { line1: "Welcome", line2: "" }, { ...DEFAULT_LOWER_THIRD_STYLE, align: "center", width: 80, accent: { enabled: true, color: "#fff", width: 8 } }, measure)
    expect(c.band.w).toBe(1536)
    expect(c.band.x).toBe((1920 - 1536) / 2)
    expect(c.accent).toEqual({ x: c.band.x, y: c.band.y, w: 1536, h: 8 })
    expect(c.line2).toBeNull()
    const r = layoutLowerThird(1920, 1080, { line1: "Welcome", line2: "x" }, { ...DEFAULT_LOWER_THIRD_STYLE, align: "right", width: 30 }, measure)
    expect(r.band.x + r.band.w).toBe(1920 - Math.round(1920 * 0.06))
    expect(r.line1.align).toBe("right")
  })
  it("stays above a ticker along the bottom", () => {
    const l = layoutLowerThird(1920, 1080, { line1: "Pastor Tolu", line2: "x" }, DEFAULT_LOWER_THIRD_STYLE, measure, 76)
    expect(l.band.y + l.band.h).toBeLessThanOrEqual(1080 - 76 - 20)
    // A band placed high already is left where it is.
    const high = layoutLowerThird(1920, 1080, { line1: "x", line2: "y" }, { ...DEFAULT_LOWER_THIRD_STYLE, bottom: 40 }, measure, 76)
    expect(high.band.y + high.band.h).toBe(1080 - Math.round(1080 * 0.4))
  })
  it("a saved style is completed and kept in bounds", () => {
    const s = normalizeLowerThirdStyle({ id: "x", name: "Mine", height: 999, background: { kind: "video", mediaId: "m" } as never })
    expect(s.height).toBe(50)
    expect(s.background).toEqual({ kind: "video", color: "#000000", opacity: 0.78, mediaId: "m" })
    expect(s.line1.color).toBe("#ffffff")
  })
})

describe("strips that follow what is live", () => {
  const verse = { reference: "John 3:16", segments: [{ text: "For God so loved", verseNumber: 16 }] }
  const lyric = { kind: "lyric" as const, reference: "Amazing Grace · Verse 1", segments: [], lines: ["Amazing grace", "How sweet the sound"] }
  it("a scripture strip shows the verse and its reference; a lyrics strip the lines and the song", () => {
    expect(overlayFor({ line1: "", line2: "", follow: "scripture" }, verse)).toMatchObject({ line1: "For God so loved", line2: "John 3:16" })
    expect(overlayFor({ line1: "", line2: "", follow: "lyrics" }, lyric)).toMatchObject({ line1: "Amazing grace\nHow sweet the sound", line2: "Amazing Grace" })
  })
  it("nothing to show: hidden; a name band is left alone", () => {
    expect(overlayFor({ line1: "", line2: "", follow: "scripture" }, lyric)).toBeNull()
    expect(overlayFor({ line1: "", line2: "", follow: "lyrics" }, verse)).toBeNull()
    expect(overlayFor({ line1: "", line2: "", follow: "scripture" }, null)).toBeNull()
    const name = { line1: "Pastor Tolu", line2: "" }
    expect(overlayFor(name, null)).toBe(name)
  })
  it("comes on over the entrance time unless the style has none", () => {
    expect(entranceProgress({ shownAt: 1000 }, 1000)).toBe(0)
    expect(entranceProgress({ shownAt: 1000 }, 99999)).toBe(1)
    expect(entranceProgress({ shownAt: 1000, style: { ...DEFAULT_LOWER_THIRD_STYLE, animation: "none" } }, 1000)).toBe(1)
  })
})
