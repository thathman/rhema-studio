// Compatibility prototype for the Avnac engine in Rhema (C2; spike 33's gate): make a scene, edit
// text and an image, render it to drawing commands, save and reopen it, and time a 100-layer scene.
import { describe, expect, it } from "vitest"

import {
  applyCommand,
  buildRenderCommands,
  createEmptySaraswatiScene,
  parseSaraswatiScene,
  SARASWATI_ROOT_ID,
  toAvnacDocument,
  type SaraswatiImageNode,
  type SaraswatiScene,
  type SaraswatiTextNode,
} from "./saraswati"
import { fromAvnacDocument } from "./saraswati/compat/from-avnac"

const base = { parentId: SARASWATI_ROOT_ID, visible: true, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, originX: "left" as const, originY: "top" as const }

function text(id: string, value: string, y = 100): SaraswatiTextNode {
  return {
    ...base, id, type: "text", x: 160, y, text: value, width: 1600, fontSize: 72, fontFamily: "Inter", fontWeight: "700", fontStyle: "normal",
    textAlign: "center", lineHeight: 1.2, underline: false, color: { type: "solid", color: "#ffffff" }, stroke: null, strokeWidth: 0,
  }
}

function image(id: string): SaraswatiImageNode {
  return { ...base, id, type: "image", x: 0, y: 0, width: 1920, height: 1080, src: "asset://media/backdrop.jpg", cropX: 0, cropY: 0, clipPath: null }
}

function service(): SaraswatiScene {
  let scene = createEmptySaraswatiScene({ width: 1920, height: 1080, bg: { type: "solid", color: "#101020" } })
  scene = applyCommand(scene, { type: "ADD_NODE", node: image("backdrop") })
  scene = applyCommand(scene, { type: "ADD_NODE", node: text("title", "Welcome") })
  return scene
}

describe("Avnac engine in Rhema", () => {
  it("edits text and an image and renders them in layer order", () => {
    let scene = service()
    scene = applyCommand(scene, { type: "REPLACE_NODE", node: { ...(scene.nodes.title as SaraswatiTextNode), text: "Good morning" } })
    scene = applyCommand(scene, { type: "MOVE_NODE", id: "title", dx: 0, dy: 400 })
    const drawn = buildRenderCommands(scene)
    const kinds = drawn.map((c) => c.type)
    expect(drawn[0]).toMatchObject({ id: "__artboard__", width: 1920, height: 1080 })
    expect(kinds.indexOf("image")).toBeLessThan(kinds.indexOf("text"))
    const title = drawn.find((c) => c.type === "text")
    expect(title).toMatchObject({ text: "Good morning" })
    expect((scene.nodes.title as SaraswatiTextNode).y).toBe(500)
  })

  it("saves and reopens a scene unchanged, and through Avnac's own document format", () => {
    const scene = applyCommand(service(), { type: "SET_NODE_NAME", id: "title", name: "Title" })
    const reopened = parseSaraswatiScene(JSON.parse(JSON.stringify(scene)))
    expect(reopened).toEqual(scene)
    const back = fromAvnacDocument(toAvnacDocument(scene))
    expect(back.issues).toEqual([])
    const viaAvnac = back.scene
    expect(viaAvnac.artboard).toMatchObject({ width: 1920, height: 1080 })
    const texts = Object.values(viaAvnac.nodes).filter((n) => n.type === "text") as SaraswatiTextNode[]
    expect(texts.map((t) => t.text)).toEqual(["Welcome"])
  })

  it("renders a 100-layer scene quickly enough to edit live", () => {
    let scene = service()
    for (let i = 0; i < 100; i++) scene = applyCommand(scene, { type: "ADD_NODE", node: text(`line-${i}`, `Line ${i}`, 10 * i) })
    const start = performance.now()
    let drawn = buildRenderCommands(scene)
    for (let i = 0; i < 59; i++) drawn = buildRenderCommands(scene)
    const perFrameMs = (performance.now() - start) / 60
    expect(drawn.filter((c) => c.type === "text")).toHaveLength(101)
    // One frame's drawing list must take a small part of a 60 fps frame (16.7 ms).
    expect(perFrameMs).toBeLessThan(4)
    console.info(`[avnac] 101 text + 1 image layers: ${perFrameMs.toFixed(3)} ms per frame's drawing list`)
  })
})
