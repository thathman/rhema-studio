// @vitest-environment node
import { createCanvas, Image, loadImage, type Canvas } from "@napi-rs/canvas"
import { beforeAll, describe, expect, it } from "vitest"

import { applyCommand, buildRenderCommands } from "@/vendor/avnac/saraswati"
import { canvas2DRendererBackend } from "@/vendor/avnac/renderer/backends/canvas2d/renderer"
import { designToScene, sceneToDesign } from "@/design-engine/rhema-scene"
import { mergeDeskScene } from "@/lib/desk-scenes"
import { normalizeScene, sceneFrame } from "@/lib/scenes"
import { drawScene } from "@/lib/scene-renderer"
import { layerRotation } from "@/lib/scene-rotation"
import type { Scene, SceneLayer } from "@/types"

/**
 * Layer rotation (#851 G7) on real pixels: a layer turned in the Avnac editor is saved into the
 * Rhema scene, survives the approved snapshot, and every output draws it turned about its box's
 * centre exactly as the editor draws it.
 */
type Rgba = [number, number, number, number]
const ctxOf = (c: Canvas) => c.getContext("2d") as unknown as CanvasRenderingContext2D
const pixel = (c: Canvas, x: number, y: number): Rgba => [...ctxOf(c).getImageData(Math.round(x), Math.round(y), 1, 1).data] as Rgba
const near = (a: Rgba, b: Rgba, tolerance = 3) => a.every((v, i) => Math.abs(v - b[i]!) <= tolerance)
const RED: Rgba = [220, 30, 30, 255]
const BG: Rgba = [16, 16, 32, 255]
let url = ""
let picture: Image

beforeAll(async () => {
  const c = createCanvas(200, 100)
  const x = ctxOf(c)
  x.fillStyle = "rgb(220, 30, 30)"
  x.fillRect(0, 0, 200, 100)
  url = `data:image/png;base64,${c.toBuffer("image/png").toString("base64")}`
  picture = await loadImage(c.toBuffer("image/png"))
  Object.assign(globalThis, { Image, HTMLImageElement: Image, ImageBitmap: class {}, HTMLCanvasElement: class {} })
})

// A wide bar across the middle: 40–60% across, 45–55% down (768–1152 × 486–594 at 1920×1080).
const bar = (kind: SceneLayer["kind"], extra: Partial<SceneLayer> = {}): Scene => ({
  id: "turn", name: "Turn", background: "#101020", createdAt: 1, updatedAt: 1, design: { id: "d", version: 1 },
  layers: [{ id: "bar", name: "bar", kind, box: { x: 30, y: 45, w: 40, h: 10 }, opacity: 1, visible: true, ...extra }],
})

function turned(scene: Scene, rotation: number): Scene {
  const design = sceneToDesign(scene)
  const { scene: saved, issues } = designToScene({ ...design, scene: applyCommand(design.scene, { type: "ROTATE_NODE", id: "bar", rotation }) })
  expect(issues).toEqual([])
  return saved
}

function drawOutput(scene: Scene, width = 1920, height = 1080): Canvas {
  const canvas = createCanvas(width, height)
  const frame = sceneFrame({ isLive: false, liveVerse: null, sources: {} as never, themes: [] }, { themeId: "t" }, scene)
  drawScene(ctxOf(canvas), width, height, frame, { image: () => picture as unknown as HTMLImageElement, layerCanvas: () => createCanvas(1, 1) as unknown as HTMLCanvasElement })
  return canvas
}

async function drawEditor(scene: Scene): Promise<Canvas> {
  const canvas = createCanvas(1920, 1080)
  await canvas2DRendererBackend.render(ctxOf(canvas), buildRenderCommands(sceneToDesign(scene).scene))
  return canvas
}

function differing(a: Canvas, b: Canvas): number {
  const x = ctxOf(a).getImageData(0, 0, 1920, 1080).data, y = ctxOf(b).getImageData(0, 0, 1920, 1080).data
  let n = 0
  for (let i = 0; i < x.length; i += 4) if (Math.max(Math.abs(x[i]! - y[i]!), Math.abs(x[i + 1]! - y[i + 1]!), Math.abs(x[i + 2]! - y[i + 2]!), Math.abs(x[i + 3]! - y[i + 3]!)) > 4) n++
  return n / (1920 * 1080)
}

