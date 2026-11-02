// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

const { dataUrl, fileUrl } = vi.hoisted(() => ({ dataUrl: vi.fn(), fileUrl: vi.fn() }))
vi.mock("@/stores/media-store", () => ({ useMediaStore: { getState: () => ({ dataUrl, fileUrl, assets: [] }) } }))

import type { Scene } from "@/types/scene"
import { hydrateDesignSceneMedia } from "./design-media"

const assetUrl = "asset://localhost/%2Fmedia%2Fabcd1234-background.png"
const imageScene = (): Scene => ({
  id: "design-welcome-v1",
  name: "Welcome",
  background: "#000000",
  createdAt: 0,
  updatedAt: 0,
  layers: [{
    id: "background",
    name: "Welcome background",
    kind: "picture",
    mediaId: "media-welcome",
    imageUrl: assetUrl,
    box: { x: 0, y: 0, w: 100, h: 100 },
    opacity: 1,
    visible: true,
  }],
})

const videoScene = (): Scene => ({
  id: "design-sermon-v1",
  name: "Sermon",
  background: "#000000",
  createdAt: 0,
  updatedAt: 0,
  layers: [{
    id: "sermon-video",
    name: "Sermon clip",
    kind: "video",
    mediaId: "media-sermon",
    mediaFile: "sermon.mp4",
    videoUrl: assetUrl,
    box: { x: 0, y: 0, w: 100, h: 100 },
    opacity: 1,
    visible: true,
  }],
})

beforeEach(() => { dataUrl.mockReset(); fileUrl.mockReset() })

describe("design media hydration", () => {
  it("resolves content-addressed Library references for an output frame", async () => {
    dataUrl.mockResolvedValue("data:image/png;base64,cGljdHVyZQ==")
    const scene = imageScene()

    const result = await hydrateDesignSceneMedia(scene)

    expect(dataUrl).toHaveBeenCalledWith("media-welcome")
    expect(result.scene?.layers[0]).toMatchObject({ kind: "picture", mediaId: "media-welcome", imageUrl: "data:image/png;base64,cGljdHVyZQ==" })
    expect(scene.layers[0]?.imageUrl).toBe(assetUrl)
  })

  it("keeps existing embedded versions offline-capable without rereading the Library", async () => {
    dataUrl.mockResolvedValue("data:image/png;base64,unused")
    const scene = imageScene()
    scene.layers[0]!.imageUrl = "data:image/png;base64,embedded"

    const result = await hydrateDesignSceneMedia(scene)

    expect(result).toEqual({ scene })
    expect(dataUrl).not.toHaveBeenCalled()
  })

  it("fails closed when a referenced Library file is missing", async () => {
    dataUrl.mockResolvedValue(null)

    const result = await hydrateDesignSceneMedia(imageScene())

    expect(result.scene).toBeNull()
    expect(result.issue).toContain("Welcome background")
  })

  it("refreshes a Library video reference and refuses to use a missing video", async () => {
    const currentUrl = "asset://localhost/%2Fmedia%2Fsermon.mp4"
    fileUrl.mockResolvedValue(currentUrl)
    const scene = videoScene()

    const refreshed = await hydrateDesignSceneMedia(scene)

    expect(fileUrl).toHaveBeenCalledWith("media-sermon")
    expect(refreshed.scene?.layers[0]).toMatchObject({
      kind: "video",
      mediaId: "media-sermon",
      mediaFile: "sermon.mp4",
      videoUrl: currentUrl,
    })
    expect(scene.layers[0]?.videoUrl).toBe(assetUrl)

    fileUrl.mockResolvedValue(null)
    const missing = await hydrateDesignSceneMedia(scene)
    expect(missing.scene).toBeNull()
    expect(missing.issue).toContain("Sermon clip")
  })
})
