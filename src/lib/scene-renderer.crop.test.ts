// @vitest-environment node
import { createCanvas, Image, loadImage, type Canvas } from "@napi-rs/canvas"
import { beforeAll, describe, expect, it } from "vitest"

import { applyCommand, buildRenderCommands } from "@/vendor/avnac/saraswati"
import { canvas2DRendererBackend } from "@/vendor/avnac/renderer/backends/canvas2d/renderer"
import { designToScene, outputCoverPictures, sceneToDesign } from "@/design-engine/rhema-scene"
import { normalizeScene, sceneFrame } from "@/lib/scenes"
import { drawScene } from "@/lib/scene-renderer"
import type { Scene, SceneLayer } from "@/types"

/**
 * Real pixels (#448 Slice B): a picture cropped, rounded and clipped in the Avnac editor, drawn by
 * the scene renderer every output uses (Skia's Canvas 2D, not a mocked canvas) against the editor's
 * own image renderer, and against what the crop must show.
 */
type Rgba = [number, number, number, number]
const ctxOf = (c: Canvas) => c.getContext("2d") as unknown as CanvasRenderingContext2D
const pixel = (c: Canvas, x: number, y: number): Rgba => [...ctxOf(c).getImageData(Math.round(x), Math.round(y), 1, 1).data] as Rgba
const near = (a: Rgba, b: Rgba, tolerance = 3) => a.every((v, i) => Math.abs(v - b[i]!) <= tolerance)

const RED: Rgba = [220, 30, 30, 255], GREEN: Rgba = [30, 200, 60, 255], BLUE: Rgba = [30, 60, 220, 255], YELLOW: Rgba = [240, 220, 30, 255]
const BG: Rgba = [16, 16, 32, 255]
let url = ""
let picture: Image

