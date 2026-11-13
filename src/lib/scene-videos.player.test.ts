import { describe, expect, it } from "vitest"
import { feedMediaUrl, playerRect } from "@/lib/scene-videos"
import { sceneArea } from "@/lib/scene-renderer"

describe("a camera or video player under a browser feed's picture (#448)", () => {
  it("sits where drawScene cuts its box out, also for a design's shape on a differently shaped screen", () => {
    // Same shape: the box in the whole frame, scaled to the screen.
    expect(playerRect(sceneArea(1920, 1080, 16 / 9), { x: 25, y: 50, w: 50, h: 25 }, 0.5)).toEqual({ left: 240, top: 270, width: 480, height: 135 })
    // A 16:9 design on a 4:3 output (1440 × 1080): letterboxed inside, 1440 × 810 from y 135.
    expect(playerRect(sceneArea(1440, 1080, 16 / 9), { x: 0, y: 0, w: 100, h: 100 }, 1)).toEqual({ left: 0, top: 135, width: 1440, height: 810 })
  })
})

describe("a scene video's file on a browser feed", () => {
  it("is asked for with the page's feed key (it once went out with the scene's id and the host refused it, 403)", () => {
    expect(feedMediaUrl("tv-yo", "abc.mp4", "0123abcd")).toBe("/api/v1/feed/tv-yo/media/abc.mp4?k=0123abcd")
  })
})
