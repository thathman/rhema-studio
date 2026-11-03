// @vitest-environment node
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { createCanvas, loadImage, type Canvas, type Image } from "@napi-rs/canvas"
import { beforeAll, describe, expect, it } from "vitest"

import { designPages, designToScene, outputCoverPictures, type RhemaDesign } from "@/design-engine/rhema-scene"
import { sceneFrame } from "@/lib/scenes"
import { drawScene } from "@/lib/scene-renderer"

/**
 * The design an assistant proposed over MCP (#443 C5 slice 1), as the Rust builder saves it
 * (`fixtures/mcp-design-draft.json`, kept equal to the builder by `mcp_design_draft.rs`): the
 * editor's own adapter opens every page with no issue, and the output renderer draws it.
 */
const design = JSON.parse(readFileSync(join(__dirname, "fixtures/mcp-design-draft.json"), "utf8")) as RhemaDesign
type Rgba = [number, number, number, number]
const ctxOf = (c: Canvas) => c.getContext("2d") as unknown as CanvasRenderingContext2D
const pixel = (c: Canvas, x: number, y: number): Rgba => [...ctxOf(c).getImageData(Math.round(x), Math.round(y), 1, 1).data] as Rgba
const near = (a: Rgba, b: Rgba, tolerance = 6) => a.every((v, i) => Math.abs(v - b[i]!) <= tolerance)
let choir: Image

beforeAll(async () => {
  const c = createCanvas(1600, 900)
  const x = ctxOf(c)
  x.fillStyle = "rgb(20, 180, 90)"
  x.fillRect(0, 0, 1600, 900)
  choir = await loadImage(c.toBuffer("image/png"))
})

function drawPage(pageId: string): Canvas {
  const { scene, issues } = designToScene(design, pageId)
  expect(issues).toEqual([])
  const canvas = createCanvas(1920, 1080)
  const frame = sceneFrame({ isLive: false, liveVerse: null, sources: {} as never, themes: [] }, { themeId: "t" }, scene)
  drawScene(ctxOf(canvas), 1920, 1080, frame, {
    image: (url) => (url === "asset://localhost/%2Fmedia%2Fchoir.png" ? (choir as unknown as HTMLImageElement) : null),
    layerCanvas: () => createCanvas(1, 1) as unknown as HTMLCanvasElement,
  })
  return canvas
}

describe("an MCP-created design draft opens and draws through Rhema's adapters", () => {
  const pages = designPages(design)

  it("has its three pages, in order, each a scene with every layer and both languages", () => {
    expect(pages.map((p) => p.title)).toEqual(["Welcome", "When", "Picture"])
    for (const page of pages) {
      const { scene, issues } = designToScene(design, page.id)
      expect(issues).toEqual([])
      expect(scene.layers).toHaveLength(2)
      const text = scene.layers.find((l) => l.kind === "text")!
      expect(text.text && text.textSecond).toBeTruthy()
    }
    expect(designToScene(design, pages[0]!.id).scene.layers[1]).toMatchObject({ text: "Harvest Thanksgiving", textSecond: "Ìdúpẹ́ Ìkórè", fontSize: 96, fontWeight: "800" })
  })

  it("draws the gradient background, the solid band, the gradient sun and the library picture", () => {
    const welcome = drawPage(pages[0]!.id)
    expect(near(pixel(welcome, 960, 1000), [194, 65, 12, 255]), "the band").toBe(true)
    const topLeft = pixel(welcome, 10, 10), bottomRight = pixel(welcome, 1900, 700)
    expect(topLeft[2]).toBeLessThan(bottomRight[2]!) // the background runs dark to blue

    const when = drawPage(pages[1]!.id)
    const left = pixel(when, 1380, 320), right = pixel(when, 1740, 320)
    expect(left[1]).toBeGreaterThan(right[1]!) // yellow to orange, left to right
    expect(pixel(when, 1370, 130)[0], "outside the ellipse shows the dark background").toBeLessThan(80)
    expect(pixel(when, 1560, 320)[0], "inside it, the sun").toBeGreaterThan(230)

    const picture = drawPage(pages[2]!.id)
    expect(near(pixel(picture, 640, 410), [20, 180, 90, 255]), "the picture").toBe(true)
  })

  it("draws its words on screen", () => {
    const welcome = drawPage(pages[0]!.id)
    const data = ctxOf(welcome).getImageData(160, 300, 1600, 200).data
    let white = 0
    for (let i = 0; i < data.length; i += 4) if (data[i]! > 230 && data[i + 1]! > 230 && data[i + 2]! > 230) white++
    expect(white).toBeGreaterThan(500)
  })

  it("previews its picture in the editor as outputs draw it (never cropped there)", () => {
    const picture = Object.values(design.bindings).find((b) => b.kind === "picture")!
    expect(outputCoverPictures(design)).toEqual({ [picture.id!]: { l: 0, t: 0, r: 0, b: 0 } })
  })
})
