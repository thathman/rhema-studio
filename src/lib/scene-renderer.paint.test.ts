// @vitest-environment node
import { createCanvas, type Canvas } from "@napi-rs/canvas"
import { describe, expect, it } from "vitest"

import { applyCommand, buildRenderCommands } from "@/vendor/avnac/saraswati"
import { canvas2DRendererBackend } from "@/vendor/avnac/renderer/backends/canvas2d/renderer"
import { designToScene, sceneToDesign } from "@/design-engine/rhema-scene"
import { normalizeScene, sceneFrame } from "@/lib/scenes"
import { drawScene } from "@/lib/scene-renderer"
import type { Scene, SceneGradient, SceneLayer } from "@/types"

/**
 * Real pixels (#448 Slice A): the scene renderer every output uses, drawn by Skia's Canvas 2D (not
 * a mocked canvas), against the Avnac editor's own renderer and against colours worked out here.
 */
type Rgba = [number, number, number, number]
const ctxOf = (c: Canvas) => c.getContext("2d") as unknown as CanvasRenderingContext2D
const pixel = (c: Canvas, x: number, y: number): Rgba => [...ctxOf(c).getImageData(Math.round(x), Math.round(y), 1, 1).data] as Rgba
const near = (a: Rgba, b: Rgba, tolerance = 3) => a.every((v, i) => Math.abs(v - b[i]!) <= tolerance)
const mix = (a: Rgba, b: Rgba, t: number): Rgba => a.map((v, i) => Math.round(v + (b[i]! - v) * t)) as Rgba

const layer = (id: string, kind: SceneLayer["kind"], extra: Partial<SceneLayer>): SceneLayer => ({ id, name: id, kind, box: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, visible: true, ...extra })
const g = (angle: number, ...stops: [string, number][]): SceneGradient => ({ angle, stops: stops.map(([color, offset]) => ({ color, offset })) })

const NAVY: Rgba = [0x0b, 0x1a, 0x3a, 255]
const ROSE: Rgba = [0xd1, 0x4c, 0x62, 255]
const BLUE: Rgba = [0x31, 0x57, 0xa4, 255]
const WHITE: Rgba = [255, 255, 255, 255]

/** A designed scene with the paint Slice A supports: a gradient artboard, a gradient panel and a gradient ellipse. */
const painted: Scene = {
  id: "painted", name: "Painted", background: "#0b1a3a", createdAt: 1, updatedAt: 1,
  backgroundGradient: g(90, ["#0b1a3a", 0], ["#d14c62", 1]),
  layers: [
    layer("panel", "color", { color: "#3157a4", gradient: g(180, ["#3157a4", 0], ["#ffffff", 1]), box: { x: 10, y: 10, w: 30, h: 40 } }),
    layer("halo", "ellipse", { color: "#d14c62", gradient: g(0, ["#d14c62", 0], ["#3157a4", 1]), box: { x: 55, y: 20, w: 35, h: 60 } }),
    layer("glass", "color", { color: "rgba(255, 255, 255, 0.5)", box: { x: 60, y: 85, w: 30, h: 10 } }),
  ],
  design: { id: "d1", version: 1 },
}

const frameOf = (scene: Scene) => sceneFrame({ isLive: false, liveVerse: null, sources: {} as never, themes: [] }, { themeId: "t" }, scene)

function drawOutput(scene: Scene, width: number, height: number): Canvas {
  const canvas = createCanvas(width, height)
  drawScene(ctxOf(canvas), width, height, frameOf(scene), { image: () => null, layerCanvas: () => createCanvas(1, 1) as unknown as HTMLCanvasElement })
  return canvas
}

async function drawEditor(scene: Scene): Promise<Canvas> {
  const canvas = createCanvas(1920, 1080)
  await canvas2DRendererBackend.render(ctxOf(canvas), buildRenderCommands(sceneToDesign(scene).scene))
  return canvas
}