describe("layer rotation (#851 G7)", () => {
  it("normalises degrees to (-180, 180] and leaves upright layers unturned", () => {
    expect([0, 360, -720, 0.001, Number.NaN, "15", null].map(layerRotation)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined])
    expect([15, 375, -15, 190, -180, 180, 270, 12.3456].map(layerRotation)).toEqual([15, 15, -15, -170, 180, 180, -90, 12.35])
  })

  it("saves the turn with the unturned box and draws it turned on outputs, as the editor does", async () => {
    const scene = turned(bar("color", { color: "#dc1e1e" }), 90)
    expect(scene.layers[0]).toMatchObject({ rotation: 90, box: { x: 30, y: 45, w: 40, h: 10 } })
    const out = drawOutput(scene)
    // Turned a quarter: the bar now stands upright through the centre.
    expect(near(pixel(out, 960, 540), RED), "centre").toBe(true)
    expect(near(pixel(out, 960, 300), RED), "above the centre, inside the turned bar").toBe(true)
    expect(near(pixel(out, 800, 540), BG), "where the upright bar was").toBe(true)
    expect(differing(await drawEditor(scene), out)).toBeLessThan(0.002)
  })

  it("turns pictures, ellipses and text too, and reopens with the same turn", async () => {
    for (const scene of [
      turned(bar("picture", { mediaId: "m1", imageUrl: url }), 30),
      turned(bar("ellipse", { color: "#dc1e1e" }), -45),
    ]) {
      expect(differing(await drawEditor(scene), drawOutput(scene))).toBeLessThan(0.003)
      expect(sceneToDesign(scene).scene.nodes.bar).toMatchObject({ rotation: scene.layers[0]!.rotation })
      expect(designToScene(sceneToDesign(scene)).scene.layers[0]).toMatchObject({ rotation: scene.layers[0]!.rotation, box: scene.layers[0]!.box })
    }
    const text = turned(bar("text", { text: "Welcome", fontSize: 48, textColor: "#ffffff", fontFamily: "Arial" }), 10)
    // Text keeps the box of its unturned words, not the larger box around the turned ones.
    expect(text.layers[0]).toMatchObject({ rotation: 10, box: { x: 30, y: 45, w: 40 } })
  })

  it("keeps the turn through the approved snapshot and a desk's edit, and drops it when upright", () => {
    const scene = turned(bar("color", { color: "#dc1e1e" }), 33)
    const snapshot = normalizeScene(JSON.parse(JSON.stringify(scene)))!
    expect(snapshot.layers[0]?.rotation).toBe(33)
    const a = ctxOf(drawOutput(scene, 1280, 720)).getImageData(0, 0, 1280, 720).data
    const b = ctxOf(drawOutput(snapshot, 1280, 720)).getImageData(0, 0, 1280, 720).data
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true)
    // A desk cannot send a turn, but its move of the layer keeps the host's.
    const deskLayer: Partial<SceneLayer> = { ...snapshot.layers[0]! }
    delete deskLayer.rotation
    const merged = mergeDeskScene({ ...snapshot, layers: [{ ...deskLayer, box: { x: 10, y: 45, w: 40, h: 10 } }] }, snapshot)
    expect(merged?.layers[0]).toMatchObject({ rotation: 33, box: { x: 10, y: 45, w: 40, h: 10 } })
    expect(designToScene(sceneToDesign(turned(bar("color", { color: "#dc1e1e" }), 360))).scene.layers[0]?.rotation).toBeUndefined()
    expect(normalizeScene({ ...snapshot, layers: [{ ...snapshot.layers[0], rotation: "a lot" }] })?.layers[0]?.rotation).toBeUndefined()
  })

  it("refuses to save a turned camera, video or ticker, and outputs never turn one from an older file", () => {
    for (const [kind, extra] of [
      ["camera", { cameraUrl: "http://192.168.1.10:8889/pulpit/whep" }],
      ["video", { mediaId: "v1", videoUrl: "asset://v1.mp4", mediaFile: "v1.mp4" }],
      ["ticker", {}],
    ] as const) {
      const design = sceneToDesign(bar(kind, extra))
      const { issues } = designToScene({ ...design, scene: applyCommand(design.scene, { type: "ROTATE_NODE", id: "bar", rotation: 20 }) })
      expect(issues).toContainEqual({ nodeId: "bar", message: "Cameras, videos and tickers cannot be turned on Rhema outputs yet; set Rotation back to 0" })
      expect(normalizeScene({ ...bar(kind, extra), layers: [{ ...bar(kind, extra).layers[0], rotation: 20 }] })?.layers[0]?.rotation).toBeUndefined()
    }
  })
})
