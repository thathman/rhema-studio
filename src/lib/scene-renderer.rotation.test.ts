// @vitest-environment node
import { createCanvas, Image, loadImage, type Canvas } from "@napi-rs/canvas"
import { beforeAll, describe, expect, it } from "vitest"

import { applyCommand, buildRenderCommands } from "@/vendor/avnac/saraswati"
import { canvas2DRendererBackend } from "@/vendor/avnac/renderer/backends/canvas2d/renderer"
import { layoutTextLines } from "@/vendor/avnac/renderer/backends/canvas2d/text-layout"
import { measureCanvas2DTextLineWidth } from "@/vendor/avnac/renderer/backends/canvas2d/shared"
import type { SaraswatiTextNode } from "@/vendor/avnac/saraswati"
import { designToScene, sceneToDesign } from "@/design-engine/rhema-scene"
import { mergeDeskScene } from "@/lib/desk-scenes"
import { normalizeScene, sceneFrame } from "@/lib/scenes"
import { drawScene, layerPivot } from "@/lib/scene-renderer"
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

/** The centre of the bright (text) pixels: where turned words land. */
function inkCentre(c: Canvas): { x: number; y: number } {
  const d = ctxOf(c).getImageData(0, 0, 1920, 1080).data
  let n = 0, sx = 0, sy = 0
  for (let i = 0; i < d.length; i += 4) if (d[i]! > 200 && d[i + 1]! > 200 && d[i + 2]! > 200) { const p = i / 4; sx += p % 1920; sy += Math.floor(p / 1920); n++ }
  return { x: sx / n, y: sy / n }
}

/** Where the Avnac editor turns a text node: the centre of the box it lays the words out in. */
function editorTextPivot(node: SaraswatiTextNode): { x: number; y: number } {
  const ctx = ctxOf(createCanvas(8, 8))
  const layout = layoutTextLines(node, (font, text) => measureCanvas2DTextLineWidth(ctx, font, text))
  return { x: node.x + layout.boxWidth / 2, y: node.y + layout.boxHeight / 2 }
}