describe("scene paint on a real canvas", () => {
  it("draws the same pixels as the Avnac editor for a gradient artboard, panel and ellipse", async () => {
    const [editor, output] = [await drawEditor(painted), drawOutput(painted, 1920, 1080)]
    const a = ctxOf(editor).getImageData(0, 0, 1920, 1080).data
    const b = ctxOf(output).getImageData(0, 0, 1920, 1080).data
    let differ = 0
    for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i]! - b[i]!), Math.abs(a[i + 1]! - b[i + 1]!), Math.abs(a[i + 2]! - b[i + 2]!), Math.abs(a[i + 3]! - b[i + 3]!)) > 4) differ++
    // Only antialiased ellipse edges may differ by more than rounding.
    expect(differ / (1920 * 1080)).toBeLessThan(0.001)
  })

  it("puts each gradient's colours where the angle says, at 1920×1080 and 1280×720", () => {
    for (const [w, h] of [[1920, 1080], [1280, 720]] as const) {
      const c = drawOutput(painted, w, h)
      // Background, 90°: left to right, navy to rose (sampled where no layer covers it).
      for (const t of [0.05, 0.45, 0.95]) expect(near(pixel(c, w * t, h * 0.97), mix(NAVY, ROSE, t), 4), `${w}: background at ${t}`).toBe(true)
      // Panel, 180°: top to bottom inside its box, blue to white.
      for (const t of [0.1, 0.5, 0.9]) expect(near(pixel(c, w * 0.25, h * (0.1 + 0.4 * t)), mix(BLUE, WHITE, t), 4), `${w}: panel at ${t}`).toBe(true)
      // Ellipse, 0°: bottom to top, rose to blue; outside its curve the background shows.
      expect(near(pixel(c, w * 0.725, h * (0.2 + 0.6 * 0.75)), mix(ROSE, BLUE, 0.25), 4), `${w}: ellipse low`).toBe(true)
      expect(near(pixel(c, w * 0.725, h * (0.2 + 0.6 * 0.25)), mix(ROSE, BLUE, 0.75), 4), `${w}: ellipse high`).toBe(true)
      expect(near(pixel(c, w * 0.555, h * 0.205), mix(NAVY, ROSE, 0.555), 4), `${w}: ellipse corner`).toBe(true)
      // A see-through fill shows the background through it.
      expect(near(pixel(c, w * 0.75, h * 0.9), mix(mix(NAVY, ROSE, 0.75), WHITE, 0.5), 5), `${w}: glass`).toBe(true)
    }
  })

  it("letterboxes on a 4:3 output: the design's area keeps its gradient, the bars continue its edges", () => {
    const c = drawOutput(painted, 1440, 1080)
    // The 16:9 area is 1440×810 at y 135; the panel is 10–40% of it.
    expect(near(pixel(c, 1440 * 0.25, 135 + 810 * 0.12), mix(BLUE, WHITE, 0.05), 4)).toBe(true)
    expect(near(pixel(c, 1440 * 0.05, 135 + 810 * 0.97), mix(NAVY, ROSE, 0.05), 4)).toBe(true)
    expect(near(pixel(c, 1440 * 0.5, 40), mix(NAVY, ROSE, 0.5), 4), "a bar carries the gradient's colour for its column").toBe(true)
  })

  it("keeps transparency: a see-through gradient over a transparent output stays see-through", () => {
    const glass: Scene = { ...painted, background: "transparent", backgroundGradient: g(90, ["rgba(0, 0, 0, 0)", 0], ["#ffffff80", 1]), layers: [] }
    const c = drawOutput(glass, 1920, 1080)
    expect(pixel(c, 5, 540)[3]).toBeLessThan(6)
    expect(Math.abs(pixel(c, 1915, 540)[3] - 128)).toBeLessThanOrEqual(3)
  })

  it("a picture whose media is missing leaves the paint below untouched", () => {
    const missing: Scene = { ...painted, layers: [layer("pic", "picture", { imageUrl: "data:image/png;base64,missing", box: { x: 0, y: 0, w: 100, h: 100 } })] }
    const c = drawOutput(missing, 1920, 1080)
    expect(near(pixel(c, 960, 540), mix(NAVY, ROSE, 0.5), 4)).toBe(true)
  })

  it("draws a stored scene the same after the design is saved, reopened and normalised (the approved snapshot path)", () => {
    const design = sceneToDesign(painted)
    const saved = designToScene(JSON.parse(JSON.stringify(design))).scene
    const snapshot = normalizeScene(JSON.parse(JSON.stringify({ ...saved, design: painted.design })))!
    const a = ctxOf(drawOutput(painted, 1280, 720)).getImageData(0, 0, 1280, 720).data
    const b = ctxOf(drawOutput(snapshot, 1280, 720)).getImageData(0, 0, 1280, 720).data
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true)
  })

  it("a corrupt stored gradient falls back to the saved solid colour, never to nothing", () => {
    const corrupt = normalizeScene({ ...painted, backgroundGradient: { angle: 0, stops: [{ color: "javascript:alert(1)", offset: 0 }] }, layers: [] })!
    expect(corrupt.backgroundGradient).toBeUndefined()
    expect(near(pixel(drawOutput(corrupt, 320, 180), 160, 90), NAVY)).toBe(true)
  })
})

it("the editor marks the design with no issues once the paint is supported", () => {
  let scene = sceneToDesign(painted).scene
  scene = applyCommand(scene, { type: "SET_NODE_FILL", id: "glass", fill: { type: "gradient", css: "", stops: [{ color: "#000000", offset: 0 }, { color: "#ffffff", offset: 1 }], angle: 45 } })
  expect(designToScene({ ...sceneToDesign(painted), scene }).issues).toEqual([])
})

it("the Basic scene sheet keeps a background gradient until it sets another background", async () => {
  const { basicOf, withBasic } = await import("@/lib/basic-scene")
  const same = withBasic(painted, basicOf(painted))
  expect(same.backgroundGradient).toEqual(painted.backgroundGradient)
  const recoloured = withBasic(painted, { ...basicOf(painted), background: { kind: "colour", color: "#112233" } })
  expect(recoloured.backgroundGradient).toBeUndefined()
  expect(near(pixel(drawOutput(recoloured, 320, 180), 5, 175), [0x11, 0x22, 0x33, 255])).toBe(true)
})

