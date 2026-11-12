import { describe, expect, it } from "vitest"
import type { LiveSources } from "@/lib/live-sources"
import type { BroadcastOutput, Scene, SceneLayer, VerseRenderData } from "@/types"
import { feedsWithoutVideo, videoOnFeedsWarning, type FeedVideoState } from "./video-on-feeds"

const out = (o: Partial<BroadcastOutput> & Pick<BroadcastOutput, "id" | "name" | "type">) => o as BroadcastOutput
const video: VerseRenderData = { kind: "image", reference: "", segments: [], video: { url: "asset://intro.mp4", fit: "contain", loop: false, sound: false, name: "Intro", token: 1 } }
const verse: VerseRenderData = { reference: "John 3:16", segments: [{ text: "For God so loved", verseNumber: 16 }] }
const on = { feedActive: true }
const tv = out({ id: "tv", name: "Hall TV", type: "browser" })
const state = (p: Partial<FeedVideoState>): FeedVideoState => ({ isLive: true, liveVerse: video, sources: {}, outputs: [], outputStatus: {}, scenes: [], ...p })
const feedLayer = (p: Partial<SceneLayer> = {}): SceneLayer => ({ id: "l", name: "Live content", kind: "feed", box: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, visible: true, ...p }) as SceneLayer

describe("a video item and the TV feeds", () => {
  it("names a congregation feed on air that follows Program", () => {
    expect(feedsWithoutVideo(state({ outputs: [tv, out({ id: "main", name: "Projector", type: "display" })], outputStatus: { tv: on, main: { previewOpen: true } } }))).toEqual(["Hall TV"])
  })

  it("leaves out feeds that are off, overlay-only or not congregation", () => {
    const feeds = [
      out({ id: "off", name: "Off TV", type: "browser" }),
      out({ id: "lt", name: "Lower third", type: "browser", shows: ["lowerThird"] }),
      out({ id: "stage", name: "Stage TV", type: "browser", role: "stage" }),
    ]
    expect(feedsWithoutVideo(state({ outputs: feeds, outputStatus: { lt: on, stage: on } }))).toEqual([])
  })

  it("leaves out a feed that follows Scripture, which keeps its verse while the video plays", () => {
    const sources = { bible: { on: true, revision: 2, value: verse } } as unknown as LiveSources
    const bibleTv = out({ id: "btv", name: "Bible TV", type: "browser", shows: ["bible"] })
    expect(feedsWithoutVideo(state({ outputs: [bibleTv], outputStatus: { btv: on }, sources }))).toEqual([])
  })

  it("names a scene whose visible content layer follows Program, but not one that holds a verse", () => {
    const program = { id: "s1", name: "Camera and words", layers: [feedLayer()] } as unknown as Scene
    const held = { id: "s2", name: "Held verse", layers: [feedLayer({ held: verse })] } as unknown as Scene
    const outputs = [out({ id: "a", name: "Scene TV", type: "browser", sceneId: "s1" }), out({ id: "b", name: "Held TV", type: "browser", sceneId: "s2" })]
    expect(feedsWithoutVideo(state({ outputs, outputStatus: { a: on, b: on }, scenes: [program, held] }))).toEqual(["Scene TV"])
  })

  it("names nobody when nothing live is a video", () => {
    expect(feedsWithoutVideo(state({ liveVerse: verse, outputs: [tv], outputStatus: { tv: on } }))).toEqual([])
  })

  it("says it once, naming every such screen", () => {
    expect(videoOnFeedsWarning("Intro", [])).toBeNull()
    expect(videoOnFeedsWarning("Intro", ["Hall TV"])).toMatch(/^Hall TV shows only the background while "Intro" plays/)
    expect(videoOnFeedsWarning("Intro", ["Hall TV", "Foyer", "Overflow"])).toMatch(/^Hall TV, Foyer and Overflow show only/)
  })
})