/** Where outputs turn the same layer, at 1920×1080. */
function outputPivot(scene: Scene): { x: number; y: number } {
  const frame = sceneFrame({ isLive: false, liveVerse: null, sources: {} as never, themes: [] }, { themeId: "t" }, scene)
  const l = frame.layers[0]!
  const r = { x: (l.box.x / 100) * 1920, y: (l.box.y / 100) * 1080, w: (l.box.w / 100) * 1920, h: (l.box.h / 100) * 1080 }
  return layerPivot(ctxOf(createCanvas(8, 8)), l, r, 1080)
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
    // A desk that turns it (the Scene composer's Rotation field) is followed; 0 stands it upright.
    expect(mergeDeskScene({ ...snapshot, layers: [{ ...deskLayer, rotation: -12 }] }, snapshot)?.layers[0]?.rotation).toBe(-12)
    expect(mergeDeskScene({ ...snapshot, layers: [{ ...deskLayer, rotation: 0 }] }, snapshot)?.layers[0]?.rotation).toBeUndefined()
    expect(designToScene(sceneToDesign(turned(bar("color", { color: "#dc1e1e" }), 360))).scene.layers[0]?.rotation).toBeUndefined()
    expect(normalizeScene({ ...snapshot, layers: [{ ...snapshot.layers[0], rotation: "a lot" }] })?.layers[0]?.rotation).toBeUndefined()
  })

  it("turns text about the centre of its words, where the editor turns it, not the taller clipping box", async () => {
    const words = { text: "Welcome", fontSize: 72, textColor: "#ffffff", fontFamily: "Arial", textAlign: "center" as const, lineHeight: 1.2 }
    // From the editor: a 20%-high box (216 px) holding one 72 px line, turned 90° and 30°.
    for (const deg of [90, 30]) {
      const design = sceneToDesign(bar("text", { ...words, box: { x: 30, y: 30, w: 40, h: 20 } }))
      const turnedScene = applyCommand(design.scene, { type: "ROTATE_NODE", id: "bar", rotation: deg })
      const { scene, issues } = designToScene({ ...design, scene: turnedScene })
      expect(issues).toEqual([])
      expect(scene.layers[0]).toMatchObject({ rotation: deg, box: { y: 30, h: 20 } })
      const editor = editorTextPivot(turnedScene.nodes.bar as SaraswatiTextNode)
      const output = outputPivot(scene)
      expect(Math.abs(output.x - editor.x), `${deg}° x`).toBeLessThan(1)
      expect(Math.abs(output.y - editor.y), `${deg}° y`).toBeLessThan(1)
      expect(editor.y).toBeCloseTo(324 + 36, 0)
      const ink = [inkCentre(await drawEditor(scene)), inkCentre(drawOutput(scene))]
      expect(Math.hypot(ink[0]!.x - ink[1]!.x, ink[0]!.y - ink[1]!.y), `${deg}° ink`).toBeLessThan(4)
    }
    // From a scene: two lines in a tall box, turned in the Scene composer, then opened in the editor.
    const scene = bar("text", { ...words, text: "Welcome\nhome", rotation: -40, box: { x: 30, y: 20, w: 40, h: 50 } })
    const editor = editorTextPivot(sceneToDesign(scene).scene.nodes.bar as SaraswatiTextNode)
    const output = outputPivot(scene)
    expect(Math.abs(output.y - editor.y)).toBeLessThan(1)
    expect(editor.y).toBeCloseTo(216 + (72 * 1.2 + 72) / 2, 0)
    const ink = [inkCentre(await drawEditor(scene)), inkCentre(drawOutput(scene))]
    expect(Math.hypot(ink[0]!.x - ink[1]!.x, ink[0]!.y - ink[1]!.y)).toBeLessThan(4)
    // And back from the editor the box keeps its height (the clipping viewport).
    expect(designToScene(sceneToDesign(scene)).scene.layers[0]).toMatchObject({ rotation: -40, box: { h: 50 } })
  })

  it("spaces lines below a line height of 1 the same in the editor and on outputs", async () => {
    const lines = { text: "Welcome\nhome\nagain", fontSize: 72, textColor: "#ffffff", fontFamily: "Arial", textAlign: "center" as const }
    for (const lineHeight of [0.5, 0.7, 1.4]) {
      const scene = bar("text", { ...lines, lineHeight, box: { x: 30, y: 20, w: 40, h: 50 } })
      const node = sceneToDesign(scene).scene.nodes.bar as SaraswatiTextNode
      expect(node.lineHeight).toBe(lineHeight)
      // The editor's tight block: two line steps plus the last em.
      expect(editorTextPivot(node).y, `${lineHeight} editor`).toBeCloseTo(216 + (2 * 72 * lineHeight + 72) / 2, 0)
      expect(Math.abs(outputPivot(scene).y - editorTextPivot(node).y), `${lineHeight} pivot`).toBeLessThan(1)
      const ink = [inkCentre(await drawEditor(scene)), inkCentre(drawOutput(scene))]
      expect(Math.abs(ink[0]!.y - ink[1]!.y), `${lineHeight} ink, upright`).toBeLessThan(1.5)
      // Saved from the editor, the value comes back unchanged.
      expect(designToScene(sceneToDesign(scene)).scene.layers[0]).toMatchObject({ lineHeight })
    }
  })

  it("wraps a word wider than the box where the editor does, and turns it about the same point", async () => {
    const words = { text: "Hallelujah! Supercalifragilistic praise", fontSize: 72, textColor: "#ffffff", fontFamily: "Arial", textAlign: "center" as const, lineHeight: 1.2 }
    // 15% of 1920 = 288 px: "Supercalifragilistic" alone is far wider.
    const design = sceneToDesign(bar("text", { ...words, box: { x: 20, y: 30, w: 15, h: 40 } }))
    const turnedScene = applyCommand(design.scene, { type: "ROTATE_NODE", id: "bar", rotation: 30 })
    const node = turnedScene.nodes.bar as SaraswatiTextNode
    const ctx = ctxOf(createCanvas(8, 8))
    const layout = layoutTextLines(node, (font, text) => measureCanvas2DTextLineWidth(ctx, font, text))
    expect(layout.lines).toEqual(["Hallelujah!", "Supercalifragilistic", "praise"])
    expect(layout.boxWidth).toBeGreaterThan(288 * 1.5)
    const { scene, issues } = designToScene({ ...design, scene: turnedScene })
    expect(issues).toEqual([])
    // The saved box is the width the editor wraps at, not an estimate stretched by the long word.
    expect(scene.layers[0]).toMatchObject({ rotation: 30, box: { x: 20, w: 15 } })
    const editor = editorTextPivot(node)
    const output = outputPivot(scene)
    expect(Math.abs(output.x - editor.x), "pivot x").toBeLessThan(1)
    expect(Math.abs(output.y - editor.y), "pivot y").toBeLessThan(1)
    const ink = [inkCentre(await drawEditor(scene)), inkCentre(drawOutput(scene))]
    expect(Math.hypot(ink[0]!.x - ink[1]!.x, ink[0]!.y - ink[1]!.y), "ink, turned").toBeLessThan(4)
    const upright = { ...scene, layers: [{ ...scene.layers[0]!, rotation: undefined }] }
    const still = [inkCentre(await drawEditor(upright)), inkCentre(drawOutput(upright))]
    expect(Math.hypot(still[0]!.x - still[1]!.x, still[0]!.y - still[1]!.y), "ink, upright").toBeLessThan(4)
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