describe("gradient paint outside the editor (review of #656)", () => {
  it("refuses colours Canvas 2D cannot parse, and draws every form it accepts", async () => {
    const { gradientIssue } = await import("@/lib/scene-gradient")
    const { scenePaint } = await import("@/lib/scene-renderer")
    expect(gradientIssue(g(0, ["rgb(10%, 20, 30)", 0], ["#000000", 1]))).toContain("whole-number channels")
    expect(gradientIssue(g(0, ["rgb(300, 0, 0)", 0], ["#000000", 1]))).not.toBeNull()
    const ctx = ctxOf(createCanvas(10, 10))
    for (const color of ["#abc", "#aabbcc", "#aabbcc80", "rgb(1, 2, 3)", "rgba(1, 2, 3, 0.5)", "RGBA(255,255,255,1)"]) {
      const paint = g(0, [color, 0], ["#000000", 1])
      expect(gradientIssue(paint), color).toBeNull()
      expect(() => scenePaint(ctx, "#000000", paint, { x: 0, y: 0, w: 10, h: 10 }), color).not.toThrow()
    }
  })

  it("keeps a #rrggbb solid colour beside every gradient, which desks and approval review accept", () => {
    let scene = sceneToDesign(painted).scene
    scene = applyCommand(scene, { type: "SET_ARTBOARD", bg: { type: "gradient", css: "", stops: [{ color: "rgba(0, 0, 0, 0)", offset: 0 }, { color: "#ffffff", offset: 1 }], angle: 0 } })
    scene = applyCommand(scene, { type: "SET_NODE_FILL", id: "halo", fill: { type: "gradient", css: "", stops: [{ color: "rgba(209, 76, 98, 0.5)", offset: 0 }, { color: "#fff", offset: 1 }], angle: 0 } })
    scene = applyCommand(scene, { type: "SET_NODE_FILL", id: "panel", fill: { type: "gradient", css: "", stops: [{ color: "#abc", offset: 0 }, { color: "#fff", offset: 1 }], angle: 0 } })
    const saved = designToScene({ ...sceneToDesign(painted), scene }).scene
    expect(saved.background).toBe("transparent")
    expect(saved.layers.find((l) => l.id === "halo")?.color).toBe("#d14c62")
    expect(saved.layers.find((l) => l.id === "panel")?.color).toBe("#aabbcc")
    expect(normalizeScene(saved)?.layers.find((l) => l.id === "halo")?.color).toBe("#d14c62")
  })

  it("a solid colour set over a gradient replaces it; a new gradient stays", async () => {
    const { useBroadcastStore } = await import("@/stores/broadcast-store")
    const b = () => useBroadcastStore.getState()
    b().saveScene(painted)
    const saved = () => b().scenes.find((s) => s.id === painted.id)!
    // A colour picker patches the colour and leaves the gradient as it was.
    b().saveScene({ ...saved(), background: "transparent", layers: saved().layers.map((l) => (l.id === "panel" ? { ...l, color: "#112233" } : l)) })
    expect(saved().backgroundGradient).toBeUndefined()
    expect(saved().layers.find((l) => l.id === "panel")?.gradient).toBeUndefined()
    expect(saved().layers.find((l) => l.id === "halo")?.gradient).toEqual(painted.layers[1]!.gradient)
    // The design editor saves a new gradient with its new fallback colour: kept.
    b().saveScene({ ...saved(), background: "#d14c62", backgroundGradient: g(45, ["#d14c62", 0], ["#000000", 1]) })
    expect(saved().backgroundGradient?.angle).toBe(45)
  })

  it("a joined desk's save keeps the host's gradients unless it changed that colour", async () => {
    const { mergeDeskScene, sceneForDesk } = await import("@/lib/desk-scenes")
    const sent = JSON.parse(JSON.stringify(sceneForDesk(painted, false)))
    // Desks see the gradient (and its revision); what they send back cannot set one.
    expect(sent.backgroundGradient).toEqual(painted.backgroundGradient)
    expect(mergeDeskScene({ ...sent, backgroundGradient: g(1, ["#000000", 0], ["#ffffff", 1]) }, painted, { cameras: new Set(), themes: new Set() })?.backgroundGradient).toEqual(painted.backgroundGradient)
    const renamed = mergeDeskScene({ ...sent, name: "Renamed" }, painted, { cameras: new Set(), themes: new Set() })!
    expect(renamed.name).toBe("Renamed")
    expect(renamed.backgroundGradient).toEqual(painted.backgroundGradient)
    expect(renamed.layers.map((l) => l.gradient)).toEqual(painted.layers.map((l) => l.gradient))
    const recoloured = mergeDeskScene({ ...sent, background: "#000000", layers: sent.layers.map((l: SceneLayer) => (l.id === "panel" ? { ...l, color: "#112233" } : l)) }, painted, { cameras: new Set(), themes: new Set() })!
    expect(recoloured.backgroundGradient).toBeUndefined()
    expect(recoloured.layers.find((l) => l.id === "panel")?.gradient).toBeUndefined()
    expect(recoloured.layers.find((l) => l.id === "halo")?.gradient).toEqual(painted.layers[1]!.gradient)
  })
})
