import { describe, expect, it } from "vitest"
import type { BroadcastOutput, Scene } from "@/types"
import { feedsWithoutVideo, videoOnFeedsWarning } from "./video-on-feeds"

const out = (o: Partial<BroadcastOutput> & Pick<BroadcastOutput, "id" | "name" | "type">) => o as BroadcastOutput
const on = { feedActive: true }

describe("a video item and the TV feeds", () => {
  const tv = out({ id: "tv", name: "Hall TV", type: "browser" })
  it("names congregation feeds on air that follow Program", () => {
    expect(feedsWithoutVideo([tv, out({ id: "main", name: "Projector", type: "display" })], { tv: on, main: { previewOpen: true } }, [])).toEqual(["Hall TV"])
  })
  it("leaves out feeds that are off, overlay-only, not congregation, or showing a scene", () => {
    const scene = { id: "s1", name: "Camera" } as Scene
    const feeds = [
      out({ id: "off", name: "Off TV", type: "browser" }),
      out({ id: "lt", name: "Lower third", type: "browser", shows: ["lowerThird"] }),
      out({ id: "stage", name: "Stage TV", type: "browser", role: "stage" }),
      out({ id: "sc", name: "Scene TV", type: "browser", sceneId: "s1" }),
    ]
    expect(feedsWithoutVideo(feeds, { lt: on, stage: on, sc: on }, [scene])).toEqual([])
  })
  it("says it once, naming every such screen", () => {
    expect(videoOnFeedsWarning("Intro", [])).toBeNull()
    expect(videoOnFeedsWarning("Intro", ["Hall TV"])).toMatch(/^Hall TV shows only the background while "Intro" plays/)
    expect(videoOnFeedsWarning("Intro", ["Hall TV", "Foyer", "Overflow"])).toMatch(/^Hall TV, Foyer and Overflow show only/)
  })
})
