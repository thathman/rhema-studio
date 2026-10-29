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
    expect(issues).toEqual(expect.arrayContaining([
      { nodeId: group.id, message: "Group opacity cannot be saved into a flat Rhema scene yet" },
      { nodeId: group.id, message: "Group rotation cannot be saved into a Rhema scene yet" },
    ]))
  })

  it("blocks saves that would drop gradients, layer rotation, or image crop", () => {
    const design = sceneToDesign(sermon)
    let scene = design.scene
    scene = applyCommand(scene, {
      type: "SET_ARTBOARD",
      bg: { type: "gradient", css: "linear-gradient(90deg, #000, #fff)", stops: [{ color: "#000", offset: 0 }, { color: "#fff", offset: 1 }], angle: 90 },
    })
    scene = applyCommand(scene, {
      type: "SET_NODE_FILL",
      id: "bg",
      fill: { type: "gradient", css: "linear-gradient(90deg, #202040, #ffffff)", stops: [{ color: "#202040", offset: 0 }, { color: "#ffffff", offset: 1 }], angle: 90 },
    })
    scene = applyCommand(scene, { type: "ROTATE_NODE", id: "pic", rotation: 20 })
    scene = applyCommand(scene, { type: "SET_IMAGE_CROP", id: "pic", cropX: 12, cropY: 8, cropWidth: 180, cropHeight: 120 })
    const { issues } = designToScene({ ...design, scene })
    expect(issues).toEqual(expect.arrayContaining([
      { nodeId: "__artboard__", message: "Rhema scenes cannot save gradient backgrounds yet" },
      { nodeId: "bg", message: "Gradient layer fills cannot be saved into a Rhema scene yet" },
      { nodeId: "pic", message: "Layer rotation cannot be saved into a Rhema scene yet" },
      { nodeId: "pic", message: "Image crop and clipping cannot be saved into a Rhema scene yet" },
    ]))
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
