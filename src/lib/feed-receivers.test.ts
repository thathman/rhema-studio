import { describe, expect, it } from "vitest"
import { feedLost, hostLostWords, insetArea, lostView, overscanPct, screenPrivacyWords, tvKeys, tvKeyWords, tvSizeWords } from "@/lib/feed-receivers"

// #198: what a TV shows when it loses the host, overscan, and the host's TV list words.
describe("feed receivers", () => {
  it("keeps overscan between 0 and 10 % in halves", () => {
    expect(overscanPct(undefined)).toBe(0)
    expect(overscanPct(Number.NaN)).toBe(0)
    expect(overscanPct(-3)).toBe(0)
    expect(overscanPct(2.3)).toBe(2.5)
    expect(overscanPct(40)).toBe(10)
    expect(insetArea(1920, 1080, 5)).toEqual({ x: 96, y: 54, w: 1728, h: 972 })
    expect(insetArea(1920, 1080, 0)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
  })

  it("sends a rule only with what it needs", () => {
    expect(feedLost(undefined, 5, "data:image/png;base64,x")).toBeUndefined()
    expect(feedLost({ mode: "last" }, 5, null)).toBeUndefined()
    expect(feedLost({ mode: "picture", mediaId: "m" }, null, null), "the picture is still loading").toBeUndefined()
    expect(feedLost({ mode: "picture", mediaId: "m" }, null, "data:image/png;base64,x")).toEqual({ mode: "picture", url: "data:image/png;base64,x" })
    expect(feedLost({ mode: "countdown" }, null, null), "no start time").toBeUndefined()
    expect(feedLost({ mode: "countdown" }, 1000, null)).toEqual({ mode: "countdown", startsAt: 1000 })
  })

  it("draws a picture sent as data only, and counts down to the start", () => {
    expect(lostView(undefined, 0)).toBeNull()
    expect(lostView({ mode: "picture", url: "https://example.com/x.png" }, 0), "never an address from a frame").toBeNull()
    expect(lostView({ mode: "picture", url: "data:image/jpeg;base64,AA" }, 0)).toEqual({ kind: "picture", url: "data:image/jpeg;base64,AA" })
    expect(lostView({ mode: "countdown", startsAt: 125_000 }, 0)).toEqual({ kind: "countdown", title: "The service starts in", time: "2:05" })
    expect(lostView({ mode: "countdown", startsAt: 3_725_000 }, 0)).toEqual({ kind: "countdown", title: "The service starts in", time: "1:02:05" })
    expect(lostView({ mode: "countdown", startsAt: 1000 }, 999), "the last part of a second still counts").toEqual({ kind: "countdown", title: "The service starts in", time: "0:01" })
    expect(lostView({ mode: "countdown", startsAt: 1000 }, 5000)).toEqual({ kind: "countdown", title: "The service is starting", time: "" })
    expect(lostView({ mode: "other" }, 0)).toBeNull()
  })

  it("says each TV's size, link and the screen's rule in plain words", () => {
    expect(hostLostWords(undefined)).toBe("If this computer is lost: keeps the last picture")
    expect(hostLostWords({ mode: "picture", mediaId: "m" }, "Welcome")).toBe("If this computer is lost: shows the picture “Welcome”")
    expect(hostLostWords({ mode: "countdown" })).toBe("If this computer is lost: counts down to the service start")
    expect(tvKeyWords({ token: "k".repeat(32) })).toBe("Private link: its own key")
    expect(tvKeyWords({})).toContain("Shared link")
    expect(screenPrivacyWords({ role: "stage" })).toBe("Private screen (stage notes)")
    expect(screenPrivacyWords({ role: "congregation" })).toBe("Public screen")
    expect(tvSizeWords({ width: 3840, height: 2160 })).toBe("3840×2160")
    expect(tvSizeWords({})).toContain("not known")
    expect(tvKeys([{ name: "a", address: "1:1", sentAt: 0, token: "k".repeat(32) }, { name: "b", address: "1:2", sentAt: 0 }, { name: "c", address: "1:3", sentAt: 0, token: "short" }])).toEqual([{ id: "1:1", token: "k".repeat(32) }])
  })
})
