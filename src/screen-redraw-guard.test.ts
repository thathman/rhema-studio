import { readdirSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * #411 outputs hunt. A redraw after `loadThemeImage` must check the picture came: a missing file
 * resolves null, the redraw asks again, and the screen redraws for ever (CPU pegged on the church
 * Mac). And Black on a screen output stops the ticker band (it copied the frame before Black back).
 * Static scan of the sources.
 */
const src = new URL("./", import.meta.url)
const files = readdirSync(src, { recursive: true, encoding: "utf8" }).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))

describe("screen redraw guard (#411)", () => {
  it("no redraw after an image load that may have failed", () => {
    const offenders = files.flatMap((f) => readFileSync(new URL(f, src), "utf8").split("\n").flatMap((line, i) =>
      /loadThemeImage\([^)]*\)\.then\(\s*(?:\(\s*\)|redraw\b|draw\b)/.test(line) && /\bif\s*\(\s*!\w+\s*\)/.test(line) ? [`${f}:${i + 1}`] : []))
    expect(offenders).toEqual([])
  })

  it("the output window's ticker paths stop on Black", () => {
    const s = readFileSync(new URL("broadcast-output.tsx", src), "utf8")
    const band = s.slice(s.indexOf("const drawTickerBand"), s.indexOf("const drawTickerBand") + 600)
    const tick = s.slice(s.indexOf("const tickTicker"), s.indexOf("const tickTicker") + 400)
    expect(band).toContain('screen === "black"')
    expect(tick).toContain('screen === "black"')
  })
})
