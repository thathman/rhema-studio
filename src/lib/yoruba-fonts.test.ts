import { describe, expect, it } from "vitest"
import { YORUBA_SAMPLES, drawsYoruba } from "./yoruba-fonts"

/** A fake canvas: the named font draws only `has` itself; anything else comes from the fallback. */
function measureWith(fonts: Record<string, string[]>) {
  return (font: string, text: string) => {
    const named = /"([^"]+)"/.exec(font)?.[1]
    const base = font.split(",").at(-1)!.trim().replace(/^72px /, "")
    const own = named && fonts[named]?.some((c) => text.startsWith(c))
    return own ? text.length * 41 : text.length * (base === "monospace" ? 43 : base === "serif" ? 37 : 39)
  }
}

describe("fonts that can draw Yorùbá (#213 preflight)", () => {
  it("passes a font with ẹ ọ ṣ and their capitals", () => {
    expect(drawsYoruba("Noto Sans", measureWith({ "Noto Sans": ["ẹ", "ọ", "ṣ", "Ẹ", "Ọ", "Ṣ"] }))).toBe(true)
  })

  it("fails a font missing any of them (the screen would draw the fallback's)", () => {
    expect(drawsYoruba("Display Font", measureWith({ "Display Font": ["ẹ", "ọ"] }))).toBe(false)
    expect(drawsYoruba("Not Installed", measureWith({}))).toBe(false)
  })

  it("checks the tone-marked letters", () => {
    expect(YORUBA_SAMPLES).toEqual(expect.arrayContaining(["ẹ́", "ọ̀", "Ọ̀"]))
  })
})
