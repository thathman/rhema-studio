import { describe, expect, it } from "vitest"
import { defaultBrandKit } from "@/lib/brand-kit"
import { blend, tickerContrast } from "./ticker-contrast"

const style = (p: Partial<Parameters<typeof tickerContrast>[0]> = {}) => ({
  color: "#ffffff",
  background: { kind: "color" as const, color: "#000000", opacity: 0.8, mediaId: null },
  label: "",
  labelColor: "#ffffff",
  labelBackground: "#b91c1c",
  ...p,
})

/** The ticker designer's readability check (#187): WCAG AA for the words, with the ratio. */
describe("ticker contrast", () => {
  it("white words on a dark band read well; the ratio is given", () => {
    const c = tickerContrast(style(), ["#0a0a1a"])
    expect(c.words.ok).toBe(true)
    expect(c.words.ratio).toBeGreaterThan(15)
    expect(c.tag).toBeUndefined()
  })

  it("a see-through band over a light look fails, with the ratio and a Brand Kit colour that passes", () => {
    const kit = { ...defaultBrandKit(), colors: { primary: "#1a1a3e", accent: "#d4a574", text: "#f5f5f5", background: "#0a0a1a" } }
    const c = tickerContrast(style({ color: "#eeeeee", background: { kind: "color", color: "#000000", opacity: 0.1, mediaId: null } }), ["#ffffff"], kit)
    expect(c.words.ok).toBe(false)
    expect(c.words.ratio).toBeLessThan(4.5)
    expect(c.words.suggest).toBe("#0a0a1a")
  })

  it("over a picture it checks the darkest and lightest the picture could be; the tag on its own colour", () => {
    const over = tickerContrast(style({ background: { kind: "picture", color: "#000000", opacity: 0.3, mediaId: "m1" }, label: "NEWS", labelColor: "#ffffff", labelBackground: "#fde047" }), ["#000000"])
    expect(over.overMedia).toBe(true)
    expect(over.words.ok).toBe(false) // 30% black over white is still light
    expect(over.tag).toMatchObject({ ok: false, suggest: "#000000" })
  })

  it("blends a colour at its opacity", () => {
    expect(blend("#000000", "#ffffff", 0.5)).toBe("#808080")
    expect(blend("#ff0000", "#0000ff", 1)).toBe("#ff0000")
  })
})
