import { describe, expect, it } from "vitest"
import { BUILTIN_THEMES } from "./builtin-themes"
import { applyLook, lookOf } from "./theme-look"

const theme = BUILTIN_THEMES[0]

describe("Edit the look (DS-004)", () => {
  it("reads a theme in simple terms", () => {
    const look = lookOf(theme)
    expect(["compact", "comfortable", "large"]).toContain(look.size)
    expect(look.ratio).toBe("16:9")
    expect(look.align).toBe(theme.layout.textAlign)
  })

  it("a font change reaches both languages and the reference; nothing else moves", () => {
    const withSecond = { ...theme, secondaryVerseText: { ...theme.verseText, fontFamily: "Georgia" } }
    const t = applyLook(withSecond, { font: "sans" })
    expect([t.verseText.fontFamily, t.secondaryVerseText?.fontFamily, t.reference.fontFamily]).toEqual(["IBM Plex Sans", "IBM Plex Sans", "IBM Plex Sans"])
    expect(t.background).toBe(withSecond.background)
    expect(lookOf(t).font).toBe("sans")
  })

  it("size scales the reference with the words; the margin is a share of the screen, kept 3 to 18%", () => {
    const t = applyLook(theme, { size: "large" })
    expect(t.verseText.fontSize).toBe(Math.round(theme.resolution.height * 0.08))
    expect(lookOf(t).size).toBe("large")
    expect(t.reference.fontSize / theme.reference.fontSize).toBeCloseTo(t.verseText.fontSize / theme.verseText.fontSize, 1)
    const m = applyLook(theme, { margin: 40 })
    expect(m.layout.padding.left).toBe(Math.round(theme.resolution.width * 0.18))
    expect(lookOf(m).margin).toBe(18)
  })

  it("alignment, colours, shape and the gap between languages", () => {
    const t = [{ align: "left" as const }, { background: "#204238" }, { words: "#f5f0e6" }, { accent: "#eecb8d" }, { ratio: "4:3" as const }, { languageGap: 64 }].reduce((acc, c) => applyLook(acc, c), theme)
    expect(lookOf(t)).toMatchObject({ align: "left", background: "#204238", words: "#f5f0e6", accent: "#eecb8d", ratio: "4:3", languageGap: 64 })
    expect(t.verseText.horizontalAlign).toBe("left")
  })
})
