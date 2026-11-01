// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

const { dataUrl } = vi.hoisted(() => ({ dataUrl: vi.fn() }))
vi.mock("@/stores/media-store", () => ({ useMediaStore: { getState: () => ({ dataUrl }) } }))

import type { Scene } from "@/types/scene"
import { hydrateDesignSceneMedia } from "./design-media"

const assetUrl = "asset://localhost/%2Fmedia%2Fabcd1234-background.png"
const imageScene = (): Scene => ({
  id: "design-welcome-v1",
  name: "Welcome",
  background: "#000000",
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

beforeEach(() => dataUrl.mockReset())

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
})
