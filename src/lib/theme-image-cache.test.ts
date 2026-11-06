import { describe, expect, it } from "vitest"
import { MAX_CACHED_IMAGES, themeImageCache } from "@/lib/theme-image-cache"

const img = (n: number) => ({ n }) as unknown as HTMLImageElement

describe("pictures kept per window stay bounded (#411 media hunt)", () => {
  it("keeps the most recently used pictures, never the one being drawn", () => {
    const cache = themeImageCache()
    cache.clear()
    cache.set("on-screen", img(0))
    for (let i = 1; i <= MAX_CACHED_IMAGES * 2; i++) {
      cache.set(`photo-${i}`, img(i))
      // The picture on screen is drawn again between the others.
      expect(cache.get("on-screen")).toBeDefined()
    }
    expect(cache.size).toBe(MAX_CACHED_IMAGES)
    expect(cache.has("photo-1")).toBe(false)
    expect(cache.has(`photo-${MAX_CACHED_IMAGES * 2}`)).toBe(true)
  })
})
