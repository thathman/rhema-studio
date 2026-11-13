import { describe, expect, it } from "vitest"

import { applyCommand, buildRenderCommands, SARASWATI_ROOT_ID, type SaraswatiGroupNode, type SaraswatiRectNode } from "../vendor/avnac/saraswati"
import type { Scene, SceneLayer } from "../types/scene"
import { designToScene, pinStatus, previewDesign, resolveDesignedMoment, sceneFromVersion, sceneToDesign } from "./rhema-scene"

const layer = (id: string, kind: SceneLayer["kind"], extra: Partial<SceneLayer> = {}): SceneLayer => ({
  id, name: id, kind, box: { x: 10, y: 20, w: 30, h: 40 }, opacity: 1, visible: true, ...extra,
})

const sermon: Scene = {
  id: "sermon", name: "Sermon", background: "#101020", fadeMs: 400, createdAt: 1, updatedAt: 2, updatedBy: "Femi",
  layers: [
    layer("bg", "color", { color: "#202040", box: { x: 0, y: 0, w: 100, h: 100 } }),
    layer("title", "text", { text: "Sunday worship", fontFamily: "Geist Variable", fontSize: 64, fontWeight: "700", fontStyle: "italic", textAlign: "center", lineHeight: 1.15, textColor: "#ffffff", underline: true, textWiden: "right", box: { x: 10, y: 12, w: 80, h: 20 } }),
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

  it("marks text saved from the editor so outputs widen an over-wide word as the editor does", () => {
    const older = { ...sermon, layers: sermon.layers.map((l) => (l.kind === "text" ? { ...l, textWiden: undefined } : l)) }
    const text = designToScene(sceneToDesign(older)).scene.layers.find((l) => l.kind === "text")
    expect(text).toMatchObject({ textWiden: "right", box: { x: 10, w: 80 } })
  })

  it("requires a valid fixed time before a clock layer can be used in Prepare", () => {
    const design = sceneToDesign({ ...sermon, layers: [layer("fixed-clock", "clock", { clockShows: "until" })] })
    expect(designToScene(design).issues).toContainEqual({
      nodeId: "fixed-clock",
      message: "A clock counting down to a fixed time needs a valid 24-hour time before this version can be used in Prepare",
    })
  })

  it("resolves exactly the selected page from one versioned scene graph", () => {
    const base = sceneToDesign({ ...sermon, layers: [layer("first", "text", { text: "First page" })] })
    const root = base.scene.nodes[base.scene.root]
    const first = base.scene.nodes.first
    if (root.type !== "group" || first.type !== "text") throw new Error("Expected a root group and text layer")
    const pageOne: SaraswatiGroupNode = { id: "page-one", type: "group", parentId: root.id, name: "Page 1", visible: true, opacity: 1, children: [first.id] }
    const pageTwo: SaraswatiGroupNode = { id: "page-two", type: "group", parentId: root.id, name: "Page 2", visible: true, opacity: 0.5, rotation: 15, children: ["second"] }
    const second = { ...first, id: "second", parentId: pageTwo.id, text: "Second page" }
    const multiPage = {
      ...base,
      pages: [
        { id: pageOne.id, nodeId: pageOne.id, title: pageOne.name! },
        { id: pageTwo.id, nodeId: pageTwo.id, title: pageTwo.name! },
      ],
      scene: {
        ...base.scene,
        nodes: {
          ...base.scene.nodes,
          [root.id]: { ...root, children: [pageOne.id, pageTwo.id] },
          [pageOne.id]: pageOne,
          [pageTwo.id]: pageTwo,
          [first.id]: { ...first, parentId: pageOne.id },
          [second.id]: second,
        },
      },
      bindings: {
        ...base.bindings,
        second: { id: "second", kind: "text" as const, textBoxHeight: 216 },
      },
    }

    const selected = designToScene(multiPage, pageTwo.id)
    // A faded, turned page: its layer is faded by it; the page's own angle is a record the editor never draws (#448).
    expect(selected.issues).toEqual([])
    expect(selected.scene.layers[0]?.opacity).toBeCloseTo(pageTwo.opacity * second.opacity, 3)
    expect(selected.scene.layers).toEqual([expect.objectContaining({ id: "second", kind: "text", text: "Second page" })])
    expect(designToScene(multiPage, pageOne.id).issues).toEqual([])
    expect(designToScene(multiPage, "deleted-page").issues).toEqual([
      expect.objectContaining({ nodeId: "__pages__", message: expect.stringContaining("page") }),
    ])
  })

  it("fails closed on malformed page metadata without throwing", () => {
    const malformed = { ...sceneToDesign(sermon), pages: { length: 2 } } as never
    expect(() => designToScene(malformed)).not.toThrow()
    expect(designToScene(malformed).issues).toContainEqual(expect.objectContaining({
      nodeId: "__pages__",
      message: expect.stringContaining("between 1 and 50"),
    }))
  })

  it("roundtrips solid Avnac ellipses as editable Rhema scene layers and refuses unsupported paint", () => {
    const ellipseScene: Scene = { ...sermon, layers: [layer("oval", "ellipse", { color: "#d14c62" })] }
    const design = sceneToDesign(ellipseScene)
    expect(design.scene.nodes.oval).toMatchObject({ type: "ellipse", fill: { type: "solid", color: "#d14c62" }, stroke: null, strokeWidth: 0 })
    const { scene, issues } = designToScene(design)
    expect(issues).toEqual([])
    expect(scene.layers).toEqual(ellipseScene.layers)
    const reopened = JSON.parse(JSON.stringify(design)) as typeof design
    const versioned = sceneFromVersion({ designId: "design-ellipse", version: 3, document: reopened })
    expect(versioned.issues).toEqual([])
    expect(versioned.scene.layers[0]).toMatchObject({ id: "oval", kind: "ellipse", color: "#d14c62" })
    expect(versioned.scene.design).toEqual({ id: "design-ellipse", version: 3 })

    const oval = design.scene.nodes.oval
    if (oval.type !== "ellipse") throw new Error("Expected the ellipse node")
    const stretched = designToScene({
      ...design,
      scene: { ...design.scene, nodes: { ...design.scene.nodes, oval: { ...oval, scaleX: 2 } } },
    })
    expect(stretched.issues).toEqual([])
    expect(stretched.scene.layers[0]?.box).toEqual({ x: 10, y: 20, w: 60, h: 40 })
    const gradient = applyCommand(design.scene, {
      type: "SET_NODE_FILL", id: "oval",
      fill: { type: "gradient", css: "linear-gradient(90deg, #d14c62, #3157a4)", stops: [{ color: "#d14c62", offset: 0 }, { color: "#3157a4", offset: 1 }], angle: 90 },
    })
    const graded = designToScene({ ...design, scene: gradient })
    expect(graded.issues).toEqual([])
    expect(graded.scene.layers[0]).toMatchObject({ color: "#d14c62", gradient: { angle: 90, stops: [{ color: "#d14c62", offset: 0 }, { color: "#3157a4", offset: 1 }] } })
    const badGradient = applyCommand(design.scene, { type: "SET_NODE_FILL", id: "oval", fill: { type: "gradient", css: "", stops: [{ color: "red", offset: 0 }, { color: "#3157a4", offset: 1 }], angle: 90 } })
    expect(designToScene({ ...design, scene: badGradient }).issues).toContainEqual({ nodeId: "oval", message: "This ellipse gradient cannot be drawn on Rhema outputs: Gradient colours must be hex (#rrggbb, #rrggbbaa) or rgb()/rgba() with whole-number channels" })
    // An outline is saved and drawn on outputs (#448), and reopens in the editor as its stroke.
    const stroke = applyCommand(design.scene, { type: "SET_NODE_STROKE", id: "oval", stroke: { type: "solid", color: "#ffffff" }, strokeWidth: 2 })
    const outlined = designToScene({ ...design, scene: stroke })
    expect(outlined.issues).toEqual([])
    expect(outlined.scene.layers[0]).toMatchObject({ outline: { color: "#ffffff", width: 2 } })
    expect(sceneToDesign(outlined.scene).scene.nodes.oval).toMatchObject({ stroke: { type: "solid", color: "#ffffff" }, strokeWidth: 2 })
    const gradientStroke = applyCommand(design.scene, { type: "SET_NODE_STROKE", id: "oval", stroke: { type: "gradient", css: "", stops: [{ color: "#ffffff", offset: 0 }, { color: "#000000", offset: 1 }], angle: 0 }, strokeWidth: 2 })
    expect(designToScene({ ...design, scene: gradientStroke }).issues).toContainEqual({ nodeId: "oval", message: "Outline colours must be a solid #rrggbb for Rhema outputs" })
    const stretchedStroke = { ...stroke, nodes: { ...stroke.nodes, oval: { ...stroke.nodes.oval, scaleX: 2 } } } as typeof stroke
    expect(designToScene({ ...design, scene: stretchedStroke }).issues).toContainEqual({ nodeId: "oval", message: expect.stringContaining("stretched shape") })
    const clip = applyCommand(design.scene, { type: "SET_NODE_CLIP_PATH", id: "oval", clipPath: { type: "ellipse", x: 0, y: 0, width: 100, height: 100 } })
    expect(designToScene({ ...design, scene: clip }).issues).toContainEqual({ nodeId: "oval", message: "Ellipse clipping cannot be saved into a Rhema scene yet" })
    const rotated = applyCommand(design.scene, { type: "ROTATE_NODE", id: "oval", rotation: 12 })
    // A turned layer saves its turn (#851 G7): outputs turn it about its box's centre.
    expect(designToScene({ ...design, scene: rotated })).toMatchObject({ issues: [], scene: { layers: [{ id: "oval", rotation: 12 }] } })
    const flipped = designToScene({ ...design, scene: { ...design.scene, nodes: { ...design.scene.nodes, oval: { ...oval, scaleX: -1 } } } })
    expect(flipped.issues).toContainEqual({ nodeId: "oval", message: "Ellipse must keep a positive, finite scale for Rhema scene output" })
  })

  it("draw in layer order with Rhema's boxes on a 1920×1080 frame", () => {
    const drawn = buildRenderCommands(sceneToDesign(sermon).scene)
    expect(drawn.map((c) => c.id)).toEqual(["__artboard__", "bg", "title", "pic", "cam", "verse", "clock", "ticker", "lt", "vid"])
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

  it("roundtrips editable literal text and its style into a usable Rhema scene layer", () => {
    const textOnly: Scene = { ...sermon, layers: [sermon.layers.find((candidate) => candidate.kind === "text")!] }
    const design = sceneToDesign(textOnly)
    const node = design.scene.nodes.title
    expect(node).toMatchObject({ type: "text", text: "Sunday worship", fontFamily: "Geist Variable", fontSize: 64, fontWeight: "700", fontStyle: "italic", textAlign: "center", lineHeight: 1.15, underline: true })
    const { scene, issues } = designToScene(design)
    expect(issues).toEqual([])
    expect(scene.layers[0]).toMatchObject({ kind: "text", text: "Sunday worship", fontFamily: "Geist Variable", fontSize: 64, fontWeight: "700", fontStyle: "italic", textAlign: "center", lineHeight: 1.15, textColor: "#ffffff", underline: true, box: { x: 10, y: 12, w: 80, h: 20 } })
  })

  it("refuses text with a non-uniform scale that the output renderer cannot reproduce", () => {
    const textOnly: Scene = { ...sermon, layers: [sermon.layers.find((candidate) => candidate.kind === "text")!] }
    const design = sceneToDesign(textOnly)
    const node = design.scene.nodes.title
    if (node.type !== "text") throw new Error("text")
    const scene = {
      ...design.scene,
      nodes: { ...design.scene.nodes, title: { ...node, scaleX: 1.5 } },
    }
    expect(designToScene({ ...design, scene }).issues).toEqual(expect.arrayContaining([
      { nodeId: "title", message: "Text must keep an even, unflipped scale for Rhema scene output" },
    ]))
  })

  it("carries group visibility to its layers and blocks group opacity or rotation on save", () => {
    const design = sceneToDesign(sermon)
    const root = design.scene.nodes[SARASWATI_ROOT_ID]
    if (root.type !== "group") throw new Error("root")
    const group: SaraswatiGroupNode = {
      id: "content-group", type: "group", parentId: SARASWATI_ROOT_ID, visible: false, opacity: 0.5,
      rotation: 15, children: ["cam", "verse"],
    }
    const children = [...root.children]
    const position = children.indexOf("cam")
    const rootChildren = children.filter((id) => id !== "cam" && id !== "verse")
    rootChildren.splice(position, 0, group.id)
    const scene = {
      ...design.scene,
      nodes: {
        ...design.scene.nodes,
        [SARASWATI_ROOT_ID]: { ...root, children: rootChildren },
        [group.id]: group,
        cam: { ...design.scene.nodes.cam, parentId: group.id },
        verse: { ...design.scene.nodes.verse, parentId: group.id },
      },
    }
    const { scene: saved, issues } = designToScene({ ...design, scene })
    const byId = Object.fromEntries(saved.layers.map((item) => [item.id, item]))
    expect(byId.cam.visible).toBe(false)
    expect(byId.verse.visible).toBe(false)
    expect(issues.filter((i) => i.nodeId === group.id)).toEqual([])
  })

  it("saves a turned, cropped picture with its turn and its crop (#851 G7)", () => {
    const design = sceneToDesign(sermon)
    let scene = design.scene
    scene = applyCommand(scene, { type: "ROTATE_NODE", id: "pic", rotation: 20 })
    scene = applyCommand(scene, { type: "SET_IMAGE_CROP", id: "pic", cropX: 12, cropY: 8, cropWidth: 180, cropHeight: 120 })
    const { issues, scene: saved } = designToScene({ ...design, scene })
    expect(issues).toEqual([])
    expect(saved.layers.find((l) => l.id === "pic")?.rotation).toBe(20)
    expect(saved.layers.find((l) => l.id === "pic")?.imageDraw).toMatchObject({ cropX: 12, cropY: 8, cropWidth: 180, cropHeight: 120 })
  })
})

describe("picture crop and clipping (#448 Slice B)", () => {
  const cropped = () => {
    const design = sceneToDesign(sermon)
    let scene = applyCommand(design.scene, { type: "SET_IMAGE_CROP", id: "pic", cropX: 10, cropY: 5, cropWidth: 80, cropHeight: 40 })
    scene = applyCommand(scene, { type: "SET_IMAGE_BORDER_RADIUS", id: "pic", radius: 24 })
    scene = applyCommand(scene, { type: "SET_NODE_CLIP_PATH", id: "pic", clipPath: { type: "ellipse", x: 0, y: 0, width: 400, height: 300 } })
    return { ...design, scene }
  }

  it("saves crop, rounded corners and a clip as the editor keeps them, and they reopen the same", () => {
    const { scene, issues } = designToScene(cropped())
    expect(issues).toEqual([])
    const pic = scene.layers.find((l) => l.id === "pic")!
    expect(pic.imageDraw).toMatchObject({ width: 576, height: 432, cropX: 10, cropY: 5, cropWidth: 80, cropHeight: 40, clips: [{ type: "ellipse", x: 0, y: 0, width: 400, height: 300 }] })
    expect(pic.imageDraw?.radius).toBeGreaterThan(0)
    expect(pic.box).toEqual({ x: 10, y: 20, w: 30, h: 40 })
    const stored = JSON.parse(JSON.stringify(scene)) as Scene
    const reopened = designToScene(JSON.parse(JSON.stringify(sceneToDesign(stored))))
    expect(reopened.issues).toEqual([])
    expect(reopened.scene).toEqual(stored)
  })

  it("a picture resized after cropping keeps its own size and scales onto the box", () => {
    const design = cropped()
    const pic = design.scene.nodes.pic
    if (pic.type !== "image") throw new Error("image")
    const resized = designToScene({ ...design, scene: { ...design.scene, nodes: { ...design.scene.nodes, pic: { ...pic, scaleX: 2, scaleY: 0.5 } } } })
    expect(resized.issues).toEqual([])
    const layer = resized.scene.layers.find((l) => l.id === "pic")!
    expect(layer.imageDraw).toMatchObject({ width: 576, height: 432 })
    expect(layer.box).toEqual({ x: 10, y: 20, w: 60, h: 20 })
    expect(sceneToDesign(resized.scene).scene.nodes.pic).toMatchObject({ width: 576, height: 432, scaleX: 2, scaleY: 0.5 })
  })

  it("an untouched picture still covers its box, as before", () => {
    const { scene } = designToScene(sceneToDesign(sermon))
    expect(scene.layers.find((l) => l.id === "pic")?.imageDraw).toBeUndefined()
  })

  it.each([
    ["a flipped picture", (n: Record<string, unknown>) => ({ ...n, scaleX: -1 }), "positive, unflipped scale"],
    ["a crop starting outside", (n: Record<string, unknown>) => ({ ...n, cropX: -5 }), "cannot start before its edge"],
    ["a zero-pixel crop", (n: Record<string, unknown>) => ({ ...n, cropWidth: 0 }), "at least one pixel"],
    ["a polygon clip", (n: Record<string, unknown>) => ({ ...n, clipPath: { type: "polygon", points: [] } }), "rectangles and ellipses only"],
    ["too many clips", (n: Record<string, unknown>) => ({ ...n, clipPathStack: Array.from({ length: 4 }, () => ({ type: "ellipse", x: 0, y: 0, width: 10, height: 10 })) }), "at most 4 clips"],
    ["an infinite clip", (n: Record<string, unknown>) => ({ ...n, clipPath: { type: "rect", x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 10, radiusX: 0, radiusY: 0 } }), "finite position and a size"],
  ])("refuses %s, saying why", (_why, edit, says) => {
    const design = cropped()
    const scene = { ...design.scene, nodes: { ...design.scene.nodes, pic: edit(design.scene.nodes.pic as unknown as Record<string, unknown>) as never } }
    expect(designToScene({ ...design, scene }).issues).toEqual([{ nodeId: "pic", message: expect.stringContaining(says) }])
  })

  it("fades a group's layers by the group's opacity, overlapping or not, as the editor does (#448)", () => {
    const apart: Scene = { ...sermon, layers: [layer("a", "color", { color: "#ff0000", box: { x: 0, y: 0, w: 60, h: 60 }, opacity: 0.8 }), layer("b", "ellipse", { color: "#00ff00", box: { x: 50, y: 50, w: 40, h: 40 } })] }
    const d2 = sceneToDesign(apart)
    const r2 = d2.scene.nodes[d2.scene.root]!
    const out = designToScene({ ...d2, scene: { ...d2.scene, nodes: { ...d2.scene.nodes, [r2.id]: { ...r2, opacity: 0.5 } } } })
    expect(out.issues).toEqual([])
    expect(out.scene.layers.map((l) => [l.id, l.opacity])).toEqual([["a", 0.4], ["b", 0.5]])
    // Turning a group turns each of its layers, as the editor does; the group's angle is not drawn.
    const turned = applyCommand({ ...d2.scene, nodes: { ...d2.scene.nodes, g: { id: "g", type: "group", parentId: r2.id, visible: true, opacity: 1, rotation: 0, children: ["a", "b"] }, a: { ...d2.scene.nodes.a, parentId: "g" }, b: { ...d2.scene.nodes.b, parentId: "g" }, [r2.id]: { ...r2, children: ["g"] } } } as never, { type: "ROTATE_NODE", id: "g", rotation: 30 })
    const saved = designToScene({ ...d2, scene: turned })
    expect(saved.issues).toEqual([])
    expect(saved.scene.layers.map((l) => l.rotation)).toEqual([30, 30])
    // Out of range is clamped as the editor clamps it.
    const over = designToScene({ ...d2, scene: { ...d2.scene, nodes: { ...d2.scene.nodes, [r2.id]: { ...r2, opacity: 1.5 } } } })
    expect(over.scene.layers.map((l) => l.opacity)).toEqual([0.8, 1])
  })
})

describe("gradient paint (#448 Slice A)", () => {
  const linear = (angle: number, ...stops: [string, number][]) => ({ type: "gradient" as const, css: "", stops: stops.map(([color, offset]) => ({ color, offset })), angle })
  const graded = () => {
    let scene = sceneToDesign(sermon).scene
    scene = applyCommand(scene, { type: "SET_ARTBOARD", bg: linear(135, ["#0b1a3a", 0], ["rgba(209, 76, 98, 0.5)", 0.6], ["#ffffffcc", 1]) })
    scene = applyCommand(scene, { type: "SET_NODE_FILL", id: "bg", fill: linear(90, ["#202040", 0], ["#3157a4", 1]) })
    return { ...sceneToDesign(sermon), scene }
  }

  it("saves the artboard's and a colour layer's gradient as typed paint, and they reopen the same", () => {
    const { scene, issues } = designToScene(graded())
    expect(issues).toEqual([])
    expect(scene.backgroundGradient).toEqual({ angle: 135, stops: [{ color: "#0b1a3a", offset: 0 }, { color: "rgba(209, 76, 98, 0.5)", offset: 0.6 }, { color: "#ffffffcc", offset: 1 }] })
    expect(scene.background).toBe("#0b1a3a")
    expect(scene.layers[0]).toMatchObject({ id: "bg", color: "#202040", gradient: { angle: 90, stops: [{ color: "#202040", offset: 0 }, { color: "#3157a4", offset: 1 }] } })
    // Saved, reopened (JSON, as the store keeps it), opened in the editor again and saved: unchanged.
    const stored = JSON.parse(JSON.stringify(scene)) as Scene
    const reopened = designToScene(JSON.parse(JSON.stringify(sceneToDesign(stored))))
    expect(reopened.issues).toEqual([])
    expect(reopened.scene).toEqual(stored)
    expect(sceneToDesign(stored).scene.artboard.bg).toMatchObject({ type: "gradient", angle: 135, css: "linear-gradient(135deg, #0b1a3a 0%, rgba(209, 76, 98, 0.5) 60%, #ffffffcc 100%)" })
  })

  it("going back to a solid fill leaves no gradient behind", () => {
    const stored = designToScene(graded()).scene
    const design = sceneToDesign(stored)
    let scene = applyCommand(design.scene, { type: "SET_ARTBOARD", bg: { type: "solid", color: "#101020" } })
    scene = applyCommand(scene, { type: "SET_NODE_FILL", id: "bg", fill: { type: "solid", color: "#112233" } })
    const solid = designToScene({ ...design, scene, meta: { ...design.meta, backgroundGradient: stored.backgroundGradient } as typeof design.meta })
    expect(solid.issues).toEqual([])
    expect(solid.scene.backgroundGradient).toBeUndefined()
    expect(solid.scene.layers[0]?.gradient).toBeUndefined()
    expect(solid.scene.layers[0]?.color).toBe("#112233")
  })

  it.each([
    ["no stops", linear(90), "between 2 and 16 colour stops"],
    ["one stop", linear(90, ["#000000", 0]), "between 2 and 16 colour stops"],
    ["too many stops", linear(90, ...Array.from({ length: 17 }, (_, i): [string, number] => ["#000000", i / 16])), "between 2 and 16 colour stops"],
    ["a named colour", linear(90, ["red", 0], ["#000000", 1]), "hex (#rrggbb, #rrggbbaa) or rgb()/rgba()"],
    ["a CSS function", linear(90, ["url(x)", 0], ["#000000", 1]), "hex (#rrggbb, #rrggbbaa) or rgb()/rgba()"],
    ["a stop past the end", linear(90, ["#000000", 0], ["#ffffff", 2]), "between 0 and 100%"],
    ["no angle", { ...linear(90, ["#000000", 0], ["#ffffff", 1]), angle: Number.NaN }, "finite angle"],
  ])("refuses a gradient it cannot draw (%s), saying why", (_why, bad, says) => {
    const design = sceneToDesign(sermon)
    const background = designToScene({ ...design, scene: applyCommand(design.scene, { type: "SET_ARTBOARD", bg: bad }) })
    expect(background.issues).toEqual([{ nodeId: "__artboard__", message: expect.stringContaining(says) }])
    const fill = designToScene({ ...design, scene: applyCommand(design.scene, { type: "SET_NODE_FILL", id: "bg", fill: bad }) })
    expect(fill.issues).toEqual([{ nodeId: "bg", message: expect.stringContaining(says) }])
  })

  it("still refuses a gradient on a live layer's placeholder", () => {
    const design = sceneToDesign(sermon)
    const { issues } = designToScene({ ...design, scene: applyCommand(design.scene, { type: "SET_NODE_FILL", id: "cam", fill: linear(90, ["#000000", 0], ["#ffffff", 1]) }) })
    expect(issues).toContainEqual({ nodeId: "cam", message: "Gradient fills on this live layer cannot be saved into a Rhema scene yet" })
  })
})

describe("a design whose node tree is broken", () => {
  it("reports a missing root or child and survives a group inside itself, never an empty scene without a word", () => {
    const design = sceneToDesign(sermon)
    const missingRoot = designToScene({ ...design, scene: { ...design.scene, root: "nowhere" } })
    expect(missingRoot.scene.layers).toEqual([])
    expect(missingRoot.issues).toEqual([{ nodeId: "nowhere", message: expect.stringContaining("missing") }])
    const root = design.scene.nodes[SARASWATI_ROOT_ID]
    if (root.type !== "group") throw new Error("root")
    const looped = { ...design.scene, nodes: { ...design.scene.nodes, [SARASWATI_ROOT_ID]: { ...root, children: [...root.children, "ghost", SARASWATI_ROOT_ID] } } }
    const { scene, issues } = designToScene({ ...design, scene: looped })
    expect(scene.layers.map((l) => l.id)).toEqual(sermon.layers.map((l) => l.id))
    expect(issues.map((i) => i.nodeId)).toEqual(["ghost", SARASWATI_ROOT_ID])
    const childless = { ...design.scene, nodes: { ...design.scene.nodes, [SARASWATI_ROOT_ID]: { ...root, children: undefined as unknown as string[] } } }
    expect(designToScene({ ...design, scene: childless }).issues).toEqual([{ nodeId: SARASWATI_ROOT_ID, message: expect.stringContaining("no list") }])
  })
})

describe("a scene made from a design version", () => {
  it("is pinned to that version, and a newer version is only offered, never applied", () => {
    const v1 = { designId: "d1", version: 1, document: sceneToDesign(sermon) }
    const { scene, issues } = sceneFromVersion(v1)
    expect(issues).toEqual([])
    expect(scene.design).toEqual({ id: "d1", version: 1 })
    expect(scene.layers).toEqual(sermon.layers)
    // The design moves on to version 2: the scene made from version 1 is unchanged and is offered v2.
    const moved = applyCommand(v1.document.scene, { type: "MOVE_NODE", id: "cam", dx: 192, dy: 0 })
    const v2 = { designId: "d1", version: 2, document: { ...v1.document, scene: moved } }
    expect(scene.layers.find((l) => l.id === "cam")?.box.x).toBe(10)
    expect(pinStatus(scene, 2)).toEqual({ pin: { id: "d1", version: 1 }, update: 2 })
    expect(pinStatus(scene, 1)).toEqual({ pin: { id: "d1", version: 1 }, update: null })
    expect(pinStatus(sermon, 2)).toBeNull()
    // Choosing the update makes a new scene pinned to v2; the old one is untouched.
    const updated = sceneFromVersion(v2).scene
    expect(updated.design).toEqual({ id: "d1", version: 2 })
    expect(updated.layers.find((l) => l.id === "cam")?.box.x).toBe(20)
    // Survives the design round trip (an approved snapshot keeps the pin as JSON).
    expect(JSON.parse(JSON.stringify(scene)).design).toEqual({ id: "d1", version: 1 })
    expect(designToScene(sceneToDesign(scene)).scene.design).toEqual({ id: "d1", version: 1 })
  })
})

describe("a designed moment in a service", () => {
  const store = new Map([["d1@1", { designId: "d1", version: 1, document: sceneToDesign(sermon) }]])
  const getVersion = async (id: string, version: number) => store.get(`${id}@${version}`) ?? null

  it("shows the scene from the version it pins", async () => {
    const { scene, issues } = await resolveDesignedMoment({ title: "Welcome", designRef: { id: "d1", version: 1 } }, getVersion)
    expect(issues).toEqual([])
    expect(scene?.design).toEqual({ id: "d1", version: 1 })
    expect(scene?.layers.map((l) => l.id)).toEqual(sermon.layers.map((l) => l.id))
  })

  it("falls back to its own slide, saying why, when the version is missing or unreadable, never another version", async () => {
    const missing = await resolveDesignedMoment({ title: "Welcome", designRef: { id: "d1", version: 2 } }, getVersion)
    expect(missing.scene).toBeNull()
    expect(missing.issues[0].message).toContain("version 2 is not in this computer's designs")
    const failing = await resolveDesignedMoment({ title: "Welcome", designRef: { id: "d1", version: 1 } }, () => Promise.reject(new Error("db closed")))
    expect(failing).toEqual({ scene: null, issues: [{ nodeId: "__design__", message: expect.stringContaining("could not be read") }] })
    expect(await resolveDesignedMoment({ title: "Plain slide" }, getVersion)).toEqual({ scene: null, issues: [] })
  })

  it("does not show a version it cannot draw faithfully", async () => {
    const broken = { designId: "d2", version: 1, document: { ...sceneToDesign(sermon), scene: { ...sceneToDesign(sermon).scene, root: "nowhere" } } }
    const { scene, issues } = await resolveDesignedMoment({ title: "Welcome", designRef: { id: "d2", version: 1 } }, async () => broken)
    expect(scene).toBeNull()
    expect(issues.length).toBeGreaterThan(0)
  })
})

describe("live layers in the editor's preview", () => {
  const live = (bible: string | null, ticker = "Welcome to service") => ({
    program: { onAir: true, reference: bible },
    sources: [
      { id: "bible", reference: bible ?? "", on: bible !== null },
      { id: "ticker", reference: ticker, on: true },
      { id: "timer", reference: "running · 12:30", on: true, state: "running" },
      { id: "camera:pulpit", reference: "pulpit", on: true, state: "sending" },
    ],
    clockValues: { timer: "running · 12:30", countdown: { next: "running · 12:30" } },
  })

  it("show what each live layer would show now, and follow the Live State", () => {
    const design = sceneToDesign(sermon)
    const words = (s: ReturnType<typeof previewDesign>) =>
      Object.fromEntries(Object.values(s.nodes).filter((n) => n.id.startsWith("preview:") && n.type === "text").map((n) => [n.id, (n as { text: string }).text]))
    const first = words(previewDesign(design, live("John 3:16")))
    expect(first).toMatchObject({ "preview:verse": "John 3:16", "preview:ticker": "Welcome to service", "preview:clock": "running · 12:30", "preview:cam": "pulpit · sending" })
    expect(first["preview:logo"]).toBeUndefined()
    expect(words(previewDesign(design, live("Romans 8:28")))["preview:verse"]).toBe("Romans 8:28")
    expect(words(previewDesign(design, live(null)))["preview:verse"]).toBe("Nothing on air")
  })

  it("uses the clock's selected host source and previews the actual Brand Kit image privately", () => {
    const design = sceneToDesign(sermon)
    const clockId = Object.entries(design.bindings).find(([, binding]) => binding.kind === "clock")![0]
    const logoId = Object.entries(design.bindings).find(([, binding]) => binding.kind === "logo")![0]
    design.bindings[clockId] = { ...design.bindings[clockId]!, clockShows: "until", until: "10:30" }
    design.scene.nodes[logoId] = { ...design.scene.nodes[logoId]!, visible: true }

    const preview = previewDesign(design, {
      ...live("John 3:16"),
      clockValues: { timer: "8:00", time: "10:12", until: { "10:30": "18:00" } },
      logoUrl: "data:image/png;base64,ZmFrZQ==",
    })

    expect(preview.nodes[`preview:${clockId}`]).toMatchObject({ type: "text", text: "18:00" })
    expect(preview.nodes[logoId]).toMatchObject({ type: "image", src: "data:image/png;base64,ZmFrZQ==", name: "logo (Brand Kit preview)" })
    expect(preview.nodes[`preview:${logoId}`]).toBeUndefined()
    expect(preview.nodes[logoId]?.parentId).toBe(design.scene.nodes[logoId]?.parentId)
    expect(design.scene.nodes[logoId]?.type).toBe("rect")
    expect(design.scene.nodes[logoId]?.visible).toBe(true)
  })

  it("uses the newest active source in a feed that follows multiple source kinds", () => {
    const design = sceneToDesign(sermon)
    design.bindings.verse = { ...design.bindings.verse!, shows: ["ticker", "lowerThird", "bible", "song"] as never }
    const preview = previewDesign(design, {
      ...live("John 3:16"),
      sources: [
        { id: "bible", reference: "Romans 8:28", on: true, revision: 4 },
        { id: "song", reference: "Amazing Grace · Verse 1", on: true, revision: 9 },
        { id: "ticker", reference: "Welcome to service", on: true, revision: 99 },
        { id: "lowerThird", reference: "Pastor Tolu", on: true, revision: 100 },
      ],
    })

    expect(preview.nodes["preview:verse"]).toMatchObject({ type: "text", text: "Amazing Grace · Verse 1" })

    design.bindings.verse = { ...design.bindings.verse!, shows: ["ticker", "lowerThird"] as never }
    const overlaysOnly = previewDesign(design, {
      ...live("John 3:16"),
      sources: [
        { id: "ticker", reference: "Welcome to service", on: true, revision: 99 },
        { id: "lowerThird", reference: "Pastor Tolu", on: true, revision: 100 },
      ],
    })
    expect(overlaysOnly.nodes["preview:verse"]).toMatchObject({ type: "text", text: "Nothing on air" })
  })

  it("never change the design itself: the saved scene keeps the subscription, not the words", () => {
    const design = sceneToDesign(sermon)
    const before = JSON.stringify(design)
    previewDesign(design, live("John 3:16"))
    expect(JSON.stringify(design)).toBe(before)
    expect(designToScene(design).scene).toEqual(sermon)
  })
})

describe("a design the host's store accepts", () => {
  it("has the shape the host checks (artboard, root, nodes; every binding names a node) and survives JSON", () => {
    const design = JSON.parse(JSON.stringify(sceneToDesign(sermon))) as ReturnType<typeof sceneToDesign>
    expect(typeof design.scene.root).toBe("string")
    expect(design.scene.artboard).toMatchObject({ width: 1920, height: 1080 })
    expect(Object.keys(design.bindings).every((id) => id in design.scene.nodes)).toBe(true)
    expect(designToScene(design).scene).toEqual(sermon)
  })
})
