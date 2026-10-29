import { describe, expect, it } from "vitest"

import { applyCommand, buildRenderCommands, SARASWATI_ROOT_ID, type SaraswatiRectNode } from "../vendor/avnac/saraswati"
import type { Scene, SceneLayer } from "../types/scene"
import { designToScene, sceneToDesign } from "./rhema-scene"

const layer = (id: string, kind: SceneLayer["kind"], extra: Partial<SceneLayer> = {}): SceneLayer => ({
  id, name: id, kind, box: { x: 10, y: 20, w: 30, h: 40 }, opacity: 1, visible: true, ...extra,
})

const sermon: Scene = {
  id: "sermon", name: "Sermon", background: "#101020", fadeMs: 400, createdAt: 1, updatedAt: 2, updatedBy: "Femi",
  layers: [
    layer("bg", "color", { color: "#202040", box: { x: 0, y: 0, w: 100, h: 100 } }),
    layer("pic", "picture", { mediaId: "m1", imageUrl: "data:image/png;base64,AAAA" }),
    layer("cam", "camera", { cameraUrl: "http://192.168.1.10:8889/pulpit/whep", noSignal: "bars", noSignalName: true }),
    layer("verse", "feed", { shows: ["bible"], themeId: "t1", language: "both", fadeMs: 300, crop: { l: 1, t: 2, r: 3, b: 4 } }),
    layer("clock", "clock", { clockShows: "countdown", countdownTo: "next" }),
    layer("ticker", "ticker"),
    layer("lt", "lowerThird", { opacity: 0.8 }),
    layer("vid", "video", { mediaId: "v1", videoUrl: "asset://v1.mp4", mediaFile: "v1.mp4" }),
    layer("logo", "logo", { visible: false }),
  ],
}

describe("Rhema scenes in the Avnac engine", () => {
  it("open and come back unchanged, every layer kind and what it follows", () => {
    const { scene, issues } = designToScene(sceneToDesign(sermon))
    expect(issues).toEqual([])
    expect(scene).toEqual(sermon)
  })

  it("draw in layer order with Rhema's boxes on a 1920×1080 frame", () => {
    const drawn = buildRenderCommands(sceneToDesign(sermon).scene)
    expect(drawn.map((c) => c.id)).toEqual(["__artboard__", "bg", "pic", "cam", "verse", "clock", "ticker", "lt", "vid"])
    expect(drawn.find((c) => c.id === "cam")).toMatchObject({ x: 192, y: 216, width: 576, height: 432 })
  })

  it("bring the editor's moves, resizes, hides, reorders and deletes back into the scene", () => {
    const design = sceneToDesign(sermon)
    let s = design.scene
    s = applyCommand(s, { type: "MOVE_NODE", id: "cam", dx: 192, dy: -108 })
    s = applyCommand(s, { type: "RESIZE_NODE", id: "verse", x: 0, y: 540, width: 1920, height: 540 })
    s = applyCommand(s, { type: "SET_NODE_VISIBLE", id: "ticker", visible: false })
    s = applyCommand(s, { type: "SET_NODE_FILL", id: "bg", fill: { type: "solid", color: "#000000" } })
    s = applyCommand(s, { type: "DELETE_NODE", id: "vid" })
    const root = s.nodes[SARASWATI_ROOT_ID]
    if (root.type !== "group") throw new Error("root")
    s = applyCommand(s, { type: "SET_GROUP_CHILDREN", id: SARASWATI_ROOT_ID, children: [...root.children.filter((c) => c !== "pic"), "pic"] })
    const { scene, issues } = designToScene({ ...design, scene: s })
    expect(issues).toEqual([])
    const byId = Object.fromEntries(scene.layers.map((l) => [l.id, l]))
    expect(byId.cam.box).toEqual({ x: 20, y: 10, w: 30, h: 40 })
    expect(byId.verse.box).toEqual({ x: 0, y: 50, w: 100, h: 50 })
    expect(byId.verse).toMatchObject({ shows: ["bible"], themeId: "t1", language: "both", crop: { l: 1, t: 2, r: 3, b: 4 } })
    expect(byId.ticker.visible).toBe(false)
    expect(byId.bg.color).toBe("#000000")
    expect(byId.vid).toBeUndefined()
    expect(scene.layers.at(-1)?.id).toBe("pic")
  })

  it("never bakes in a shape drawn in the editor: it is reported and left out", () => {
    const design = sceneToDesign(sermon)
    const drawnInEditor = { ...(design.scene.nodes.bg as SaraswatiRectNode), id: "doodle", name: "Doodle" }
    const s = applyCommand(design.scene, { type: "ADD_NODE", node: drawnInEditor })
    const { scene, issues } = designToScene({ ...design, scene: s })
    expect(scene.layers.map((l) => l.id)).not.toContain("doodle")
    expect(issues).toEqual([{ nodeId: "doodle", message: expect.stringContaining("Doodle") }])
  })
})
