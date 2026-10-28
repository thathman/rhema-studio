import { describe, expect, it } from "vitest"
import { logoRect } from "./verse-renderer"
import { themeImageUrls } from "./theme-image-cache"

const res = { width: 1920, height: 1080 }

describe("theme logo", () => {
  it("sits in the chosen corner with a 2% margin, sized by frame height and the picture's aspect", () => {
    expect(logoRect({ corner: "top-left", size: 10 }, res, 2)).toEqual({ x: 21.6, y: 21.6, width: 216, height: 108 })
    const br = logoRect({ corner: "bottom-right", size: 10 }, res, 1)
    expect(br).toEqual({ x: 1920 - 21.6 - 108, y: 1080 - 21.6 - 108, width: 108, height: 108 })
    expect(logoRect({ corner: "top-right", size: 99 }, res).height).toBe(270) // clamped to 25%
    expect(logoRect({ corner: "bottom-left", size: 1 }, res).height).toBeCloseTo(43.2) // clamped to 4%
  })

  it("is preloaded with the other theme images", () => {
    expect(themeImageUrls({ logo: { url: "data:logo" }, background: { image: { url: "data:bg" } } })).toEqual(["data:logo", "data:bg"])
    expect(themeImageUrls({ logo: null })).toEqual([])
  })
})