beforeAll(async () => {
  // A 200×100 picture in four colours: red, green over blue, yellow.
  const c = createCanvas(200, 100)
  const x = ctxOf(c)
  for (const [color, px, py] of [[RED, 0, 0], [GREEN, 100, 0], [BLUE, 0, 50], [YELLOW, 100, 50]] as const) {
    x.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`
    x.fillRect(px, py, 100, 50)
  }
  url = `data:image/png;base64,${c.toBuffer("image/png").toString("base64")}`
  picture = await loadImage(c.toBuffer("image/png"))
  // What the editor's image loader expects of a browser.
  Object.assign(globalThis, { Image, HTMLImageElement: Image, ImageBitmap: class {}, HTMLCanvasElement: class {} })
})

const pictureScene = (extra: Partial<SceneLayer> = {}): Scene => ({
  id: "pics", name: "Pictures", background: "#101020", createdAt: 1, updatedAt: 1, design: { id: "d", version: 1 },
  layers: [{ id: "pic", name: "pic", kind: "picture", mediaId: "m1", imageUrl: url, box: { x: 20, y: 20, w: 40, h: 40 }, opacity: 1, visible: true, ...extra }],
})

/** The scene as saved from the editor after these edits to its picture. */
function edited(...commands: Parameters<typeof applyCommand>[1][]): Scene {
  const design = sceneToDesign(pictureScene())
  const scene = commands.reduce(applyCommand, design.scene)
  const { scene: saved, issues } = designToScene({ ...design, scene })
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

// The box: 20–60% of the frame each way, so 384–1152 × 216–648 at 1920×1080.
const inBox = (fx: number, fy: number): [number, number] => [1920 * (0.2 + 0.4 * fx), 1080 * (0.2 + 0.4 * fy)]

describe("picture crop and clipping on a real canvas", () => {
  it("a rectangular crop shows only the cropped part, stretched over the box, as the editor does", async () => {
    const scene = edited({ type: "SET_IMAGE_CROP", id: "pic", cropX: 100, cropY: 0, cropWidth: 100, cropHeight: 50 })
    const out = drawOutput(scene)
    for (const [fx, fy] of [[0.02, 0.02], [0.5, 0.5], [0.98, 0.98]]) expect(near(pixel(out, ...inBox(fx, fy)), GREEN), `${fx},${fy}`).toBe(true)
    expect(near(pixel(out, 300, 540), BG), "outside the box").toBe(true)
    expect(differing(await drawEditor(scene), out)).toBeLessThan(0.001)
  })

  it("rounded corners and an ellipse clip cut the picture as the editor does", async () => {
    const rounded = edited({ type: "SET_IMAGE_BORDER_RADIUS", id: "pic", radius: 80 })
    const r = drawOutput(rounded)
    expect(near(pixel(r, ...inBox(0.005, 0.005)), BG), "a rounded corner shows what is below").toBe(true)
    expect(near(pixel(r, ...inBox(0.25, 0.25)), RED)).toBe(true)
    expect(differing(await drawEditor(rounded), r)).toBeLessThan(0.002)

    const oval = edited({ type: "SET_NODE_CLIP_PATH", id: "pic", clipPath: { type: "ellipse", x: 0, y: 0, width: 768, height: 432 } })
    const o = drawOutput(oval)
    expect(near(pixel(o, ...inBox(0.1, 0.1)), BG), "outside the ellipse").toBe(true)
    expect(near(pixel(o, ...inBox(0.7, 0.7)), YELLOW), "inside the ellipse").toBe(true)
    expect(differing(await drawEditor(oval), o)).toBeLessThan(0.002)
  })

  it("an off-centre rectangular clip and a crop together", async () => {
    const both = edited(
      { type: "SET_IMAGE_CROP", id: "pic", cropX: 0, cropY: 50, cropWidth: 200, cropHeight: 50 },
      { type: "SET_NODE_CLIP_PATH", id: "pic", clipPath: { type: "rect", x: 192, y: 0, width: 384, height: 432, radiusX: 0, radiusY: 0 } },
    )
    const c = drawOutput(both)
    expect(near(pixel(c, ...inBox(0.25, 0.5)), BG), "the clip keeps only the right half").toBe(true)
    expect(near(pixel(c, ...inBox(0.75, 0.5)), YELLOW), "the crop keeps only the bottom row").toBe(true)
    expect(differing(await drawEditor(both), c)).toBeLessThan(0.001)
  })

  it("keeps the crop at another size and on a 4:3 output", () => {
    const scene = edited({ type: "SET_IMAGE_CROP", id: "pic", cropX: 0, cropY: 50, cropWidth: 100, cropHeight: 50 })
    const small = drawOutput(scene, 1280, 720)
    expect(near(pixel(small, 1280 * 0.4, 720 * 0.4), BLUE)).toBe(true)
    const square = drawOutput(scene, 1440, 1080)
    // The 16:9 area is 1440×810 at y 135.
    expect(near(pixel(square, 1440 * 0.4, 135 + 810 * 0.4), BLUE)).toBe(true)
    expect(near(pixel(square, 1440 * 0.1, 135 + 810 * 0.1), BG)).toBe(true)
  })

  it("draws the same after save, reopen and normalising (the approved snapshot), and a picture without crop still covers its box", () => {
    const scene = edited({ type: "SET_IMAGE_CROP", id: "pic", cropX: 100, cropY: 50, cropWidth: 100, cropHeight: 50 }, { type: "SET_IMAGE_BORDER_RADIUS", id: "pic", radius: 40 })
    const snapshot = normalizeScene(JSON.parse(JSON.stringify(scene)))!
    const a = ctxOf(drawOutput(scene, 1280, 720)).getImageData(0, 0, 1280, 720).data
    const b = ctxOf(drawOutput(snapshot, 1280, 720)).getImageData(0, 0, 1280, 720).data
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true)
    // Rhema's own picture (no editor drawing) covers its 4:3-ish box from the centre, as before.
    const plain = drawOutput(pictureScene({ box: { x: 0, y: 0, w: 50, h: 100 } }))
    expect(near(pixel(plain, 960 * 0.1, 1080 * 0.25), RED)).toBe(true)
    expect(near(pixel(plain, 960 * 0.9, 1080 * 0.75), YELLOW)).toBe(true)
  })

  it("a missing picture leaves what is below; a corrupt stored crop draws the whole picture covering the box", () => {
    const scene = edited({ type: "SET_IMAGE_CROP", id: "pic", cropX: 100, cropY: 0, cropWidth: 100, cropHeight: 50 })
    const canvas = createCanvas(320, 180)
    drawScene(ctxOf(canvas), 320, 180, sceneFrame({ isLive: false, liveVerse: null, sources: {} as never, themes: [] }, { themeId: "t" }, scene), { image: () => null, layerCanvas: () => createCanvas(1, 1) as unknown as HTMLCanvasElement })
    expect(near(pixel(canvas, 160, 90), BG)).toBe(true)
    const corrupt = normalizeScene({ ...scene, layers: scene.layers.map((l) => ({ ...l, imageDraw: { ...l.imageDraw, width: "wide" } })) })!
    expect(corrupt.layers[0]?.imageDraw).toBeUndefined()
  })
})

it("a joined desk's save keeps the host's picture crop", async () => {
  const { mergeDeskScene, sceneForDesk } = await import("@/lib/desk-scenes")
  const scene = edited({ type: "SET_IMAGE_CROP", id: "pic", cropX: 100, cropY: 0, cropWidth: 100, cropHeight: 50 })
  const sent = JSON.parse(JSON.stringify(sceneForDesk(scene, false)))
  const back = mergeDeskScene({ ...sent, name: "Renamed", layers: sent.layers.map((l: SceneLayer) => ({ ...l, imageDraw: { width: 1, height: 1, cropX: 0, cropY: 0 } })) }, scene, { cameras: new Set(), themes: new Set() })!
  expect(back.layers[0]?.imageDraw).toEqual(scene.layers[0]?.imageDraw)
})

describe("picture drawing after review", () => {
  it("matches the editor for a picture resized after cropping, a stack of two clips and half opacity", async () => {
    const design = sceneToDesign(pictureScene({ opacity: 0.5 }))
    let scene = applyCommand(design.scene, { type: "SET_IMAGE_CROP", id: "pic", cropX: 20, cropY: 10, cropWidth: 150, cropHeight: 80 })
    const pic = scene.nodes.pic
    if (pic.type !== "image") throw new Error("image")
    scene = { ...scene, nodes: { ...scene.nodes, pic: { ...pic, scaleX: 1.25, scaleY: 0.75, clipPathStack: [{ type: "rect", x: -100, y: 0, width: 600, height: 432, radiusX: 40, radiusY: 40 }], clipPath: { type: "ellipse", x: 50, y: 0, width: 700, height: 380 } } } }
    const { scene: saved, issues } = designToScene({ ...design, scene })
    expect(issues).toEqual([])
    expect(saved.layers[0]?.imageDraw?.clips?.map((c) => c.type)).toEqual(["rect", "ellipse"])
    expect(differing(await drawEditor(saved), drawOutput(saved))).toBeLessThan(0.002)
  })

  it("another picture or a Rhema crop set over a cropped picture replaces the editor's drawing; the editor's own save keeps it", async () => {
    const { useBroadcastStore } = await import("@/stores/broadcast-store")
    const b = () => useBroadcastStore.getState()
    const scene = edited({ type: "SET_IMAGE_CROP", id: "pic", cropX: 100, cropY: 0, cropWidth: 100, cropHeight: 50 })
    b().saveScene(scene)
    const saved = () => b().scenes.find((s) => s.id === scene.id)!.layers[0]!
    b().saveScene({ ...scene, name: "Renamed" })
    expect(saved().imageDraw).toEqual(scene.layers[0]!.imageDraw)
    b().saveScene({ ...scene, layers: [{ ...scene.layers[0]!, mediaId: "m2", imageUrl: "data:image/png;base64,other" }] })
    expect(saved().imageDraw).toBeUndefined()
    b().saveScene(scene)
    b().saveScene({ ...scene, layers: [{ ...scene.layers[0]!, crop: { l: 10, t: 0, r: 0, b: 0 } }] })
    expect(saved().imageDraw).toBeUndefined()
    expect(saved().crop).toEqual({ l: 10, t: 0, r: 0, b: 0 })
  })

  it("refuses to crop in the editor a picture already cropped in the Scene composer, rather than lose that crop", () => {
    const design = sceneToDesign(pictureScene({ crop: { l: 20, t: 0, r: 0, b: 0 } }))
    const { issues } = designToScene({ ...design, scene: applyCommand(design.scene, { type: "SET_IMAGE_BORDER_RADIUS", id: "pic", radius: 20 }) })
    expect(issues).toEqual([{ nodeId: "pic", message: expect.stringContaining("reset that crop there") }])
  })

  it.each([
    ["a negative clip size", { clips: [{ type: "ellipse", x: 0, y: 0, width: -5, height: 10 }] }],
    ["a crop past any picture", { cropX: 200_000 }],
    ["an oversized picture", { width: 50_000 }],
    ["a clip of an unknown shape", { clips: [{ type: "star" }] }],
  ])("drops a stored drawing it cannot draw (%s): the picture covers its box", async (_why, bad) => {
    const scene = edited({ type: "SET_IMAGE_CROP", id: "pic", cropX: 100, cropY: 0, cropWidth: 100, cropHeight: 50 })
    const stored = normalizeScene({ ...scene, layers: scene.layers.map((l) => ({ ...l, imageDraw: { ...l.imageDraw, ...bad } })) })!
    expect(stored.layers[0]?.imageDraw).toBeUndefined()
  })
})

it("a picture replaced in the design editor keeps its crop when the scene is re-pinned to that version", async () => {
  const { useBroadcastStore } = await import("@/stores/broadcast-store")
  const b = () => useBroadcastStore.getState()
  const v1 = { ...edited({ type: "SET_IMAGE_CROP", id: "pic", cropX: 100, cropY: 0, cropWidth: 100, cropHeight: 50 }), id: "repin", design: { id: "d", version: 1 } }
  b().saveScene(v1)
  const v2 = { ...v1, design: { id: "d", version: 2 }, layers: [{ ...v1.layers[0]!, mediaId: "m2", imageUrl: "data:image/png;base64,replaced" }] }
  b().saveScene(v2)
  expect(b().scenes.find((s) => s.id === "repin")?.layers[0]?.imageDraw).toEqual(v1.layers[0]!.imageDraw)
})

it("filling in a library picture's address keeps its crop", async () => {
  const { useBroadcastStore } = await import("@/stores/broadcast-store")
  const b = () => useBroadcastStore.getState()
  const scene = { ...edited({ type: "SET_IMAGE_CROP", id: "pic", cropX: 100, cropY: 0, cropWidth: 100, cropHeight: 50 }), id: "hydrate" }
  b().saveScene({ ...scene, layers: [{ ...scene.layers[0]!, imageUrl: "asset://m1.png" }] })
  b().saveScene(scene)
  expect(b().scenes.find((s) => s.id === "hydrate")?.layers[0]?.imageDraw).toEqual(scene.layers[0]!.imageDraw)

})

describe("a picture never cropped in the editor (#448 P2)", () => {
    /** The editor's preview, drawing pictures as outputs will (what `renderSceneToCanvas` does with `imageCover`). */
    async function drawPreview(design: ReturnType<typeof sceneToDesign>, cover = true): Promise<Canvas> {
      const canvas = createCanvas(1920, 1080)
      const covered = cover ? outputCoverPictures(design) : {}
      const commands = buildRenderCommands(design.scene).map((c) => (c.type === "image" && covered[c.id] ? { ...c, cover: covered[c.id] } : c))
      await canvas2DRendererBackend.render(ctxOf(canvas), commands)
      return canvas
    }

    it("resized out of shape, the editor previews it covering its box, as outputs draw it", async () => {
      // Composer-cropped off centre, so where its colours meet shows whether it was stretched.
      const design = sceneToDesign(pictureScene({ crop: { l: 25, t: 0, r: 0, b: 0 } }))
      // Stretch it three times wider than tall: the 1.5:1 picture can only cover that by losing its top and bottom.
      const scene = applyCommand(design.scene, { type: "RESIZE_NODE", id: "pic", x: 384, y: 216, width: 960, height: 320 })
      const resized = { ...design, scene }
      const { scene: saved, issues } = designToScene(resized)
      expect(issues).toEqual([])
      expect(saved.layers[0]!.imageDraw).toBeUndefined()
      const out = drawOutput(saved)
      expect(differing(await drawPreview(resized), out)).toBeLessThan(0.002)
      // Without the cover, the editor stretched it: the screens would not show what was designed.
      expect(differing(await drawPreview(resized, false), out)).toBeGreaterThan(0.01)
    })

    it("keeps its Scene composer crop in the preview", async () => {
      const design = sceneToDesign(pictureScene({ crop: { l: 50, t: 0, r: 0, b: 0 } }))
      const out = drawOutput(designToScene(design).scene)
      expect(near(pixel(out, ...inBox(0.5, 0.25)), GREEN)).toBe(true)
      expect(differing(await drawPreview(design), out)).toBeLessThan(0.002)
    })

    it("one cropped, rounded or clipped in the editor, now or before, is previewed as the editor draws it", () => {
      const cropped = sceneToDesign(pictureScene())
      cropped.scene = applyCommand(cropped.scene, { type: "SET_IMAGE_BORDER_RADIUS", id: "pic", radius: 20 })
      expect(outputCoverPictures(cropped)).toEqual({})
      // Reset after a save: outputs keep drawing it as the editor does, so the preview does too.
      const before = sceneToDesign(edited({ type: "SET_IMAGE_CROP", id: "pic", cropX: 10, cropY: 0 }))
      before.scene = applyCommand(before.scene, { type: "SET_IMAGE_CROP", id: "pic", cropX: 0, cropY: 0 })
      expect(designToScene(before).scene.layers[0]!.imageDraw).toBeDefined()
      expect(outputCoverPictures(before)).toEqual({})
    })
  })
