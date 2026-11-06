import { afterEach, describe, expect, it, vi } from "vitest"
import { IMAGE_IDLE_MS, SOFT_IMAGE_LIMIT, imageCacheVersion, themeImageCache } from "@/lib/theme-image-cache"

const img = (n: number) => ({ n }) as unknown as HTMLImageElement

describe("pictures kept per window stay bounded (#411 media hunt)", () => {
  afterEach(() => vi.restoreAllMocks())

  it("lets go of pictures not drawn for a while, past the limit, and never of ones drawn now", () => {
    let now = 0
    vi.spyOn(performance, "now").mockImplementation(() => now)
    const cache = themeImageCache()
    cache.clear()
    for (let i = 0; i < SOFT_IMAGE_LIMIT; i++) cache.set(`old-${i}`, img(i))
    now += IMAGE_IDLE_MS + 1
    cache.get("old-0") // still drawn
    for (let i = 0; i < 10; i++) cache.set(`new-${i}`, img(100 + i))
    expect(cache.size).toBe(SOFT_IMAGE_LIMIT)
    expect(cache.has("old-0")).toBe(true)
    expect(cache.has("old-1")).toBe(false)
    expect(cache.has("new-9")).toBe(true)
  })

  it("everything drawn recently stays, whatever the count: a big grid never reloads in a loop", () => {
    vi.spyOn(performance, "now").mockReturnValue(0)
    const cache = themeImageCache()
    cache.clear()
    for (let i = 0; i < SOFT_IMAGE_LIMIT * 2; i++) cache.set(`card-${i}`, img(i))
    expect(cache.size).toBe(SOFT_IMAGE_LIMIT * 2)
  })

  it("the version changes with every picture put in, even when the count stays the same", () => {
    const cache = themeImageCache()
    const before = imageCacheVersion(cache)
    cache.set("again", img(1))
    expect(imageCacheVersion(cache)).toBe(before + 1)
  })
})
